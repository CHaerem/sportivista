#!/usr/bin/env node
/**
 * WP-05: publishes docs/data/entities.json — a stable-id index of the
 * athletes/teams/tournaments/leagues the pipeline knows about. This is the
 * lookup table build-events.js uses to stamp `entityId` /
 * `homeTeamEntityId` / `awayTeamEntityId` onto matched events (WP-05 item 2).
 *
 * Four data sources, folded in this priority order:
 *   1. scripts/config/tracked.json — AI-managed and already carries stable
 *      slugs (e.g. "viktor-hovland"). Reused verbatim. This source wins any
 *      cross-source dedup: its id/name/type are never overwritten.
 *   2. scripts/config/norwegian-golfers.json — curated golfer name + aliases
 *      (golf only). Richer than sports-config's flat list, so it's folded in
 *      before sports-config to donate its aliases first.
 *   3. scripts/config/sports-config.js — free-text team/player lists the
 *      fetchers use for norwegian-relevance filtering. No existing ids here;
 *      a stable kebab-case slug is generated from the name.
 *   4. scripts/config/catalog.json tier2 — the coverage compass's named-entity
 *      long-tail (WP-160). tier2.teams → type "team", tier2.tournaments →
 *      type "tournament", with the catalog's own aliases. Makes the WHOLE
 *      catalog long-tail (Liverpool, handball clubs, tennis majors, cycling
 *      monuments …) searchable/followable on both surfaces without waiting for
 *      the world register (WP-161). tracked.json still wins dedup (it's folded
 *      first); a tier2 entity that overlaps no already-registered SAME-type
 *      entity registers fresh under its authoritative tier2 type.
 *   5. scripts/config/registry/*.json — the WORLD REGISTRY (WP-161): the
 *      seeded, durable follow universe (~1 500–5 000 entities — every club in
 *      covered leagues, national teams, F1 field, WorldTour squads, ATP/WTA +
 *      FIDE top lists, esports orgs, winter-sport athletes; see
 *      registry.schema.json and scripts/seed-registry/). Folded LAST among the
 *      entity sources so every pre-registry entity keeps its exact published
 *      id/name/type (follow-targets in user profiles must never silently
 *      change id). A registry entity that overlaps an existing SAME-type
 *      entity merges into it — donating aliases plus its `external` source ids
 *      and `country` — while a fresh one registers under its own stable
 *      registry id. Registry files are pre-deduped artifacts with globally
 *      unique ids (CI-enforced), so registry entities are deliberately NOT
 *      dedup-scanned against each other (a boundary cap keeps the fold
 *      linear). The registry is authoritative on type: a cross-type overlap
 *      (tracked's misfiled club-as-league vs. the registry's team) registers
 *      fresh under the registry type and logs the mismatch (WP-160 semantics).
 *
 * Entry shape: { id, name, aliases: [], sport, type, country?, national?, colors?, external? }
 *
 * WP-185: `country` (ISO 3166-1 alpha-2), `national` (a landslag, not a club) and
 * `colors` ({primary, secondary} hex) ride along from the world registry — the
 * per-entity VISUAL IDENTITY both clients draw their row avatar from (flag for
 * athletes/national teams, colour monogram for clubs, sport glyph when neither is
 * known). Pure pass-through: this file never invents or guesses them.
 * type ∈ "athlete" | "team" | "tournament" | "league" | "sport" | "category"
 *
 * WP-64: "sport" (one per followBroadly sport) and "category" (umbrella terms
 * like "Vintersport") entities are appended last. They make a broadly-followed
 * sport and an umbrella term groundable by the app-side assistant, and are
 * server-inert — NOT in build-events.js's athlete/team/league enrichment pools,
 * so they never stamp an entityId onto an event.
 *
 * Dedup rule: a candidate merges into an already-registered entity of the
 * SAME sport AND SAME type when any (name|alias) term of one word-boundary-
 * matches (containsName, scripts/lib/helpers.js) any term of the other, in
 * either direction — never naive substring (the Brooklyn/Lyn trap documented
 * in tests/fixtures/feed-vectors/DIVERGENCES.md: "Brooklyn FC" must not match
 * the tracked club "Lyn"). The type match guards against a coincidental
 * substring inside an unrelated entity's descriptive name — e.g. sports-config's
 * free-text team "Lyn" must not fold into tracked.json's league entry
 * "OBOS-ligaen 2026 (Lyn Oslo)" just because the substring "lyn" appears in its
 * display name; requiring type equality (team vs. league) keeps them separate.
 * On merge, only aliases are unioned — the first-registered entity keeps its
 * id/name/type/sport.
 *
 * WP-125: dedup ALSO fires when one term is a nickname / initial-form of
 * another — the "100 Thieves" ⇄ "100T" class. sports-config lists both spellings
 * of the same team so its focus-team filter matches either; left un-folded they
 * became two entities (`100-thieves` + `100t`), so a fan following one never
 * matched events/news stamped with the other (a real lens-miss). `isNicknameForm`
 * (below) closes it: "100T" now folds in as an ALIAS of "100 Thieves", one id.
 *
 * WP-133: dedup ALSO fires for a curated cross-language SYNONYM — the "Norway"
 * ⇄ "Norge" class. Two spellings of the same national side share no token and
 * are not initial-forms of each other, so the token-overlap / initial-form rules
 * above never fold them; left un-folded, sports-config's own "Norway"/"Norge"
 * pair became two team entities, so a fan following one never matched events
 * stamped with the other (the WP-125 lens-miss class, again). `isKnownAlias`
 * (below) closes it via an explicit, curated table — deliberately narrower than a
 * generic cross-language heuristic: only the exact listed spellings fold, so it
 * can never over-merge two genuinely different teams.
 *
 * Known, accepted limitation: dedup still needs a token overlap, an initial-form
 * match, OR a curated known-alias pair. Purely alternate spellings with no shared
 * token, no abbreviation relationship, and no table entry are NOT folded and end
 * up as separate entities. Matching against event text still works either way,
 * just under two ids; general synonym-resolution is future work.
 *
 * NOTE ON TYPE ACCURACY: tracked.json files a few entries under its "leagues"
 * bucket that are really clubs (e.g. "fc-barcelona"), because tracked.json
 * has no separate "teams" bucket. This index labels them `type: "league"`
 * accordingly (a direct, defensible mirror of the source bucket) — but
 * build-events.js's homeTeam/awayTeam matching pool includes BOTH "team" and
 * "league" typed entities, so a literal `homeTeam: "FC Barcelona"` still
 * resolves correctly regardless of the label. Type-driven client behaviour is
 * out of scope for this WP. catalog.json tier2 (source 4), by contrast, has
 * PRECISE team/tournament lists — so where a tier2 entity fails to dedup into a
 * tracked entry only because the buckets disagree on type (tracked's misfiled
 * club "fc-barcelona" as a league vs. tier2's "Barcelona" as a team), the tier2
 * type is authoritative and it registers as its own correctly-typed entity.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonIfExists, rootDataPath, configDirPath, normalizeText, containsName } from "./lib/helpers.js";
import { sportsConfig as defaultSportsConfig } from "./config/sports-config.js";
import { readLogoPolicy, isLogoAllowed } from "./lib/logo-policy.js";

/**
 * WP-64: the sports shown broadly on the board even without a specific tracked
 * entity. Read from interests.json's `followBroadly`, else this default — kept
 * deliberately in sync with build-events.js (both derive the same "broad
 * coverage" set the same way). Winter sports are the datahull this WP closes:
 * "all vintersport" was ungroundable because these sports had NO entity to
 * ground to.
 */
