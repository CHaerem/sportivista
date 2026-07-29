// football.js: the static Eliteserien/OBOS fetcher.
//
// Regression cover for the 19 July 2026 outage: `applyCustomFilters` kept a
// Norwegian-league match ONLY when `event.norwegian` was true — and that flag is the
// OWNER's precision list (sports-config `norwegian.teams` = Lyn / Norge). Lyn plays in
// OBOS-ligaen, so EVERY Eliteserien match failed the gate, football.json went empty,
// and retainLastGood froze the last good copy for 137 consecutive runs while the
// research agent hand-filled each round. `football` is catalog tier1 — covered
// wholesale — so coverage is the catalog's call, never one person's follow list.
import { describe, it, expect } from "vitest";
import { FootballFetcher, norwegianClubName, norwegianiseMatch } from "../scripts/fetch/football.js";

const inDays = (d, hour = 17) => {
	const t = new Date(Date.now() + d * 86400000);
	t.setUTCHours(hour, 0, 0, 0);
	return t.toISOString();
};

describe("Norwegian club naming", () => {
	it("maps ESPN's anglicised club names to what a Norwegian reader calls them", () => {
		expect(norwegianClubName("Bodo/Glimt")).toBe("Bodø/Glimt");
		expect(norwegianClubName("Tromso")).toBe("Tromsø");
		expect(norwegianClubName("Lillestrom")).toBe("Lillestrøm");
		expect(norwegianClubName("Hamarkameratene")).toBe("HamKam");
		expect(norwegianClubName("Sarpsborg FK")).toBe("Sarpsborg 08");
		expect(norwegianClubName("SK Brann")).toBe("Brann");
	});

	it("passes an unmapped club through untouched (a promoted club is never mangled)", () => {
		expect(norwegianClubName("Fredrikstad")).toBe("Fredrikstad");
		expect(norwegianClubName("Bryne")).toBe("Bryne");
		expect(norwegianClubName("")).toBe("");
		expect(norwegianClubName(undefined)).toBe("");
	});

	it("rewrites the title into the board's own «Hjemme – Borte» voice", () => {
		// ESPN's own per-event `name` is English AND ASCII-folded ("Hamarkameratene at
		// Valerenga") even though team.displayName has the diacritics right.
		const e = norwegianiseMatch({ title: "Hamarkameratene at Valerenga", homeTeam: "Vålerenga", awayTeam: "Hamarkameratene" });
		expect(e.title).toBe("Vålerenga – HamKam");
		expect(e.homeTeam).toBe("Vålerenga");
		expect(e.awayTeam).toBe("HamKam");
	});

	it("leaves an event without both teams alone", () => {
		const e = norwegianiseMatch({ title: "Eliteserien", homeTeam: "Molde" });
		expect(e.title).toBe("Eliteserien");
	});
});

describe("coverage filtering", () => {
	const eliteserie = () => [
		{ title: "Fredrikstad – Sandefjord", time: inDays(2), sport: "football", leagueCode: "nor.1", tournament: "Eliteserien", norwegian: false },
		{ title: "Molde – Sarpsborg 08", time: inDays(3), sport: "football", leagueCode: "nor.1", tournament: "Eliteserien", norwegian: false },
		{ title: "Brann – Rosenborg", time: inDays(3, 19), sport: "football", leagueCode: "nor.1", tournament: "Eliteserien", norwegian: false },
	];

	it("KEEPS Eliteserien matches that involve none of the owner's followed teams", () => {
		// The exact bug: none of these three has `norwegian: true`, because the owner
		// follows Lyn (OBOS) and Norge. Before the fix all three were dropped.
		const kept = new FootballFetcher().applyFilters(eliteserie());
		expect(kept).toHaveLength(3);
		expect(kept.map((e) => e.title)).toContain("Brann – Rosenborg");
	});

	it("treats OBOS-ligaen as domestic too, ahead of any foreign fixture", () => {
		const events = [
			{ title: "Arsenal vs Chelsea", time: inDays(1), sport: "football", leagueCode: "eng.1", tournament: "Premier League", norwegian: false },
			...eliteserie(),
			{ title: "Lyn – Sogndal", time: inDays(1), sport: "football", leagueCode: "nor.2", tournament: "OBOS-ligaen", norwegian: true },
		];
		const kept = new FootballFetcher().applyFilters(events);
		expect(kept).toHaveLength(5);
		// The four domestic fixtures come first; the foreign one brings up the rear.
		expect(kept.slice(0, 4).map((e) => e.title)).toContain("Lyn – Sogndal");
		expect(kept[4].title).toBe("Arsenal vs Chelsea");
	});

	it("keeps Eliteserien ahead of foreign leagues when maxEvents has to cut", () => {
		// From mid-August the PL, La Liga and CL are all in season, and a 7-day window
		// over seven leagues exceeds maxEvents (30). Whatever falls past the cut is
		// decided by this ordering — domestic must never lose its slot to a midweek
		// foreign fixture on a Norwegian board.
		const foreign = Array.from({ length: 40 }, (_, i) => ({
			title: `Foreign ${i}`, time: inDays(1 + (i % 5)), sport: "football",
			leagueCode: "eng.1", tournament: "Premier League", norwegian: false,
		}));
		const kept = new FootballFetcher().applyFilters([...foreign, ...eliteserie()]);
		expect(kept).toHaveLength(30); // maxEvents
		const titles = kept.map((e) => e.title);
		for (const t of ["Fredrikstad – Sandefjord", "Molde – Sarpsborg 08", "Brann – Rosenborg"]) {
			expect(titles).toContain(t);
		}
		expect(titles.slice(0, 3).every((t) => !t.startsWith("Foreign"))).toBe(true);
	});

	it("does not drop foreign-league matches either", () => {
		const kept = new FootballFetcher().applyFilters([
			{ title: "Arsenal vs Chelsea", time: inDays(4), sport: "football", leagueCode: "eng.1", tournament: "Premier League", norwegian: false },
		]);
		expect(kept).toHaveLength(1);
	});
});
