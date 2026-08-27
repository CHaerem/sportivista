#!/usr/bin/env node
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { readJsonIfExists, rootDataPath, configDirPath, MS_PER_DAY, makeCoverageGate, normalizeParticipants, normalizeNorwegianPlayers, normalizeText, containsName, entityTerms } from "./lib/helpers.js";
import { resolveStreaming, stampUrlKinds } from "./lib/norwegian-rights.js";
import { deriveProvenance, lookalikeHosts, stripLookalikeEvidence } from "./lib/provenance.js";
import { soleDistrustedBasis, RELIABILITY_FLOOR } from "./lib/calibration-gate.js";
import { assessContracts } from "./lib/coverage-contracts.js";
import { writeManifest } from "./build-manifest.js";
import { writePortReport } from "./build-port-report.js";
import { readIosCommit, buildAppVersion, readTestflight } from "./lib/app-version.js";
import { buildNews } from "./lib/news.js";
import { fileURLToPath } from "url";
import { writeEntities } from "./build-entities.js";
import { validateEvents, loadEventSchema } from "./validate-events.js";

const dataDir = rootDataPath();
const configDir = configDirPath();

// Stable event ID: first 12 hex chars of a sha256 hash of the same dedupe key
// used throughout this file (`${sport}|${title}|${time}`, see the preservation
// pass below). Known limitation, accepted by design: if the verify agent later
// amends an event's title or time, the NEXT build computes a DIFFERENT id for
// it — a client/notification diff then sees remove+add rather than an
// in-place update. That's fine; it's still far more stable than the old
// client-side `array-index` synthesis, which changed on every reorder.
function computeEventId(sport, title, time) {
	return crypto.createHash("sha256").update(`${sport}|${title}|${time}`).digest("hex").slice(0, 12);
}

// WP-05: entity index — built (and published to docs/data/entities.json)
// before anything below needs it for entityId enrichment. Two lookup pools:
// athletes (matched against norwegianPlayers) and teams+leagues (matched
// against homeTeam/awayTeam — "league" is included because tracked.json files
// a few clubs, e.g. FC Barcelona, under its "leagues" bucket; see
// build-entities.js's NOTE ON TYPE ACCURACY).
const entities = writeEntities(dataDir, configDir);
const athleteEntities = entities.filter((e) => e.type === "athlete");
const teamEntities = entities.filter((e) => e.type === "team" || e.type === "league");

/**
 * Word-boundary, sport-scoped entity lookup. Checks every (name+alias) term
 * of each candidate entity against `name` in BOTH directions via containsName
 * — never naive substring (the Brooklyn/Lyn trap: "Brooklyn FC" must not
 * match the tracked club "Lyn"; see tests/fixtures/feed-vectors/DIVERGENCES.md
 * and the negative test in tests/build-entities.test.js). Sport-scoped so a
 * same-named entity in a different sport can't cross-match.
 */
function findEntityId(name, pool, sport) {
	if (!name) return null;
	for (const e of pool) {
		if (sport && e.sport && normalizeText(e.sport) !== normalizeText(sport)) continue;
		for (const term of entityTerms(e)) {
			if (containsName(name, term) || containsName(term, name)) return e.id;
		}
	}
	return null;
}

/**
 * Stamp entityId (norwegianPlayers) / homeTeamEntityId / awayTeamEntityId
 * onto an event, in place. Called from BOTH pushEvent() (fresh events) and
 * the final normalization pass over `kept` (preserved ai-research /
 * kept-on-board events, which bypass pushEvent — same dual-call pattern as
 * computeEventId()/normalizeNorwegianPlayers() below). Idempotent: clears a
 * stale id when the current text no longer matches any known entity.
 */
function enrichEntityIds(event) {
	for (const p of event.norwegianPlayers || []) {
		if (!p?.name) continue;
		const id = findEntityId(p.name, athleteEntities, event.sport);
		if (id) p.entityId = id;
		else delete p.entityId;
	}
	const homeId = event.homeTeam ? findEntityId(event.homeTeam, teamEntities, event.sport) : null;
	if (homeId) event.homeTeamEntityId = homeId;
	else delete event.homeTeamEntityId;
	const awayId = event.awayTeam ? findEntityId(event.awayTeam, teamEntities, event.sport) : null;
	if (awayId) event.awayTeamEntityId = awayId;
	else delete event.awayTeamEntityId;
}

// Auto-discover sport files by convention: any JSON with a { tournaments: [...] }
// structure. Cache the parsed JSON as we go so the load pass below can reuse it —
// each sport file used to be read+parsed twice per build (discovery + load), and on
// the hourly cadence that double I/O is pure waste (WP-130).
const dataFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));
const sports = [];
const sportData = new Map();
for (const f of dataFiles) {
	if (f === "events.json") continue;
	const data = readJsonIfExists(path.join(dataDir, f));
	if (data && Array.isArray(data.tournaments)) {
		const sport = f.replace(".json", "");
		sports.push(sport);
		sportData.set(sport, data);
	}
}

const all = [];

