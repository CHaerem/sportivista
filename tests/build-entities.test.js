// WP-05: docs/data/entities.json — a stable-id index of athletes/teams/
// tournaments/leagues, built from tracked.json + norwegian-golfers.json +
// sports-config.js, deduped across sources.
import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildEntityIndex, writeEntities, seasonlessId, editionOfId } from "../scripts/build-entities.js";
import { entityTerms } from "../scripts/lib/helpers.js";

function tmpDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("buildEntityIndex", () => {
	it("builds entries from all three sources: tracked.json, norwegian-golfers.json, sports-config.js", () => {
		const configDir = tmpDir("ss-entities-sources-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({
				leagues: [{ id: "premier-league-2026-27", name: "Premier League 2026/27", sport: "football" }],
				athletes: [{ id: "viktor-hovland", name: "Viktor Hovland", sport: "golf" }],
				tournaments: [{ id: "the-open-2026", name: "The Open 2026", sport: "golf" }],
			})
		);
		fs.writeFileSync(
			path.join(configDir, "norwegian-golfers.json"),
			JSON.stringify([{ name: "Kris Ventura", tours: ["pga"], aliases: ["Ventura"] }])
		);
		const fakeSportsConfig = {
			football: { sport: "football", norwegian: { teams: ["FK Lyn Oslo", "Lyn"] } },
		};

		const entities = buildEntityIndex(configDir, fakeSportsConfig);

		expect(entities.find((e) => e.id === "premier-league")).toMatchObject({ type: "league", sport: "football" });
		expect(entities.find((e) => e.id === "viktor-hovland")).toMatchObject({ type: "athlete", sport: "golf" });
		expect(entities.find((e) => e.id === "the-open")).toMatchObject({ type: "tournament", sport: "golf" });
		expect(entities.find((e) => e.name === "Kris Ventura")).toMatchObject({ type: "athlete", sport: "golf", aliases: ["Ventura"] });
		// sports-config's free-text team list, deduped down to one entity (Lyn merges as an alias of FK Lyn Oslo).
		const lynTeam = entities.find((e) => e.name === "FK Lyn Oslo");
		expect(lynTeam).toMatchObject({ type: "team", sport: "football" });
		expect(lynTeam.aliases).toContain("Lyn");
		expect(entities.filter((e) => e.sport === "football" && e.type === "team")).toHaveLength(1);

		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("every entry has the {id, name, aliases, sport, type} shape", () => {
		const configDir = tmpDir("ss-entities-shape-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "magnus-carlsen", name: "Magnus Carlsen", sport: "chess" }] })
		);
		const entities = buildEntityIndex(configDir, {});
		expect(entities.length).toBeGreaterThan(0);
		for (const e of entities) {
			expect(typeof e.id).toBe("string");
			expect(typeof e.name).toBe("string");
			expect(Array.isArray(e.aliases)).toBe(true);
			expect(["athlete", "team", "tournament", "league", "sport", "category"]).toContain(e.type);
		}
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("dedups a tracked.json athlete against the same name in sports-config.js — tracked's id wins", () => {
		const configDir = tmpDir("ss-entities-dedup-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "casper-ruud", name: "Casper Ruud", sport: "tennis" }] })
		);
		const fakeSportsConfig = { tennis: { sport: "tennis", norwegian: { players: ["Casper Ruud"] } } };

		const entities = buildEntityIndex(configDir, fakeSportsConfig);

		const ruudEntities = entities.filter((e) => e.name === "Casper Ruud");
		expect(ruudEntities).toHaveLength(1); // not two separate entities for the same person
		expect(ruudEntities[0].id).toBe("casper-ruud"); // tracked.json's id wins
	});

	it("merges an alias-only match across sources (golfers.json alias vs. tracked.json full name)", () => {
		// Realistic case: tracked.json tracks "Kristoffer Ventura" (full name);
		// norwegian-golfers.json / sports-config use the short form "Kris Ventura"
		// with alias "Ventura". The shared alias "Ventura" word-boundary-matches
		// the tracked full name, so these fold into ONE entity under tracked's id.
		const configDir = tmpDir("ss-entities-alias-dedup-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "kristoffer-ventura", name: "Kristoffer Ventura", sport: "golf" }] })
		);
		fs.writeFileSync(
			path.join(configDir, "norwegian-golfers.json"),
			JSON.stringify([{ name: "Kris Ventura", aliases: ["Ventura"] }])
		);
		const entities = buildEntityIndex(configDir, {});
		const venturaEntities = entities.filter((e) => e.sport === "golf" && e.type === "athlete");
		expect(venturaEntities).toHaveLength(1);
		expect(venturaEntities[0].id).toBe("kristoffer-ventura");
		expect(venturaEntities[0].aliases).toEqual(expect.arrayContaining(["Kris Ventura", "Ventura"]));
	});

	it("does NOT fold a league's parenthetical annotation into a false team match (the Lyn/OBOS-ligaen trap)", () => {
		// Regression found while implementing WP-05: tracked.json names a league
		// "OBOS-ligaen 2026 (Lyn Oslo)" for human-readable context. Left in, that
		// parenthetical would make the LEAGUE entity word-boundary-match the club
		// name "Lyn" too — so a homeTeam "Lyn" would wrongly resolve to the league
		// instead of the actual club entity. The league's match-name must have the
		// annotation stripped.
		const configDir = tmpDir("ss-entities-annotation-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "obos-ligaen-2026", name: "OBOS-ligaen 2026 (Lyn Oslo)", sport: "football" }] })
		);
		const fakeSportsConfig = { football: { sport: "football", norwegian: { teams: ["FK Lyn Oslo", "Lyn"] } } };
		const entities = buildEntityIndex(configDir, fakeSportsConfig);

		const league = entities.find((e) => e.id === "obos-ligaen");
		expect(league.name).toBe("OBOS-ligaen 2026"); // annotation stripped from the match/display name
		expect(league.aliases).not.toContain("Lyn");

		const team = entities.find((e) => e.name === "FK Lyn Oslo");
		expect(team.type).toBe("team");
		expect(team.aliases).toContain("Lyn"); // Lyn merged into the TEAM entity, not the league
	});

	// WP-125: nickname / initial-form consolidation (the 100T lens-miss class).
	it("consolidates a nickname/initial-form team duplicate into ONE entity (100T ⇒ alias of 100 Thieves)", () => {
		// The real source: sports-config lists BOTH spellings so the esports
		// focus-team filter matches either; un-folded they became `100-thieves` +
		// `100t`, so following one never matched events/news stamped with the other.
		const fakeSportsConfig = {
			esports: { sport: "esports", norwegian: { teams: ["100 Thieves", "100T"] } },
		};
		const entities = buildEntityIndex(tmpDir("ss-entities-nickname-"), fakeSportsConfig);
		const esTeams = entities.filter((e) => e.sport === "esports" && e.type === "team");
		expect(esTeams).toHaveLength(1); // one team, not two
		expect(esTeams[0].id).toBe("100-thieves"); // the full name wins the id (registered first)
		expect(esTeams[0].name).toBe("100 Thieves");
		expect(esTeams[0].aliases).toContain("100T"); // the nickname folds in as an alias
	});

	it("does NOT over-merge two distinct multi-word teams (Real Madrid vs. Real Mallorca stay separate)", () => {
		// Safety boundary: the initial-form rule compares a MULTI-word name against a
		// SINGLE-token nickname only — two multi-word clubs are never abbreviated
		// onto each other, so a shared leading word cannot collapse them.
		const fakeSportsConfig = {
			football: { sport: "football", norwegian: { teams: ["Real Madrid", "Real Mallorca"] } },
		};
		const entities = buildEntityIndex(tmpDir("ss-entities-no-overmerge-"), fakeSportsConfig);
		const teams = entities.filter((e) => e.sport === "football" && e.type === "team");
		expect(teams).toHaveLength(2);
		expect(teams.map((e) => e.name).sort()).toEqual(["Real Madrid", "Real Mallorca"]);
	});

	it("keeps a competition and its gender/age-category sibling SEPARATE (Tour de France vs. Tour de France Femmes)", () => {
		// Regression: word-boundary containment folded the shorter men's name into
		// the longer women's name, so once the finished men's race left tracked.json
		// the men's entity silently vanished — killing the durable `tour-de-france`
		// starter-pack id. The gender/age-qualifier guard keeps the pair distinct.
		const fakeSportsConfig = {
			cycling: { sport: "cycling", norwegian: { teams: ["Tour de France", "Tour de France Femmes"] } },
		};
		const entities = buildEntityIndex(tmpDir("ss-entities-qualifier-"), fakeSportsConfig);
		const cyc = entities.filter((e) => e.sport === "cycling" && e.type === "team");
		expect(cyc).toHaveLength(2); // NOT folded into one
		expect(cyc.map((e) => e.name).sort()).toEqual(["Tour de France", "Tour de France Femmes"]);
	});

	// WP-133: cross-language national-team consolidation (the Norway/Norge lens-miss class).
	it("consolidates a cross-language national-team duplicate into ONE entity (Norway ⇒ alias of Norge)", () => {
		// The real source: sports-config lists BOTH "Norge" and "Norway" so the
		// football relevance filter matches either spelling; un-folded they became
		// `norge` + `norway`, so following one never matched events stamped with the
		// other. The two share no token and are not initial-forms, so only the curated
		// known-alias table folds them. "Norge" is listed first → wins the id.
		const fakeSportsConfig = {
			football: { sport: "football", norwegian: { teams: ["Norge", "Norway"] } },
		};
		const entities = buildEntityIndex(tmpDir("ss-entities-national-"), fakeSportsConfig);
		const teams = entities.filter((e) => e.sport === "football" && e.type === "team");
		expect(teams).toHaveLength(1); // one national team, not two
		expect(teams[0].id).toBe("norge"); // Norwegian display name wins the id
		expect(teams[0].name).toBe("Norge");
		expect(teams[0].aliases).toContain("Norway"); // the other spelling folds in as an alias
	});

	it("known-alias folding is surgical — two unrelated single-word teams stay separate", () => {
		// The curated table only folds the exact listed spellings; a country NOT
		// grouped with another (e.g. "Norway" vs "Denmark") must remain two entities.
		const fakeSportsConfig = {
			football: { sport: "football", norwegian: { teams: ["Norway", "Denmark"] } },
		};
		const entities = buildEntityIndex(tmpDir("ss-entities-national-safe-"), fakeSportsConfig);
		const teams = entities.filter((e) => e.sport === "football" && e.type === "team");
		expect(teams).toHaveLength(2);
		expect(teams.map((e) => e.name).sort()).toEqual(["Denmark", "Norway"]);
	});

	it("folds the real sports-config Norway/Norge pair into a single `norge` entity (production guard)", () => {
		// Non-vacuous: build against the REAL default config (which lists both
		// spellings) and assert the pair is consolidated with no stray `norway`.
		const entities = buildEntityIndex();
		const national = entities.filter((e) => e.sport === "football" && (e.id === "norge" || e.id === "norway"));
		expect(national.map((e) => e.id)).toEqual(["norge"]);
		expect(entities.find((e) => e.id === "norge").aliases).toContain("Norway");
		expect(entities.find((e) => e.id === "norway")).toBeUndefined();
	}, 30_000); // real-config build at world-registry scale: ~3s locally, >10s on a cold CI runner

	it("guards the built index against same-type nickname/initial-form duplicates (normalized comparison)", () => {
		// Independent (normalized) mirror of the relation the generator now folds,
		// so this is a genuine regression guard, not a tautology: within any
		// sport+type, no entity NAME may be the initial/nickname form of another's.
		const normalize = (s) => (s || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
		const initialForm = (name) => {
			const words = normalize(name).split(/\s+/).filter(Boolean);
			if (words.length < 2) return null;
			return words.map((w) => (/^\d/.test(w) ? w : Array.from(w)[0])).join("");
		};
		const isNickname = (a, b) => {
			const na = normalize(a), nb = normalize(b);
			if (!na || !nb) return false;
			return (!/\s/.test(nb) && initialForm(na) === nb) || (!/\s/.test(na) && initialForm(nb) === na);
		};
		// Run over the REAL default config (docs/data/entities.json's source), so a
		// production regression — e.g. a new 100T-style pair the generator fails to
		// fold — trips this. The generator guarantees the invariant by construction.
		// WP-161 refinement: at world-registry scale, two GENUINELY DIFFERENT
		// entities can coincide as nickname-forms (the CS2 org "OG" vs "OpTic
		// Gaming"/"OneTap Gaming" — three real orgs). A pair whose entities carry
		// DISTINCT external source ids is provably two real-world things, not a
		// fold failure — only pairs without that proof count as dupes.
		const provablyDistinct = (a, b) =>
			a.external && b.external && JSON.stringify(a.external) !== JSON.stringify(b.external);
		const entities = buildEntityIndex();
		const byGroup = new Map();
		for (const e of entities) {
			const key = `${normalize(e.sport)}|${e.type}`;
			if (!byGroup.has(key)) byGroup.set(key, []);
			byGroup.get(key).push(e);
		}
		const dupes = [];
		for (const group of byGroup.values()) {
			for (let i = 0; i < group.length; i++) {
				for (let j = i + 1; j < group.length; j++) {
					if (isNickname(group[i].name, group[j].name) && !provablyDistinct(group[i], group[j])) {
						dupes.push(`${group[i].name} ⇄ ${group[j].name} (${group[i].sport}/${group[i].type})`);
					}
				}
			}
		}
		expect(dupes).toEqual([]);
		// Non-vacuous: the real esports team really is consolidated under one id.
		const hundred = entities.filter((e) => e.id === "100-thieves");
		expect(hundred).toHaveLength(1);
		expect(hundred[0].aliases).toContain("100T");
		expect(entities.find((e) => e.id === "100t")).toBeUndefined();
	}, 30_000); // real-config build at world-registry scale (see the production guard above)

	it("generates a stable, readable kebab-case slug for a free-text name with no existing id", () => {
		const fakeSportsConfig = { cycling: { sport: "cycling", norwegian: { players: ["Søren Wærenskjold"] } } };
		const entities = buildEntityIndex(tmpDir("ss-entities-slug-"), fakeSportsConfig);
		const entity = entities.find((e) => e.name === "Søren Wærenskjold");
		expect(entity.id).toBe("soren-waerenskjold");
	});

	// WP-16.2: app-resolver aliases (year-strip + initial acronym).
	it("generates a year-strip alias for a year-suffixed name (\"Tour de France 2026\" → \"Tour de France\")", () => {
		const configDir = tmpDir("ss-entities-yearstrip-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({
				tournaments: [
					{ id: "tour-de-france-2026", name: "Tour de France 2026", sport: "cycling" },
					{ id: "the-open-2026", name: "The Open Championship 2026 (Royal Birkdale)", sport: "golf" },
					{ id: "la-liga-2026-27", name: "La Liga 2026/27", sport: "football" },
				],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		expect(entities.find((e) => e.id === "tour-de-france").aliases).toContain("Tour de France");
		// Trailing parenthetical + year both stripped.
		expect(entities.find((e) => e.id === "the-open").aliases).toContain("The Open Championship");
		// Season token "2026/27" stripped too.
		expect(entities.find((e) => e.id === "la-liga").aliases).toContain("La Liga");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("generates an initial-alias for a 3+-word name (\"Tour de France\" → \"TdF\"), in a separate `initials` field", () => {
		const configDir = tmpDir("ss-entities-initials-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({
				tournaments: [
					{ id: "tour-de-france-2026", name: "Tour de France 2026", sport: "cycling" },
					{ id: "the-open-2026", name: "The Open 2026", sport: "golf" }, // 2 words after strip → none
				],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		const tdf = entities.find((e) => e.id === "tour-de-france");
		expect(tdf.initials).toEqual(["TdF"]);
		// A 2-word name gets no acronym (would be too collision-prone).
		expect(entities.find((e) => e.id === "the-open").initials).toBeUndefined();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("drops the initial-alias from BOTH entities when two share the same acronym (collision)", () => {
		const configDir = tmpDir("ss-entities-collision-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({
				tournaments: [
					{ id: "alpha-beta-gamma", name: "Alpha Beta Gamma", sport: "golf" },
					{ id: "apple-banana-grape", name: "Apple Banana Grape", sport: "tennis" },
				],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		// Both would be "ABG" → ambiguous → neither carries a stored acronym.
		expect(entities.find((e) => e.id === "alpha-beta-gamma").initials).toBeUndefined();
		expect(entities.find((e) => e.id === "apple-banana-grape").initials).toBeUndefined();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("keeps the initial-alias OUT of server-side matching terms (initials never reach containsName/entityTerms)", () => {
		const configDir = tmpDir("ss-entities-server-safe-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ tournaments: [{ id: "tour-de-france-2026", name: "Tour de France 2026", sport: "cycling" }] })
		);
		const entities = buildEntityIndex(configDir, {});
		const tdf = entities.find((e) => e.id === "tour-de-france");
		// The acronym exists as resolver data …
		expect(tdf.initials).toEqual(["TdF"]);
		// … but is NOT in `aliases`, and NOT in the terms server matching reads.
		expect(tdf.aliases).not.toContain("TdF");
		expect(entityTerms(tdf)).not.toContain("TdF");
		expect(entityTerms(tdf)).toEqual([tdf.name, ...tdf.aliases]);
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	// WP-64: sport-/category-level coverage entities (the winter-sport datahull).
	it("publishes one sport entity per followBroadly sport with a Norwegian name + aliases", () => {
		const configDir = tmpDir("ss-entities-broad-");
		// No interests.json → the default followBroadly set (incl. winter sports).
		const entities = buildEntityIndex(configDir, {});

		const biathlon = entities.find((e) => e.id === "sport-biathlon");
		expect(biathlon).toMatchObject({ name: "Skiskyting", sport: "biathlon", type: "sport" });
		expect(biathlon.aliases).toContain("biathlon");

		const langrenn = entities.find((e) => e.id === "sport-cross-country");
		expect(langrenn).toMatchObject({ name: "Langrenn", sport: "cross-country", type: "sport" });

		const alpint = entities.find((e) => e.id === "sport-alpine");
		expect(alpint).toMatchObject({ name: "Alpint", sport: "alpine", type: "sport" });

		const hopp = entities.find((e) => e.id === "sport-ski-jumping");
		expect(hopp).toMatchObject({ name: "Hopp", sport: "ski jumping", type: "sport" });

		// Non-winter followBroadly sports get a sport entity too (as a low-priority
		// fallback; existing tournaments/teams still win representativeEntity).
		expect(entities.find((e) => e.id === "sport-football")).toMatchObject({ name: "Fotball", type: "sport" });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("publishes a groundable «Vintersport» umbrella category covering the winter set", () => {
		const configDir = tmpDir("ss-entities-cat-");
		const entities = buildEntityIndex(configDir, {});
		const cat = entities.find((e) => e.id === "category-winter-sports");
		expect(cat).toMatchObject({ name: "Vintersport", type: "category" });
		expect(cat.aliases).toEqual(expect.arrayContaining(["vinteridrett", "vinteridretter"]));
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("honours interests.followBroadly — only listed sports get a sport entity, category dropped when no winter member", () => {
		const configDir = tmpDir("ss-entities-fb-");
		fs.writeFileSync(
			path.join(configDir, "interests.json"),
			JSON.stringify({ followBroadly: ["golf", "tennis"] })
		);
		const entities = buildEntityIndex(configDir, {});
		expect(entities.find((e) => e.id === "sport-golf")).toBeDefined();
		expect(entities.find((e) => e.id === "sport-tennis")).toBeDefined();
		expect(entities.find((e) => e.id === "sport-biathlon")).toBeUndefined();
		// No winter member in scope → no umbrella category.
		expect(entities.find((e) => e.id === "category-winter-sports")).toBeUndefined();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("sport/category entities are server-inert — never stamped onto an event by build-events", () => {
		// enrichEntityIds only pools athlete/team/league; assert no sport/category
		// entity is in those pools (so a "Golf"/"Vintersport" name can't false-match).
		const configDir = tmpDir("ss-entities-inert-");
		const entities = buildEntityIndex(configDir, {});
		const pooled = entities.filter((e) => ["athlete", "team", "league"].includes(e.type));
		expect(pooled.some((e) => e.type === "sport" || e.type === "category")).toBe(false);
		expect(entities.some((e) => e.type === "sport")).toBe(true);
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("is deterministic across two runs on the same input", () => {
		const configDir = tmpDir("ss-entities-determinism-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "viktor-hovland", name: "Viktor Hovland", sport: "golf" }] })
		);
		const first = buildEntityIndex(configDir, {});
		const second = buildEntityIndex(configDir, {});
		expect(second).toEqual(first);
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	// WP-160: catalog.json tier2 long-tail folds in as a fourth source.
	it("folds catalog.json tier2 teams → team and tournaments → tournament (with catalog aliases)", () => {
		const configDir = tmpDir("ss-entities-tier2-");
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({
				tier1: ["football"],
				tier2: {
					teams: [{ name: "Liverpool", aliases: ["Liverpool FC"], sport: "football" }],
					tournaments: [{ name: "Premier League", aliases: ["EPL"], sport: "football" }],
					athletes: [{ name: "Casper Ruud", aliases: ["Ruud"], sport: "tennis" }],
				},
			})
		);
		const entities = buildEntityIndex(configDir, {});
		const liverpool = entities.find((e) => e.id === "liverpool");
		expect(liverpool).toMatchObject({ name: "Liverpool", type: "team", sport: "football" });
		expect(liverpool.aliases).toContain("Liverpool FC");
		const pl = entities.find((e) => e.id === "premier-league");
		expect(pl).toMatchObject({ name: "Premier League", type: "tournament", sport: "football" });
		expect(pl.aliases).toContain("EPL");
		// tier2.athletes are intentionally NOT folded (out of WP-160 scope: teams + tournaments only).
		expect(entities.find((e) => e.name === "Casper Ruud")).toBeUndefined();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("tracked.json still wins tier2 dedup for a same-type overlap (Tour de France folds under the tracked id)", () => {
		const configDir = tmpDir("ss-entities-tier2-dedup-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ tournaments: [{ id: "tour-de-france-2026", name: "Tour de France 2026", sport: "cycling" }] })
		);
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { tournaments: [{ name: "Tour de France", aliases: ["TdF"], sport: "cycling" }] } })
		);
		const entities = buildEntityIndex(configDir, {});
		const tdf = entities.filter((e) => e.sport === "cycling" && e.type === "tournament");
		expect(tdf).toHaveLength(1); // one entity, not two
		expect(tdf[0].id).toBe("tour-de-france"); // tracked's record wins (folded first), under the CANONICAL seasonless id (WP-162)
		expect(tdf[0].aliases).toContain("TdF"); // the catalog alias folds in
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("keeps a tier2 team distinct from a tracked club MISFILED under a different type (Barcelona team vs. fc-barcelona league)", () => {
		// The NOTE ON TYPE ACCURACY case: tracked files clubs under "leagues", but
		// tier2 has precise team lists — so where the buckets disagree on type, the
		// tier2 type is authoritative and it registers as its own team entity.
		const configDir = tmpDir("ss-entities-tier2-type-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "fc-barcelona", name: "FC Barcelona", sport: "football" }] })
		);
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { teams: [{ name: "Barcelona", aliases: ["FC Barcelona"], sport: "football" }] } })
		);
		const entities = buildEntityIndex(configDir, {});
		expect(entities.find((e) => e.id === "fc-barcelona").type).toBe("league");
		expect(entities.find((e) => e.id === "barcelona")).toMatchObject({ type: "team", sport: "football" });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	// WP-160: handball is now a groundable sport (the SPORT_LABELS hole, à la WP-64 for winter).
	it("publishes a groundable Håndball sport entity when handball is in tier1 (the WP-160 label hole)", () => {
		const configDir = tmpDir("ss-entities-handball-");
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier1: ["handball"] })
		);
		const entities = buildEntityIndex(configDir, {});
		const handball = entities.find((e) => e.id === "sport-handball");
		expect(handball).toMatchObject({ name: "Håndball", sport: "handball", type: "sport" });
		expect(handball.aliases).toContain("handball");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	// WP-160: KNOWN_ALIAS_GROUPS generalised to scripts/config/entity-aliases.json.
	it("reads curated known-alias groups from entity-aliases.json (research/verify-maintainable)", () => {
		const configDir = tmpDir("ss-entities-aliasfile-");
		// A pair that shares no token and is not an initial-form — only a curated
		// group can fold it. Not in the seed, so it proves the FILE is read.
		fs.writeFileSync(
			path.join(configDir, "entity-aliases.json"),
			JSON.stringify({ groups: [["sweden", "sverige"]] })
		);
		const fakeSportsConfig = { football: { sport: "football", norwegian: { teams: ["Sverige", "Sweden"] } } };
		const entities = buildEntityIndex(configDir, fakeSportsConfig);
		const teams = entities.filter((e) => e.sport === "football" && e.type === "team");
		expect(teams).toHaveLength(1); // folded via the file's group
		expect(teams[0].aliases).toContain("Sweden");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("falls back to the seed alias groups when entity-aliases.json is absent (Norway/Norge still folds)", () => {
		const configDir = tmpDir("ss-entities-aliasseed-");
		const fakeSportsConfig = { football: { sport: "football", norwegian: { teams: ["Norge", "Norway"] } } };
		const entities = buildEntityIndex(configDir, fakeSportsConfig); // no entity-aliases.json in this dir
		const teams = entities.filter((e) => e.sport === "football" && e.type === "team");
		expect(teams).toHaveLength(1);
		expect(teams[0].id).toBe("norge");
		expect(teams[0].aliases).toContain("Norway");
		fs.rmSync(configDir, { recursive: true, force: true });
	});
});

// WP-161: the world registry (configDir/registry/*.json) folds in LAST among
// the entity sources — merges donate external/country/aliases, fresh entities
// keep their stable registry ids, and the registry is authoritative on type.
describe("buildEntityIndex — world registry fold (WP-161)", () => {
	function withRegistry(configDir, filesByName) {
		fs.mkdirSync(path.join(configDir, "registry"), { recursive: true });
		for (const [name, entities] of Object.entries(filesByName)) {
			fs.writeFileSync(path.join(configDir, "registry", name), JSON.stringify({ entities }));
		}
	}

	it("a registry entity merges into an existing same-type entity, donating aliases + external + country (id/name kept)", () => {
		const configDir = tmpDir("ss-entities-reg-merge-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "magnus-carlsen", name: "Magnus Carlsen", sport: "chess" }] })
		);
		withRegistry(configDir, {
			"chess.json": [{ id: "magnus-carlsen-fide", name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess", type: "athlete", country: "NOR", external: { fideId: "1503014" } }],
		});
		const entities = buildEntityIndex(configDir, {});
		const carlsen = entities.filter((e) => e.type === "athlete" && e.sport === "chess");
		expect(carlsen).toHaveLength(1); // merged, not duplicated
		expect(carlsen[0].id).toBe("magnus-carlsen"); // tracked wins the id
		expect(carlsen[0].aliases).toContain("Carlsen");
		expect(carlsen[0].external).toEqual({ fideId: "1503014" });
		expect(carlsen[0].country).toBe("NOR");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("a fresh registry entity registers under its own stable id with external/country passed through", () => {
		const configDir = tmpDir("ss-entities-reg-fresh-");
		withRegistry(configDir, {
			"football.json": [{ id: "liverpool", name: "Liverpool", aliases: [], sport: "football", type: "team", external: { espnId: "364" } }],
		});
		const entities = buildEntityIndex(configDir, {});
		const liv = entities.find((e) => e.id === "liverpool");
		expect(liv).toMatchObject({ name: "Liverpool", sport: "football", type: "team", external: { espnId: "364" } });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("registry is authoritative on type: a cross-type overlap registers fresh AND logs the mismatch (tracked keeps its entry)", () => {
		const configDir = tmpDir("ss-entities-reg-type-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "fc-barcelona", name: "FC Barcelona", sport: "football" }] })
		);
		withRegistry(configDir, {
			"football.json": [{ id: "barcelona-registry", name: "Barcelona", aliases: ["FC Barcelona"], sport: "football", type: "team", external: { espnId: "83" } }],
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const entities = buildEntityIndex(configDir, {});
		expect(warn.mock.calls.some((c) => String(c[0]).includes("type-mismatch"))).toBe(true);
		warn.mockRestore();
		expect(entities.find((e) => e.id === "fc-barcelona")).toMatchObject({ type: "league" }); // tracked untouched
		expect(entities.find((e) => e.id === "barcelona-registry")).toMatchObject({ type: "team", external: { espnId: "83" } });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("an id collision keeps the first-registered id (tracked wins) and suffixes the registry entity", () => {
		const configDir = tmpDir("ss-entities-reg-collide-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "lyn", name: "Kari Lyn", sport: "golf" }] })
		);
		withRegistry(configDir, {
			"football.json": [{ id: "lyn", name: "Lyn 1896", aliases: [], sport: "football", type: "team", external: { espnId: "9" } }],
		});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const entities = buildEntityIndex(configDir, {});
		warn.mockRestore();
		expect(entities.find((e) => e.id === "lyn")).toMatchObject({ name: "Kari Lyn", type: "athlete" });
		expect(entities.find((e) => e.id === "lyn-2")).toMatchObject({ name: "Lyn 1896", type: "team", external: { espnId: "9" } });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("registry entities are NOT dedup-scanned against each other (pre-deduped artifacts — both register)", () => {
		const configDir = tmpDir("ss-entities-reg-boundary-");
		withRegistry(configDir, {
			// Deliberately overlapping names in the same file: the fold must trust
			// the artifact (CI enforces uniqueness/dedup at seed level) and keep both.
			"football.json": [
				{ id: "real-sociedad", name: "Real Sociedad", aliases: [], sport: "football", type: "team", external: { espnId: "1" } },
				{ id: "real-sociedad-b", name: "Real Sociedad B", aliases: [], sport: "football", type: "team", external: { espnId: "2" } },
			],
		});
		const entities = buildEntityIndex(configDir, {});
		expect(entities.find((e) => e.id === "real-sociedad")).toBeTruthy();
		expect(entities.find((e) => e.id === "real-sociedad-b")).toBeTruthy();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("files are read in sorted name order and a missing registry dir is a no-op", () => {
		const configDir = tmpDir("ss-entities-reg-order-");
		// no registry dir at all → still builds (existing behaviour untouched)
		expect(() => buildEntityIndex(configDir, {})).not.toThrow();
		withRegistry(configDir, {
			"b.json": [{ id: "bbb", name: "BBB", aliases: [], sport: "football", type: "team", external: { espnId: "2" } }],
			"a.json": [{ id: "aaa", name: "AAA", aliases: [], sport: "football", type: "team", external: { espnId: "1" } }],
		});
		const entities = buildEntityIndex(configDir, {});
		const ids = entities.filter((e) => ["aaa", "bbb"].includes(e.id)).map((e) => e.id);
		expect(ids).toEqual(["aaa", "bbb"]); // a.json folded before b.json
		fs.rmSync(configDir, { recursive: true, force: true });
	});
});

// WP-162 — canonical, seasonless competition ids. A profile rule freezes
// entityId at follow time, so an edition-stamped id is a follow with an expiry
// date; these tests pin the mapping, the metadata, the merge and — crucially —
// the two things that must NEVER happen (silent id theft, lost fields).
describe("buildEntityIndex — seasonless competition ids (WP-162)", () => {
	it("seasonlessId/editionOfId strip an edition SEGMENT, never a digit inside a name", () => {
		expect(seasonlessId("premier-league-2026-27")).toBe("premier-league");
		expect(seasonlessId("tour-de-france-2026")).toBe("tour-de-france");
		expect(seasonlessId("esports-world-cup-2026-cs2")).toBe("esports-world-cup-cs2");
		expect(seasonlessId("blast-bounty-2026-s2")).toBe("blast-bounty-s2");
		expect(editionOfId("premier-league-2026-27")).toBe("2026/27");
		expect(editionOfId("tour-de-france-2026")).toBe("2026");
		// Not an edition: a digit run that is part of the identity itself.
		expect(seasonlessId("100-thieves")).toBe("100-thieves");
		expect(seasonlessId("f1")).toBe("f1");
		expect(editionOfId("100-thieves")).toBeNull();
	});

	it("publishes a dated tracked competition under its CANONICAL id, with edition + altIds as metadata", () => {
		const configDir = tmpDir("ss-entities-canonical-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({
				tournaments: [{ id: "tour-de-france-2026", name: "Tour de France 2026", sport: "cycling" }],
				leagues: [{ id: "premier-league-2026-27", name: "Premier League 2026/27", sport: "football" }],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		const tdf = entities.find((e) => e.id === "tour-de-france");
		expect(tdf).toMatchObject({ type: "tournament", edition: "2026", altIds: ["tour-de-france-2026"] });
		const pl = entities.find((e) => e.id === "premier-league");
		expect(pl).toMatchObject({ type: "league", edition: "2026/27", altIds: ["premier-league-2026-27"] });
		// The dated id is GONE as a primary id — it lives on only as an altId, so
		// an existing profile rule still resolves (belt) while the client-side
		// migration re-points it (braces).
		expect(entities.find((e) => e.id === "tour-de-france-2026")).toBeUndefined();
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("MERGES the dated tracked record with the catalog's seasonless one — one competition, one id, nothing lost", () => {
		const configDir = tmpDir("ss-entities-canonical-merge-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "premier-league-2026-27", name: "Premier League 2026/27", sport: "football" }] })
		);
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { tournaments: [{ name: "Premier League", aliases: ["EPL"], sport: "football" }] } })
		);
		const entities = buildEntityIndex(configDir, {});
		const pl = entities.filter((e) => e.sport === "football" && ["league", "tournament"].includes(e.type));
		expect(pl).toHaveLength(1); // the league/tournament split collapses into ONE record
		expect(pl[0].id).toBe("premier-league");
		expect(pl[0].name).toBe("Premier League"); // the seasonless display name wins
		expect(pl[0].type).toBe("tournament"); // the type the canonical id already published
		expect(pl[0].aliases).toEqual(expect.arrayContaining(["Premier League 2026/27", "EPL"]));
		expect(pl[0].altIds).toContain("premier-league-2026-27");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("never steals a canonical id from a DIFFERENT entity (the misfiled club «Rosenborg BK» keeps its dated id)", () => {
		const configDir = tmpDir("ss-entities-canonical-collision-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "rosenborg-2026", name: "Rosenborg BK", sport: "football" }] })
		);
		fs.mkdirSync(path.join(configDir, "registry"));
		fs.writeFileSync(
			path.join(configDir, "registry", "football.json"),
			JSON.stringify({
				entities: [{
					id: "rosenborg", name: "Rosenborg", aliases: ["RBK"], sport: "football", type: "team",
					colors: { primary: "#ffffff" }, external: { espnId: "438" },
				}],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		const club = entities.find((e) => e.id === "rosenborg");
		expect(club).toMatchObject({ type: "team", colors: { primary: "#ffffff" }, external: { espnId: "438" } });
		// The misfiled tracked "league" is NOT renamed onto the club's id.
		expect(entities.find((e) => e.id === "rosenborg-2026")).toMatchObject({ type: "league" });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("preserves identity metadata through a canonical merge (logo/colors/country/external survive)", () => {
		const configDir = tmpDir("ss-entities-canonical-meta-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "eliteserien-2026", name: "Eliteserien", sport: "football" }] })
		);
		fs.mkdirSync(path.join(configDir, "registry"));
		fs.writeFileSync(
			path.join(configDir, "registry", "football.json"),
			JSON.stringify({
				entities: [{
					id: "eliteserien", name: "Eliteserien", aliases: ["Eliteserien 2026"], sport: "football",
					type: "tournament", country: "NO", colors: { primary: "#123456" }, external: { wikidata: "Q123" },
				}],
			})
		);
		const entities = buildEntityIndex(configDir, {});
		const es = entities.filter((e) => e.id === "eliteserien");
		expect(es).toHaveLength(1);
		expect(es[0]).toMatchObject({
			country: "NO", colors: { primary: "#123456" }, external: { wikidata: "Q123" }, edition: "2026",
		});
		expect(es[0].altIds).toContain("eliteserien-2026");
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("is idempotent and total: every published altId is unique and no id is both primary and alt", () => {
		const live = JSON.parse(fs.readFileSync(new URL("../docs/data/entities.json", import.meta.url), "utf8"));
		const primary = new Set(live.map((e) => e.id));
		const seenAlt = new Set();
		for (const e of live) {
			for (const alt of e.altIds || []) {
				expect(primary.has(alt)).toBe(false); // an altId is never ALSO a live id
				expect(seenAlt.has(alt)).toBe(false); // and never claimed twice
				seenAlt.add(alt);
			}
		}
		// No live COMPETITION id still carries an edition segment.
		for (const e of live) {
			if (!["league", "tournament"].includes(e.type)) continue;
			if (e.altIds) expect(seasonlessId(e.id)).toBe(e.id);
		}
	});
});

describe("writeEntities", () => {
	it("writes entities.json to dataDir and returns the same array", () => {
		const dataDir = tmpDir("ss-entities-write-");
		const configDir = tmpDir("ss-entities-write-cfg-");
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "magnus-carlsen", name: "Magnus Carlsen", sport: "chess" }] })
		);
		const returned = writeEntities(dataDir, configDir);
		const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "entities.json"), "utf-8"));
		expect(onDisk).toEqual(returned);
		expect(onDisk.some((e) => e.id === "magnus-carlsen")).toBe(true);
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("CLI entrypoint writes entities.json when run directly with node", () => {
		const dataDir = tmpDir("ss-entities-cli-");
		const configDir = tmpDir("ss-entities-cli-cfg-");
		execFileSync("node", ["scripts/build-entities.js"], {
			env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir, SPORTSYNC_CONFIG_DIR: configDir },
		});
		expect(fs.existsSync(path.join(dataDir, "entities.json"))).toBe(true);
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});
});

// WP-05 acceptance: build-events.js enrichment (entityId / homeTeamEntityId /
// awayTeamEntityId), the Brooklyn/Lyn negative matching test, and manifest coverage.
describe("build-events.js integration (WP-05 entity enrichment)", () => {
	function freshDirs() {
		return {
			dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "ss-enrich-")),
			configDir: fs.mkdtempSync(path.join(os.tmpdir(), "ss-enrich-cfg-")),
		};
	}
	function runBuild(dataDir, configDir) {
		execFileSync("node", ["scripts/build-events.js"], {
			env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir, SPORTSYNC_CONFIG_DIR: configDir },
		});
		return JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf-8"));
	}
	const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

	it("acceptance: a tracked athlete appearing in norwegianPlayers gets entityId", () => {
		const { dataDir, configDir } = freshDirs();
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "viktor-hovland", name: "Viktor Hovland", sport: "golf" }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "golf.json"),
			JSON.stringify({
				tournaments: [{ name: "PGA Tour", events: [
					{ title: "The Open", time: future(2), norwegian: true, norwegianPlayers: [{ name: "Viktor Hovland" }] },
				] }],
			})
		);
		const events = runBuild(dataDir, configDir);
		const ev = events.find((e) => e.title === "The Open");
		expect(ev.norwegianPlayers[0].entityId).toBe("viktor-hovland");
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("acceptance: enrichment also applies to a preserved ai-research event (bypasses pushEvent)", () => {
		const { dataDir, configDir } = freshDirs();
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "magnus-carlsen", name: "Magnus Carlsen", sport: "chess" }] })
		);
		// WP-92/96: chess is entity-gated for coverage (which reads catalog.json, not
		// tracked.json) — cover Carlsen so the event stays on the board and we can
		// assert its entityId enrichment (built from tracked.json/entities.json).
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { athletes: [{ name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess" }] } })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "chess", title: "EWC Chess Final", time: future(5), source: "ai-research", confidence: "high",
				  evidence: ["a", "b"], norwegianPlayers: [{ name: "Magnus Carlsen" }] },
			])
		);
		const events = runBuild(dataDir, configDir);
		const ev = events.find((e) => e.title === "EWC Chess Final");
		expect(ev.norwegianPlayers[0].entityId).toBe("magnus-carlsen");
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("negative test: 'Brooklyn FC' as homeTeam must NOT match the tracked club 'Lyn' (word-boundary, not substring)", () => {
		const { dataDir, configDir } = freshDirs();
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ leagues: [{ id: "obos-ligaen-2026", name: "OBOS-ligaen 2026 (Lyn Oslo)", sport: "football" }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({
				tournaments: [{ name: "Some Cup", events: [
					// Trap: naive substring matching would find "lyn" inside "brooklyn".
					{ title: "Brooklyn FC friendly", time: future(2), homeTeam: "Brooklyn FC", awayTeam: "Some Team" },
					// Control: a real Lyn fixture must still match.
					{ title: "Vålerenga vs Lyn", time: future(3), homeTeam: "Vålerenga", awayTeam: "Lyn" },
				] }],
			})
		);
		const events = runBuild(dataDir, configDir);
		const brooklyn = events.find((e) => e.title === "Brooklyn FC friendly");
		expect(brooklyn.homeTeamEntityId).toBeUndefined();

		const derby = events.find((e) => e.title === "Vålerenga vs Lyn");
		expect(derby.awayTeamEntityId).toBe("fk-lyn-oslo");
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});

	it("entities.json is published to dataDir and covered by manifest.json", () => {
		const { dataDir, configDir } = freshDirs();
		fs.writeFileSync(
			path.join(configDir, "tracked.json"),
			JSON.stringify({ athletes: [{ id: "viktor-hovland", name: "Viktor Hovland", sport: "golf" }] })
		);
		runBuild(dataDir, configDir);
		expect(fs.existsSync(path.join(dataDir, "entities.json"))).toBe(true);
		const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf-8"));
		expect(manifest.files).toHaveProperty("entities.json");
		const entitiesBuf = fs.readFileSync(path.join(dataDir, "entities.json"));
		expect(manifest.files["entities.json"].bytes).toBe(entitiesBuf.length);
		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});
});
