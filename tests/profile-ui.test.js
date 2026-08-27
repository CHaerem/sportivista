// profile-ui.test.js — the follow/unfollow wiring end-to-end in the sandbox:
// followTargets → follow buttons → toggleFollow → the board re-personalises
// (hasProfile flips, interests fill, must-see accent follows). Proves Step 2b:
// the web board becomes YOURS once you follow something, and an empty profile is
// the catalog-wide fallback.

import { describe, it, expect, beforeEach } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let W; // sandbox window
beforeEach(() => {
	const sandbox = createClientSandbox();
	Object.assign(sandbox, { TextEncoder, TextDecoder, btoa, atob, Uint8Array, crypto: globalThis.crypto });
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "lens.js");
	loadClientScript(sandbox, "profile-sync.js");
	loadClientScript(sandbox, "dashboard.js");
	loadClientScript(sandbox, "detail.js");
	loadClientScript(sandbox, "profile-ui.js");
	W = sandbox.window;
	W.dashboard.catalog = { tier2: { teams: [], athletes: [], tournaments: [] } };
	W.dashboard.applyProfile(W.ssProfileLoad());
});

const matchEvent = () => ({
	id: "m1", sport: "football", title: "Liverpool – Arsenal",
	homeTeam: "Liverpool", homeTeamEntityId: "team-liverpool",
	awayTeam: "Arsenal", awayTeamEntityId: "team-arsenal",
	norwegianPlayers: [{ name: "Martin Ødegaard", entityId: "athlete-odegaard" }],
	time: "2026-07-21T18:00:00Z",
});

describe("followTargets", () => {
	it("returns each team (with its id) and each Norwegian player", () => {
		const t = W.dashboard.followTargets(matchEvent());
		expect(t.map((x) => x.entityId)).toEqual(["team-liverpool", "team-arsenal", "athlete-odegaard"]);
		expect(t[2].kind).toBe("athlete");
	});
	it("synthesizes a stable id when the event carries none", () => {
		const t = W.dashboard.followTargets({ sport: "golf", homeTeam: "", awayTeam: "", norwegianPlayers: [{ name: "Viktor Hovland" }] });
		expect(t[0].entityId).toBe("viktor hovland|golf");
	});
});

describe("followButtonsHtml", () => {
	it("labels each target 'Følg X' when not followed", () => {
		const html = W.dashboard.followButtonsHtml(matchEvent());
		expect(html).toContain("Følg Liverpool");
		expect(html).toContain('data-entity-id="team-liverpool"');
		expect(html).not.toContain("is-following");
	});
});

describe("toggleFollow → re-personalisation", () => {
	it("following a team flips hasProfile, fills interests, and marks it must-see", () => {
		expect(W.dashboard.hasProfile).toBe(false); // empty profile → catalog-wide
		// Simulate a click on Liverpool's follow button.
		const btn = { dataset: { entityId: "team-liverpool", entityName: "Liverpool", entitySport: "football", kind: "team", followState: "off" } };
		let rendered = 0;
		W.dashboard.render = () => { rendered++; };
		W.dashboard.toggleFollow(btn);
		expect(rendered).toBe(1);
		expect(W.ssProfileFollows("team-liverpool")).toBe(true);
		expect(W.dashboard.hasProfile).toBe(true);
		expect(W.dashboard.interests.alwaysTrack.teams.map((e) => e.name)).toContain("Liverpool");
		// The board now accents a Liverpool match (isMustSee via the tracked-team branch).
		expect(W.dashboard.isMustSee(matchEvent())).toBe(true);
	});

	it("unfollowing the last entity returns to the catalog-wide fallback", () => {
		const follow = { dataset: { entityId: "team-liverpool", entityName: "Liverpool", entitySport: "football", kind: "team", followState: "off" } };
		W.dashboard.render = () => {};
		W.dashboard.toggleFollow(follow);
		expect(W.dashboard.hasProfile).toBe(true);
		const unfollow = { dataset: { entityId: "team-liverpool", followState: "on" } };
		W.dashboard.toggleFollow(unfollow);
		expect(W.ssProfileFollows("team-liverpool")).toBe(false);
		expect(W.dashboard.hasProfile).toBe(false);
		expect(W.dashboard.interests).toBe(null);
	});
});

describe("whyShown — personal voice when you have a profile", () => {
	it("switches from 'som vi dekker' to the personal 'Fordi … følger'", () => {
		const btn = { dataset: { entityId: "team-liverpool", entityName: "Liverpool", entitySport: "football", kind: "team", followState: "off" } };
		W.dashboard.render = () => {};
		W.dashboard.toggleFollow(btn);
		const why = W.dashboard.whyShown(matchEvent());
		expect(why).toContain("Fordi");
		expect(why).toContain("Liverpool");
	});
});