function pushEvent(ev, sport, tournament) {
	const event = {
		sport,
		tournament: ev.tournament || tournament,
		title: ev.title,
		time: ev.time,
		endTime: ev.endTime || null,
		venue: ev.venue,
		meta: ev.meta,
		norwegian: ev.norwegian || false,
		streaming: ev.streaming || [],
		// WP-04: canonical form — [{name}] / [{name, teeTime?, teeTimeUTC?,
		// status?}], never bare strings and never null. Fetchers are cleaned up at
		// the source too (scripts/lib/event-normalizer.js), but this is the
		// guarantee: every event built fresh in THIS pass goes through here
		// regardless of which fetcher/curated-config produced it.
		participants: normalizeParticipants(ev.participants),
		norwegianPlayers: normalizeNorwegianPlayers(ev.norwegianPlayers),
		totalPlayers: ev.totalPlayers || null,
		link: ev.link || null,
		status: ev.status || null,
		featuredGroups: ev.featuredGroups || [],
		homeTeam: ev.homeTeam || null,
		awayTeam: ev.awayTeam || null,
		isFavorite: ev.isFavorite || false,
		round: ev.round || null,
	};
	// See computeEventId() above for the stability contract. This covers events
	// built fresh in this pass; the final normalization loop before write (see
	// "kept" below) recomputes it for every output event regardless of path, so
	// preserved ai-research / kept-on-board events (pushed directly from a
	// previous events.json, which may predate this field) get one too.
	event.id = computeEventId(event.sport, event.title, event.time);
	if (ev.format) event.format = ev.format;
	if (ev.stage) event.stage = ev.stage;
	if (ev.result) event.result = ev.result;
	if (ev.context) event.context = ev.context;
	if (ev.importance != null) event.importance = ev.importance;
	if (ev.summary) event.summary = ev.summary;
	// AI-research provenance fields — carried through verbatim
	if (ev.source) event.source = ev.source;
	if (ev.confidence) event.confidence = ev.confidence;
	if (ev.evidence) event.evidence = ev.evidence;
	if (ev.provenance) event.provenance = ev.provenance; // WP-242: per-faktum-proveniens

	if (ev.researchedAt) event.researchedAt = ev.researchedAt;
	if (ev.verifiedAt) event.verifiedAt = ev.verifiedAt;
	if (ev.verificationStatus) event.verificationStatus = ev.verificationStatus;
	if (ev.verificationSources) event.verificationSources = ev.verificationSources;
	// WP-05: entityId enrichment — see enrichEntityIds() above for the
	// dual-call-site rationale (this covers events built fresh in this pass;
	// the final pass over `kept` covers preserved events too).
	enrichEntityIds(event);
	all.push(event);
}

// 1. Load standard sport JSON files (static fetchers) — reuse the JSON already
// parsed during discovery above (no second read of the same file).
for (const sport of sports) {
	const json = sportData.get(sport);
	if (!json || !Array.isArray(json.tournaments)) continue;
	json.tournaments.forEach((t) => {
		(t.events || []).forEach((ev) => pushEvent(ev, sport, t.name));
	});
}

// 2. Auto-discover curated event configs from scripts/config/*.json
if (fs.existsSync(configDir)) {
	const configFiles = fs.readdirSync(configDir).filter((f) => f.endsWith(".json"));
	for (const file of configFiles) {
		const config = readJsonIfExists(path.join(configDir, file));
		if (!config || !Array.isArray(config.events)) continue;
		const sport =
			config.sport ||
			config.context?.split("-")[0] ||
			file.replace(".json", "").split("-")[0];
		const tournamentName = config.name || file.replace(".json", "");
		console.log(`  Curated config: ${file} → ${config.events.length} events (sport: ${sport})`);
		config.events.forEach((ev) => {
			if (config.context && !ev.context) ev.context = config.context;
			pushEvent(ev, sport, tournamentName);
		});
	}
}

