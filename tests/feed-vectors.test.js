// WP-06 · Golden feed vectors.
//
// Freezes the personalisation semantics — relevance, must-watch (bell),
// must-see (accent), the agenda time window, and series collapse — as
// declarative JSON fixtures in tests/fixtures/feed-vectors/. Each fixture is a
// pure-data pair of { input, expected }: no JS inside the fixtures, so the exact
// same files can be replayed from XCTest to prove the Swift FeedCompiler
// (WP-13) equivalent. See tests/fixtures/feed-vectors/README.md for the format
// and tests/fixtures/feed-vectors/DIVERGENCES.md for the server/client mismatches
// this test pins (deliberately NOT fixed — WP-06 is non-fixing by contract).
//
// Where the same logic exists on BOTH sides, the vector is run against both:
//   • isEventInWindow → server scripts/lib/helpers.js AND client
//     docs/js/shared-constants.js (the two must agree — a divergence would be a
//     real bug; the test asserts parity).
//   • mustWatch (bell) → server helper mustWatchEntity (client only reads the
//     precomputed e.mustWatch, so there is no second implementation to run).
//   • mustSee (accent) + collapseSeries → client only (docs/js/dashboard.js).
//   • relevant (feed inclusion) → the PERSONAL LENS: "given a user's interests,
//     what is in THEIR feed?". WP-96 (the flerbruker-split) moved this predicate
//     off the server: build-events.js now applies isCovered(catalog.json) — "does
//     Sportivista COVER this?" — a per-CATALOG superset, no longer a per-person
//     filter. The lens itself is UNCHANGED (still `followBroadly`/entity-gate/
//     blanket/tracked-match over a personal profile) and now lives ONLY on the
//     clients (iOS FeedCompiler.isRelevant; the web board is catalog-wide). The
//     reference below (`lensRelevant`) is that unchanged lens algorithm — the JS
//     twin of FeedCompiler.isRelevant the Swift port is proven against. The
//     vectors are therefore NOT re-frozen by WP-96 (the lens didn't change); the
//     new server isCovered is a separate, server-only predicate tested in
//     tests/build-events.test.js. See DIVERGENCES.md §6.

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import {
	isEventInWindow as serverInWindow,
	mustWatchEntity,
	matchInterest,
	MS_PER_DAY,
} from "../scripts/lib/helpers.js";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

const FIX_DIR = path.resolve(process.cwd(), "tests", "fixtures", "feed-vectors");

// --- Load every JSON vector (deterministic order by filename) ----------------
function loadVectors() {
	return fs
		.readdirSync(FIX_DIR)
		.filter((f) => f.endsWith(".json"))
		.sort()
		.map((f) => ({ file: f, ...JSON.parse(fs.readFileSync(path.join(FIX_DIR, f), "utf-8")) }));
}
const VECTORS = loadVectors();

// --- Client-lens reference: relevance (personal feed inclusion) ---------------
// The PERSONAL LENS — the JS twin of iOS FeedCompiler.isRelevant. WP-96 moved
// this off the server (build-events.js now does isCovered(catalog), a superset),
// but the lens ALGORITHM is unchanged, so this reference is unchanged too:
//   • the default followBroadly list — WP-92: chess/esports are NOT here; a
//     profile tracks them only via named entities (elite chess / a CS2 team).
//   • the lens (== the pre-WP-96 build-events isRelevant): (1) followBroadly
//     wholesale, (2) chess/esports entity-gate (SPORT-SCOPED match; no norwegian/
//     favorite/importance/ai-research blanket), (3) the norwegian/favorite/
//     importance blanket for every other non-broad sport — ai-research is not a
//     blanket pass on its own, and WP-200 narrows it to the sports the profile
//     COVERS — and (4) an UNSCOPED tracked-entity match
//     (DIVERGENCES.md §1). WP-04: norwegianPlayers/participants are canonical
//     {name} objects, so the hay-building maps both through `p.name || p`.
//   • the 14-day retention cutoff, which keys off endTime when present, else start.
const DEFAULT_FOLLOW_BROADLY = [
	"football", "golf", "f1", "cycling",
	"biathlon", "cross-country", "alpine", "nordic", "ski jumping",
];
const ENTITY_GATED_SPORTS = new Set(["chess", "esports"]);

