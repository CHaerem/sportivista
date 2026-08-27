#!/usr/bin/env node
/**
 * Coverage watch (mechanical half): a cheap, recall-biased net that runs every
 * pipeline cycle and flags things the dashboard may be missing. Three signals,
 * all written to docs/data/coverage-gaps.json for the research/coverage agents:
 *
 *   1. Entity gaps   — a tracked entity is in the news but has NO upcoming event
 *      (the original signal), OR has one only far out while the news signals
 *      something imminent ("i dag", "denne helgen", …).
 *   2. Sport gaps    — a followed sport is in the news with imminence language but
 *      has no event on the board in the next few days. This is the F1-blind-spot
 *      catcher: ESPN silently mis-dates F1 weekends (Fridays, premature FINAL) so
 *      the CURRENT race can vanish while later races remain — no entity/name match
 *      would notice, but "Formel 1 … i dag" + zero F1 events soon does.
 *   3. Source anomalies — a fetcher's own data file is missing/empty, or has events
 *      the board dropped. Guards against a single upstream source going unreliable.
 *   4. Contract breaches (WP-243) — a wholesale-covered competition's coverage
 *      contract (authority.json contract blocks, measured by build-events into
 *      coverage-contracts.json) is breached: in season, but fewer upcoming events
 *      on the board than promised. Always high severity — a broken promise is the
 *      one gap class we defined in advance.
 *
 * Deliberately noisy and mechanical — the coverage-critic and research agents read
 * this file and decide what is real (they cross-check the web). Detection costs
 * nothing, so it runs hourly; judgement is left to the agents.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonIfExists, rootDataPath, configDirPath, writeJsonPretty, iso, MS_PER_DAY, containsName, coverageHaystack, normalizeText, normalizeEntity, entityTerms, isEventInWindow, makeCoverageGate } from "./lib/helpers.js";
import { collectDemand } from "./lib/demand.js";

// Re-export so existing importers (tests) keep resolving containsName from here.
export { containsName };

/** How soon counts as "imminent" — the window the news is usually shouting about. */
export const IMMINENT_DAYS = 4;
/** How far out we still consider an entity "covered" for the plain missing check. */
export const UPCOMING_DAYS = 14;

/** Sport data files the static pipeline is expected to produce (mirrors scripts/fetch/index.js). */
export const EXPECTED_SPORT_FILES = ["football", "golf", "tennis", "f1", "chess", "esports", "cycling"];

/**
 * How long a source file may be served from `retainLastGood` retention before we call
 * the fetcher broken. A day or two of retention is ordinary (a between-rounds lull, a
 * transient upstream blip); a week is a dead fetcher nobody noticed. Deliberately well
 * under retainLastGood's own 14-day `maxAgeDays`, so the fetcher is flagged while the
 * file still has content — not only once retention expires and the sport falls off.
 */
export const STALE_RETAIN_DAYS = 3;

/**
 * Followed sports keyed by distinctive news terms → the sport key used in events.json.
 * Kept small and specific on purpose: this is a recall net, not a taxonomy. "winter"
 * has no fetcher/sport key, so it flags whenever winter sport is imminent in the news
 * and nothing is on the board (correct in season, silent off-season).
 */
export const SPORT_NEWS_KEYWORDS = [
	{ sport: "f1", label: "Formel 1", keywords: ["formel 1", "formula 1", "grand prix"] },
	{ sport: "cycling", label: "Sykkel", keywords: ["tour de france", "sykkel-vm", "verdenscup sykkel"] },
	{ sport: "chess", label: "Sjakk", keywords: ["sjakk-vm", "norway chess", "sjakkturnering"] },
	{ sport: "golf", label: "Golf", keywords: ["pga tour", "golf major", "the open championship"] },
	{ sport: "tennis", label: "Tennis", keywords: ["grand slam", "atp-turnering", "wta-turnering"] },
	{ sport: "football", label: "Fotball", keywords: ["mesterligaen", "cupfinale", "landskamp"] },
	{ sport: "esports", label: "Esport", keywords: ["cs2", "counter-strike", "esport-major"] },
	{ sport: "winter", label: "Vinteridrett", keywords: ["langrenn", "skiskyting", "alpint verdenscup"] },
];

/** Headline language that says "this is happening now / very soon". */
export const IMMINENCE_MARKERS = [
	"i dag", "i kveld", "i natt", "i morgen",
	"denne helga", "denne helgen", "i helga", "i helgen",
	"live", "direkte", "sendes nå", "starter i dag",
	"this weekend", "today", "tonight", "kickoff", "race day",
];