// ── WP-253: symmetri (fjern der du ser det) + angre i stedet for å bekrefte ──
// The board used to be one-directional: «Følg X» sat in the detail sheet, but
// stopping was somewhere else entirely — and the sheet went silent for exactly
// the rows you'd want to prune. These pin the two halves of the fix.

describe("followButtonsHtml — symmetric: the sheet offers BOTH directions", () => {
	it("says the ACTION «Slutt å følge X» once you follow it, never the state «Følger X»", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const html = W.dashboard.followButtonsHtml(matchEvent());
		expect(html).toContain("Slutt å følge Liverpool");
		expect(html).not.toContain("Følger Liverpool");
		expect(html).toContain('data-follow-state="on"');
	});

	it("keeps «Følg» for the sides you do NOT follow — add and remove side by side", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const html = W.dashboard.followButtonsHtml(matchEvent());
		expect(html).toContain("Følg Arsenal");
		expect(html).toContain("Slutt å følge Liverpool");
	});

	it("offers each target exactly once (no duplicate button for a followed team)", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const html = W.dashboard.followButtonsHtml(matchEvent());
		expect(html.match(/data-entity-id="team-liverpool"/g)).toHaveLength(1);
	});

	it("stays empty for an empty profile's row — nothing followed, nothing to remove", () => {
		const html = W.dashboard.followButtonsHtml(matchEvent());
		expect(html).not.toContain("Slutt å følge");
		expect(html).toContain("Følg Liverpool");
	});

	it("never puts a toggle STATE on an action label (no aria-pressed on a verb)", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const html = W.dashboard.followButtonsHtml(matchEvent());
		// «Slutt å følge Liverpool, veksleknapp, på» describes the opposite of what
		// the button does. The label is the action, so the button is a plain button.
		expect(html).toContain("Slutt å følge Liverpool");
		expect(html).not.toContain("aria-pressed");
		// The state-labelled twin (search: «Følg» / «Følger») keeps aria-pressed,
		// where it is true — one choice per control, consistently.
		W.dashboard.entities = [{ id: "team-liverpool", name: "Liverpool", type: "team", sport: "football" }];
		const row = W.dashboard.followSearchRow(W.dashboard.entities[0]);
		expect(row).toContain('aria-pressed="true"');
		expect(row).toContain("Følger");
	});
});

