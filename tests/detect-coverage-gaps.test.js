// detect-coverage-gaps.js: recall watch — entities in the news with no upcoming event.
import { describe, it, expect } from "vitest";
import {
	buildWatchlist,
	hasUpcomingEvent,
	detectGaps,
	containsName,
	headlineIsImminent,
	detectSourceAnomalies,
	detectTrackedClaims,
	reasonClaimsCoverage,
	entryClaimTerms,
	parseNorwegianDates,
} from "../scripts/detect-coverage-gaps.js";
import { makeCoverageGate } from "../scripts/lib/helpers.js";

const NOW = Date.parse("2026-07-03T12:00:00Z");
const interests = { alwaysTrack: { athletes: ["Viktor Hovland"], teams: ["Lyn"], tournaments: [] } };
const tracked = { athletes: [{ name: "Casper Ruud" }], tournaments: [{ name: "Tour de France 2026" }], leagues: [] };

describe("buildWatchlist", () => {
	it("merges interests and tracked entities", () => {
		const list = buildWatchlist(interests, tracked);
		expect(list).toEqual(expect.arrayContaining(["Viktor Hovland", "Lyn", "Casper Ruud", "Tour de France 2026"]));
	});

	it("includes interests.alwaysTrack.tournaments (review finding)", () => {
		const list = buildWatchlist(
			{ alwaysTrack: { athletes: [], teams: [], tournaments: ["Wimbledon"] } },
			null
		);
		expect(list).toContain("Wimbledon");
	});
});

describe("containsName (word boundaries)", () => {
	it("matches whole names but not substrings inside words (review finding)", () => {
		expect(containsName("lyn slo vif i går", "lyn")).toBe(true);
		expect(containsName("kraftig lynnedslag i oslo", "lyn")).toBe(false);
		expect(containsName("vålerenga-lyn utsatt", "lyn")).toBe(true);
	});
});

describe("hasUpcomingEvent", () => {
	const events = [
		{ title: "John Deere Classic", norwegianPlayers: [{ name: "Viktor Hovland" }], time: "2026-07-05T10:00:00Z" },
	];
	it("finds entity mentions in upcoming events", () => {
		expect(hasUpcomingEvent("Viktor Hovland", events, NOW)).toBe(true);
	});
	it("returns false for entities without events", () => {
		expect(hasUpcomingEvent("Casper Ruud", events, NOW)).toBe(false);
	});
});

describe("detectGaps", () => {
	it("flags newsworthy entities with no upcoming event", () => {
		const rss = { items: [{ title: "Casper Ruud klar for ny turnering neste uke", link: "https://nrk.no/x" }] };
		const gaps = detectGaps({ rss, events: [], interests, tracked, now: NOW });
		expect(gaps).toHaveLength(1);
		expect(gaps[0].entity).toBe("Casper Ruud");
	});

	it("does not flag entities that already have events", () => {
		const rss = { items: [{ title: "Hovland i storform: Viktor Hovland jakter seier" }] };
		const events = [{ title: "The Open", norwegianPlayers: [{ name: "Viktor Hovland" }], time: "2026-07-10T08:00:00Z" }];
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		expect(gaps).toHaveLength(0);
	});

	it("dedupes multiple headlines about the same entity", () => {
		const rss = { items: [
			{ title: "Casper Ruud vant" },
			{ title: "Casper Ruud til semifinale" },
		] };
		const gaps = detectGaps({ rss, events: [], interests, tracked, now: NOW });
		expect(gaps).toHaveLength(1);
	});

	it("handles missing inputs gracefully", () => {
		expect(detectGaps({ rss: null, events: [], interests: null, tracked: null, now: NOW })).toEqual([]);
	});
});

describe("headlineIsImminent", () => {
	it("recognises Norwegian and English 'happening now' language", () => {
		expect(headlineIsImminent("Formel 1: British GP i dag på Silverstone")).toBe(true);
		expect(headlineIsImminent("Live: landskampen mot Sverige")).toBe(true);
		expect(headlineIsImminent("Ruud klar for turnering neste uke")).toBe(false);
	});
});