/** Build the watchlist: names (and aliases) worth spotting in headlines. */
export function buildWatchlist(interests, tracked) {
	const names = new Set();
	for (const group of ["athletes", "teams", "tournaments"]) {
		for (const raw of interests?.alwaysTrack?.[group] || []) {
			const e = normalizeEntity(raw);
			if (e) for (const term of entityTerms(e)) names.add(term);
		}
	}
	for (const group of ["athletes", "tournaments", "leagues"]) {
		for (const entry of tracked?.[group] || []) {
			if (entry?.name) names.add(entry.name);
		}
	}
	return [...names].filter((n) => n && n.length >= 3);
}

/** Does the headline carry "happening now/soon" language? */
export function headlineIsImminent(headline) {
	return IMMINENCE_MARKERS.some((m) => containsName(headline, m));
}

/** Does this event mention the given name (title, teams, tournament, players)? */
function eventMentionsName(event, name) {
	// Shares the canonical coverage haystack (helpers.coverageHaystack) so this
	// recall net scans the exact same fields the build's coverage gate does (WP-130).
	return containsName(coverageHaystack(event), name);
}

/**
 * Does any event within `days` (and not already over) mention this name?
 * Uses isEventInWindow so an ongoing multi-day event (golf, stage race) that
 * STARTED days ago still counts as coverage — windowing on start time alone
 * generated false gaps for exactly those events.
 */
export function hasEventWithin(name, events, now, days) {
	const windowStart = now - MS_PER_DAY;
	const windowEnd = now + days * MS_PER_DAY;
	return events.some((e) => isEventInWindow(e, windowStart, windowEnd) && eventMentionsName(e, name));
}

/** Back-compat: is there an upcoming (≤14d) event for this name? */
export function hasUpcomingEvent(name, events, now = Date.now()) {
	return hasEventWithin(name, events, now, UPCOMING_DAYS);
}

/** Count events of a given sport within `days` (ongoing multi-day events included). */
export function countSportEventsWithin(events, sport, now, days) {
	const windowStart = now - MS_PER_DAY;
	const windowEnd = now + days * MS_PER_DAY;
	return events.filter((e) => e.sport === sport && isEventInWindow(e, windowStart, windowEnd)).length;
}

export function detectGaps({ rss, events, interests, tracked, now = Date.now() }) {
	const watchlist = buildWatchlist(interests, tracked);
	const items = (rss?.items || []).map((item) => ({
		item,
		text: `${item.title || ""} ${item.description || ""}`,
	}));
	const gaps = [];

	// (1) + partial (imminent) — per tracked entity.
	for (const name of watchlist) {
		const matches = items.filter(({ text }) => containsName(text, name));
		if (matches.length === 0) continue;

		const hasUpcoming = hasEventWithin(name, events, now, UPCOMING_DAYS);
		const hasImminent = hasEventWithin(name, events, now, IMMINENT_DAYS);
		const imminentMatch = matches.find(({ text }) => headlineIsImminent(text));

		let type = null;
		if (!hasUpcoming) type = "missing"; // in the news, nothing on the board at all
		else if (imminentMatch && !hasImminent) type = "imminent"; // something soon per the news, but our next one is far out
		if (!type) continue;

		const lead = imminentMatch || matches[0];
		gaps.push({
			kind: "entity",
			entity: name,
			type,
			imminent: type === "imminent" || (!!imminentMatch && type === "missing"),
			headline: lead.item.title || "",
			link: lead.item.link || null,
			feed: lead.item.feed || lead.item.source || null,
			matchCount: matches.length,
			detectedAt: iso(now),
		});
	}

	// (2) sport-level imminence — the ESPN-blind-spot catcher (F1 etc.).
	for (const { sport, label, keywords } of SPORT_NEWS_KEYWORDS) {
		const match = items.find(
			({ text }) => headlineIsImminent(text) && keywords.some((k) => containsName(text, k))
		);
		if (!match) continue;
		if (countSportEventsWithin(events, sport, now, IMMINENT_DAYS) > 0) continue;
		gaps.push({
			kind: "sport",
			entity: label,
			sport,
			type: "imminent",
			imminent: true,
			headline: match.item.title || "",
			link: match.item.link || null,
			feed: match.item.feed || match.item.source || null,
			detectedAt: iso(now),
		});
	}

	return gaps;
}