// 3. Preserve AI work from the previous events.json.
// (a) AI-research events no static fetcher knows about must survive rebuilds.
// (b) Agent amendments to STATIC events (streaming corrections, verification
//     stamps) must also survive — the fetchers regenerate those events from
//     API data and would otherwise silently erase the corrections every hour.
// Dedupe key: sport|title|time.
const CARRY_FORWARD_FIELDS = [
	"streaming",
	"status", // a "cancelled"/"postponed" mark from the verify agent must survive the hourly rebuild
	"verifiedAt",
	"verificationStatus",
	"verificationSources",
	// Agent enrichment grafted onto a bare static stub (see mergeEnrichment) must
	// survive the NEXT re-fetch too — the fetcher regenerates the stub empty every
	// hour, and without these the tracked player/context is lost and the event
	// drops out of the relevance filter again (the Gstaad / Ruud silent drop).
	"norwegianPlayers",
	"participants",
	"summary",
	// WP-242: en agent-stemplet per-faktum-proveniens på et statisk event må
	// overleve at fetcheren regenererer eventet tomt hver time — samme
	// begrunnelse som verifikasjonsstemplene over.
	"provenance",
];
// A verified streaming channel must beat a *non-empty* default — not just fill an
// empty one. The carry-forward above only fills gaps, and the streaming-resolution
// pass further down re-derives the channel from the deterministic rights map
// (`resolveStreaming`) on every rebuild. So when that map hard-codes the WRONG (but
// confident, non-tentative) channel, it silently overwrites the verify agent's
// correction every hour: the Corales Puntacana revert-war (the golf map emitted
// Viaplay while verify had amended the channel to HBO Max — reverted for 5+ days).
// Fix: when the previous event carries a *fresh* verify decision
// (`confirmed`/`amended` within the TTL) whose channel differs from what the map
// re-derives, the verified channel wins (enforced in the streaming-resolution pass).
// The TTL lets a genuinely CHANGED value (a real rights move, or a corrected map
// default) reclaim the field once the stale verification ages out — verify
// re-checks near-term events daily, so a still-true decision is refreshed long
// before it expires.
const VERIFICATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
function verifiedDecisionIsFresh(prev, now) {
	if (!prev) return false;
	if (prev.verificationStatus !== "confirmed" && prev.verificationStatus !== "amended") return false;
	const verifiedAt = Date.parse(prev.verifiedAt);
	// No usable timestamp ⇒ can't establish freshness ⇒ don't override the map.
	if (!Number.isFinite(verifiedAt)) return false;
	return now - verifiedAt <= VERIFICATION_TTL_MS;
}
// Which broadcaster a `verificationSources` URL corroborates — used to spot a
// STALE revert-war casualty: an event whose stored `streaming` array is the wrong
// channel (the old confident-but-wrong map wrote it AFTER verify recorded the right
// answer in its sources/summary), so the array must NOT be trusted over the
// corrected map. Distinctive domain/name tokens only (no generic "sport"/"tv").
const PLATFORM_SOURCE_TOKENS = [
	{ match: /viaplay|v sport/, tokens: ["viaplay"] },
	{ match: /hbo\s*max/, tokens: ["hbomax", "hbo-max"] },
	{ match: /eurosport/, tokens: ["eurosport"] },
	{ match: /discovery/, tokens: ["discoveryplus", "discovery.no", "presse.discovery", "warnerbrosdiscovery"] },
	{ match: /\bmax\b/, tokens: ["max.com"] },
	{ match: /nrk/, tokens: ["nrk.no"] },
	{ match: /tv\s*2/, tokens: ["tv2.no", "tv 2"] },
];
function streamingBackedBySources(streaming, sources) {
	if (!Array.isArray(streaming) || !Array.isArray(sources) || !sources.length) return false;
	const src = sources.join(" ").toLowerCase();
	for (const c of streaming) {
		const p = ((c && c.platform) || "").toLowerCase();
		for (const { match, tokens } of PLATFORM_SOURCE_TOKENS) {
			if (match.test(p) && tokens.some((t) => src.includes(t))) return true;
		}
	}
	return false;
}
// Fuzzy "same event" check, to de-dupe an ai-research event against a static one
// when a sport|title|time key misses them. Two ways two sources point at one event:
//   • "title": same sport + ≥2 shared title words (or one title's words ⊆ the
//     other) + overlapping date range — common for multi-day golf/stage events
//     (ESPN says 04:00, the research agent wrote 06:00).
//   • "venue": same sport + same venue + overlapping date range, when the two
//     sources title the event COMPLETELY differently — the recurring World Cup
//     knockout case, where ESPN emits a bracket placeholder ("Semifinal 2 Winner
//     at Semifinal 1 Winner") and the research agent wrote a human title
//     ("VM-finalen 2026"). Zero shared title words, but same stadium + kickoff.
//     Safe because for point-in-time events the date-range overlap collapses to an
//     EXACT start-time match — two events can't share a venue at the same instant.
const TITLE_STOP = new Set(["the", "at", "in", "of", "and", "a", "vs", "v"]);
function titleTokens(s) {
	return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
		.filter((w) => w.length > 1 && !TITLE_STOP.has(w) && !/^\d+(st|nd|rd|th)?$/.test(w));
}
const VENUE_GENERIC = new Set(["stadium", "stadion", "arena", "park", "field", "ground", "at"]);
function venueMatch(a, b) {
	const norm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
	const va = norm(a.venue), vb = norm(b.venue);
	if (!va || !vb) return false;
	if (va.includes(vb) || vb.includes(va)) return true; // one venue string contains the other
	const sig = (v) => new Set(v.split(" ").filter((w) => w.length > 2 && !VENUE_GENERIC.has(w)));
	const tb = sig(vb);
	for (const w of sig(va)) if (tb.has(w)) return true; // share a distinctive (non-generic) venue token
	return false;
}
// Returns how a and b match ("title" | "venue"), or null. See the block comment above.
function fuzzyMatchKind(a, b) {
	if (!a || !b || a.sport !== b.sport) return null;
	const s1 = Date.parse(a.time), e1 = a.endTime ? Date.parse(a.endTime) : s1;
	const s2 = Date.parse(b.time), e2 = b.endTime ? Date.parse(b.endTime) : s2;
	if (!Number.isFinite(s1) || !Number.isFinite(s2)) return null;
	if (!(s1 <= e2 && s2 <= e1)) return null; // date ranges must overlap
	const at = titleTokens(a.title), bset = new Set(titleTokens(b.title));
	const shared = at.filter((w) => bset.has(w));
	const subset = at.length > 0 && at.every((w) => bset.has(w));
	if (shared.length >= 2 || subset) return "title";
	if (venueMatch(a, b)) return "venue";
	return null;
}

// When an ai-research event is dropped in favour of a fuzzy-matched static event,
// graft the AI event's enrichment onto the static stub first. ESPN's tennis feed
// lists events as bare tournament names ("EFG Swiss Open Gstaad") with no player
// on them — so the AI event's tracked player + norwegian flag are exactly what the
// relevance filter needs to keep the event on the board. Without this carry-over
// the static stub silently fails isRelevant() and BOTH copies vanish (the Gstaad /
// Casper Ruud silent drop). Static wins on dates/venue; the AI event fills only
// fields the static stub left empty.
function mergeEnrichment(target, ai) {
	if (ai.norwegian) target.norwegian = true;
	const fillIfEmpty = (field) => {
		const cur = target[field];
		const empty = cur == null || (Array.isArray(cur) && cur.length === 0);
		const aiHas = ai[field] != null && (!Array.isArray(ai[field]) || ai[field].length > 0);
		if (empty && aiHas) target[field] = ai[field];
	};
	fillIfEmpty("norwegianPlayers");
	fillIfEmpty("participants");
	fillIfEmpty("streaming");
	fillIfEmpty("summary");
	fillIfEmpty("homeTeam");
	fillIfEmpty("awayTeam");
	if (target.importance == null && ai.importance != null) target.importance = ai.importance;
}

