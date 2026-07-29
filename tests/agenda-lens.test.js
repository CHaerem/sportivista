// WP-200b · linsa koblet inn i WEB-agendaen.
//
// WP-200 fikset lensa på begge flater, men web-agendaen konsumerte den ikke:
// `agendaDayGroups()` og `forwardWindow()` bygget rett fra `this.allEvents` uten
// `ssIsRelevant`. iOS-agendaen kompilerte allerede fra lensa, så fiksen var
// usynlig for nøyaktig de brukerne den ble laget for — en web-profil som følger
// kun Formel 1 fikk fortsatt golf, sykkel og skiskyting.
//
// Filen var eid av WP-246 i en parallell branch da WP-200 landet, så
// innkoblingen ble en oppfølger. Denne testen pinner den.
//
// Kontrakten som IKKE får brytes: ingen profil (`interests = null`) ⇒ nøyaktig
// dagens katalogbrede tavle. Det er samme garanti som vektor 01–14 fryser.

import { describe, it, expect, beforeAll } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let dash;

beforeAll(() => {
	const sandbox = createClientSandbox();
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "lens.js");
	loadClientScript(sandbox, "dashboard.js");
	loadClientScript(sandbox, "live.js");
	loadClientScript(sandbox, "detail.js");
	loadClientScript(sandbox, "followed.js");
	loadClientScript(sandbox, "chrome.js");
	loadClientScript(sandbox, "news-web.js");
	loadClientScript(sandbox, "entity-page.js");
	dash = sandbox.window.dashboard;
});

const inDays = (d) => new Date(Date.now() + d * 86400000).toISOString();

/** A board spanning four sports — the shape that made the bug visible. */
const board = () => [
	{ id: "f1-a", sport: "f1", title: "Nederlands Grand Prix", tournament: "Formel 1", time: inDays(2) },
	{ id: "golf-a", sport: "golf", title: "Wyndham Championship", tournament: "PGA Tour", time: inDays(3), norwegian: true },
	{ id: "cyc-a", sport: "cycling", title: "Tour de Pologne", tournament: "UCI WorldTour", time: inDays(4), norwegian: true },
	{ id: "fb-a", sport: "football", title: "Brann – Rosenborg", tournament: "Eliteserien", time: inDays(5), norwegian: true },
];

/** The interests shape ssProfileToInterests produces for ONE precise follow.
 *
 *  The absent/empty distinction is load-bearing and easy to get wrong (I did):
 *  `followBroadly` ABSENT (null) means "no profile speaks" → lens.js falls back
 *  to the nine-sport catalog default. EMPTY ([]) means "a profile speaks, and it
 *  follows no sport wholesale" → only the precise follows get through. A
 *  tournament/team/athlete rule produces the latter; only a `sport-…` entity
 *  (the starter packs) puts a sport in the list. */
const only = (sport, name) => ({
	followBroadly: [],
	alwaysTrack: { teams: [], athletes: [], tournaments: [{ name, aliases: [], sport }] },
});

describe("agendaDayGroups is lensed (WP-200b)", () => {
	it("no profile ⇒ the catalog-wide board, unchanged", () => {
		dash.allEvents = board();
		dash.interests = null;
		const ids = dash.agendaDayGroups().groups.flatMap((g) => g.events.map((e) => e.id));
		expect(ids.sort()).toEqual(["cyc-a", "f1-a", "fb-a", "golf-a"]);
	});

	it("a profile that follows only Formel 1 gets an agenda of only F1", () => {
		// The bug this package exists for: golf/cycling/football were all Norwegian,
		// so rule (3) waved them through regardless of what the user chose.
		dash.allEvents = board();
		dash.interests = only("f1", "Formel 1");
		const ids = dash.agendaDayGroups().groups.flatMap((g) => g.events.map((e) => e.id));
		expect(ids).toEqual(["f1-a"]);
	});

	it("the forward glance is lensed by the same rule", () => {
		dash.allEvents = [
			{ id: "far-f1", sport: "f1", title: "Grand Prix", tournament: "Formel 1", time: inDays(20) },
			{ id: "far-golf", sport: "golf", title: "Open", tournament: "PGA Tour", time: inDays(21), norwegian: true },
		];
		dash.interests = only("f1", "Formel 1");
		expect(dash.forwardWindow().map((e) => e.id)).toEqual(["far-f1"]);
	});

	it("keeps the FULL set resolvable by id, so a filtered event still opens", () => {
		// _eventById is deliberately unlensed — a deep link or a series row must
		// resolve an event the agenda filtered away, rather than 404 silently.
		dash.allEvents = board();
		dash.interests = only("f1", "Formel 1");
		dash.agendaDayGroups();
		expect(dash._eventById.get("golf-a")).toBeTruthy();
	});

	it("lensed() is a pass-through when no profile speaks", () => {
		dash.interests = null;
		expect(dash.lensed(board())).toHaveLength(4);
	});
});