describe("detectGaps — imminence (entity has a later event but nothing soon)", () => {
	it("flags an entity the news says plays today while our next event is far out", () => {
		// Hovland's next event is 12 days out (covered at 14d, not at 4d); news says "i dag".
		const events = [
			{ title: "Genesis Scottish Open", norwegianPlayers: [{ name: "Viktor Hovland" }], time: "2026-07-15T10:00:00Z" },
		];
		const rss = { items: [{ title: "Viktor Hovland spiller i dag", link: "https://nrk.no/h" }] };
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		const g = gaps.find((x) => x.entity === "Viktor Hovland");
		expect(g).toBeTruthy();
		expect(g.type).toBe("imminent");
		expect(g.imminent).toBe(true);
	});

	it("does NOT flag imminence when the entity already has an event in the next few days", () => {
		const events = [
			{ title: "The Open R1", norwegianPlayers: [{ name: "Viktor Hovland" }], time: "2026-07-04T08:00:00Z" },
		];
		const rss = { items: [{ title: "Viktor Hovland spiller i dag" }] };
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		expect(gaps.find((x) => x.entity === "Viktor Hovland")).toBeUndefined();
	});
});

describe("detectGaps — ongoing multi-day events (WP-43 regression)", () => {
	// A golf tournament that STARTED three days before NOW and is still running.
	// Windowing on e.time alone read this as "not on the board" and produced
	// false entity/sport gaps; isEventInWindow must count it as coverage.
	const ongoingGolf = {
		sport: "golf",
		title: "The Open Championship",
		norwegianPlayers: [{ name: "Viktor Hovland" }],
		time: "2026-06-30T06:00:00Z", // > 1 day before NOW (2026-07-03)
		endTime: "2026-07-06T18:00:00Z", // still in progress
	};

	it("does NOT flag an entity playing an ongoing multi-day event", () => {
		const rss = { items: [{ title: "Viktor Hovland spiller i dag", link: "https://nrk.no/h" }] };
		const gaps = detectGaps({ rss, events: [ongoingGolf], interests, tracked, now: NOW });
		expect(gaps.find((x) => x.entity === "Viktor Hovland")).toBeUndefined();
	});

	it("does NOT flag a sport gap when the sport has an ongoing multi-day event", () => {
		const rss = { items: [{ title: "PGA Tour: avgjørelsen faller i dag" }] };
		const gaps = detectGaps({ rss, events: [ongoingGolf], interests, tracked, now: NOW });
		expect(gaps.find((x) => x.kind === "sport" && x.sport === "golf")).toBeUndefined();
	});

	it("still flags when the multi-day event is already over", () => {
		const finished = { ...ongoingGolf, time: "2026-06-25T06:00:00Z", endTime: "2026-06-28T18:00:00Z" };
		const rss = { items: [{ title: "Viktor Hovland spiller i dag", link: "https://nrk.no/h" }] };
		const gaps = detectGaps({ rss, events: [finished], interests, tracked, now: NOW });
		expect(gaps.find((x) => x.entity === "Viktor Hovland")).toBeTruthy();
	});
});