/**
 * (3) Source health, coverage-first. What matters is whether the *board* covers a
 * sport, not the fetcher's internal state: some sports (chess, most cycling) have no
 * API and are filled by AI research, so an empty fetcher file there is expected. So
 * we only look closer at a sport when the board has NOTHING upcoming for it, then
 * name why (fetcher missing / empty / dropping events). `sources` maps sport key →
 * parsed data file (or null if absent).
 *
 * ONE signal deliberately escapes the coverage-first gate: `stale-retained`. See the
 * comment at its check — a fetcher frozen on retained data is broken even when the
 * board looks complete, and coverage-first is precisely what hid it for 137 runs.
 *
 * WP-110: the "dropped-in-build" (high) signal is CATALOG-GATED with the SAME
 * `isCovered` build-events.js uses. Entity-gated sports (chess/esports) are covered
 * only through the named catalog long-tail, so a minor open with a lone club player
 * (the "Sant Martí" class) legitimately never reaches the board — that is a correct
 * build drop, NOT the build dropping something it should keep. Counting it as
 * dropped-in-build fired a chronic HIGH false positive every hour. So a source-file
 * event only counts toward this signal if the catalog actually covers it. `isCovered`
 * defaults to a permissive gate (cover everything) so callers that don't pass one keep
 * the pre-WP-110 behaviour; main() passes the real catalog gate. File events carry no
 * `sport` field (build-events stamps it from the filename), so we force it here too.
 */
export function detectSourceAnomalies({ sources, events, now = Date.now(), isCovered = () => true }) {
	const anomalies = [];
	for (const sport of EXPECTED_SPORT_FILES) {
		const onBoard = countSportEventsWithin(events, sport, now, UPCOMING_DAYS);
		const data = sources?.[sport];

		// Chronic retention — DELIBERATELY checked BEFORE the coverage-first gate below.
		// `retainLastGood` keeps the last non-empty file when a fetch comes back empty and
		// stamps `_retained`, but nothing ever read that stamp. So a dead fetcher stayed
		// invisible for as long as SOMETHING else covered the sport: football.json sat
		// frozen on the 19 July World Cup final for 137 consecutive runs while the board
		// looked healthy, because the research agent was hand-filling Eliteserien rounds
		// as `source: "ai-research"`. Coverage-first is right for the signals below (an
		// empty chess file is normal — chess has no API), but it is exactly wrong here:
		// a fetcher that has stopped producing is broken whether or not the board hides it.
		const retained = data?._retained;
		if (retained) {
			const since = Date.parse(retained.lastFreshFetch || retained.since || "");
			const staleDays = Number.isFinite(since) ? Math.floor((now - since) / MS_PER_DAY) : null;
			if (staleDays != null && staleDays >= STALE_RETAIN_DAYS) {
				anomalies.push({
					sport,
					issue: "stale-retained",
					detail: `docs/data/${sport}.json has been served from retention for ${retained.consecutiveRetains || "?"} consecutive run(s) — no fresh fetch in ${staleDays} day(s). The fetcher is producing nothing; the file only looks current because retainLastGood re-writes the last good copy${onBoard > 0 ? ", and the board hides it because another source covers this sport" : ""}.`,
					consecutiveRetains: retained.consecutiveRetains || null,
					staleDays,
					severity: "high",
					detectedAt: iso(now),
				});
			}
		}

		if (onBoard > 0) continue; // covered by some source — not a coverage problem

		if (data == null) {
			anomalies.push({ sport, issue: "file-missing", detail: `docs/data/${sport}.json is absent and no ${sport} events on the board — fetcher may have failed`, severity: "medium", detectedAt: iso(now) });
			continue;
		}
		const fileEvents = (data.tournaments || []).flatMap((t) => t.events || []);
		// Only events the BUILD would actually KEEP count as "dropped" — an uncovered
		// event (Sant Martí chess/esports) is a legitimate drop, not a build bug.
		const droppableUpcoming = fileEvents.filter((e) =>
			isEventInWindow(e, now - MS_PER_DAY, now + UPCOMING_DAYS * MS_PER_DAY) &&
			isCovered({ ...e, sport })
		).length;
		if (droppableUpcoming > 0) {
			anomalies.push({ sport, issue: "dropped-in-build", detail: `${droppableUpcoming} upcoming ${sport} event(s) in the source file but 0 on the board — build/normalisation may be dropping them`, severity: "high", detectedAt: iso(now) });
		} else if (fileEvents.length === 0) {
			anomalies.push({ sport, issue: "file-empty", detail: `docs/data/${sport}.json has no events and none on the board — source may be down or changed`, severity: "low", detectedAt: iso(now) });
		}
	}
	return anomalies;
}

