// validate-events.js: catches malformed events, enforces the AI-research contract.
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

function runValidate(events) {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-validate-"));
	fs.writeFileSync(path.join(dataDir, "events.json"), JSON.stringify(events));
	let exitCode = 0;
	try {
		execFileSync("node", ["scripts/validate-events.js"], {
			env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir },
			stdio: "pipe",
		});
	} catch (err) {
		exitCode = err.status;
	}
	fs.rmSync(dataDir, { recursive: true, force: true });
	return exitCode;
}

const future = new Date(Date.now() + 86400000).toISOString();

describe("validate-events", () => {
	it("passes valid events", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: future }])).toBe(0);
	});

	it("fails on missing time", () => {
		expect(runValidate([{ sport: "golf", title: "Open" }])).toBe(1);
	});

	it("fails on invalid time format", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: "not-a-date" }])).toBe(1);
	});

	it("fails on out-of-range importance", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: future, importance: 9 }])).toBe(1);
	});

	it("fails on ai-research event without valid confidence", () => {
		expect(runValidate([{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research" }])).toBe(1);
	});

	it("fails on high-confidence ai-research event with fewer than 2 evidence URLs", () => {
		expect(
			runValidate([{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research", confidence: "high", evidence: ["https://a.no"] }])
		).toBe(1);
	});

	it("passes high-confidence ai-research event with 2+ evidence URLs", () => {
		expect(
			runValidate([
				{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research", confidence: "high", evidence: ["https://a.no", "https://b.no"] },
			])
		).toBe(0);
	});
});

// ── WP-246: the landing-page gap must be COUNTED, not invisible ─────────────

import { validateEvents, loadEventSchema } from "../scripts/validate-events.js";

describe("landing-page-only channel URLs are a counted warning (WP-246)", () => {
	const schema = loadEventSchema();
	const soon = new Date(Date.now() + 2 * 86400000).toISOString();
	const farOut = new Date(Date.now() + 30 * 86400000).toISOString();
	const check = (events) => validateEvents(events, schema);

	it("counts a near-term event whose only channel URL is a service front page", () => {
		const r = check([
			{ sport: "football", title: "Brann – Rosenborg", time: soon, streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }] },
		]);
		expect(r.streamingLandingOnly).toBe(1);
		expect(r.errors).toBe(0); // a warning, never a build-breaking error
	});
	it("does NOT count an event that has a real deep link alongside the landing one", () => {
		const r = check([
			{
				sport: "cycling", title: "Etappe 5", time: soon,
				streaming: [
					{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" },
					{ platform: "TV 2 Play", url: "https://play.tv2.no/sport/sykkel/arctic-race-of-norway", urlKind: "deep" },
				],
			},
		]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("does NOT count a channel with no URL at all — that is a different (already honest) gap", () => {
		const r = check([{ sport: "chess", title: "Runde 3", time: soon, streaming: [{ platform: "Chess.com" }] }]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("only looks at the near term (the next 7 days), like the streaming-missing warning", () => {
		const r = check([
			{ sport: "football", title: "Langt frem", time: farOut, streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }] },
		]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("counts static-pipeline events too, not just ai-research (that is where most of them come from)", () => {
		const landing = { platform: "Viaplay", url: "https://viaplay.no/no-no/sport", urlKind: "landing" };
		const r = check([
			{ sport: "f1", title: "Belgian GP", time: soon, streaming: [landing] },
			{ sport: "football", title: "Brann – Molde", time: soon, streaming: [landing], source: "ai-research", confidence: "medium" },
		]);
		expect(r.streamingLandingOnly).toBe(2);
		expect(r.errors).toBe(0);
	});
	it("accepts urlKind through the formal schema (no shape drift, backward compatible without it)", () => {
		const r = check([
			{ sport: "f1", title: "Med felt", time: soon, streaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport", urlKind: "landing" }] },
			{ sport: "f1", title: "Uten felt", time: soon, streaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport" }] },
		]);
		expect(r.errors).toBe(0);
		expect(check([{ sport: "f1", title: "Ugyldig", time: soon, streaming: [{ platform: "Viaplay", urlKind: "kanskje" }] }]).errors).toBeGreaterThan(0);
	});
});
