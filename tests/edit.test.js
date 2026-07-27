// docs/js/edit.js + the shared next-event/coreName helpers — WP-120.
// edit.js is a standalone page script (no Dashboard prototype); its top-level
// function declarations land on the vm sandbox global, and its bootstrap is
// guarded on #edit-root (absent here), so loading it runs no async fetch.
import { describe, it, expect, beforeAll } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let sb;

beforeAll(() => {
	sb = createClientSandbox();
	loadClientScript(sb, "shared-constants.js");
	loadClientScript(sb, "edit.js");
});

const hoursFromNow = (h, base) => new Date(base + h * 3600000).toISOString();

describe("ssCoreName — strip edition noise for a clean follow", () => {
	it("drops a trailing year and season", () => {
		expect(sb.ssCoreName("Tour de France 2026")).toBe("Tour de France");
		expect(sb.ssCoreName("Serie A 2026/27")).toBe("Serie A");
	});
	it("drops a parenthetical qualifier", () => {
		expect(sb.ssCoreName("Sjakk-NM (eliteklassen)")).toBe("Sjakk-NM");
	});
	it("leaves a plain name untouched", () => {
		expect(sb.ssCoreName("Casper Ruud")).toBe("Casper Ruud");
	});
});

describe("ssNextEventForEntity — the shared 'when's X next?' matcher", () => {
	const base = Date.parse("2026-07-24T09:00:00Z");
	const events = [
		{ sport: "football", title: "Strømsgodset – Lyn", homeTeam: "Strømsgodset", awayTeam: "Lyn", time: hoursFromNow(31, base), streaming: [{ platform: "TV 2" }] },
		{ sport: "cycling", title: "Etappe 12 Tour de France 2026", time: hoursFromNow(26, base) },
		{ sport: "football", title: "Lyn – Kongsvinger", homeTeam: "Lyn", awayTeam: "Kongsvinger", time: hoursFromNow(200, base) },
	];

	it("finds the nearest sport-scoped upcoming event", () => {
		const next = sb.ssNextEventForEntity(events, { name: "Lyn", aliases: ["FK Lyn Oslo"], sport: "football" }, base);
		expect(next.title).toBe("Strømsgodset – Lyn"); // the nearer of Lyn's two matches
	});

	it("matches a tournament by its name in the title", () => {
		const next = sb.ssNextEventForEntity(events, { name: "Tour de France", sport: "cycling" }, base);
		expect(next.title).toContain("Etappe 12");
	});

	it("is sport-scoped so a cross-sport name collision doesn't match", () => {
		const cycling = [{ sport: "cycling", title: "Etappe 5: Barcelona – Girona", time: hoursFromNow(10, base) }];
		expect(sb.ssNextEventForEntity(cycling, { name: "Barcelona", sport: "football" }, base)).toBe(null);
	});

	it("treats an event that ended over 3h ago as over", () => {
		const past = [{ sport: "football", title: "Lyn – X", homeTeam: "Lyn", awayTeam: "X", time: hoursFromNow(-4, base) }];
		expect(sb.ssNextEventForEntity(past, { name: "Lyn", sport: "football" }, base)).toBe(null);
	});

	it("returns null when nothing matches", () => {
		expect(sb.ssNextEventForEntity(events, { name: "Aryan Tari", sport: "chess" }, base)).toBe(null);
	});
});

describe("buildFollowedSet / makeIsFollowed — one 'already followed?' test (dedup)", () => {
	const at = {
		teams: [{ name: "Lyn", aliases: ["FK Lyn Oslo"] }],
		athletes: [{ name: "Casper Ruud", aliases: ["Ruud"] }],
		tournaments: ["Tour de France"],
	};

	it("flattens names + aliases across teams/athletes/tournaments", () => {
		const followed = sb.buildFollowedSet(at);
		expect(followed).toContain("Lyn");
		expect(followed).toContain("FK Lyn Oslo");
		expect(followed).toContain("Casper Ruud");
		expect(followed).toContain("Tour de France");
	});

	it("plain predicate matches a clean candidate name", () => {
		const isFollowed = sb.makeIsFollowed(sb.buildFollowedSet(at));
		expect(isFollowed("Lyn")).toBe(true);
		expect(isFollowed("Rosenborg")).toBe(false);
	});

	it("core:true strips a year off a discovery before the reverse check", () => {
		const isFollowed = sb.makeIsFollowed(sb.buildFollowedSet(at), { core: true });
		// "Tour de France 2026" is already followed as "Tour de France".
		expect(isFollowed("Tour de France 2026")).toBe(true);
		// Without core-stripping the year would defeat the reverse containment.
		expect(sb.makeIsFollowed(sb.buildFollowedSet(at))("Tour de France 2026")).toBe(true); // forward match still hits
		expect(isFollowed("Vuelta 2026")).toBe(false);
	});
});

describe("editNextLine — the row's value subtitle", () => {
	it("is an honest gap when there is no next event", () => {
		expect(sb.editNextLine(null)).toBe("ikke satt opp ennå");
	});
	it("names the next event when scheduled", () => {
		const line = sb.editNextLine({ homeTeam: "Strømsgodset", awayTeam: "Lyn", time: "2026-07-25T16:00:00Z", streaming: [{ platform: "TV 2" }] });
		expect(line.startsWith("Neste:")).toBe(true);
		expect(line).toContain("Strømsgodset");
		expect(line).toContain("Lyn");
		expect(line).toContain("TV 2");
	});
});

describe("row — tap-to-expand, value subtitle, no amber-overload", () => {
	const base = Date.parse("2026-07-24T09:00:00Z");
	const events = [{ sport: "football", title: "Strømsgodset – Lyn", homeTeam: "Strømsgodset", awayTeam: "Lyn", time: hoursFromNow(31, base), streaming: [{ platform: "TV 2" }] }];

	it("renders name + next-event subtitle, with actions in the collapsed detail", () => {
		const html = sb.row({ name: "Lyn", sport: "football" }, "teams", "Lag", events, base);
		expect(html).toContain("ed-item");
		expect(html).toContain("ed-name");
		expect(html).toContain("Lyn");
		expect(html).toContain("Neste:");          // value subtitle, not "varsler på"
		expect(html).toContain("ed-detail");
		expect(html).toContain('hidden');           // actions hidden until the row is tapped
		expect(html).toContain("Slå av varsel");    // teams default notify on
		expect(html).toContain("Fjern");
		expect(html).not.toContain("🔔");           // no emoji in the chrome
		expect(html).not.toContain("varsler på");   // dead identical subtitle is gone
	});

	it("shows an honest gap for a followed entity with no scheduled event", () => {
		const html = sb.row({ name: "Aryan Tari", sport: "chess" }, "athletes", "Utøver", events);
		expect(html).toContain("ikke satt opp ennå");
		expect(html).toContain("no-event");
	});

	it("escapes HTML in the name", () => {
		const html = sb.row({ name: "<script>alert(1)</script>", sport: "chess" }, "athletes", "Utøver", []);
		expect(html).not.toContain("<script>alert");
	});
});

describe("issueUrl — the follow-request deep link", () => {
	it("encodes the structured body + label", () => {
		const url = sb.issueUrl({ action: "Fjern", kind: "Lag", name: "Lyn" });
		expect(url).toContain("github.com/CHaerem/sportivista/issues/new");
		expect(url).toContain("labels=follow-request");
		expect(decodeURIComponent(url)).toContain("Fjern");
		expect(decodeURIComponent(url)).toContain("Lyn");
	});
});