describe("detectGaps — sport-level blind spot (the F1 case)", () => {
	it("flags a followed sport that is imminent in the news but absent from the board soon", () => {
		// F1 in the news happening today; board only has a race 14 days out (the real bug).
		const events = [{ sport: "f1", title: "Belgian Grand Prix", time: "2026-07-17T11:30:00Z" }];
		const rss = { items: [{ title: "Formel 1: British Grand Prix i dag", link: "https://f1.no/gp" }] };
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		const g = gaps.find((x) => x.kind === "sport" && x.sport === "f1");
		expect(g).toBeTruthy();
		expect(g.type).toBe("imminent");
	});

	it("does not flag the sport when an event is actually on the board soon", () => {
		const events = [{ sport: "f1", title: "British Grand Prix", time: "2026-07-05T14:00:00Z" }];
		const rss = { items: [{ title: "Formel 1: British Grand Prix i dag" }] };
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		expect(gaps.find((x) => x.kind === "sport" && x.sport === "f1")).toBeUndefined();
	});

	it("requires imminence language, not just a sport mention", () => {
		const events = [];
		const rss = { items: [{ title: "Formel 1: sesongen oppsummert så langt" }] };
		const gaps = detectGaps({ rss, events, interests, tracked, now: NOW });
		expect(gaps.find((x) => x.kind === "sport" && x.sport === "f1")).toBeUndefined();
	});
});

