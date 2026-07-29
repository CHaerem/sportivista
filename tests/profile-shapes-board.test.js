// WP-200 · «Profilen former tavla» — the web half.
//
// Sportivista let you choose what you care about and then ignored the answer.
// Two independent leaks did it:
//
//   1. `ssProfileToInterests` returned `followBroadly: null` unconditionally, so
//      `ssIsRelevant` fell back to `lens-config.json`'s nine-sport default no
//      matter what the profile said — a profile could only ADD, never shape.
//   2. Rule (3), the norwegian/favorite/importance blanket, was a blank cheque:
//      ANY Norwegian / favourite / importance≥4 event passed for every sport
//      that wasn't entity-gated.
//
// Together: someone who followed only «Formel 1» got an agenda full of golf,
// cycling and biathlon. This file pins the fix from BOTH ends — the derivation
// (profile → interests) and the consequence (interests → board) — plus the hard
// backward-compatibility guarantee: an EMPTY profile reproduces the pre-WP-200
// catalog-wide board id-for-id.
//
// The same semantics are frozen cross-platform by the golden feed-vectors
// (15-profile-shapes-board-f1-only.json, 16-profile-shapes-board-one-team.json),
// which iOS FeedCompiler replays bit-for-bit; the Swift twin of the derivation is
// EffectiveInterests.merge (ios/SportivistaTests/EffectiveInterestsTests.swift).

import { describe, it, expect, beforeAll } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let W; // the client globals (profile-sync + lens)

beforeAll(() => {
	const sandbox = createClientSandbox();
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "profile-sync.js");
	loadClientScript(sandbox, "lens.js");
	W = sandbox.window;
});

// --- profile fixtures --------------------------------------------------------

const NOW = Date.parse("2026-07-13T12:00:00Z");

/** One live ProfileSyncState rule row (the shape ssLiveRules reads). */
const ruleRow = (o) => ({
	rule: {
		entityId: o.entityId,
		entityName: o.entityName || o.entityId,
		sport: o.sport || "",
		scope: null,
		weight: 0.5,
		reason: "test",
		addedAt: "2026-07-10T10:00:00Z",
		lens: { sportAsSuch: {} },
		...(o.kind ? { kind: o.kind } : {}),
	},
	modifiedAt: "2026-07-10T10:00:00Z",
	deviceID: "dev-a",
	deleted: !!o.deleted,
});
const stateOf = (rules) => ({ rules: rules.map(ruleRow), episodic: [], counters: [], facts: [] });

const EMPTY = stateOf([]);
const F1_ONLY = stateOf([
	{ entityId: "f1-world-championship", entityName: "Formula 1 World Championship", sport: "f1", kind: "tournament" },
]);
const ONE_TEAM = stateOf([
	{ entityId: "rosenborg", entityName: "Rosenborg", sport: "football", kind: "team" },
]);
const WINTER = stateOf([
	{ entityId: "sport-biathlon", entityName: "Skiskyting", sport: "biathlon" },
	{ entityId: "sport-alpine", entityName: "Alpint", sport: "alpine" },
]);

// --- a fixed, catalog-wide board (no clock dependence) -----------------------

const EVENTS = [
	{ id: "f1-race", sport: "f1", title: "Ungarns Grand Prix – løp", tournament: "Formula 1 World Championship 2026", time: "2026-07-19T13:00:00Z" },
	{ id: "f1-imp5", sport: "f1", title: "Sesongfinalen i Abu Dhabi", tournament: "Grand Prix-helgen", time: "2026-07-20T13:00:00Z", importance: 5 },
	{ id: "rbk-molde", sport: "football", title: "Rosenborg – Molde", tournament: "Eliteserien", homeTeam: "Rosenborg", awayTeam: "Molde", time: "2026-07-19T16:00:00Z", norwegian: true },
	{ id: "vif-hamkam", sport: "football", title: "Vålerenga – HamKam", tournament: "Eliteserien", homeTeam: "Vålerenga", awayTeam: "HamKam", time: "2026-07-18T18:00:00Z", norwegian: true },
	{ id: "golf-norsk", sport: "golf", title: "Rocket Classic – runde 3", tournament: "PGA Tour", time: "2026-07-18T15:00:00Z", norwegian: true, norwegianPlayers: [{ name: "Kristoffer Reitan" }] },
	{ id: "cycling-norsk", sport: "cycling", title: "Clásica San Sebastián", tournament: "UCI WorldTour 2026", time: "2026-07-19T09:00:00Z", norwegian: true },
	{ id: "biathlon-plain", sport: "biathlon", title: "Verdenscup sprint menn", tournament: "IBU World Cup", time: "2026-07-20T11:00:00Z" },
	{ id: "alpine-norsk", sport: "alpine", title: "Storslalåm menn", tournament: "FIS Alpine World Cup", time: "2026-07-21T09:00:00Z", norwegian: true },
	{ id: "chess-carlsen", sport: "chess", title: "Norway Chess – runde 4", tournament: "Norway Chess 2026", time: "2026-07-19T15:00:00Z", norwegian: true, norwegianPlayers: [{ name: "Magnus Carlsen" }] },
];

/** The ids the lens admits for a profile state (null = no profile at all). */
function boardFor(state) {
	const interests = state === null ? null : W.ssProfileToInterests(state);
	return EVENTS.filter((e) => W.ssIsRelevant(e, interests, NOW)).map((e) => e.id).sort();
}