export const DEFAULT_FOLLOW_BROADLY = [
	"football", "golf", "f1", "cycling", "chess", "esports",
	"biathlon", "cross-country", "alpine", "nordic", "ski jumping",
];

/**
 * WP-64: Norwegian display name + aliases for each canonical sport tag. Used to
 * publish one sport-level entity per followBroadly sport so a bare "skiskyting"
 * / "mer langrenn" grounds to a real entity. Aliases carry the English tag and
 * common Norwegian variants so the app resolver matches either.
 */
const SPORT_LABELS = {
	football: { name: "Fotball", aliases: ["football", "soccer"] },
	golf: { name: "Golf", aliases: [] },
	tennis: { name: "Tennis", aliases: [] },
	f1: { name: "Formel 1", aliases: ["F1", "Formula 1", "Formula One"] },
	cycling: { name: "Sykkel", aliases: ["sykling", "landeveissykling", "cycling"] },
	chess: { name: "Sjakk", aliases: ["chess"] },
	esports: { name: "Esport", aliases: ["esports", "e-sport", "CS2"] },
	athletics: { name: "Friidrett", aliases: ["athletics"] },
	handball: { name: "Håndball", aliases: ["handball"] },
	biathlon: { name: "Skiskyting", aliases: ["biathlon"] },
	"cross-country": { name: "Langrenn", aliases: ["langrennsski", "cross-country skiing"] },
	alpine: { name: "Alpint", aliases: ["utfor", "slalåm", "alpine skiing"] },
	nordic: { name: "Nordisk kombinert", aliases: ["kombinert", "nordic combined"] },
	"ski jumping": { name: "Hopp", aliases: ["skihopp", "ski jumping"] },
};

/**
 * WP-64: umbrella categories → the member sports they expand to. Publishing a
 * category entity ("Vintersport") makes the umbrella term itself groundable as
 * ONE broad-scope following; the member expansion (category → set of sports)
 * lives app-side in SportVocabulary (EntityIndex.swift). A category is only
 * published when at least one member is in followBroadly.
 */
const CATEGORIES = {
	"winter-sports": {
		name: "Vintersport",
		aliases: ["vinteridrett", "vinteridretter", "vintersporter", "winter sports"],
		members: ["biathlon", "cross-country", "nordic", "alpine", "ski jumping"],
	},
};

/**
 * Broad-coverage sport set (lowercased). WP-96: the compass is the catalog's
 * `tier1` ("what we cover wholesale"); falls back to interests.json's
 * `followBroadly` (owner reference), then the default — kept deliberately in
 * sync with build-events.js's `coveredBroadly`.
 */
