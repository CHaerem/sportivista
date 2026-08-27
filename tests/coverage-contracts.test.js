// coverage-contracts.js (WP-243): dekningskontrakten per konkurranse — det
// målbare løftet «i sesong: minst N events innen H dager», sesongærlig.
import { describe, it, expect } from "vitest";
import { assessContracts } from "../scripts/lib/coverage-contracts.js";

const NOW = Date.parse("2026-08-27T10:00:00Z"); // august → måned 8
const days = (n) => new Date(NOW + n * 86400000).toISOString();

const authority = {
	competitions: [
		{
			id: "football:eliteserien",
			sport: "football",
			name: "Eliteserien",
			match: ["eliteserien"],
			time: { sourceIds: ["eliteserien", "fotball-no"] },
			contract: { horizonDays: 14, minUpcoming: 2, months: [4, 5, 6, 7, 8, 9, 10, 11] },
		},
		{
			id: "biathlon:world-cup",
			sport: "biathlon",
			name: "Verdenscupen skiskyting",
			match: ["world cup", "verdenscup"],
			time: { sourceIds: ["ibu"] },
			contract: { horizonDays: 10, minUpcoming: 1, months: [1, 2, 3, 11, 12] },
		},
		{
			id: "cycling:tour-de-france",
			sport: "cycling",
			name: "Tour de France",
			match: ["tour de france"],
			time: { sourceIds: ["letour"] },
		}, // ingen kontrakt — skal aldri dukke opp i målingen
		{
			id: "cycling:tour-de-france-femmes",
			sport: "cycling",
			name: "Tour de France Femmes",
			match: ["tour de france femmes"],
			time: { sourceIds: ["letour"] },
			contract: { horizonDays: 14, minUpcoming: 1, months: [7] }, // kun juli — off-season i testmåneden (august)
		},
	],
};

const el = (title, time, over = {}) => ({ sport: "football", tournament: "Eliteserien", title, time, ...over });

describe("assessContracts", () => {
	it("met when the board holds at least minUpcoming events within the horizon", () => {
		const { contracts, breached } = assessContracts(
			authority,
			[el("Lyn – Brann", days(2)), el("Bodø/Glimt – Molde", days(9))],
			NOW
		);
		const elc = contracts.find((c) => c.id === "football:eliteserien");
		expect(elc.status).toBe("met");
		expect(elc.upcoming).toBe(2);
		expect(elc.authority).toBe("eliteserien, fotball-no");
		expect(breached).not.toContain("football:eliteserien");
	});

	it("breached in season with too few upcoming — events outside the horizon do not count", () => {
		const { contracts, breached } = assessContracts(
			authority,
			[el("Lyn – Brann", days(2)), el("Runde 25", days(20))], // nr. 2 er utenfor 14 d
			NOW
		);
		const elc = contracts.find((c) => c.id === "football:eliteserien");
		expect(elc.status).toBe("breached");
		expect(elc.upcoming).toBe(1);
		expect(breached).toEqual(["football:eliteserien"]);
	});

	it("off-season never breaches — sesongærlighet (skiskyting i august)", () => {
		const { contracts, breached } = assessContracts(authority, [], NOW);
		expect(contracts.find((c) => c.id === "biathlon:world-cup").status).toBe("off-season");
		expect(breached).not.toContain("biathlon:world-cup");
	});

	it("a multi-day event straddling the horizon start counts (isEventInWindow-konvensjonen)", () => {
		const ongoing = el("Pågående runde", days(-1), { endTime: days(1) });
		const { contracts } = assessContracts(
			{ competitions: [{ ...authority.competitions[0], contract: { horizonDays: 14, minUpcoming: 1, months: [8] } }] },
			[ongoing],
			NOW
		);
		expect(contracts[0].status).toBe("met");
	});

	it("longest match wins: a Femmes-etappe never counts toward the wrong contract", () => {
		const femmes = { sport: "cycling", tournament: "Tour de France Femmes", title: "Etappe 3", time: days(3) };
		const { contracts } = assessContracts(authority, [femmes], NOW);
		expect(contracts.find((c) => c.id === "cycling:tour-de-france-femmes").upcoming).toBe(1);
		// TdF (uten kontrakt) er ikke målt i det hele tatt:
		expect(contracts.some((c) => c.id === "cycling:tour-de-france")).toBe(false);
	});

	it("is empty and silent without contracts or without an authority map (fail-soft)", () => {
		expect(assessContracts(null, [el("x", days(1))], NOW)).toEqual({ contracts: [], breached: [] });
		expect(
			assessContracts({ competitions: [{ id: "a", sport: "football", name: "A", match: ["a"], time: {} }] }, [], NOW)
		).toEqual({ contracts: [], breached: [] });
	});
});