// ─────────────────────────────────────────────────────────────────────────────
// (4) Tracked-claim gaps — RSS-INDEPENDENT. tracked.json's `reason` prose routinely
// names a concrete upcoming date ("lørdag 25. juli", "torsdag 27. august") that the
// AI believes it has put on the board. When such a claim exists but events.json has
// NO matching event, the board silently disagrees with its own tracking rationale.
// This is the Gstaad class: tracked.json claimed Ruud's Swiss Open coverage while the
// event was absent — no RSS headline and no entity/sport signal would ever catch it,
// because the only witness is tracked.json itself.
// ─────────────────────────────────────────────────────────────────────────────

/** How far ahead we still count a matching event as backing a coverage claim. */
export const TRACKED_CLAIM_HORIZON_DAYS = 400;

/**
 * Unambiguous phrases the research agent uses when it has actually put an event on the
 * board. Kept strict on purpose — "lagt til" is excluded because it also appears in the
 * negation "Ingen event lagt til" / "ikke lagt til", which would invert the signal.
 * These are the AI asserting coverage; if the assertion has no event behind it, that is
 * the silent miss we want (the Gstaad class).
 */
export const COVERAGE_CLAIM_MARKERS = [
	"pa tavla", "pa tavlen", "ai-research-event", "ligger inne", "ligger na inne", "ligger naa inne",
];

/** Norwegian month names/abbreviations → 0-based month index. */
export const NOR_MONTHS = {
	januar: 0, jan: 0, februar: 1, feb: 1, mars: 2, mar: 2, april: 3, apr: 3, mai: 4,
	juni: 5, jun: 5, juli: 6, jul: 6, august: 7, aug: 7, september: 8, sept: 8, sep: 8,
	oktober: 9, okt: 9, november: 10, nov: 10, desember: 11, des: 11,
};

const NOR_DATE_RE = new RegExp(
	`(\\d{1,2})\\.\\s*(${Object.keys(NOR_MONTHS).sort((a, b) => b.length - a.length).join("|")})\\b`,
	"gi"
);

/**
 * Language near a date that says "we did NOT put this on the board (yet)". A claim
 * wrapped in hold-off prose is an intentional non-coverage, not a silent miss — so we
 * must not flag it. Kept deliberately specific so it can't swallow real claims.
 */
export const HOLD_OFF_MARKERS = [
	"holdt av tavla", "holdes av tavla", "holdt av tavlen", "holdes av tavlen",
	"ikke pa tavla", "ikke pa tavlen", "ikke lagt til", "ikke lagt inn",
	"utenfor horisonten", "ikke pa tavla enna", "ubekreftet", "ikke bekreftet",
	"tid ikke satt", "avspark-tid er ikke", "tbd", "holdes av",
];

/**
 * Parse Norwegian "<day>. <month>" dates out of free prose and resolve each to a UTC
 * timestamp near `now` (the year is implicit in tracked reasons). Returns
 * `{ ts, index }` per match so callers can inspect the surrounding text.
 */
export function parseNorwegianDates(text, now = Date.now()) {
	const out = [];
	if (!text) return out;
	for (const m of text.matchAll(NOR_DATE_RE)) {
		const day = parseInt(m[1], 10);
		const monthIdx = NOR_MONTHS[m[2].toLowerCase()];
		if (day < 1 || day > 31 || monthIdx == null) continue;
		const year = new Date(now).getUTCFullYear();
		let ts = Date.UTC(year, monthIdx, day);
		if (ts < now - 60 * MS_PER_DAY) ts = Date.UTC(year + 1, monthIdx, day);
		else if (ts > now + 300 * MS_PER_DAY) ts = Date.UTC(year - 1, monthIdx, day);
		out.push({ ts, index: m.index ?? 0 });
	}
	return out;
}

/** Is there hold-off prose within a window of `index` in `text`? */
function heldOffNear(text, index) {
	const norm = normalizeText(text.slice(Math.max(0, index - 110), index + 60));
	return HOLD_OFF_MARKERS.some((mk) => norm.includes(mk));
}