function readFollowBroadly(configDir) {
	const catalog = readJsonIfExists(path.join(configDir, "catalog.json"));
	const interests = readJsonIfExists(path.join(configDir, "interests.json"));
	const list = (Array.isArray(catalog?.tier1) && catalog.tier1.length && catalog.tier1)
		|| (Array.isArray(interests?.followBroadly) && interests.followBroadly.length && interests.followBroadly)
		|| DEFAULT_FOLLOW_BROADLY;
	return list.map((s) => String(s).toLowerCase());
}

/**
 * WP-64: append one sport-level entity per followBroadly sport, plus each
 * umbrella category whose members intersect followBroadly. These carry type
 * "sport"/"category" — deliberately OUTSIDE build-events.js's athlete/team/
 * league enrichment pools, so they are server-inert (never stamp an entityId
 * onto an event) and exist purely for the app-side resolver to ground a broad
 * sport-/category-following through the normal diff/confirm flow.
 */
function addBroadCoverageEntities(builder, configDir) {
	const followBroadly = readFollowBroadly(configDir);
	const inScope = new Set(followBroadly);
	for (const sport of followBroadly) {
		const label = SPORT_LABELS[sport];
		if (!label) continue;
		builder.upsert({ id: `sport-${slugify(sport)}`, name: label.name, aliases: [...label.aliases], sport, type: "sport" });
	}
	for (const [key, cat] of Object.entries(CATEGORIES)) {
		if (!cat.members.some((m) => inScope.has(m))) continue;
		builder.upsert({ id: `category-${key}`, name: cat.name, aliases: [...cat.aliases], sport: "winter", type: "category" });
	}
}

/**
 * Stable kebab-case slug. normalizeText (helpers.js) strips COMBINING marks
 * via NFD, which already folds "å"/"é" etc. to their base letter — but "æ"/
 * "ø" have no such decomposition (they're standalone letters), so they'd
 * otherwise collapse to a bare "-" and produce an ugly id (e.g. "Søren
 * Wærenskjold" → "s-ren-w-renskjold"). Transliterate those explicitly first
 * for a readable slug ("soren-waerenskjold").
 */
export function slugify(name) {
	const translit = String(name || "")
		.replace(/[æÆ]/g, "ae")
		.replace(/[øØ]/g, "o");
	return normalizeText(translit)
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * tracked.json's "leagues" bucket sometimes appends a human-readable
 * parenthetical explaining WHY it's tracked (e.g. "La Liga 2026/27
 * (Barcelona)", "OBOS-ligaen 2026 (Lyn Oslo)") — context for a human reading
 * tracked.json's reasoning, not part of the league's identity. Left in, that
 * annotation makes the LEAGUE's own name word-boundary-match the annotated
 * TEAM's name (e.g. a "Lyn" homeTeam would wrongly resolve to the league
 * entity "obos-ligaen-2026" instead of no match / the actual Lyn team
 * entity) — strip it before the name becomes an identity/match term.
 */
