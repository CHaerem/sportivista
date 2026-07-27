// lib/norwegian-rights.js — followed events always resolve to Norwegian channels.
import { describe, it, expect } from "vitest";
import { norwegianRights, normalizeStreaming } from "../scripts/lib/norwegian-rights.js";

describe("norwegianRights", () => {
	it("World Cup football (no per-match data) → one tentative NRK / TV 2 label, never a foreign net", () => {
		const r = norwegianRights({ sport: "football", tournament: "FIFA World Cup 2026", title: "Norway vs Brazil" });
		expect(r.map((c) => c.platform)).toEqual(["NRK / TV 2"]); // shared rights, exact channel TBD
		expect(r[0].tentative).toBe(true);
		expect(JSON.stringify(r)).not.toMatch(/fox|espn/i);
	});
	it("F1 → Viaplay", () => {
		expect(norwegianRights({ sport: "f1", tournament: "Belgian Grand Prix" })[0].platform).toBe("Viaplay");
	});
	it("Premier League → TV 2 Play", () => {
		expect(norwegianRights({ sport: "football", tournament: "Premier League" })[0].platform).toBe("TV 2 Play");
	});
	it("Champions League → TV 2 Play (TV 2 holds UEFA's flagship club comp)", () => {
		expect(norwegianRights({ sport: "football", tournament: "UEFA Champions League" })[0].platform).toBe("TV 2 Play");
	});
	it("Europa League → Viaplay (NOT TV 2; verified 2026-07-27 vs presse.viaplaygroup.no + tvkampen)", () => {
		const r = norwegianRights({ sport: "football", tournament: "UEFA Europa League 2026/27 (kvalifisering)" });
		expect(r[0].platform).toBe("Viaplay");
		expect(r.some((c) => /tv 2/i.test(c.platform))).toBe(false);
	});
	it("Conference League → Viaplay (NOT TV 2; Brann–U Cluj ground truth)", () => {
		expect(norwegianRights({ sport: "football", tournament: "UEFA Conference League 2026/27 (kvalifisering)" })[0].platform).toBe("Viaplay");
	});
	it("unknown competition → no guess (empty)", () => {
		expect(norwegianRights({ sport: "football", tournament: "Some Friendly" })).toEqual([]);
	});
});

describe("normalizeStreaming", () => {
	it("overrides a foreign broadcaster (FOX) with Norwegian rights", () => {
		const s = normalizeStreaming({ sport: "football", tournament: "FIFA World Cup 2026", streaming: [{ platform: "FOX" }] });
		expect(s.map((c) => c.platform)).toEqual(["NRK / TV 2"]);
		expect(JSON.stringify(s)).not.toContain("FOX");
	});
	it("drops foreign nets when no rights mapping and keeps Norwegian ones", () => {
		const s = normalizeStreaming({ sport: "tennis", tournament: "Nordea Open", streaming: [{ platform: "Tennis Channel" }, { platform: "TV 2 Play" }] });
		expect(s.map((c) => c.platform)).toEqual(["TV 2 Play"]);
	});
	it("leaves esports free streams untouched", () => {
		const s = normalizeStreaming({ sport: "esports", streaming: [{ platform: "Twitch" }] });
		expect(s[0].platform).toBe("Twitch");
	});
});

import { resolveStreaming, matchTvListing } from "../scripts/lib/norwegian-rights.js";

describe("Viaplay's F1 links to the sport section, not the homepage", () => {
	it("F1 resolves to Viaplay's sport section", () => {
		const s = normalizeStreaming({ sport: "f1", tournament: "Belgian Grand Prix" });
		expect(s[0].platform).toBe("Viaplay");
		expect(s[0].url).toBe("https://viaplay.no/no-no/sport");
	});
});