const previousEvents = readJsonIfExists(path.join(dataDir, "events.json"));
if (Array.isArray(previousEvents)) {
	const byKey = new Map(all.map((e) => [`${e.sport}|${e.title}|${e.time}`, e]));
	// A live match can drop out of the ESPN fetch the moment it kicks off; if we
	// rebuild purely from the fetch, a verified in-progress event vanishes from
	// the board mid-play (see (c) below for the rescue).
	const now = Date.now();
	const LIVE_GRACE_MS = 3 * 60 * 60 * 1000; // match length + buffer, for events with no endTime
	let preserved = 0;
	let carried = 0;
	let keptOnBoard = 0;
	for (const prev of previousEvents) {
		const key = `${prev.sport}|${prev.title}|${prev.time}`;
		const current = byKey.get(key);
		if (current) {
			// Same event re-fetched: keep agent amendments the fetcher lacks
			for (const field of CARRY_FORWARD_FIELDS) {
				const currentEmpty =
					current[field] == null ||
					(Array.isArray(current[field]) && current[field].length === 0);
				const prevHasValue =
					prev[field] != null &&
					(!Array.isArray(prev[field]) || prev[field].length > 0);
				if (currentEmpty && prevHasValue) {
					current[field] = prev[field];
					carried++;
				}
			}
			// The norwegian flag is agent enrichment (a bare ESPN stub has it false);
			// once set true it must survive re-fetches so the event keeps its
			// must-watch / accent treatment. A boolean isn't "empty", so the loop
			// above skips it — carry it explicitly.
			if (!current.norwegian && prev.norwegian) {
				current.norwegian = true;
				carried++;
			}
			continue;
		}
		// (a) AI-research events no static fetcher knows about must survive rebuilds
		//     — UNLESS a static fetcher already covers the same multi-day event under
		//     a slightly different start time (e.g. the Genesis Scottish Open, which
		//     ESPN lists at 04:00 and the agent re-added at 06:00). Prefer the static
		//     one (it carries the ESPN field + tee times) but GRAFT the AI event's
		//     enrichment onto it first — the static stub often lacks the tracked
		//     player / norwegian flag that the relevance filter needs, so dropping
		//     the AI copy outright made the whole event vanish (Gstaad / Ruud).
		if (prev.source === "ai-research") {
			let staticMatch = null, matchKind = null;
			for (const cur of all) {
				if (cur.source === "ai-research") continue;
				const kind = fuzzyMatchKind(cur, prev);
				if (kind) { staticMatch = cur; matchKind = kind; break; }
			}
			if (staticMatch) {
				if (matchKind === "venue") {
					// The two sources title this slot completely differently and match
					// only on venue+time — the recurring World Cup knockout case, where
					// the static fetcher emits a useless bracket placeholder ("Semifinal
					// 2 Winner at Semifinal 1 Winner") and the ai-research event carries a
					// human title + confirmed Norwegian channel. Keep the AI event, drop
					// the static placeholder. Verify was removing these by hand daily —
					// see the "recurring build-events dedup gap" note in verify-log.json.
					const idx = all.indexOf(staticMatch);
					if (idx >= 0) all.splice(idx, 1);
					byKey.set(key, prev);
					all.push(prev);
					preserved++;
					continue;
				}
				// Title match (same tournament, differing start time): the static
				// fetcher is authoritative on dates/venue — graft AI enrichment onto it.
				mergeEnrichment(staticMatch, prev);
				continue;
			}
			byKey.set(key, prev);
			all.push(prev);
			preserved++;
			continue;
		}
		// (c) A STATIC event missing from the latest fetch is normally rebuilt
		//     from source — but keep it when dropping it would make it silently
		//     vanish from the board at the wrong moment:
		//       • it's happening RIGHT NOW (ESPN stops returning a match once it
		//         goes live), or
		//       • an agent marked it cancelled/postponed — verify keeps such a
		//         match on the board as "Avlyst"/"Utsatt" instead of removing it,
		//         and that annotation must survive the hourly rebuild.
		//     A plain *future* static event missing from the fetch is still dropped
		//     (may be genuinely cancelled/rescheduled — we only keep it once an
		//     agent has confirmed the status, which also avoids reschedule ghosts).
		const start = Date.parse(prev.time);
		const end = prev.endTime ? Date.parse(prev.endTime) : start + LIVE_GRACE_MS;
		const isLiveNow = Number.isFinite(start) && start <= now && now <= end;
		const sticky = ["cancelled", "canceled", "postponed"].includes(String(prev.status || "").toLowerCase());
		const stickyStillRelevant = sticky && Number.isFinite(end) && now <= end + MS_PER_DAY;
		if (isLiveNow || stickyStillRelevant) {
			byKey.set(key, prev);
			all.push(prev);
			keptOnBoard++;
		}
	}
	if (preserved > 0) {
		console.log(`Preserved ${preserved} AI-research event(s) from previous build.`);
	}
	if (keptOnBoard > 0) {
		console.log(`Kept ${keptOnBoard} in-progress / cancelled static event(s) missing from the latest fetch.`);
	}
	if (carried > 0) {
		console.log(`Carried forward ${carried} agent amendment(s) onto re-fetched static events.`);
	}
}