describe("detectSourceAnomalies", () => {
	const healthy = () => {
		const s = {};
		for (const sport of ["football", "golf", "tennis", "f1", "chess", "esports", "cycling"]) {
			s[sport] = { tournaments: [{ events: [{ time: "2026-07-05T10:00:00Z" }] }] };
		}
		return s;
	};
	const boardWithAll = () =>
		["football", "golf", "tennis", "f1", "chess", "esports", "cycling"].map((sport) => ({
			sport,
			time: "2026-07-05T10:00:00Z",
		}));

	it("is quiet when every source is healthy and on the board", () => {
		expect(detectSourceAnomalies({ sources: healthy(), events: boardWithAll(), now: NOW })).toEqual([]);
	});

	// The football.json regression: the fetcher stopped producing on 19 July 2026 and
	// retainLastGood re-served the last good copy 137 runs in a row. Nothing noticed,
	// because the research agent was hand-filling Eliteserien as `source: "ai-research"`
	// — so the board was covered and the coverage-first gate skipped the sport entirely.
	describe("stale-retained (escapes the coverage-first gate)", () => {
		const retainedFor = (days, runs) => {
			const s = healthy();
			const stamp = new Date(NOW - days * 86400000).toISOString();
			s.football._retained = { since: stamp, consecutiveRetains: runs, lastFreshFetch: stamp };
			return s;
		};

		it("flags a chronically retained file EVEN WHEN the board is fully covered", () => {
			const a = detectSourceAnomalies({ sources: retainedFor(9, 137), events: boardWithAll(), now: NOW });
			const hit = a.find((x) => x.sport === "football");
			expect(hit).toMatchObject({ issue: "stale-retained", severity: "high", consecutiveRetains: 137, staleDays: 9 });
			expect(hit.detail).toMatch(/137 consecutive run/);
		});

		it("stays quiet for an ordinary short retention lull", () => {
			const a = detectSourceAnomalies({ sources: retainedFor(1, 20), events: boardWithAll(), now: NOW });
			expect(a.find((x) => x.sport === "football")).toBeUndefined();
		});

		it("stays quiet once the fetcher produces fresh data again", () => {
			expect(detectSourceAnomalies({ sources: healthy(), events: boardWithAll(), now: NOW })).toEqual([]);
		});

		it("survives a retention stamp with no parseable date", () => {
			const s = healthy();
			s.football._retained = { consecutiveRetains: 500 };
			expect(detectSourceAnomalies({ sources: s, events: boardWithAll(), now: NOW })).toEqual([]);
		});
	});

	it("stays quiet when the fetcher file is empty but the board is covered (AI research)", () => {
		// chess/cycling have no API and are filled by research — an empty file is expected.
		const s = healthy();
		s.chess = { tournaments: [] };
		const a = detectSourceAnomalies({ sources: s, events: boardWithAll(), now: NOW });
		expect(a.find((x) => x.sport === "chess")).toBeUndefined();
	});

	it("flags a missing fetcher file only when the board also lacks the sport", () => {
		const s = healthy();
		s.f1 = null;
		const board = boardWithAll().filter((e) => e.sport !== "f1");
		const a = detectSourceAnomalies({ sources: s, events: board, now: NOW });
		expect(a.find((x) => x.sport === "f1")?.issue).toBe("file-missing");
	});

	it("flags an empty fetcher file when the board lacks the sport", () => {
		const s = healthy();
		s.chess = { tournaments: [] };
		const board = boardWithAll().filter((e) => e.sport !== "chess");
		const a = detectSourceAnomalies({ sources: s, events: board, now: NOW });
		expect(a.find((x) => x.sport === "chess")?.issue).toBe("file-empty");
	});

	it("counts an ongoing multi-day event in the source file as upcoming (WP-43 regression)", () => {
		const s = healthy();
		// Started 3 days before NOW, still running — must register as dropped-in-build, not file-empty.
		s.golf = { tournaments: [{ events: [{ time: "2026-06-30T06:00:00Z", endTime: "2026-07-06T18:00:00Z" }] }] };
		const board = boardWithAll().filter((e) => e.sport !== "golf");
		const a = detectSourceAnomalies({ sources: s, events: board, now: NOW });
		expect(a.find((x) => x.sport === "golf")?.issue).toBe("dropped-in-build");
	});

	it("flags (high) events present in the source but dropped from the board", () => {
		const s = healthy();
		const board = boardWithAll().filter((e) => e.sport !== "f1"); // f1 has source events but none on board
		const a = detectSourceAnomalies({ sources: s, events: board, now: NOW });
		const f1 = a.find((x) => x.sport === "f1");
		expect(f1?.issue).toBe("dropped-in-build");
		expect(f1?.severity).toBe("high");
	});

	// WP-110 · the catalog gate. chess/esports are entity-gated: an event the
	// catalog never covers (a minor open with a lone club player — the "Sant Martí"
	// class) is a LEGITIMATE build drop, so it must NOT surface as dropped-in-build.
	// This was a chronic HIGH false positive firing every pipeline cycle.
	describe("dropped-in-build is catalog-gated (Sant Martí false positive)", () => {
		const catalog = {
			tier1: ["football", "golf", "f1", "cycling"],
			tier2: { athletes: [{ name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess" }] },
		};
		const isCovered = makeCoverageGate(catalog);

		it("does NOT flag an uncovered entity-gated chess event the build correctly drops", () => {
			const s = healthy();
			// A minor Norwegian chess open, one club player, no catalog entity — the
			// build's isCovered drops it, so it is not a source anomaly. (Source-file
			// events carry no `sport` field; the gate forces it from the file key.)
			s.chess = { tournaments: [{ events: [{
				title: "Round 6 – XXVI Obert Internacional Sant Martí 2026",
				time: "2026-07-05T10:00:00Z",
				norwegian: true,
				participants: [{ name: "Johan-Sebastian Christiansen" }],
			}] }] };
			const board = boardWithAll().filter((e) => e.sport !== "chess");
			const a = detectSourceAnomalies({ sources: s, events: board, isCovered, now: NOW });
			expect(a.find((x) => x.sport === "chess")).toBeUndefined();
		});

		it("STILL flags a catalog-covered entity-gated event dropped from the board", () => {
			const s = healthy();
			// Names a tracked catalog athlete → the build should keep it, so its
			// absence from the board is a real drop worth flagging.
			s.chess = { tournaments: [{ events: [{
				title: "Norway Chess 2026 – Carlsen vs Nakamura",
				time: "2026-07-05T10:00:00Z",
				participants: [{ name: "Magnus Carlsen" }, { name: "Hikaru Nakamura" }],
			}] }] };
			const board = boardWithAll().filter((e) => e.sport !== "chess");
			const a = detectSourceAnomalies({ sources: s, events: board, isCovered, now: NOW });
			expect(a.find((x) => x.sport === "chess")?.issue).toBe("dropped-in-build");
		});

		it("still flags a tier1 sport dropped from the board (gate is a no-op for wholesale sports)", () => {
			const s = healthy();
			const board = boardWithAll().filter((e) => e.sport !== "f1");
			const a = detectSourceAnomalies({ sources: s, events: board, isCovered, now: NOW });
			expect(a.find((x) => x.sport === "f1")?.issue).toBe("dropped-in-build");
		});
	});
});

describe("reasonClaimsCoverage", () => {
	it("recognises the AI's board-coverage assertions", () => {
		expect(reasonClaimsCoverage("Ekte ai-research-event (bekreftet ATP)")).toBe(true);
		expect(reasonClaimsCoverage("nå lagt til på tavla som ai-research-event")).toBe(true);
		expect(reasonClaimsCoverage("seks events ligger nå inne")).toBe(true);
	});
	it("does NOT treat a deliberate non-coverage as a claim (Tari/Andorra class)", () => {
		// The real Aryan Tari entry: names a tournament but explicitly adds no event.
		expect(reasonClaimsCoverage("Andorra Open 18.–26. juli — Ingen event lagt til (finner ikke bekreftet deltakelse).")).toBe(false);
		expect(reasonClaimsCoverage("holdes av tavla til klubben bekrefter tid")).toBe(false);
	});
});

describe("entryClaimTerms", () => {
	it("keeps distinctive words incl. parenthetical entity, drops years/months", () => {
		expect(entryClaimTerms({ name: "Swiss Open Gstaad 2026" })).toEqual(expect.arrayContaining(["Swiss", "Open", "Gstaad"]));
		expect(entryClaimTerms({ name: "Swiss Open Gstaad 2026" })).not.toContain("2026");
		expect(entryClaimTerms({ name: "OBOS-ligaen 2026 (Lyn Oslo)" })).toEqual(expect.arrayContaining(["Lyn", "Oslo"]));
	});
});

describe("parseNorwegianDates", () => {
	const now = Date.parse("2026-07-18T00:00:00Z");
	it("parses day+month prose and resolves the implicit year near now", () => {
		const [d] = parseNorwegianDates("finalen søndag 26. juli", now);
		expect(new Date(d.ts).toISOString().slice(0, 10)).toBe("2026-07-26");
	});
	it("parses abbreviations and the last day of a range", () => {
		const ds = parseNorwegianDates("kampen torsdag 27. aug kl. 21.00", now);
		expect(new Date(ds[0].ts).toISOString().slice(0, 10)).toBe("2026-08-27");
	});
	it("returns nothing for prose without a day+month date", () => {
		expect(parseNorwegianDates("kl. 21.00 på Camp Nou", now)).toEqual([]);
	});
});

describe("detectTrackedClaims — the Gstaad class (RSS-independent)", () => {
	const now = Date.parse("2026-07-18T00:00:00Z");
	// tracked.json asserts the tournament is on the board ("ai-research-event"),
	// naming a concrete date, while events.json carries no such event.
	const gstaadTracked = {
		tournaments: [
			{
				id: "swiss-open-gstaad-2026",
				name: "Swiss Open Gstaad 2026",
				sport: "tennis",
				reason: "Casper Ruuds turnering (ATP 250) 13.–19. juli på Roy Emerson Arena. Ekte ai-research-event (bekreftet ATP + Wikipedia, TV 2 Play).",
			},
		],
	};

	it("flags a coverage claim with no matching event on the board", () => {
		const gaps = detectTrackedClaims({ tracked: gstaadTracked, events: [], now });
		expect(gaps).toHaveLength(1);
		expect(gaps[0].kind).toBe("tracked-claim");
		expect(gaps[0].entity).toBe("Swiss Open Gstaad 2026");
		expect(gaps[0].sport).toBe("tennis");
		expect(gaps[0].imminent).toBe(true); // 19 July is within 4 days of 18 July
	});

	it("does NOT flag when the board actually carries the event", () => {
		const events = [
			{ sport: "tennis", title: "EFG Swiss Open Gstaad", time: "2026-07-17T11:30:00Z", endTime: "2026-07-19T18:00:00Z" },
		];
		expect(detectTrackedClaims({ tracked: gstaadTracked, events, now })).toEqual([]);
	});

	it("recognises coverage via an ongoing multi-day event and the players field", () => {
		// Athlete entry; the event is titled by tournament but lists the player.
		const tracked = {
			athletes: [{ name: "Viktor Hovland", sport: "golf", reason: "på tavla: The Open, tee-tid bekreftet" }],
		};
		const events = [
			{ sport: "golf", title: "The Open", norwegianPlayers: [{ name: "Viktor Hovland" }], time: "2026-07-16T04:00:00Z", endTime: "2026-07-19T20:00:00Z" },
		];
		expect(detectTrackedClaims({ tracked, events, now })).toEqual([]);
	});

	it("does NOT flag an entry that never asserts coverage (deliberate non-coverage)", () => {
		const tracked = {
			athletes: [{ name: "Aryan Tari", sport: "chess", reason: "Andorra Open 18.–26. juli — Ingen event lagt til (finner ikke bekreftet Tari-deltakelse)." }],
		};
		expect(detectTrackedClaims({ tracked, events: [], now })).toEqual([]);
	});

	it("respects the sport scope — a wrong-sport event does not count as coverage", () => {
		const events = [{ sport: "golf", title: "Swiss Open (golf, unrelated)", time: "2026-07-18T10:00:00Z" }];
		const gaps = detectTrackedClaims({ tracked: gstaadTracked, events, now });
		expect(gaps).toHaveLength(1);
	});

	it("skips entries whose expires is already past", () => {
		const tracked = {
			tournaments: [{ ...gstaadTracked.tournaments[0], expires: "2026-07-01T00:00:00Z" }],
		};
		expect(detectTrackedClaims({ tracked, events: [], now })).toEqual([]);
	});

	it("handles missing/empty tracked gracefully", () => {
		expect(detectTrackedClaims({ tracked: null, events: [], now })).toEqual([]);
		expect(detectTrackedClaims({ tracked: {}, events: [], now })).toEqual([]);
	});
});

// ── WP-243: kontraktbrudd → høy-alvorlighets gap ────────────────────────────
import { detectContractBreaches } from "../scripts/detect-coverage-gaps.js";

describe("detectContractBreaches", () => {
	const report = {
		contracts: [
			{ id: "football:eliteserien", name: "Eliteserien", sport: "football", authority: "eliteserien, fotball-no", horizonDays: 14, minUpcoming: 4, upcoming: 1, inSeason: true, status: "breached" },
			{ id: "f1:world-championship", name: "Formel 1", sport: "f1", authority: "formula1", horizonDays: 35, minUpcoming: 1, upcoming: 2, inSeason: true, status: "met" },
			{ id: "biathlon:world-cup", name: "Verdenscupen", sport: "biathlon", authority: "ibu", horizonDays: 10, minUpcoming: 1, upcoming: 0, inSeason: false, status: "off-season" },
		],
	};

	it("only breached contracts become gaps — always high severity, imminent, with the named authority", () => {
		const gaps = detectContractBreaches(report, Date.parse("2026-08-27T10:00:00Z"));
		expect(gaps).toHaveLength(1);
		const g = gaps[0];
		expect(g.kind).toBe("contract-breach");
		expect(g.severity).toBe("high");
		expect(g.imminent).toBe(true);
		expect(g.sport).toBe("football");
		expect(g.detail).toContain("eliteserien, fotball-no");
		expect(g.detail).toContain("1 av minst 4");
	});

	it("is empty and silent without a contract report (fail-soft)", () => {
		expect(detectContractBreaches(null)).toEqual([]);
		expect(detectContractBreaches({})).toEqual([]);
	});
});
