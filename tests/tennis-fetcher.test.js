// tennis.js: a RUNNING multi-day tournament must survive both filters that
// silenced the fetcher for the whole US Open 2026 — the adapter's 4h raw-event
// window judged by START date, and the fallback's "skip completed" judged by
// ESPN's status alone (ESPN stamps a running tournament STATUS_FINAL after
// each finished session).
import { describe, it, expect, beforeEach } from "vitest";
import { TennisFetcher } from "../scripts/fetch/tennis.js";

function iso(daysFromNow) {
	return new Date(Date.now() + daysFromNow * 86400000).toISOString().replace(".000Z", "Z");
}

// A tournament-level scoreboard event as ESPN returns it during play: no
// top-level competitions (matches live in groupings), prematurely FINAL.
function runningTournament(overrides = {}) {
	return {
		id: "154-2026",
		name: "US Open",
		date: iso(-3),
		endDate: iso(11),
		status: { type: { name: "STATUS_FINAL" } },
		venue: { fullName: "USTA Billie Jean King National Tennis Center" },
		groupings: [
			{
				grouping: { displayName: "Men's Singles" },
				competitions: [{ competitors: [{ athlete: { displayName: "Casper Ruud" } }] }],
			},
		],
		...overrides,
	};
}

let fetcher;

beforeEach(() => {
	fetcher = new TennisFetcher();
});

describe("TennisFetcher.transformESPNEvent (tournament fallback)", () => {
	it("keeps a STATUS_FINAL tournament whose endDate is in the future", () => {
		const end = iso(11);
		const out = fetcher.transformESPNEvent(runningTournament({ endDate: end }));
		expect(out).not.toBeNull();
		expect(out.title).toBe("US Open");
		expect(out.endTime).toBe(end);
		expect(out.norwegian).toBe(true); // Ruud sits in the groupings JSON
	});

	it("drops a tournament whose endDate has passed, regardless of status", () => {
		const out = fetcher.transformESPNEvent(
			runningTournament({ date: iso(-14), endDate: iso(-1), status: { type: { name: "STATUS_IN_PROGRESS" } } })
		);
		expect(out).toBeNull();
	});

	it("still drops STATUS_FINAL when no endDate exists to judge by", () => {
		const out = fetcher.transformESPNEvent(runningTournament({ endDate: undefined }));
		expect(out).toBeNull();
	});
});

describe("raw-event window (fetchScoreboardWithLeagues)", () => {
	it("keeps a tournament that STARTED days ago but is still running (endDate-aware)", async () => {
		fetcher.apiClient.fetchJSON = async () => ({ events: [runningTournament()] });
		fetcher.apiClient.delay = async () => {};

		const raw = await fetcher.fetchScoreboardWithLeagues(fetcher.config.sources[0]);
		expect(raw.length).toBeGreaterThan(0);
		expect(raw[0].name).toBe("US Open");
	});

	it("still drops single-day events older than the 4h window", async () => {
		fetcher.apiClient.fetchJSON = async () => ({
			events: [{ name: "Old match", date: iso(-1), status: { type: { name: "STATUS_FINAL" } } }],
		});
		fetcher.apiClient.delay = async () => {};

		const raw = await fetcher.fetchScoreboardWithLeagues(fetcher.config.sources[0]);
		expect(raw).toHaveLength(0);
	});
});