// A previously-CONFIRMED channel (from the verify agent or a real tvkampen
// listing) must not be downgraded to a tentative guess on the next rebuild.
// e.g. verify resolves a World Cup match's "NRK / TV 2" to the actual "NRK";
// without this the hourly rebuild would overwrite it with the guess again.
const prevConfirmedStreaming = new Map();
const prevStreamingByKey = new Map();
const prevByKey = new Map();
if (Array.isArray(previousEvents)) {
	for (const prev of previousEvents) {
		const key = `${prev.sport}|${prev.title}|${prev.time}`;
		prevByKey.set(key, prev);
		const s = prev.streaming;
		if (Array.isArray(s) && s.length) {
			prevStreamingByKey.set(key, s);
			if (!s.some((c) => c && c.tentative)) {
				prevConfirmedStreaming.set(key, s);
			}
		}
	}
}

// Keep the most specific known viewing URL per broadcaster. A deep per-event URL
// (e.g. a verify-found NRK program page tv.nrk.no/serie/…, which opens the app on
// the actual broadcast) must survive the hourly rebuild — otherwise resolveStreaming
// re-derives the generic sport-section landing from the rights map and clobbers it.
// Match by host, prefer the deeper path.
function hostOf(u) { try { return new URL(u).host; } catch { return ""; } }
function pathDepth(u) { try { return new URL(u).pathname.replace(/\/+$/, "").split("/").filter(Boolean).length; } catch { return -1; } }
function withDeepUrls(streaming, prevStreaming) {
	if (!Array.isArray(streaming) || !Array.isArray(prevStreaming) || !prevStreaming.length) return streaming;
	const bestByHost = new Map();
	for (const p of prevStreaming) {
		if (!p || !p.url || p.tentative) continue;
		const h = hostOf(p.url);
		if (h && (!bestByHost.has(h) || pathDepth(p.url) > pathDepth(bestByHost.get(h)))) bestByHost.set(h, p.url);
	}
	return streaming.map((c) => {
		if (!c || !c.url) return c;
		const deeper = bestByHost.get(hostOf(c.url));
		return (deeper && pathDepth(deeper) > pathDepth(c.url)) ? { ...c, url: deeper } : c;
	});
}

// A bare broadcaster homepage → its sport/live section (closer to the broadcast,
// likelier to be claimed by the app's universal links). Only exact homepages are
// rewritten, so a deeper per-event URL is never downgraded. Catches agent-set
// URLs that bypass the rights map (e.g. a verified WC channel written as
// "https://tv.nrk.no").
// WP-246: BOTH sides of this table are `urlKind: "landing"` — the rewrite makes a
// front page slightly less useless, it does NOT make it an answer to "hvor ser jeg
// det". The clients refuse to link either as the match; only a `deep` URL is a link.
const LANDING_UPGRADE = {
	"https://tv.nrk.no": "https://tv.nrk.no/direkte",
	"https://play.tv2.no": "https://play.tv2.no/sport",
	"https://viaplay.no": "https://viaplay.no/no-no/sport",
};
function upgradeLanding(streaming) {
	if (!Array.isArray(streaming)) return streaming;
	return streaming.map((c) => {
		if (!c || !c.url) return c;
		const bare = c.url.replace(/\/+$/, "");
		return LANDING_UPGRADE[bare] ? { ...c, url: LANDING_UPGRADE[bare] } : c;
	});
}

// Resolve streaming to Norwegian channels — prefer REAL tvkampen.com listings
// for football, fall back to the deterministic rights map (never FOX/ESPN).
const tvListings = readJsonIfExists(path.join(dataDir, "tv-listings.json"))?.listings || [];
const nowMs = Date.now();
let fromTv = 0;
let keptConfirmed = 0;
for (const e of all) {
	const before = e.streaming;
	const key = `${e.sport}|${e.title}|${e.time}`;
	const resolved = resolveStreaming(e, tvListings);
	const resolvedTentative = !resolved.length || resolved.some((c) => c && c.tentative);
	const priorConfirmed = prevConfirmedStreaming.get(key);
	const prevEvent = prevByKey.get(key);
	// A fresh verify decision (confirmed/amended within the TTL) wins over the map's
	// re-derived channel when the two DIFFER — otherwise a confident-but-wrong map
	// entry clobbers the correction every rebuild (the Corales revert-war). Stale
	// verifications age out (TTL) so a corrected map default can reclaim the field.
	const verifiedFresh =
		priorConfirmed &&
		verifiedDecisionIsFresh(prevEvent, nowMs) &&
		JSON.stringify(priorConfirmed) !== JSON.stringify(resolved);
	// …but if the event's OWN verification sources corroborate the (corrected) map's
	// channel and NOT the stored array, the array is a stale revert-war casualty —
	// the old wrong map overwrote it after verify recorded the right answer. Trust
	// the corrected map, not the leftover array (the actual live Corales state:
	// streaming=Viaplay, but sources=hbomax.com + summary=HBO Max).
	const arrayIsStaleCasualty =
		verifiedFresh &&
		streamingBackedBySources(resolved, prevEvent?.verificationSources) &&
		!streamingBackedBySources(priorConfirmed, prevEvent?.verificationSources);
	if (priorConfirmed && (resolvedTentative || (verifiedFresh && !arrayIsStaleCasualty))) {
		e.streaming = priorConfirmed; // keep the confirmed channel, don't re-guess
		keptConfirmed++;
	} else {
		e.streaming = resolved;
	}
	// Upgrade generic landing URLs to a deeper per-event URL we already knew,
	// then lift any bare homepage to the broadcaster's sport/live section.
	// stampUrlKinds LAST and unconditionally (WP-246): every rewrite above can
	// change a URL, and `urlKind` must describe the URL that actually ships —
	// including on preserved ai-research events whose channel came from an agent
	// and never went through the rights map.
	e.streaming = stampUrlKinds(upgradeLanding(withDeepUrls(e.streaming, prevStreamingByKey.get(key))));
	if (e.sport === "football" && e.streaming !== before && e.streaming.length && tvListings.length) {
		// count football events whose channel came from a real listing match
		fromTv++;
	}
}
if (tvListings.length) {
	console.log(`Streaming: ${tvListings.length} tvkampen listing(s) available for football matching.`);
}
if (keptConfirmed > 0) {
	console.log(`Kept ${keptConfirmed} confirmed channel(s) over a tentative re-guess.`);
}

