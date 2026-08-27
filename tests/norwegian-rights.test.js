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
	it("Norwegian club's European qualifier → decline to guess (don't clobber the local free holder)", () => {
		// The Glimt/Brann/Tromsø revert-war: early qualifiers are sub-licensed free
		// to Direktesport/Amedia/VG, so a confident Viaplay/TV 2 here overwrites the
		// researched channel every rebuild. norwegian:true ⇒ return [] and stand down.
		expect(norwegianRights({ sport: "football", tournament: "UEFA Champions League 2026/27 (kvalifisering)", norwegian: true })).toEqual([]);
		expect(norwegianRights({ sport: "football", tournament: "UEFA Conference League 2026/27 (kvalifisering)", norwegian: true })).toEqual([]);
		expect(norwegianRights({ sport: "football", tournament: "UEFA Europa League 2026/27 (kvalifisering)", norwegian: true })).toEqual([]);
	});
	it("foreign-vs-foreign European qualifier (no Norwegian club) → aggregator mapping still applies", () => {
		// The carve-out is gated on norwegian:true, so a generic qualifier is unchanged.
		expect(norwegianRights({ sport: "football", tournament: "UEFA Conference League 2026/27 (kvalifisering)" })[0].platform).toBe("Viaplay");
		expect(norwegianRights({ sport: "football", tournament: "UEFA Champions League 2026/27 (kvalifisering)" })[0].platform).toBe("TV 2 Play");
	});
	it("Norwegian club in the Champions League GROUP stage → still TV 2 (only qualifiers are carved out)", () => {
		expect(norwegianRights({ sport: "football", tournament: "UEFA Champions League 2026/27", norwegian: true })[0].platform).toBe("TV 2 Play");
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
	it("keeps the researched local free holder on a Norwegian club's qualifier (Tromsø–Cluj revert-war)", () => {
		// The whole point of the carve-out: Direktesport must survive rather than be
		// overwritten by a re-derived Viaplay AND rather than be filtered out as
		// "foreign" — so Direktesport is now a recognised Norwegian holder.
		const s = normalizeStreaming({
			sport: "football",
			tournament: "UEFA Conference League 2026/27 (kvalifisering)",
			norwegian: true,
			streaming: [{ platform: "Direktesport", url: "https://www.direktesport.no/tromso-cfr-cluj" }],
		});
		expect(s.map((c) => c.platform)).toEqual(["Direktesport"]);
	});
	it("keeps VG+ Sport / Avisa Nordland on a Norwegian club's qualifier and drops any foreign leftover", () => {
		const s = normalizeStreaming({
			sport: "football",
			tournament: "UEFA Champions League 2026/27 (kvalifisering)",
			norwegian: true,
			streaming: [{ platform: "Direktesport / Avisa Nordland" }, { platform: "VG+ Sport" }, { platform: "ESPN" }],
		});
		expect(s.map((c) => c.platform)).toEqual(["Direktesport / Avisa Nordland", "VG+ Sport"]);
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
	it("an unclassifiable golf event does NOT get force-mapped to PGA/HBO Max — it keeps its own researched Norwegian streaming (visual-qa 2026-08-13: Danish Golf Championship, a DP World event, was wrongly shown on HBO Max)", () => {
		// A DP World Tour event carrying only its title (as an AI-research event does,
		// with no "DP World Tour" tour tag in tournament/meta) used to fall through to
		// the PGA default and get its correct Viaplay clobbered to HBO Max.
		const s = normalizeStreaming({
			sport: "golf",
			title: "Danish Golf Championship",
			streaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport" }],
		});
		expect(s.map((c) => c.platform)).toEqual(["Viaplay"]);
		expect(s.some((c) => c.platform === "HBO Max (Sport)")).toBe(false);
	});
	it("a non-PGA tour we don't map (LPGA / Ladies European / Solheim) is left empty rather than guessed as PGA/HBO Max", () => {
		expect(normalizeStreaming({ sport: "golf", title: "Solheim Cup 2026", streaming: [] })).toEqual([]);
		expect(normalizeStreaming({ sport: "golf", title: "AIG Women's Open", streaming: [] })).toEqual([]);
	});
	it("ordinary PGA Tour is still HBO Max when the tour tag is present (the fetcher stamps meta/tournament 'PGA Tour' on every PGA event)", () => {
		expect(normalizeStreaming({ sport: "golf", meta: "PGA Tour", title: "FedEx St. Jude Championship" })[0].platform).toBe("HBO Max (Sport)");
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

// ── WP-246: the channel must point at the match, not at the front page ──────

import { classifyStreamingUrl, stampUrlKinds } from "../scripts/lib/norwegian-rights.js";

describe("classifyStreamingUrl — deep vs. landing", () => {
	it("classifies the rights map's own fallback URLs as landing (they are the lie WP-246 removes)", () => {
		expect(classifyStreamingUrl("https://play.tv2.no/sport")).toBe("landing");
		expect(classifyStreamingUrl("https://viaplay.no/no-no/sport")).toBe("landing");
		expect(classifyStreamingUrl("https://www.eurosport.no")).toBe("landing");
		expect(classifyStreamingUrl("https://tv.nrk.no/direkte")).toBe("landing");
		expect(classifyStreamingUrl("https://www.hbomax.com/no/no/sports/pga-tour")).toBe("landing");
		expect(classifyStreamingUrl("https://www.max.com")).toBe("landing");
		expect(classifyStreamingUrl("https://www.discoveryplus.no")).toBe("landing");
	});
	it("a bare origin is always landing, trailing slash or not", () => {
		expect(classifyStreamingUrl("https://play.tv2.no")).toBe("landing");
		expect(classifyStreamingUrl("https://play.tv2.no/")).toBe("landing");
		expect(classifyStreamingUrl("https://www.twitch.tv/")).toBe("landing");
	});
	it("a generic sport SECTION is landing too — a category page is not a broadcast", () => {
		expect(classifyStreamingUrl("https://play.tv2.no/sport/tennis")).toBe("landing");
		expect(classifyStreamingUrl("https://www.chess.com/tv")).toBe("landing");
	});
	it("classifies a real per-broadcast URL as deep", () => {
		expect(classifyStreamingUrl("https://tv.nrk.no/serie/friidrett-diamond-league")).toBe("deep");
		expect(classifyStreamingUrl("https://tv.vg.no/video/290684/rosenborg-manchester-united")).toBe("deep");
		expect(classifyStreamingUrl("https://play.tv2.no/sport/sykkel/arctic-race-of-norway")).toBe("deep");
		expect(classifyStreamingUrl("https://www.tvkampen.com/kamp/liverpool-arsenal-1")).toBe("deep");
		expect(classifyStreamingUrl("https://www.twitch.tv/STLChessClub")).toBe("deep");
	});
	it("says nothing when there is nothing to classify (no url / unparseable)", () => {
		expect(classifyStreamingUrl("")).toBe("");
		expect(classifyStreamingUrl(null)).toBe("");
		expect(classifyStreamingUrl(undefined)).toBe("");
		expect(classifyStreamingUrl("play.tv2.no/sport")).toBe(""); // no scheme → don't guess
	});
});

describe("stampUrlKinds — the label can never drift from the URL", () => {
	it("stamps landing/deep and leaves url-less entries (and plain strings) alone", () => {
		const out = stampUrlKinds([
			{ platform: "TV 2 Play", url: "https://play.tv2.no/sport" },
			{ platform: "NRK", url: "https://tv.nrk.no/serie/friidrett-nm" },
			{ platform: "Viaplay" },
			"Twitch",
		]);
		expect(out[0].urlKind).toBe("landing");
		expect(out[1].urlKind).toBe("deep");
		expect(out[2].urlKind).toBeUndefined(); // no url ⇒ no claim
		expect(out[3]).toBe("Twitch");
	});
	it("is idempotent and re-labels when a URL is rewritten", () => {
		const once = stampUrlKinds([{ platform: "TV 2 Play", url: "https://play.tv2.no/sport" }]);
		expect(stampUrlKinds(once)).toEqual(once);
		const rewritten = stampUrlKinds([{ ...once[0], url: "https://www.tvkampen.com/kamp/x-1" }]);
		expect(rewritten[0].urlKind).toBe("deep");
	});
	it("drops a stale urlKind when the url is gone", () => {
		const out = stampUrlKinds([{ platform: "TV 2 Play", urlKind: "deep" }]);
		expect(out[0].urlKind).toBeUndefined();
	});
});

describe("the rights map ships its own honesty label", () => {
	it("every mapped fallback channel is stamped landing — the map is a rights map, not a link", () => {
		for (const ev of [
			{ sport: "football", tournament: "Premier League" },
			{ sport: "f1", tournament: "Belgian Grand Prix" },
			{ sport: "golf", tournament: "PGA Tour", title: "Corales Puntacana Championship" },
			{ sport: "cycling", tournament: "Tour de France", title: "Etappe 5" },
		]) {
			const s = normalizeStreaming(ev);
			expect(s.length).toBeGreaterThan(0);
			for (const c of s) expect(c.urlKind).toBe("landing");
		}
	});
	it("the tentative WC label is landing too (tv.nrk.no is a front page)", () => {
		const s = norwegianRights({ sport: "football", tournament: "FIFA World Cup 2026" });
		expect(s[0].urlKind).toBe("landing");
	});
	it("resolveStreaming re-stamps after pointing a channel at the tvkampen match page", () => {
		const listings = [{ homeTeam: "Liverpool", awayTeam: "Arsenal", broadcasters: ["TV 2 Play"], url: "https://www.tvkampen.com/kamp/liverpool-arsenal-1" }];
		const s = resolveStreaming({ sport: "football", homeTeam: "Liverpool", awayTeam: "Arsenal", tournament: "Premier League" }, listings);
		expect(s[0].url).toContain("tvkampen.com/kamp/");
		expect(s[0].urlKind).toBe("deep"); // per-match guide, not the TV 2 front page
	});
	it("a WC fallback onto the tvkampen guide is deep, while the plain tentative label stays landing", () => {
		const guide = [{ homeTeam: "Paraguay", awayTeam: "Frankrike", broadcasters: ["Svt"], url: "https://www.tvkampen.com/kamp/paraguay-frankrike-3" }];
		const withGuide = resolveStreaming({ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Paraguay", awayTeam: "France" }, guide);
		expect(withGuide[0].urlKind).toBe("deep");
		const noGuide = resolveStreaming({ sport: "football", tournament: "FIFA World Cup 2026", homeTeam: "Norway", awayTeam: "Brazil" }, []);
		expect(noGuide[0].urlKind).toBe("landing");
	});
	it("keeps an agent-supplied deep link on esports/chess (we never downgrade a real link)", () => {
		const s = normalizeStreaming({ sport: "esports", streaming: [{ platform: "Twitch", url: "https://www.twitch.tv/blastpremier" }] });
		expect(s[0].urlKind).toBe("deep");
	});
});