describe("golf rights are tiered for 2026 (not a flat Viaplay)", () => {
	it("ordinary PGA Tour → HBO Max (Sport) / Eurosport, NOT Viaplay (the Corales class)", () => {
		const s = normalizeStreaming({ sport: "golf", tournament: "PGA Tour", title: "Corales Puntacana Championship" });
		expect(s.map((c) => c.platform)).toEqual(["HBO Max (Sport)", "Eurosport"]);
		expect(s.some((c) => c.platform === "Viaplay")).toBe(false);
	});
	it("The Open + US Open stay on Viaplay", () => {
		expect(normalizeStreaming({ sport: "golf", title: "The Open Championship" })[0].platform).toBe("Viaplay");
		expect(normalizeStreaming({ sport: "golf", title: "U.S. Open" })[0].platform).toBe("Viaplay");
	});
	it("DP World Tour → Viaplay", () => {
		expect(normalizeStreaming({ sport: "golf", tournament: "DP World Tour", title: "BMW International Open" })[0].platform).toBe("Viaplay");
	});
	it("The Masters + PGA Championship → Warner Bros. Discovery", () => {
		expect(normalizeStreaming({ sport: "golf", title: "The Masters" })[0].platform).toBe("Discovery+");
		expect(normalizeStreaming({ sport: "golf", title: "PGA Championship" })[0].platform).toBe("Discovery+");
	});
});

describe("cycling: the Tour is shown on TV 2 Play only (owner preference)", () => {
	it("Tour de France → TV 2 Play, no Max '+1'", () => {
		const s = normalizeStreaming({ sport: "cycling", tournament: "Tour de France", title: "Etappe 5" });
		expect(s.map((c) => c.platform)).toEqual(["TV 2 Play"]);
		expect(s[0].url).toContain("play.tv2.no");
	});
});

describe("tvkampen real-listing integration", () => {
	const listings = [
		{ homeTeam: "Liverpool", awayTeam: "Arsenal", time: "18:30", broadcasters: ["TV 2 Play", "TV 2 Sport 1", "Coolbet"] },
		{ homeTeam: "Ranheim", awayTeam: "Stabæk", time: "19:00", broadcasters: ["TV 2 Play", "Viaplay"] },
	];
	it("matches a football event to its listing by team names (ignoring FC suffixes)", () => {
		const l = matchTvListing({ homeTeam: "Liverpool FC", awayTeam: "Arsenal FC" }, listings);
		expect(l?.homeTeam).toBe("Liverpool");
	});
	it("uses the real listing's Norwegian broadcasters, dropping betting sites", () => {
		const s = resolveStreaming({ sport: "football", homeTeam: "Liverpool FC", awayTeam: "Arsenal FC", tournament: "Premier League" }, listings);
		expect(s.map((c) => c.platform)).toEqual(["TV 2 Play", "TV 2 Sport 1"]); // Coolbet dropped
		expect(s[0].url).toContain("tv2.no");
	});
	it("falls back to the rights map when no listing matches", () => {
		const s = resolveStreaming({ sport: "football", homeTeam: "Bodø/Glimt", awayTeam: "Molde", tournament: "Eliteserien" }, listings);
		expect(s[0].platform).toBe("TV 2 Play"); // from map, not a listing
	});
	it("collapses NRK sub-channels and caps aggregator padding to two channels", () => {
		const padded = [{
			homeTeam: "Rosenborg", awayTeam: "Brann",
			broadcasters: ["NRK1", "NRK TV", "Viaplay", "Eurosport Norge", "MAX"],
		}];
		const s = resolveStreaming({ sport: "football", homeTeam: "Rosenborg", awayTeam: "Brann", tournament: "Eliteserien" }, padded);
		expect(s.map((c) => c.platform)).toEqual(["NRK", "Viaplay"]); // NRK1/NRK TV -> one NRK, trailing padding dropped
	});
	it("non-football ignores listings and uses the map", () => {
		const s = resolveStreaming({ sport: "f1", tournament: "Belgian Grand Prix" }, listings);
		expect(s[0].platform).toBe("Viaplay");
	});
});