// Coverage filter (WP-96 · the flerbruker-split) — keep only what Sportivista
// COVERS, so the shared board carries everything any user's on-device lens might
// want, and NOTHING scoped to one person. The compass is catalog.json ("hva vi
// DEKKER"), NOT interests.json ("hva DU følger"): personal precision (Carlsen-
// only, 100-Thieves-only, …) is removed from the server and owned by the client
// lens alone (docs/js + iOS FeedCompiler — proven safe to move by WP-92). WP-131:
// build-events no longer reads interests.json at all — the events.json it publishes
// is USER-NEUTRAL (no owner must-watch stamp). The owner's calendar bell is computed
// on the owner artifact side, in build-ics.js (events.ics VALARM).
const catalog = readJsonIfExists(path.join(configDir, "catalog.json")) || {};
// isCovered — "does Sportivista cover this event?" (server scope), keyed off
// catalog.json (WP-96). The logic (tier1 wholesale; chess/esports entity-gated via a
// SPORT-SCOPED catalog-entity match; other non-broad sports kept only by
// norwegian/favorite/importance≥4 or an unscoped catalog-entity match — the Sant
// Martí class is dropped, ai-research is no blanket pass) now lives in
// helpers.makeCoverageGate. It was extracted (WP-110) so THIS board filter and
// detect-coverage-gaps.js's dropped-in-build anomaly share ONE gate and can't drift:
// an event the catalog never covers is a legitimate build drop, not a source
// anomaly. See tests/build-events.test.js + tests/fixtures/feed-vectors/DIVERGENCES.md §6.
const isCovered = makeCoverageGate(catalog);

// WP-242: konfig for den mekaniske proveniens-migreringen i normaliserings-
// passet under. Fail-soft: mangler registeret/kartet (f.eks. i testenes tomme
// SPORTSYNC_CONFIG_DIR), skjer ingen migrering — feltet er valgfritt.
const sourcesRegister = readJsonIfExists(path.join(configDir, "sources.json"));
const authorityMap = readJsonIfExists(path.join(configDir, "authority.json"));
const provenanceConfig =
	Array.isArray(sourcesRegister?.sources) && Array.isArray(authorityMap?.competitions)
		? { sources: sourcesRegister.sources, authority: authorityMap }
		: null;
let provenanceMigrated = 0;
// Domener autoritetskartet flagger som lookalikes (franceletour.com ≠ letour.fr).
const lookalikeSet = lookalikeHosts(authorityMap);
let lookalikesStripped = 0;
// WP-245: kalibreringen binder kildevalget — en kilde med målt reliabilitet
// under RELIABILITY_FLOOR kan aldri stå som eneste grunnlag for et high-
// confidence-event. Fail-soft: uten calibration.json skjer ingen binding.
const calibrationStats = readJsonIfExists(path.join(dataDir, "calibration.json"));
const calibrationConfig = calibrationStats?.sources
	? { calibration: calibrationStats, sources: sourcesRegister?.sources || [] }
	: null;
let calibrationDemoted = 0;