/** WP-200 — the sports a profile-shaped board covers: its explicit followBroadly
 *  plus every tracked entity's own sport. `null` when followBroadly is ABSENT (no
 *  profile speaks) — the blanket then stays un-scoped, i.e. pre-WP-200 behaviour.
 *  Twin of ssLensSportScope (lens.js) / FeedCompiler.sportScope (Swift). */
function lensSportScope(interests) {
	if (!Array.isArray(interests.followBroadly)) return null;
	const scope = new Set(interests.followBroadly.map((s) => String(s).toLowerCase()));
	for (const e of [
		...(interests.alwaysTrack?.teams || []),
		...(interests.alwaysTrack?.athletes || []),
		...(interests.alwaysTrack?.tournaments || []),
	]) {
		if (e && typeof e === "object" && e.sport) scope.add(String(e.sport).toLowerCase());
	}
	return scope;
}

function lensRelevant(event, interests, nowMs) {
	if (!event.time) return false;
	const relevantTime = event.endTime ? Date.parse(event.endTime) : Date.parse(event.time);
	if (relevantTime < nowMs - 14 * MS_PER_DAY) return false; // dropped: too old

	const followBroadly = new Set(
		(interests.followBroadly || DEFAULT_FOLLOW_BROADLY).map((s) => s.toLowerCase())
	);
	const sport = (event.sport || "").toLowerCase();
	if (followBroadly.has(sport)) return true; // (1) wholesale, wins over the gate

	const trackedEntities = [
		...(interests.alwaysTrack?.teams || []),
		...(interests.alwaysTrack?.athletes || []),
		...(interests.alwaysTrack?.tournaments || []),
	];
	const hay = [
		event.title, event.tournament, event.homeTeam, event.awayTeam,
		...(event.norwegianPlayers || []).map((p) => p.name || p),
		...(event.participants || []).map((p) => p.name || p),
	].join(" ");
	// (2) chess/esports: sport-scoped entity match only.
	if (ENTITY_GATED_SPORTS.has(sport)) {
		return matchInterest(hay, trackedEntities, { sport: event.sport }) != null;
	}
	// (3) other non-broad sports: norwegian/favorite/importance blanket (NO
	// ai-research), scoped since WP-200 to the sports this profile covers.
	const scope = lensSportScope(interests);
	if (scope === null || scope.has(sport)) {
		if (event.norwegian || event.isFavorite || (event.importance || 0) >= 4) return true;
	}
	// (4) unscoped tracked-entity match (DIVERGENCES §1).
	return matchInterest(hay, trackedEntities) != null;
}

// --- Client reference: shared sandbox ----------------------------------------
let dash; // docs/js/dashboard.js Dashboard instance
let clientInWindow; // docs/js/shared-constants.js isEventInWindow
// The SHIPPED lens (docs/js/lens.js) — the code users actually run. Asserting
// these against the SAME vectors the Swift FeedCompiler replays closes the drift
// hole: the reference is no longer test-only, it's the production lens.
let ssIsRelevantFn, ssMustWatchFn, ssIsMustSeeFn;

beforeAll(() => {
	const sandbox = createClientSandbox();
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "lens.js"); // before dashboard.js — isMustSee delegates to it
	loadClientScript(sandbox, "dashboard.js");
	dash = sandbox.window.dashboard;
	clientInWindow = sandbox.window.isEventInWindow;
	ssIsRelevantFn = sandbox.window.ssIsRelevant;
	ssMustWatchFn = sandbox.window.ssMustWatch;
	ssIsMustSeeFn = sandbox.window.ssIsMustSee;
});

// --- Comparison helpers ------------------------------------------------------
const sortIds = (arr) => [...arr].sort();
const idsWhere = (events, pred) => sortIds(events.filter(pred).map((e) => e.id));

function describeSeriesItem(item) {
	return item.isSeries
		? {
			isSeries: true,
			id: item.id,
			tournament: item.tournament,
			stageCount: item.stages.length,
			nextStageId: item.nextStage ? item.nextStage.id : null,
		}
		: { isSeries: false, id: item.id };
}
const sortByIdField = (arr) => [...arr].sort((a, b) => String(a.id).localeCompare(String(b.id)));

