// lib/response-validator.js: guards against malformed ESPN responses.
import { describe, it, expect } from "vitest";
import { validateESPNScoreboard } from "../scripts/lib/response-validator.js";

describe("validateESPNScoreboard", () => {
	it("accepts a well-formed scoreboard", () => {
		const result = validateESPNScoreboard({ events: [{ id: "1", competitions: [{}] }] }, "test");
		expect(result.valid).toBe(true);
	});

	it("rejects null responses", () => {
		expect(validateESPNScoreboard(null, "test").valid).toBe(false);
	});

	it("rejects responses without an events array", () => {
		expect(validateESPNScoreboard({ foo: "bar" }, "test").valid).toBe(false);
	});

	// A future golf tournament arrives with a competition but an empty field.
	const futureTournament = {
		events: [{
			name: "Butterfield Bermuda Championship",
			date: "2026-10-22T04:00:00Z",
			competitions: [{ competitors: [] }],
		}],
	};

	it("drops a competitor-less event by default (football/F1/tennis need a fixture's two sides)", () => {
		const result = validateESPNScoreboard(futureTournament, "PGA Tour");
		expect(result.events).toHaveLength(0);
		expect(result.warnings.some((w) => w.includes("missing_competitors"))).toBe(true);
	});

	it("keeps a competitor-less event when requireCompetitors is false (golf look-ahead, WP-243)", () => {
		const result = validateESPNScoreboard(futureTournament, "PGA Tour", { requireCompetitors: false });
		expect(result.events).toHaveLength(1);
		expect(result.events[0].name).toBe("Butterfield Bermuda Championship");
		expect(result.warnings.some((w) => w.includes("missing_competitors"))).toBe(false);
	});

	it("still drops a competition-less event even when requireCompetitors is false", () => {
		const malformed = { events: [{ name: "x", date: "2026-10-22T04:00:00Z", competitions: [] }] };
		expect(validateESPNScoreboard(malformed, "PGA Tour", { requireCompetitors: false }).events).toHaveLength(0);
	});
});