// Keep events from the last 14 days + upcoming, and only those the catalog covers
const cutoff = Date.now() - 14 * MS_PER_DAY;
let droppedIrrelevant = 0;
const kept = all.filter((e) => {
	if (!e.time) return false;
	const relevantTime = e.endTime ? Date.parse(e.endTime) : Date.parse(e.time);
	if (relevantTime < cutoff) return false;
	if (!isCovered(e)) { droppedIrrelevant++; return false; }
	return true;
});
kept.sort((a, b) => new Date(a.time) - new Date(b.time));
// WP-131: no per-owner annotation is written here anymore. The board is the
// catalog (isCovered above); must-watch is an OWNER concept and is derived on
// the owner-artifact side (build-ics.js, from the user-owned interests.json)
// for the events.ics VALARM. events.json stays user-neutral.
for (const e of kept) {
	// WP-04: recompute canonical participation form for every output event —
	// same rationale as the id recompute below. Preserved ai-research /
	// kept-on-board events are pushed straight from a previous events.json
	// (bypassing pushEvent() entirely — see the preservation pass above), so
	// they may still carry a pre-WP-04 shape: a bare string, a lone null, or
	// the field missing. Idempotent for already-canonical events.
	e.participants = normalizeParticipants(e.participants);
	e.norwegianPlayers = normalizeNorwegianPlayers(e.norwegianPlayers);
	// WP-05: re-derive entityId/homeTeamEntityId/awayTeamEntityId here too —
	// same rationale as the participation/id recomputes above. Preserved
	// ai-research / kept-on-board events bypass pushEvent()'s enrichment call
	// entirely, and normalizeNorwegianPlayers() just rebuilt fresh player
	// objects (dropping any entityId carried over from a previous run), so
	// this is the pass that actually makes it stick for every output event.
	enrichEntityIds(e);
	// WP-131: events.json is user-neutral (no owner must-watch stamp). Strip any
	// that a preserved event carried in from a previous build; the owner bell is
	// computed in build-ics.js, and every client recomputes from its own profile.
	delete e.mustWatch;
	// Recompute the stable id from the event's CURRENT sport|title|time so every
	// output path emits one — including preserved ai-research / kept-on-board
	// events pushed directly from a previous events.json (which may predate
	// this field, or carry a stale id if an upstream agent amended title/time
	// without recomputing it). Idempotent for unchanged events: same inputs,
	// same hash, same id across consecutive builds.
	e.id = computeEventId(e.sport, e.title, e.time);
	// WP-242: migrer flat evidence → per-faktum-proveniens der det er MEKANISK
	// trygt (autoritetskartet + kilderegisteret, eksakt domenetreff — aldri
	// lookalikes). Rører aldri et event som allerede bærer eksplisitt
	// `provenance` (agent-skrevet vinner), og er deterministisk/idempotent:
	// samme evidence + samme konfig ⇒ samme stempel på hvert bygg.
	if (provenanceConfig && e.source === "ai-research" && !e.provenance) {
		const derived = deriveProvenance(e, provenanceConfig);
		if (derived) {
			e.provenance = derived;
			provenanceMigrated++;
		}
	}
	// WP-242b: en lookalike skal ikke bare nektes SITERT — den skal ikke stå igjen
	// i den flate evidens-lista heller, for det er den ⓘ-modalen viser brukeren.
	if (lookalikeSet.size > 0) {
		for (const field of ["evidence", "verificationSources"]) {
			if (!Array.isArray(e[field])) continue;
			const { urls, removed } = stripLookalikeEvidence(e[field], lookalikeSet);
			if (removed > 0) { e[field] = urls; lookalikesStripped += removed; }
		}
	}
	// WP-245: etter lookalike-strippingen (dømmer den evidensen som faktisk blir
	// stående) — hviler et high-confidence-events hele grunnlag på mistrodde
	// kilder, demoteres det til medium. Én vei: re-promotering er verify-
	// agentens dom, aldri mekanikk.
	if (calibrationConfig && e.source === "ai-research" && e.confidence === "high") {
		const distrusted = soleDistrustedBasis(e, calibrationConfig);
		if (distrusted) {
			e.confidence = "medium";
			calibrationDemoted++;
		}
	}
}
if (provenanceMigrated > 0) {
	console.log(`Migrated flat evidence to per-fact provenance on ${provenanceMigrated} AI-research event(s) (WP-242).`);
}
if (lookalikesStripped > 0) {
	console.log(`Stripped ${lookalikesStripped} lookalike-domain evidence URL(s) — a domain posing as the organizer is not a source (WP-242b).`);
}
if (calibrationDemoted > 0) {
	console.log(`Demoted ${calibrationDemoted} high-confidence AI-research event(s) to medium — the entire evidence base resolves to sources with measured reliability < ${RELIABILITY_FLOOR} in calibration.json; a distrusted source never stands as sole basis (WP-245).`);
}
// WP-94: validate the array in-process BEFORE writing it, and degrade instead
// of freezing the hourly pipeline on a violation. static-pipeline.yml runs
// `node scripts/validate-events.js` as its own hard step right after this
// script — a schema/contract break there used to fail that step and abort the
// whole job (no coverage-gaps, no calibration, no ICS, no commit/deploy for
// that hour — see PLAN.md FASE 0G finding). That workflow file is protected
// and out of scope here, so the fix happens on THIS side of the boundary:
// reuse validate-events.js's own rules on the array we're about to publish; on
// a hard error, keep the previous (already-validated) events.json on disk
// untouched and write docs/data/build-alert.json instead of the new file.
// This script still exits 0 either way, so the pipeline continues — and the
// downstream validate-events.js step then re-checks the RETAINED, still-good
// file and passes. build-alert.json is a persistent health signal (written on
// every run, ok: true/false) rather than a one-shot failure log, so a fixed
// build clears the alarm automatically on the next successful pass.
const eventSchema = loadEventSchema();
// Validate the ROUND-TRIPPED JSON, not the raw JS array: pushEvent() sets
// several fields unconditionally to `ev.field || null`-style expressions, and
// a few (`venue`, `meta`) straight to `ev.venue`/`ev.meta` — which is `undefined`
// when the source data doesn't have them. JSON.stringify silently drops
// undefined-valued keys, so that's what validate-events.js's own (file-based)
// CLI run always saw; validating the pre-serialize object directly would see
// literal `undefined` properties the schema doesn't expect and false-positive.
const serialized = JSON.stringify(kept, null, 2);
const { errors: hardErrorCount, messages: validationMessages } = validateEvents(JSON.parse(serialized), eventSchema, calibrationConfig || {});
const eventsPath = path.join(dataDir, "events.json");
const alertPath = path.join(dataDir, "build-alert.json");
const hadPreviousGood = Array.isArray(previousEvents);

if (hardErrorCount > 0) {
	console.error(`build-events: ${hardErrorCount} validation error(s) in the freshly built array — NOT publishing it.`);
	for (const m of validationMessages.slice(0, 20)) console.error("  " + m);
	if (hadPreviousGood) {
		console.error(`build-events: keeping the previous events.json (${previousEvents.length} event(s)) untouched.`);
	} else {
		// No previous good file to fall back on (e.g. the very first build) —
		// nothing better is available, so publish anyway; the alarm still
		// records the violation for a human/self-repair to pick up.
		fs.writeFileSync(eventsPath, serialized);
		console.error("build-events: no previous events.json to retain — published the flawed array anyway (nothing better available).");
	}
	fs.writeFileSync(
		alertPath,
		JSON.stringify(
			{
				ok: false,
				checkedAt: new Date().toISOString(),
				errorCount: hardErrorCount,
				attemptedEventCount: kept.length,
				retained: hadPreviousGood,
				retainedEventCount: hadPreviousGood ? previousEvents.length : kept.length,
				sampleErrors: validationMessages.slice(0, 10),
			},
			null,
			2
		)
	);
} else {
	fs.writeFileSync(eventsPath, serialized);
	// Refresh the healthy marker every good run, so a resolved alarm doesn't
	// linger — the file always reflects the CURRENT state, not just failures.
	fs.writeFileSync(
		alertPath,
		JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), eventCount: kept.length }, null, 2)
	);
}
console.log(
	`Aggregated ${kept.length} events (filtered ${all.length - kept.length} past/irrelevant, of which ${droppedIrrelevant} off-interest) into events.json`
);