// --- 1. The derivation: profile → followBroadly ------------------------------

describe("ssProfileToInterests — followBroadly is DERIVED from the profile (WP-200)", () => {
	it("an EMPTY profile leaves followBroadly ABSENT (null), never an empty list", () => {
		// The whole backward-compatibility guarantee rests on this: absent means
		// "no profile speaks", which is what makes the lens fall back to the config
		// default AND keep the historic un-scoped blanket.
		expect(W.ssProfileToInterests(EMPTY).followBroadly).toBeNull();
	});

	it("a precise follow (tournament/team/athlete) follows NO sport wholesale", () => {
		expect(W.ssProfileToInterests(F1_ONLY).followBroadly).toEqual([]);
		expect(W.ssProfileToInterests(ONE_TEAM).followBroadly).toEqual([]);
		// …and lands in the bucket its kind says (unchanged behaviour).
		expect(W.ssProfileToInterests(F1_ONLY).alwaysTrack.tournaments.map((e) => e.name)).toEqual(["Formula 1 World Championship"]);
		expect(W.ssProfileToInterests(ONE_TEAM).alwaysTrack.teams.map((e) => e.name)).toEqual(["Rosenborg"]);
	});

	it("a SPORT-level rule (sport-… entity, the starter packs) follows that sport wholesale", () => {
		expect(W.ssProfileToInterests(WINTER).followBroadly).toEqual(["alpine", "biathlon"]); // deduped + sorted
		// It stays in the athlete bucket as well — mirrors iOS EffectiveInterests,
		// so bell/accent behave exactly as before.
		expect(W.ssProfileToInterests(WINTER).alwaysTrack.athletes.map((e) => e.name)).toEqual(["Alpint", "Skiskyting"]);
	});

	it("the sport- id wins over a stale stored kind (a pre-WP-200 rule said 'athlete')", () => {
		const stale = stateOf([{ entityId: "sport-f1", entityName: "Formel 1", sport: "f1", kind: "athlete" }]);
		expect(W.ssProfileToInterests(stale).followBroadly).toEqual(["f1"]);
	});

	it("a tombstoned sport rule stops following that sport", () => {
		const removed = stateOf([{ entityId: "sport-biathlon", entityName: "Skiskyting", sport: "biathlon", deleted: true }]);
		expect(W.ssProfileToInterests(removed).followBroadly).toBeNull(); // no live rules left at all
	});

	it("ssInferKind recognises the sport-level entity ids", () => {
		expect(W.ssInferKind("sport-biathlon")).toBe("sport");
		expect(W.ssInferKind("team-liverpool")).toBe("team");
		expect(W.ssInferKind("magnus-carlsen")).toBe("athlete");
	});
});

// --- 2. The consequence: the board is shaped ---------------------------------

describe("the board a profile actually gets (WP-200)", () => {
	it("an EMPTY profile reproduces the pre-WP-200 catalog-wide board, id-for-id", () => {
		const noProfile = boardFor(null);      // interests = null — what the web renders today
		expect(boardFor(EMPTY)).toEqual(noProfile);
		// …and that board is the wide one: eight of nine events, every default sport.
		expect(noProfile).toEqual([
			"alpine-norsk", "biathlon-plain", "cycling-norsk", "f1-imp5",
			"f1-race", "golf-norsk", "rbk-molde", "vif-hamkam",
		]);
		// chess stays out either way — it is entity-gated (WP-92), not blanketed.
		expect(noProfile).not.toContain("chess-carlsen");
	});

	it("«kun Formel 1» gives kun F1 — the bug this package exists for", () => {
		expect(boardFor(F1_ONLY)).toEqual(["f1-imp5", "f1-race"]);
	});

	it("«kun ett lag» keeps its sport and drops every other", () => {
		// Football stays (incl. the un-tracked Norwegian league match — the blanket
		// is scoped to the sport, not gated to the entity); golf/cycling/F1 go.
		expect(boardFor(ONE_TEAM)).toEqual(["rbk-molde", "vif-hamkam"]);
	});

	it("a sport-level follow is wholesale — even an event with no tracked entity", () => {
		// biathlon-plain carries no Norwegian, no favourite, no importance: it is on
		// the board purely because the profile follows the sport itself.
		expect(boardFor(WINTER)).toEqual(["alpine-norsk", "biathlon-plain"]);
	});
});

// --- 3. The un-scoped blanket survives where no profile speaks ---------------

describe("rule (3) stays un-scoped when followBroadly is ABSENT", () => {
	const noBroad = { alwaysTrack: { teams: [], athletes: [], tournaments: [] } };

	it("interests without followBroadly keep the blanket for every sport", () => {
		// The pre-WP-200 semantics, still reachable: this is what a hand-written
		// interests.json with no followBroadly key means.
		expect(W.ssIsRelevant(EVENTS.find((e) => e.id === "golf-norsk"), noBroad, NOW)).toBe(true);
		expect(W.ssIsRelevant(EVENTS.find((e) => e.id === "f1-imp5"), noBroad, NOW)).toBe(true);
	});

	it("ssLensSportScope reports the covered sports for an explicit board", () => {
		const scope = W.ssLensSportScope(W.ssProfileToInterests(ONE_TEAM));
		expect([...scope].sort()).toEqual(["football"]);
		expect(W.ssLensExplicitBroad(noBroad)).toBeNull();
		expect(W.ssLensExplicitBroad(W.ssProfileToInterests(EMPTY))).toBeNull();
	});
});