/** Does the reason assert the AI put an event on the board? */
export function reasonClaimsCoverage(reason) {
	const norm = normalizeText(reason);
	return COVERAGE_CLAIM_MARKERS.some((m) => norm.includes(m));
}

/**
 * Distinctive words to match a tracked entry against event text. Includes parenthetical
 * content (the parenthesis usually holds the distinctive entity — "(Lyn Oslo)",
 * "(Kristoffer Ventura)", "(100 Thieves)") and drops years, month names and generic
 * sport words that would match unrelated events.
 */
/** Short connector words that carry no identity even scoped to a sport. */
const TERM_STOP = new Set(["the", "fra", "mot", "cup", "and", "for", "los"]);

export function entryClaimTerms(entry) {
	const name = String(entry?.name || "").replace(/[()]/g, " ");
	// Keep short distinctive names (3-char "Lyn", "Odd") but drop structural noise
	// (years, month names, connectors). Genuinely generic words ("Open", "Championship")
	// are KEPT — the sport filter already scopes matches to the right sport, and dropping
	// them cost us a real match (an under-labelled "The Open" event vs a "The Open
	// Championship … Royal Birkdale" entry).
	return [...name.matchAll(/[\p{L}][\p{L}\d]{2,}/gu)]
		.map((m) => m[0])
		.filter((w) => !/^\d{4}$/.test(w) && !(w.toLowerCase() in NOR_MONTHS) && !TERM_STOP.has(w.toLowerCase()));
}

/** Is there ANY upcoming (or ongoing) event matching this entry's sport + a distinctive term? */
function boardBacksEntry(entry, terms, events, now, horizonDays) {
	const windowStart = now - MS_PER_DAY;
	const windowEnd = now + horizonDays * MS_PER_DAY;
	return events.some((e) => {
		if (entry.sport && e.sport && normalizeText(e.sport) !== normalizeText(entry.sport)) return false;
		if (!isEventInWindow(e, windowStart, windowEnd)) return false;
		return terms.some((t) => eventMentionsName(e, t));
	});
}

/**
 * Flag a tracked entry whose `reason` ASSERTS board coverage ("på tavla",
 * "ai-research-event", "ligger inne") but for which events.json carries NO matching
 * upcoming event at all. RSS-independent: the only witness is tracked.json disagreeing
 * with the board. This is the Gstaad class — the AI's tracking rationale said Ruud's
 * Swiss Open was on the board while the event was in fact absent, which no headline or
 * sport/entity signal could catch. Gated on an unambiguous claim marker (not a date
 * scattered through the prose) to stay precise: a noisy audit trains agents to ignore it.
 */
export function detectTrackedClaims({ tracked, events, now = Date.now(), horizonDays = TRACKED_CLAIM_HORIZON_DAYS }) {
	const gaps = [];
	if (!tracked || typeof tracked !== "object") return gaps;
	for (const group of ["leagues", "teams", "athletes", "tournaments"]) {
		for (const entry of tracked[group] || []) {
			if (!entry?.name || !entry.reason) continue;
			// An entry meant to lapse is not a live coverage claim.
			if (entry.expires && Date.parse(entry.expires) < now) continue;
			if (!reasonClaimsCoverage(entry.reason)) continue;

			const terms = entryClaimTerms(entry);
			if (terms.length === 0) continue;
			if (boardBacksEntry(entry, terms, events, now, horizonDays)) continue;

			// Enrich with the soonest non-held-off date the prose names, if any.
			const dated = parseNorwegianDates(entry.reason, now)
				.filter((d) => d.ts >= now - MS_PER_DAY && !heldOffNear(entry.reason, d.index))
				.sort((a, b) => a.ts - b.ts)[0];
			gaps.push({
				kind: "tracked-claim",
				entity: entry.name,
				group,
				sport: entry.sport || null,
				type: "missing",
				imminent: dated ? dated.ts <= now + IMMINENT_DAYS * MS_PER_DAY : false,
				claimedDate: dated ? iso(dated.ts) : null,
				reason: "tracked.json asserts board coverage for this interest, but no matching event is on the board",
				trackedId: entry.id || null,
				detectedAt: iso(now),
			});
		}
	}
	return gaps;
}

function readSources(dataDir) {
	const sources = {};
	for (const sport of EXPECTED_SPORT_FILES) {
		const file = path.join(dataDir, `${sport}.json`);
		sources[sport] = fs.existsSync(file) ? readJsonIfExists(file) : null;
	}
	return sources;
}