// Publish tracked.json (AI bookkeeping) + catalog.json (what we cover) so the
// dashboard's "Dette dekker vi" surface can show both. WP-96: interests.json is
// NO LONGER published — it is the owner's private profile (the seed for their
// on-device lens), not a shared artifact. The public web board is catalog-wide;
// each user's personal view is their own device's lens (iOS app).
for (const name of ["tracked.json", "catalog.json"]) {
	const src = path.join(configDir, name);
	if (fs.existsSync(src)) {
		fs.copyFileSync(src, path.join(dataDir, name));
		console.log(`Published ${name} to docs/data/`);
	}
}

// Publish app-version.json — the short hash of the last commit touching
// ios/ — so a sideloaded build can tell whether it is stale (it compares its
// build-time stamp against this; the manifest sync delivers the file). Since
// WP-17 it also carries the last recorded TestFlight upload (testflight.json)
// so TestFlight installs judge against the newest SHIPPABLE build, not the
// newest commit. Runs before writeManifest so the manifest covers it.
// Skipped gracefully when git/history is unavailable.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const appVersion = buildAppVersion(readIosCommit(repoRoot), readTestflight(repoRoot));
if (appVersion) {
	fs.writeFileSync(path.join(dataDir, "app-version.json"), JSON.stringify(appVersion, null, 2) + "\n");
	console.log(`Published app-version.json (ios @ ${appVersion.iosCommit}).`);
}

// WP-103: publish news.json — lens-ready news pointers built from the RSS
// digest × the entity index. Reuses the SAME word-boundary entity name-matching
// build-events uses to stamp entityId on events (helpers.matchesEntity), so the
// Brooklyn/Lyn substring trap is avoided identically. Pure builder lives in
// scripts/lib/news.js; written here (before writeManifest) so the manifest
// covers it and the client can diff-sync it. Byte-idempotent on unchanged input
// (no run-timestamp in the file). Empty/missing digest ⇒ { items: [] }.
const rssDigest = readJsonIfExists(path.join(dataDir, "rss-digest.json"));
const news = buildNews({ digest: rssDigest, entities });
fs.writeFileSync(path.join(dataDir, "news.json"), JSON.stringify(news, null, 2) + "\n");
console.log(`Published news.json (${news.items.length} item(s)).`);

// WP-243: publish coverage-contracts.json — the measurable promise per
// wholesale-covered competition («i sesong: minst N events innen H dager»,
// contract-blokkene i authority.json). Judged against the events ACTUALLY
// published this run (kept, or the retained previous good array on a degrade).
// Fail-soft: no authority map / no contracts ⇒ nothing written, nothing alarms.
// detect-coverage-gaps (next pipeline step) turns breaches into high-severity
// gaps for the agents; build-port-report (below) reads the file into the
// contracts port that feeds G2. Written before writeManifest so it syncs.
const publishedEvents = hardErrorCount > 0 && hadPreviousGood ? previousEvents : kept;
const contractReport = assessContracts(authorityMap, publishedEvents);
if (contractReport.contracts.length > 0) {
	fs.writeFileSync(
		path.join(dataDir, "coverage-contracts.json"),
		JSON.stringify(
			{
				generatedAt: new Date().toISOString(),
				contracts: contractReport.contracts,
				breached: contractReport.breached,
				note: "WP-243: dekningskontrakten per konkurranse — mekanisk måling av løftet i authority.json (contract-blokkene) mot tavla. Brudd triageres av coverage-critic/research via coverage-gaps.json; contracts-porten i port-report.json ruller dommen inn i G2-målingen.",
			},
			null,
			2
		)
	);
	console.log(
		`Published coverage-contracts.json (${contractReport.contracts.length} contract(s), ${contractReport.breached.length} breached).`
	);
}

// WP-119: publish port-report.json — mechanical measurement of the four gates
// that decide external-tester readiness (coverage / amend-rate / silent stops /
// participant status). Runs here (before writeManifest, so the manifest covers
// it) rather than as its own workflow step — .github/workflows/** is protected.
// Reads THIS build's fresh build-alert.json + published catalog.json and the
// PREVIOUS manifest.json (writeManifest runs next); fail-soft on any missing
// source (the port says "unknown", never a silent green).
const portReport = writePortReport(dataDir, configDir);
console.log(
	`Wrote port-report.json (coverage=${portReport.ports.coverage} amendRate=${portReport.ports.amendRate} silentStops=${portReport.ports.silentStops} participantStatus=${portReport.ports.participantStatus} contracts=${portReport.ports.contracts}).`
);

// WP-03: publish manifest.json (bytes + sha256 per published data file) —
// last thing this script does, so it reflects everything build-events.js
// itself just wrote (events.json, tracked.json, interests.json, port-report.json).
const manifest = writeManifest(dataDir);
console.log(`Wrote manifest.json (${Object.keys(manifest.files).length} file(s)).`);