describe("tvkampen per-match link (per-match 'when & where')", () => {
	const withUrl = [
		{ homeTeam: "Liverpool", awayTeam: "Arsenal", broadcasters: ["TV 2 Play"], url: "https://www.tvkampen.com/kamp/liverpool-arsenal-1" },
		{ homeTeam: "Canada", awayTeam: "Marokko", broadcasters: ["NRK1", "NRK TV"], url: "https://www.tvkampen.com/kamp/canada-marokko-2" },
		{ homeTeam: "Paraguay", awayTeam: "Frankrike", broadcasters: ["Svt"], url: "https://www.tvkampen.com/kamp/paraguay-frankrike-3" },
	];
	it("points TV 2 at the tvkampen match page (no linkable per-match app URL)", () => {
		const s = resolveStreaming({ sport: "football", homeTeam: "Liverpool", awayTeam: "Arsenal", tournament: "Premier League" }, withUrl);
		expect(s[0].platform).toBe("TV 2 Play");
		expect(s[0].url).toBe("https://www.tvkampen.com/kamp/liverpool-arsenal-1");
	});
	it("keeps NRK's own URL (opens the NRK app), not the tvkampen page", () => {
		const s = resolveStreaming({ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Canada", awayTeam: "Morocco" }, withUrl);
		expect(s[0].platform).toBe("NRK");
		expect(s[0].url).toContain("tv.nrk.no");
		expect(s[0].url).not.toContain("tvkampen");
	});
	it("offers the tvkampen guide when no Norwegian rights holder is confirmable (SVT only)", () => {
		const s = resolveStreaming({ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Paraguay", awayTeam: "France" }, withUrl);
		expect(s[0].platform).toBe("NRK / TV 2");
		expect(s[0].tentative).toBe(true);
		expect(s[0].url).toBe("https://www.tvkampen.com/kamp/paraguay-frankrike-3");
	});
});

describe("World Cup per-match channel resolution (English↔Norwegian nations)", () => {
	// tvkampen lists nations in Norwegian and pads with aggregators; ESPN emits
	// English nation names. Both bugs together made every WC match show NRK + TV 2.
	const wcListings = [
		{ homeTeam: "Canada", awayTeam: "Marokko", broadcasters: ["NRK1", "NRK TV", "Viaplay", "Eurosport Norge", "MAX"] },
		{ homeTeam: "England", awayTeam: "Mexico", broadcasters: ["TV 2 Play", "TV 2 Sport 1", "Viaplay", "MAX"] },
		{ homeTeam: "Paraguay", awayTeam: "Frankrike", broadcasters: ["Svt"] },
	];

	it("matches an English-named event to a Norwegian-named listing (Morocco↔Marokko)", () => {
		const s = resolveStreaming(
			{ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Canada", awayTeam: "Morocco" },
			wcListings
		);
		expect(s.map((c) => c.platform)).toEqual(["NRK"]); // one true broadcaster, aggregators dropped
	});

	it("resolves a TV 2 WC match to a single TV 2 Play (drops NRK/aggregators absent)", () => {
		const s = resolveStreaming(
			{ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "England", awayTeam: "Mexico" },
			wcListings
		);
		expect(s.map((c) => c.platform)).toEqual(["TV 2 Play"]);
	});

	it("falls back to tentative NRK / TV 2 when the listing has no Norwegian rights holder", () => {
		const s = resolveStreaming(
			{ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Paraguay", awayTeam: "France" },
			wcListings
		);
		expect(s.map((c) => c.platform)).toEqual(["NRK / TV 2"]);
		expect(s[0].tentative).toBe(true);
	});

	it("nation-vs-nation with no tournament label still resolves (never a foreign net)", () => {
		const s = resolveStreaming(
			{ sport: "football", tournament: "International", homeTeam: "Norway", awayTeam: "Brazil" },
			[]
		);
		expect(s.map((c) => c.platform)).toEqual(["NRK / TV 2"]);
	});
});