/**
 * WP-243: turn breached coverage contracts (coverage-contracts.json, written by
 * build-events the step before) into gap entries the agents already know how to
 * triage. High severity by construction: the contract IS the pre-agreed
 * definition of «this absence is a real hole», season-honest (off-season never
 * breaches) and conservative by seeding policy — so unlike the recall-biased
 * signals above, a breach needs no imminence heuristics.
 */
export function detectContractBreaches(contractReport, now = Date.now()) {
	return (contractReport?.contracts || [])
		.filter((c) => c && c.status === "breached")
		.map((c) => ({
			kind: "contract-breach",
			type: "missing",
			interest: c.name,
			sport: c.sport,
			severity: "high",
			imminent: true,
			detail: `Dekningskontrakt brutt: ${c.upcoming} av minst ${c.minUpcoming} ventede events innen ${c.horizonDays} dager for ${c.name} (i sesong). Gå til den navngitte autoriteten (${c.authority}) og fyll tavla.`,
			detectedAt: iso(now),
		}));
}

function main() {
	const dataDir = rootDataPath();
	const configDir = configDirPath();
	const rss = readJsonIfExists(path.join(dataDir, "rss-digest.json"));
	const events = readJsonIfExists(path.join(dataDir, "events.json")) || [];
	// WP-96: the recall net watches what the catalog COVERS, not one person's
	// follows. buildWatchlist reads an `alwaysTrack` shape, so map catalog tier2
	// into it (falling back to the owner's interests.json seed). Same function,
	// catalog compass.
	const catalog = readJsonIfExists(path.join(configDir, "catalog.json"));
	const interestsSeed = readJsonIfExists(path.join(configDir, "interests.json"));
	const interests = catalog?.tier2
		? { alwaysTrack: catalog.tier2 }
		: interestsSeed;
	const tracked = readJsonIfExists(path.join(configDir, "tracked.json"));
	const sources = readSources(dataDir);
	// WP-110: gate the dropped-in-build anomaly with the SAME coverage gate the
	// build uses, so an event the catalog never covers (the Sant Martí chess class)
	// is not mis-read as "the build dropped it".
	const isCovered = makeCoverageGate(catalog);

	const gaps = detectGaps({ rss, events, interests, tracked });
	const trackedClaims = detectTrackedClaims({ tracked, events });
	// WP-243: contract breaches from this build's coverage-contracts.json
	// (build-events writes it in the pipeline step right before this one).
	const contractBreaches = detectContractBreaches(readJsonIfExists(path.join(dataDir, "coverage-contracts.json")));
	const allGaps = [...gaps, ...trackedClaims, ...contractBreaches];
	const anomalies = detectSourceAnomalies({ sources, events, isCovered });
	// WP-165: fold the public, anonymous `coverage-request` demand signal in. Fail-soft
	// — collectDemand returns null when `gh` is unavailable/unauthorised, and we simply
	// omit the `demand` field then (never fail the pipeline over a missing signal).
	const demand = collectDemand({ now: Date.now() });
	const out = {
		generatedAt: iso(),
		gapCount: allGaps.length,
		anomalyCount: anomalies.length,
		gaps: allGaps,
		anomalies,
		note: "Recall-biased mechanical detection — the coverage-critic and research agents triage these and cross-check the web. gaps: entity/sport in the news but missing or not imminent on the board (kind entity/sport), or a tracked.json reason that claims an upcoming event the board lacks (kind tracked-claim, RSS-independent). anomalies: a fetcher's own data looks unreliable — including `stale-retained`, a fetcher frozen on retainLastGood retention, which is reported even when the board looks covered. demand: distinct entities users publicly asked us to cover (open coverage-request issues), anonymous name+sport only — the research agent prioritises these when widening the catalog. kind contract-breach (WP-243): a wholesale-covered competition's pre-agreed coverage contract is broken (in season, fewer upcoming events than promised) — always high severity, treat as top priority and fill from the named authority.",
	};
	if (demand != null) out.demand = demand;
	writeJsonPretty(path.join(dataDir, "coverage-gaps.json"), out);
	console.log(
		`Coverage gaps: ${allGaps.length} (${allGaps.filter((g) => g.imminent).length} imminent, ${trackedClaims.length} tracked-claim, ${contractBreaches.length} contract-breach); source anomalies: ${anomalies.length}; demand: ${demand == null ? "n/a" : demand.length}`
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main();
}