function stripTrailingAnnotation(name) {
	return String(name || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function uniqueSlug(base, used) {
	const root = base || "entity";
	let slug = root;
	let n = 2;
	while (used.has(slug)) slug = `${root}-${n++}`;
	return slug;
}

/**
 * WP-16.2: a display name with its edition noise removed — the trailing
 * parenthetical annotation (already stripped from league names, but kept on
 * tournaments) AND any 4-digit year / "2026/27" season token — collapsed and
 * trimmed. "Tour de France 2026" → "Tour de France"; "The Open Championship
 * 2026 (Royal Birkdale)" → "The Open Championship"; "La Liga 2026/27" → "La
 * Liga". Returns "" when nothing meaningful remains. Used to derive the
 * year-strip alias and the initial-alias below (so a fan typing the bare,
 * yearless name — or its initials — still resolves in the app).
 */
function editionStrippedName(name) {
	return String(name || "")
		.replace(/\s*\([^)]*\)\s*$/g, " ")            // trailing "(…)" annotation
		.replace(/\b(?:19|20)\d{2}(?:\s*\/\s*\d{2})?\b/g, " ") // 2026 · 2026/27
		.replace(/\s{2,}/g, " ")
		.replace(/^[\s\p{Pd}–—-]+|[\s\p{Pd}–—-]+$/gu, "") // stray leading/trailing dashes
		.trim();
}

/**
 * WP-162: the edition token inside an ID — "-2026" or "-2026-27", anchored so it
 * only fires on a whole segment ("premier-league-2026-27", "blast-bounty-2026-s2").
 * A bare 4-digit year that is part of a NAME ("100 Thieves") can never match: the
 * hyphen prefix plus the segment lookahead require it to be its own id segment.
 */
const EDITION_ID_SEGMENT = /-((?:19|20)\d{2})(?:-(\d{2}))?(?=-|$)/g;

/**
 * WP-162: the SEASONLESS form of an entity id — every edition segment removed.
 * "premier-league-2026-27" → "premier-league"; "esports-world-cup-2026-cs2" →
 * "esports-world-cup-cs2"; "tour-de-france-2026" → "tour-de-france". Returns the
 * input unchanged when it carries no edition segment.
 */
export function seasonlessId(id) {
	const raw = String(id || "");
	const stripped = raw.replace(EDITION_ID_SEGMENT, "").replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
	return stripped || raw;
}

/**
 * WP-162: the edition an id names, as human metadata — "2026-27" → "2026/27",
 * "2026" → "2026". null when the id carries no edition segment. The LAST segment
 * wins (ids put the edition last: "blast-bounty-2026-s2" → "2026").
 */
export function editionOfId(id) {
	let out = null;
	for (const m of String(id || "").matchAll(EDITION_ID_SEGMENT)) {
		out = m[2] ? `${m[1]}/${m[2]}` : m[1];
	}
	return out;
}

/** WP-162: competition entities — the recurring things an edition applies to. */
const COMPETITION_TYPES = new Set(["league", "tournament"]);

/**
 * WP-162 — CANONICAL, SEASONLESS IDS. A profile rule freezes `entityId` at
 * follow time, so an edition-stamped id (`premier-league-2026-27`) is a follow
 * with an expiry date: next season's bookkeeping publishes a NEW id, the old
 * rule matches nothing, and the follow dies SILENTLY. tracked.json may keep
 * booking dated editions (it is the flyktige bokføring) — this step maps them
 * onto one durable id per competition, with the edition kept as METADATA:
 *
 *   • `id`      → the seasonless form ("premier-league")
 *   • `edition` → the edition it currently books ("2026/27")
 *   • `altIds`  → every id this entity has been published under, so an EXISTING
 *                 profile rule still resolves even before the client-side
 *                 migration has run (belt and braces — see ProfileIdMigration /
 *                 ssMigrateProfileIds).
 *
 * When the canonical id is ALREADY taken by another competition of the same
 * sport (the tracked dated league vs. the catalog's seasonless tournament — two
 * records for ONE competition, kept apart today only by the league/tournament
 * type split), the two are MERGED rather than renamed around each other: the
 * earlier-registered entity survives (source priority is load-bearing, WP-166),
 * takes the canonical id, the seasonless display name and the type the canonical
 * id already published, and unions aliases/altIds/identity metadata. When the
 * canonical id is taken by something that is NOT the same competition (a club
 * misfiled in tracked's league bucket vs. the registry's team — "rosenborg"),
 * NOTHING is renamed: the dated id is left alone and the collision logged.
 * Mutates + returns the array.
 */
function canonicalizeEditions(entities) {
	const byId = new Map();
	for (const e of entities) if (!byId.has(e.id)) byId.set(e.id, e);
	const dropped = new Set();

	const addAltId = (e, id) => {
		if (!id || id === e.id) return;
		e.altIds = e.altIds || [];
		if (!e.altIds.includes(id)) e.altIds.push(id);
	};

	for (const e of entities) {
		if (dropped.has(e)) continue;
		if (!COMPETITION_TYPES.has(e.type)) continue;
		const canon = seasonlessId(e.id);
		if (canon === e.id) continue;
		const edition = editionOfId(e.id);
		const other = byId.get(canon);
		if (!other) {
			const oldId = e.id;
			byId.delete(oldId);
			e.id = canon;
			addAltId(e, oldId);
			if (edition && !e.edition) e.edition = edition;
			byId.set(canon, e);
			continue;
		}
		if (other === e) continue;
		const sameSport = !e.sport || !other.sport || normalizeText(e.sport) === normalizeText(other.sport);
		if (!COMPETITION_TYPES.has(other.type) || !sameSport) {
			console.warn(
				`build-entities: canonical id "${canon}" is taken by "${other.name}" (${other.type}); leaving "${e.name}" as "${e.id}".`
			);
			continue;
		}
		// One competition, two records → merge into the EARLIER one (source
		// priority), under the canonical id + the seasonless name/type.
		const ei = entities.indexOf(e);
		const oi = entities.indexOf(other);
		const survivor = ei < oi ? e : other;
		const merged = survivor === e ? other : e;
		const oldSurvivorId = survivor.id;
		survivor.id = canon;
		survivor.type = other.type;                      // the type the canonical id already published
		if (editionStrippedName(merged.name) === merged.name.trim() && merged.name !== survivor.name) {
			// the merged record carries the SEASONLESS display name — prefer it
			if (editionStrippedName(survivor.name) !== survivor.name.trim()) {
				survivor.aliases.push(survivor.name);
				survivor.name = merged.name;
			}
		}
		for (const t of [merged.name, ...(merged.aliases || [])]) {
			const norm = normalizeText(t).trim();
			if (!norm || normalizeText(survivor.name).trim() === norm) continue;
			if (survivor.aliases.some((a) => normalizeText(a).trim() === norm)) continue;
			survivor.aliases.push(t);
		}
		addAltId(survivor, oldSurvivorId);
		addAltId(survivor, merged.id);
		for (const id of merged.altIds || []) addAltId(survivor, id);
		if (edition && !survivor.edition) survivor.edition = edition;
		if (merged.edition && !survivor.edition) survivor.edition = merged.edition;
		if (merged.country && !survivor.country) survivor.country = merged.country;
		if (merged.national && survivor.national === undefined) survivor.national = merged.national;
		if (merged.colors && !survivor.colors) survivor.colors = merged.colors;
		if (merged.logo && !survivor.logo) survivor.logo = merged.logo;
		if (merged.external) survivor.external = { ...merged.external, ...(survivor.external || {}) };
		dropped.add(merged);
		byId.set(canon, survivor);
	}

	const out = entities.filter((e) => !dropped.has(e));
	entities.length = 0;
	entities.push(...out);
	return entities;
}

/**
 * WP-16.2: the initial-alias for a multi-word name ("Tour de France" → "TdF").
 * Only generated for names with 3+ letter-initial words (so it is a real,
 * memorable acronym, not a two-letter near-collision like "PL"). First letter
 * of each letter-initial word, ORIGINAL case preserved for a readable alias.
 * Returns null when there are fewer than three such words.
 *
 * IMPORTANT: this is written to entities.json's own `initials` field, NEVER to
 * `aliases` — server-side matching (build-events entityId enrichment, the
 * relevance/bell paths) reads only name+aliases via helpers.entityTerms, so a
 * 3-letter acronym can never leak into word-boundary haystack matching there.
 * The initials exist purely for the app-side fuzzy resolver (EntityIndex.swift).
 */
function initialAlias(name) {
	const words = editionStrippedName(name)
		.split(/\s+/)
		.filter((w) => /^\p{L}/u.test(w));
	if (words.length < 3) return null;
	return words.map((w) => Array.from(w)[0]).join("");
}

/** Every string an entity/candidate can be recognised by: name + aliases. */
function terms(e) {
	return [e?.name, ...(e?.aliases || [])].filter(Boolean);
}

/**
 * WP-125: the initial / nickname compaction of a MULTI-word name — each word
 * reduced to its leading run (the whole token when it starts with a digit, so
 * "100" stays "100"; else just its first letter). "100 thieves" → "100t";
 * "tour de france" → "tdf". Returns null for a single-word name (nothing to
 * abbreviate). Operates on already-normalizeText'd input.
 */
function initialForm(multiNorm) {
	const words = multiNorm.split(/\s+/).filter(Boolean);
	if (words.length < 2) return null;
	return words.map((w) => (/^\d/.test(w) ? w : Array.from(w)[0])).join("");
}

/**
 * WP-125: is one of these two terms a nickname / initial-form of the other —
 * the "100 Thieves" ⇄ "100T" class? True only when a MULTI-word name compacts
 * (initialForm) EXACTLY to the other, SINGLE-token name. Deliberately asymmetric
 * in shape (multi ⇄ single) so two distinct multi-word teams are never compared
 * this way ("Real Madrid" vs. "Real Mallorca" both survive) and a coincidental
 * single word can't swallow an unrelated multi-word club ("brooklyn fc" → "bf" ≠
 * "lyn"). Same-sport + same-type is already enforced by the caller (upsert).
 */
function isNicknameForm(a, b) {
	const na = normalizeText(a).trim();
	const nb = normalizeText(b).trim();
	if (!na || !nb) return false;
	if (!/\s/.test(nb) && initialForm(na) === nb) return true;
	if (!/\s/.test(na) && initialForm(nb) === na) return true;
	return false;
}

/**
 * WP-133: curated cross-language synonym groups — the "Norway" ⇄ "Norge" class.
 * Each group lists spellings (already normalizeText'd: lowercased, diacritics
 * folded) of ONE and the same entity. Kept intentionally small and explicit: an
 * entry only folds the exact spellings it names, so it cannot over-merge two
 * genuinely different entities the way a generic cross-language heuristic might.
 * Same-sport + same-type is still enforced by the caller (upsert).
 *
 * WP-160: this is now only the SEED / fallback. The live groups are read from
 * the data file scripts/config/entity-aliases.json (readAliasGroups) so
 * research/verify can maintain aliases — cross-language national sides
 * (["sweden", "sverige"]) or club abbreviations (the Liverpool FC/LFC class) —
 * WITHOUT a code change. This constant is used verbatim when the file is absent
 * (e.g. the temp config dirs the pipeline tests spin up).
 */
const SEED_ALIAS_GROUPS = [
	["norway", "norge"],
];

/**
 * WP-160: the curated known-alias groups for `configDir`, read from
 * entity-aliases.json (its `groups` array, each spelling normalizeText'd so the
 * file may carry human-readable casing) and falling back to SEED_ALIAS_GROUPS
 * when the file is missing or malformed.
 */
function readAliasGroups(configDir) {
	const data = readJsonIfExists(path.join(configDir, "entity-aliases.json"));
	const groups = Array.isArray(data?.groups) ? data.groups : null;
	if (!groups) return SEED_ALIAS_GROUPS;
	return groups
		.filter((g) => Array.isArray(g))
		.map((g) => g.map((s) => normalizeText(s).trim()).filter(Boolean))
		.filter((g) => g.length >= 2);
}

/**
 * WP-133/160: are a and b two listed spellings of the same known entity? True
 * only when both normalized terms appear in the SAME curated group.
 */
function isKnownAlias(a, b, aliasGroups) {
	const na = normalizeText(a).trim();
	const nb = normalizeText(b).trim();
	if (!na || !nb || na === nb) return false;
	return aliasGroups.some((group) => group.includes(na) && group.includes(nb));
}

/**
 * A gender / age-category qualifier — the token that marks a SEPARATE competition
 * whose name is otherwise its sibling's ("Tour de France" ⇄ "Tour de France
 * Femmes", "Paris-Roubaix" ⇄ "Paris-Roubaix Femmes", a men's club ⇄ its
 * "…Femenino"/"…U23" side). Word-boundary containment (containsName) treats the
 * longer name as containing the shorter and would otherwise FALSE-MERGE the two
 * into one entity — which silently deletes the shorter competition's entity when
 * its own booking lapses (the men's Tour de France vanishing from the index once
 * the finished race left tracked.json, leaving only "…Femmes"). Normalized,
 * apostrophe/diacritic-folded.
 */
const DISTINCT_QUALIFIERS = new Set([
	"femmes", "feminin", "feminine", "feminines", "feminino", "femenina", "femenino", "femminile",
	"women", "womens", "dames", "damen", "frauen", "kvinner", "damer",
	"u23", "u21", "u19", "u18", "u17", "junior", "juniors", "juvenil", "youth", "espoirs",
]);

/**
 * Are `a` and `b` a competition and its gender/age-category sibling — i.e. one
 * edition-stripped name is the other plus ONLY trailing DISTINCT_QUALIFIER
 * tokens? True ⇒ they are NOT the same entity and must not be folded together,
 * even though containsName would say they overlap. Deliberately narrow: the
 * extra tokens must be qualifiers and nothing else, so it can only ever PREVENT
 * a merge of a men's/women's (or senior/junior) pair — never merge two things.
 */
function isDistinctByQualifier(a, b) {
	const sa = normalizeText(editionStrippedName(a)).trim();
	const sb = normalizeText(editionStrippedName(b)).trim();
	if (!sa || !sb || sa === sb) return false;
	const [short, long] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
	if (!long.startsWith(`${short} `)) return false;
	const extra = long.slice(short.length).trim().split(/\s+/).filter(Boolean);
	return extra.length > 0 && extra.every((tok) => DISTINCT_QUALIFIERS.has(tok.replace(/[^\p{L}\p{N}]+/gu, "")));
}

/**
 * Do two term sets share a word-boundary, nickname/initial-form, or curated
 * known-alias (WP-133/160) match?
 */
function termsOverlap(aTerms, bTerms, aliasGroups) {
	for (const a of aTerms) {
		for (const b of bTerms) {
			if (isDistinctByQualifier(a, b)) continue; // men's/women's (or senior/junior) siblings — never one entity
			if (normalizeText(a).trim() === normalizeText(b).trim()) return true;
			if (containsName(a, b) || containsName(b, a)) return true;
			if (isNicknameForm(a, b)) return true;
			if (isKnownAlias(a, b, aliasGroups)) return true;
		}
	}
	return false;
}

class EntityIndexBuilder {
	constructor(aliasGroups = SEED_ALIAS_GROUPS) {
		this.entities = []; // insertion order = source priority
		this.usedSlugs = new Set();
		this.aliasGroups = aliasGroups;
	}

	/** Register a candidate, or merge it (alias-union only) into a match. */
	upsert({ id, name, aliases = [], sport, type }) {
		if (!name) return null;
		const candidateTerms = [name, ...aliases].filter(Boolean);
		const existing = this.entities.find(
			(e) =>
				e.type === type &&
				(!e.sport || !sport || normalizeText(e.sport) === normalizeText(sport)) &&
				termsOverlap(candidateTerms, terms(e), this.aliasGroups)
		);
		if (existing) {
			for (const t of candidateTerms) {
				const norm = normalizeText(t).trim();
				if (!norm) continue;
				if (normalizeText(existing.name).trim() === norm) continue;
				if (existing.aliases.some((a) => normalizeText(a).trim() === norm)) continue;
				existing.aliases.push(t);
			}
			return existing;
		}
		const slug = id || uniqueSlug(slugify(name), this.usedSlugs);
		this.usedSlugs.add(slug);
		const entity = { id: slug, name, aliases: [...aliases], sport: sport || null, type };
		this.entities.push(entity);
		return entity;
	}

	/**
	 * WP-161: register a WORLD-REGISTRY entity. Differs from upsert() in three
	 * deliberate ways:
	 *   (a) dedup scans only the first `searchLimit` entities — the pre-registry
	 *       sources. Registry files are pre-deduped artifacts with globally
	 *       unique ids (CI-enforced), so registry-vs-registry scanning is
	 *       skipped and the fold stays linear at world scale.
	 *   (b) a SAME-type merge also donates the registry's `external` source ids
	 *       plus the WP-185 identity metadata `country`/`national`/`colors`
	 *       (existing values win — tracked/curated data is never overwritten).
	 *   (c) the registry is authoritative on type: when the candidate overlaps
	 *       an existing entity ONLY across types (the tracked misfiled
	 *       club-as-league class), it registers fresh under its own type and
	 *       the mismatch is logged (WP-160 semantics, now with the log the
	 *       WP-161 contract asks for). An id collision (same slug, genuinely
	 *       different entity) keeps the first-registered id — tracked wins —
	 *       and the registry entity gets a suffixed slug, logged.
	 */
	upsertRegistry({ id, name, aliases = [], sport, type, country, national, colors, logo, external }, searchLimit) {
		if (!name) return null;
		const candidateTerms = [name, ...aliases].filter(Boolean);
		const scope = this.entities.slice(0, searchLimit);
		const sportOk = (e) => !e.sport || !sport || normalizeText(e.sport) === normalizeText(sport);
		const existing = scope.find((e) => e.type === type && sportOk(e) && termsOverlap(candidateTerms, terms(e), this.aliasGroups));
		if (existing) {
			for (const t of candidateTerms) {
				const norm = normalizeText(t).trim();
				if (!norm) continue;
				if (normalizeText(existing.name).trim() === norm) continue;
				if (existing.aliases.some((a) => normalizeText(a).trim() === norm)) continue;
				existing.aliases.push(t);
			}
			if (external && Object.keys(external).length) existing.external = { ...external, ...(existing.external || {}) };
			if (country && !existing.country) existing.country = country;
			if (national && existing.national === undefined) existing.national = true;
			if (colors && !existing.colors) existing.colors = colors;
			if (logo && !existing.logo) existing.logo = logo;
			return existing;
		}
		const crossType = scope.find((e) => e.type !== type && sportOk(e) && termsOverlap(candidateTerms, terms(e), this.aliasGroups));
		if (crossType) {
			console.warn(
				`build-entities: registry type-mismatch — "${name}" (${type}) overlaps "${crossType.name}" (${crossType.type}, id ${crossType.id}); registry type is authoritative, registering fresh.`
			);
		}
		let slug = id || uniqueSlug(slugify(name), this.usedSlugs);
		if (this.usedSlugs.has(slug)) {
			const suffixed = uniqueSlug(slug, this.usedSlugs);
			console.warn(`build-entities: registry id collision — "${slug}" is taken (tracked wins); registering "${name}" as "${suffixed}".`);
			slug = suffixed;
		}
		this.usedSlugs.add(slug);
		const entity = { id: slug, name, aliases: [...aliases], sport: sport || null, type };
		if (country) entity.country = country;
		if (national) entity.national = true;
		if (colors) entity.colors = { ...colors };
		if (logo) entity.logo = { ...logo };
		if (external && Object.keys(external).length) entity.external = { ...external };
		this.entities.push(entity);
		return entity;
	}
}

/**
 * Build the entity index. `configDir` selects where tracked.json /
 * norwegian-golfers.json are read from (env-overridable for tests, like the
 * rest of the pipeline). `sportsConfigData` defaults to the real, production
 * scripts/config/sports-config.js but is injectable so tests can exercise
 * cross-source dedup deterministically without depending on that file's
 * content staying stable over time.
 */
export function buildEntityIndex(configDir = configDirPath(), sportsConfigData = defaultSportsConfig) {
	const builder = new EntityIndexBuilder(readAliasGroups(configDir));

	// 1. tracked.json — ids reused verbatim; this source always wins dedup
	// because it's folded in first.
	const tracked = readJsonIfExists(path.join(configDir, "tracked.json"));
	if (tracked) {
		for (const entry of tracked.leagues || []) {
			builder.upsert({ id: entry.id, name: stripTrailingAnnotation(entry.name), sport: entry.sport, type: "league" });
		}
		for (const entry of tracked.athletes || []) {
			builder.upsert({ id: entry.id, name: entry.name, sport: entry.sport, type: "athlete" });
		}
		for (const entry of tracked.tournaments || []) {
			builder.upsert({ id: entry.id, name: entry.name, sport: entry.sport, type: "tournament" });
		}
	}

	// 2. norwegian-golfers.json — curated golfer name + aliases (golf only).
	const golfers = readJsonIfExists(path.join(configDir, "norwegian-golfers.json"));
	if (Array.isArray(golfers)) {
		for (const g of golfers) {
			if (!g?.name) continue;
			builder.upsert({ name: g.name, aliases: g.aliases || [], sport: "golf", type: "athlete" });
		}
	}

	// 3. sports-config.js — free-text team/player lists; slugified here.
	for (const [sportKey, cfg] of Object.entries(sportsConfigData || {})) {
		const sport = cfg.sport || sportKey;
		const nor = cfg.norwegian || {};
		for (const name of nor.teams || []) {
			builder.upsert({ name, sport, type: "team" });
		}
		for (const name of nor.players || []) {
			builder.upsert({ name, sport, type: "athlete" });
		}
	}

	// 4. WP-160 — catalog.json tier2 long-tail. teams → team, tournaments →
	// tournament, with the catalog's aliases. tracked.json (source 1) already
	// won dedup; a tier2 entity that overlaps no same-type entity registers
	// fresh under its authoritative tier2 type. tier2.athletes are intentionally
	// NOT folded here (out of WP-160 scope — the ~29 teams + ~70 tournaments are).
	const catalog = readJsonIfExists(path.join(configDir, "catalog.json"));
	const tier2 = catalog?.tier2 || {};
	for (const t of tier2.teams || []) {
		if (!t?.name) continue;
		builder.upsert({ name: t.name, aliases: t.aliases || [], sport: t.sport, type: "team" });
	}
	for (const t of tier2.tournaments || []) {
		if (!t?.name) continue;
		builder.upsert({ name: t.name, aliases: t.aliases || [], sport: t.sport, type: "tournament" });
	}

	// 5. WP-161 — the world registry (scripts/config/registry/*.json), folded
	// LAST among the entity sources so every pre-registry entity keeps its
	// exact published id/name/type. Files are read in sorted name order for
	// determinism; the boundary caps dedup scanning to the pre-registry
	// entities (see upsertRegistry). Absent directory → no-op (temp config
	// dirs in tests, and any deployment without a seeded registry).
	const registryDir = path.join(configDir, "registry");
	if (fs.existsSync(registryDir)) {
		const boundary = builder.entities.length;
		const files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json")).sort();
		for (const file of files) {
			const registry = readJsonIfExists(path.join(registryDir, file));
			for (const entity of registry?.entities || []) {
				if (!entity?.id || !entity?.name || !entity?.type) continue;
				builder.upsertRegistry(entity, boundary);
			}
		}
	}

	// 6. WP-64 — sport-/category-level entities (broad-coverage grounding).
	addBroadCoverageEntities(builder, configDir);

	// WP-186: the logo POLICY is applied here, at publish time — not only at seed
	// time. Flipping scripts/config/logo-policy.json to "free-only" and rebuilding
	// drops every `editorial-use` mark from entities.json on the next pipeline run,
	// on every surface, with no client change and no re-seed. A record without
	// complete provenance never ships under either policy (fail-closed).
	const logoPolicy = readLogoPolicy(configDir);

	// 7. WP-162 — canonical, seasonless competition ids (edition → metadata).
	// Runs BEFORE decorateAliases so the year-strip/initial aliases are derived
	// from the merged, canonical records.
	canonicalizeEditions(builder.entities);

	return decorateAliases(builder.entities).map((e) => {
		const out = { id: e.id, name: e.name, aliases: e.aliases, sport: e.sport, type: e.type };
		if (e.edition) out.edition = e.edition;
		if (e.altIds && e.altIds.length) out.altIds = e.altIds;
		if (e.country) out.country = e.country;
		if (e.national) out.national = true;
		if (e.colors) out.colors = e.colors;
		if (isLogoAllowed(e.logo, logoPolicy)) out.logo = e.logo;
		if (e.external) out.external = e.external;
		if (e.initials && e.initials.length) out.initials = e.initials;
		return out;
	});
}

/**
 * WP-16.2: derive the app-resolver aliases from each entity's display name.
 *   (a) year-strip alias → appended to `aliases` (safe for server matching: a
 *       full, yearless name like "Tour de France" is a legitimate word-boundary
 *       term, so it improves recall without the acronym-collision risk).
 *   (b) initial-alias → a NEW `initials` field, kept OUT of `aliases` so
 *       short acronyms never reach containsName-based server matching. If two
 *       entities would share the same (case-insensitive) initials the acronym
 *       is ambiguous — dropped from BOTH, so the resolver never auto-picks one
 *       (it can still surface them as "mente du …?" candidates on the fly).
 * Mutates + returns the same entity objects (they are freshly built here).
 */
function decorateAliases(entities) {
	// (a) year-strip alias. SKIP leagues: a league's year-stripped form
	// ("Premier League", "OBOS-ligaen") is a backdrop/scope phrase ("… i
	// OBOS-ligaen"), not a follow-target, and as a first-class match alias it
	// would make an utterance's scope compete with its real target (the
	// Lyn/OBOS-ligaen case). Leagues stay fully resolvable regardless — the
	// app resolver strips the year on the fly (editionStripped), so no stored
	// alias is needed for "premier league" → "Premier League 2026/27".
	for (const e of entities) {
		if (e.type === "league") continue;
		const stripped = editionStrippedName(e.name);
		if (!stripped) continue;
		const norm = normalizeText(stripped).trim();
		if (!norm || norm === normalizeText(e.name).trim()) continue;
		if (e.aliases.some((a) => normalizeText(a).trim() === norm)) continue;
		e.aliases.push(stripped);
	}

	// (b) initial-alias, with cross-index collision drop
	const byInitials = new Map(); // normalized acronym → [entity, …]
	for (const e of entities) {
		const ini = initialAlias(e.name);
		if (!ini) continue;
		e.initials = [ini];
		const key = normalizeText(ini).trim();
		if (!byInitials.has(key)) byInitials.set(key, []);
		byInitials.get(key).push(e);
	}
	for (const group of byInitials.values()) {
		if (group.length > 1) for (const e of group) delete e.initials; // ambiguous → drop
	}

	return entities;
}

/** Build + write docs/data/entities.json. Returns the entity array. */
export function writeEntities(dataDir = rootDataPath(), configDir = configDirPath()) {
	const entities = buildEntityIndex(configDir);
	fs.writeFileSync(path.join(dataDir, "entities.json"), JSON.stringify(entities, null, 2));
	return entities;
}

function main() {
	const entities = writeEntities();
	console.log(`entities.json: ${entities.length} entit${entities.length === 1 ? "y" : "ies"}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main();
}