// The action row must not rearrange itself under the finger that is using it:
// a button flips its LABEL in place, exactly as the iOS sheet's row does
// (DESIGN.md § Event-detalj — «raden BLIR STÅENDE og vipper til motsatt handling»).
describe("followButtonsHtml — the row order is stable, whatever you follow", () => {
	const ids = (html) => (html.match(/data-entity-id="[^"]+"/g) || []).map((s) => s.slice(16, -1));
	const state = (html, id) => (html.match(new RegExp(`data-entity-id="${id}"[^>]*data-follow-state="(on|off)"`)) || [])[1];

	it("keeps a button in its place and only flips its label", () => {
		W.dashboard.render = () => {};
		const before = ids(W.dashboard.followButtonsHtml(matchEvent()));
		expect(before).toEqual(["team-liverpool", "team-arsenal", "athlete-odegaard"]);
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const after = W.dashboard.followButtonsHtml(matchEvent());
		expect(ids(after)).toEqual(before); // same buttons, same order — nothing moved
		expect(state(after, "team-liverpool")).toBe("on");
		expect(after.indexOf("Slutt å følge Liverpool")).toBeLessThan(after.indexOf("Følg Arsenal"));
	});

	it("holds that order through a whole round of toggling", () => {
		W.dashboard.render = () => {};
		const order = ids(W.dashboard.followButtonsHtml(matchEvent()));
		for (const t of [
			{ entityId: "athlete-odegaard", entityName: "Martin Ødegaard", sport: "football", kind: "athlete" },
			{ entityId: "team-arsenal", entityName: "Arsenal", sport: "football", kind: "team" },
			{ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" },
		]) {
			W.dashboard.commitFollow(t);
			expect(ids(W.dashboard.followButtonsHtml(matchEvent()))).toEqual(order);
		}
		for (const id of ["team-arsenal", "athlete-odegaard", "team-liverpool"]) {
			W.dashboard.commitUnfollow(id);
			expect(ids(W.dashboard.followButtonsHtml(matchEvent()))).toEqual(order);
		}
	});

	it("keeps a profile-only subject standing as its own way back, then lets it go", () => {
		W.dashboard.render = () => {};
		const e = matchEvent();
		e.tournament = "Premier League";
		W.dashboard.commitFollow({ entityId: "tournament-pl", entityName: "Premier League", sport: "football", kind: "tournament" });
		const before = ids(W.dashboard.followButtonsHtml(e));
		expect(before).toContain("tournament-pl");
		// Stopping a follow that lives ONLY in the profile would otherwise delete
		// the button that just did it — the way back would vanish with it.
		W.dashboard.commitUnfollow("tournament-pl");
		const after = W.dashboard.followButtonsHtml(e);
		expect(ids(after)).toEqual(before);
		expect(after).toContain("Følg Premier League");
		expect(state(after, "tournament-pl")).toBe("off");
		// Closing the sheet ends the offer — the undo line is what outlives it.
		W.dashboard.forgetShownSubjects(e.id);
		expect(ids(W.dashboard.followButtonsHtml(e))).not.toContain("tournament-pl");
	});

	it("flipping back IS an undo: the rule returns intact and leaves the undo line", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team", reason: "Startpakke: Fotball", weight: 0.8 });
		W.dashboard.commitUnfollow("team-liverpool");
		expect(W.dashboard.undoText()).toBe("Sluttet å følge Liverpool.");
		// The same button, now saying «Følg Liverpool» — pressed via toggleFollow.
		W.dashboard.toggleFollow({ dataset: { entityId: "team-liverpool", entityName: "Liverpool", entitySport: "football", kind: "team", followState: "off" } });
		const rule = W.ssLiveRules(W.ssProfileLoad()).find((r) => r.entityId === "team-liverpool");
		expect(rule.reason).toBe("Startpakke: Fotball");
		expect(rule.weight).toBe(0.8);
		// …and the line stops offering to undo something you already put back.
		expect(W.dashboard.undoText()).toBe("");
	});
});

describe("unfollowTargets — reaches what put the row here, not just its two teams", () => {
	const stageEvent = () => ({
		id: "s1", sport: "cycling", title: "Etappe 5", tournament: "Tour de France",
		time: "2026-07-21T12:00:00Z",
	});

	it("offers to stop following the TOURNAMENT behind a row with no followable team", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "tournament-tdf", entityName: "Tour de France", sport: "cycling", kind: "tournament" });
		expect(W.dashboard.followTargets(stageEvent())).toHaveLength(0); // the ADD side has nothing to say
		const targets = W.dashboard.unfollowTargets(stageEvent());
		expect(targets.map((t) => t.entityId)).toEqual(["tournament-tdf"]);
		expect(W.dashboard.followButtonsHtml(stageEvent())).toContain("Slutt å følge Tour de France");
	});

	it("does not offer a follow the row is not about (sport-scoped, word-boundary)", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		expect(W.dashboard.unfollowTargets(stageEvent())).toHaveLength(0);
	});

	it("names the cost of removing a WHOLESALE sport follow in the label itself", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "sport-biathlon", entityName: "Skiskyting", sport: "biathlon", kind: "sport" });
		const e = { id: "b1", sport: "biathlon", title: "Verdenscup sprint", time: "2026-12-01T13:00:00Z" };
		const t = W.dashboard.unfollowTargets(e);
		expect(t).toHaveLength(1);
		expect(t[0].wholesale).toBe(true);
		expect(W.dashboard.followButtonsHtml(e)).toContain("Slutt å følge Skiskyting (hele sporten)");
	});

	it("matches on the event's stamped entity id too", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "athlete-odegaard", entityName: "Martin Ødegaard", sport: "football", kind: "athlete" });
		const t = W.dashboard.unfollowTargets({ id: "x", sport: "football", title: "Arsenal – Chelsea", norwegianPlayers: [{ name: "M. Ødegaard", entityId: "athlete-odegaard" }] });
		expect(t.map((x) => x.entityId)).toEqual(["athlete-odegaard"]);
	});
});