// --- Structural guards -------------------------------------------------------
describe("feed-vector suite integrity", () => {
	it("ships at least 10 vectors (WP-06 acceptance)", () => {
		expect(VECTORS.length).toBeGreaterThanOrEqual(10);
	});

	it("every event carries a unique id and every expected id resolves to an event", () => {
		for (const v of VECTORS) {
			const events = v.input.events || [];
			const ids = events.map((e) => e.id);
			expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
			expect(new Set(ids).size, `${v.file}: duplicate event id`).toBe(ids.length);
			const known = new Set(ids);
			for (const key of ["relevant", "mustWatch", "mustSee", "inWindow"]) {
				for (const id of v.expected[key] || []) {
					expect(known.has(id), `${v.file}: expected.${key} references unknown id "${id}"`).toBe(true);
				}
			}
		}
	});

	it("every vector declares at least one expectation", () => {
		for (const v of VECTORS) {
			const keys = Object.keys(v.expected || {});
			expect(keys.length, `${v.file}: no expectations`).toBeGreaterThan(0);
		}
	});
});

// --- Run each vector against the reference implementations -------------------
for (const v of VECTORS) {
	describe(`${v.file} — ${v.name}`, () => {
		const events = v.input.events || [];
		const interests = v.input.interests || {};
		const nowMs = v.input.now ? Date.parse(v.input.now) : Date.now();

		if (v.expected.relevant) {
			it("lens: relevant events match (personal lens == FeedCompiler.isRelevant + 14d cutoff)", () => {
				// The inline reference (kept as a second witness)…
				expect(idsWhere(events, (e) => lensRelevant(e, interests, nowMs))).toEqual(sortIds(v.expected.relevant));
				// …AND the SHIPPED lens (docs/js/lens.js) — the code users run.
				expect(idsWhere(events, (e) => ssIsRelevantFn(e, interests, nowMs))).toEqual(sortIds(v.expected.relevant));
			});
		}

		if (v.expected.mustWatch) {
			it("must-watch (bell) events match — server helpers.js AND shipped lens.js agree", () => {
				expect(idsWhere(events, (e) => mustWatchEntity(e, interests) != null)).toEqual(sortIds(v.expected.mustWatch));
				// The web twin (lens.js ssMustWatch) must equal the server bell.
				expect(idsWhere(events, (e) => ssMustWatchFn(e, interests))).toEqual(sortIds(v.expected.mustWatch));
			});
		}

		if (v.expected.mustSee) {
			it("client: must-see (accent) events match (dashboard.js isMustSee == shipped lens.js)", () => {
				dash.interests = interests;
				// dash.isMustSee now delegates to lens.js; assert both the method and
				// the lens function directly (proves the extraction changed nothing).
				expect(idsWhere(events, (e) => dash.isMustSee(e))).toEqual(sortIds(v.expected.mustSee));
				expect(idsWhere(events, (e) => ssIsMustSeeFn(e, interests))).toEqual(sortIds(v.expected.mustSee));
			});
		}

		if (v.expected.inWindow) {
			const win = v.input.window;
			it("has a window when it expects inWindow results", () => {
				expect(win && win.start && win.end, `${v.file}: expected.inWindow requires input.window`).toBeTruthy();
			});
			it("server & client isEventInWindow agree and match the expected set", () => {
				const ws = Date.parse(win.start), we = Date.parse(win.end);
				const serverIds = idsWhere(events, (e) => serverInWindow(e, ws, we));
				const clientIds = idsWhere(events, (e) => clientInWindow(e, ws, we));
				// The two implementations are byte-identical mirrors — pin parity so a
				// future edit to one side fails loudly (this is the only true both-sides
				// function; see CLAUDE.md "Event time filtering").
				expect(clientIds, `${v.file}: server/client isEventInWindow DIVERGED`).toEqual(serverIds);
				expect(serverIds).toEqual(sortIds(v.expected.inWindow));
			});
		}

		if (v.expected.series) {
			it("client: collapseSeries folds/keeps rows as expected (dashboard.js)", () => {
				const actual = sortByIdField(dash.collapseSeries(events, nowMs).map(describeSeriesItem));
				const expected = sortByIdField(v.expected.series);
				expect(actual).toEqual(expected);
			});
		}
	});
}