describe("angre i stedet for å bekrefte — unfollow is instant and reversible", () => {
	it("removes at once (no confirmation gate) and leaves an undo offer standing", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		W.dashboard.commitUnfollow("team-liverpool");
		expect(W.ssProfileFollows("team-liverpool")).toBe(false); // gone immediately
		expect(W.dashboard.undoText()).toBe("Sluttet å følge Liverpool.");
	});

	it("«Angre» puts the follow back, with its reason and weight intact", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team", reason: "Startpakke: Fotball", weight: 0.8 });
		W.dashboard.commitUnfollow("team-liverpool");
		expect(W.dashboard.undoUnfollow()).toBe(true);
		expect(W.ssProfileFollows("team-liverpool")).toBe(true);
		const rule = W.ssLiveRules(W.ssProfileLoad()).find((r) => r.entityId === "team-liverpool");
		expect(rule.reason).toBe("Startpakke: Fotball");
		expect(rule.weight).toBe(0.8);
		expect(W.dashboard.hasProfile).toBe(true);
		expect(W.dashboard.undoText()).toBe(""); // the offer is spent
	});

	it("luking several rows in a row is still ONE undo", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		W.dashboard.commitFollow({ entityId: "team-arsenal", entityName: "Arsenal", sport: "football", kind: "team" });
		W.dashboard.commitFollow({ entityId: "athlete-odegaard", entityName: "Martin Ødegaard", sport: "football", kind: "athlete" });
		W.dashboard.commitUnfollow("team-liverpool");
		W.dashboard.commitUnfollow("team-arsenal");
		expect(W.dashboard.undoText()).toBe("Sluttet å følge Liverpool og Arsenal.");
		W.dashboard.commitUnfollow("athlete-odegaard");
		expect(W.dashboard.undoText()).toBe("Sluttet å følge Liverpool, Arsenal og 1 til.");
		W.dashboard.undoUnfollow();
		expect(W.ssProfileFollows("team-liverpool")).toBe(true);
		expect(W.ssProfileFollows("team-arsenal")).toBe(true);
		expect(W.ssProfileFollows("athlete-odegaard")).toBe(true);
	});

	it("a lapsed offer (timeout) leaves the removal standing", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		W.dashboard.commitUnfollow("team-liverpool");
		W.dashboard.dismissUndo();
		expect(W.dashboard.undoText()).toBe("");
		expect(W.dashboard.undoUnfollow()).toBe(false);
		expect(W.ssProfileFollows("team-liverpool")).toBe(false);
	});
});

// A removal typed into the assistant arms the same undo line as every other
// removal — but the assistant sheet lies OVER that line (z-index 70 vs 65), so
// the offer stood behind the surface the user was looking at and expired unseen.
describe("angre der handlingen skjedde — the assistant carries its own «Angre»", () => {
	beforeEach(() => {
		W.dashboard.render = () => {};
		W.dashboard.entities = [
			{ id: "team-liverpool", name: "Liverpool", type: "team", sport: "football" },
			{ id: "team-arsenal", name: "Arsenal", type: "team", sport: "football" },
		];
	});

	it("offers the undo IN the answer when the assistant removed a follow", () => {
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const res = W.dashboard.handleFollowIntent("Liverpool", true);
		expect(res).toMatchObject({ ok: true, text: "Sluttet å følge Liverpool.", undo: true });
		const html = W.dashboard.assistantMutationHtml(res);
		expect(html).toContain("Sluttet å følge Liverpool.");
		expect(html).toContain('class="assistant-undo"');
		expect(html).toContain("Angre");
	});

	it("says it plainly again once the undo is taken", () => {
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		W.dashboard.handleFollowIntent("Liverpool", true);
		const names = W.dashboard.undoNameList();
		expect(W.dashboard.undoUnfollow()).toBe(true);
		expect(W.ssProfileFollows("team-liverpool")).toBe(true);
		expect(W.dashboard.undoneText(names)).toBe("Følger Liverpool igjen.");
	});

	it("is ONE offer whichever door the removal came through", () => {
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		W.dashboard.commitFollow({ entityId: "team-arsenal", entityName: "Arsenal", sport: "football", kind: "team" });
		W.dashboard.commitUnfollow("team-liverpool"); // from the sheet
		const res = W.dashboard.handleFollowIntent("Arsenal", true); // from the assistant
		expect(res.undo).toBe(true);
		expect(W.dashboard.undoText()).toBe("Sluttet å følge Liverpool og Arsenal.");
		expect(W.dashboard.undoneText(W.dashboard.undoNameList())).toBe("Følger Liverpool og Arsenal igjen.");
		W.dashboard.undoUnfollow();
		expect(W.ssProfileFollows("team-liverpool")).toBe(true);
		expect(W.ssProfileFollows("team-arsenal")).toBe(true);
	});

	it("adds nothing to an answer that removed nothing", () => {
		const res = W.dashboard.handleFollowIntent("Liverpool", false);
		expect(res.text).toBe("Følger Liverpool nå.");
		expect(W.dashboard.assistantMutationHtml(res)).not.toContain("assistant-undo");
	});
});

describe("agendaEmptyHtml — the empty board's way in (unchanged without a profile)", () => {
	it("says exactly what it always said when there is no profile", () => {
		expect(W.dashboard.hasProfile).toBe(false);
		expect(W.dashboard.agendaEmptyHtml()).toBe('<p class="empty">Ingen kommende arrangementer akkurat nå.</p>');
	});
	it("offers the search when it is YOUR list that is empty", () => {
		W.dashboard.render = () => {};
		W.dashboard.commitFollow({ entityId: "team-liverpool", entityName: "Liverpool", sport: "football", kind: "team" });
		const html = W.dashboard.agendaEmptyHtml();
		expect(html).toContain("det du følger");
		expect(html).toContain("empty-search");
		expect(html).toContain("Søk og følg noe mer");
	});
});
