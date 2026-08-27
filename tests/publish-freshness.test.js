// check-publish-freshness.js (WP-248): dømmer den PUBLISERTE kopien mot repoet —
// klassen feil der alt innvendig er grønt mens siden råtner offentlig.
import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
	STALE_THRESHOLD_HOURS,
	assessPublishFreshness,
	liveMetaUrl,
	checkPublishFreshness,
} from "../scripts/check-publish-freshness.js";

const T0 = "2026-08-27T10:00:00Z";
const hoursBefore = (iso, h) => new Date(Date.parse(iso) - h * 36e5).toISOString();

describe("assessPublishFreshness", () => {
	it("identical stamps are fresh with zero lag — the normal case after a healthy deploy", () => {
		expect(assessPublishFreshness(T0, T0)).toEqual({ status: "fresh", lagHours: 0 });
	});

	it("lag AT the threshold is still fresh — strictly over binds (crontab gaps are legitimate)", () => {
		expect(assessPublishFreshness(hoursBefore(T0, STALE_THRESHOLD_HOURS), T0).status).toBe("fresh");
	});

	it("lag over the threshold is stale — several missed deploys, never a single hiccup", () => {
		const r = assessPublishFreshness(hoursBefore(T0, STALE_THRESHOLD_HOURS + 1), T0);
		expect(r.status).toBe("stale");
		expect(r.lagHours).toBe(STALE_THRESHOLD_HOURS + 1);
	});

	it("the four-week August outage would have screamed", () => {
		expect(assessPublishFreshness(hoursBefore(T0, 24 * 28), T0).status).toBe("stale");
	});

	it("a live copy NEWER than the repo checkout is fresh (deploy landed mid-run)", () => {
		expect(assessPublishFreshness(T0, hoursBefore(T0, 1)).status).toBe("fresh");
	});

	it("unparsable stamps are unknown, never a guessed verdict", () => {
		expect(assessPublishFreshness("garbage", T0).status).toBe("unknown");
		expect(assessPublishFreshness(T0, undefined).status).toBe("unknown");
	});
});

describe("liveMetaUrl", () => {
	it("derives the URL from a CNAME file", () => {
		const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ss-cname-")), "CNAME");
		fs.writeFileSync(f, "sportivista.com\n");
		expect(liveMetaUrl({ cnamePath: f })).toBe("https://sportivista.com/data/meta.json");
	});

	it("returns null without a CNAME — unknown beats a guessed domain", () => {
		expect(liveMetaUrl({ cnamePath: "/nonexistent/CNAME" })).toBeNull();
	});
});

describe("checkPublishFreshness (injected fetch, network-free)", () => {
	const setup = (repoIso) => {
		const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-fresh-"));
		if (repoIso) fs.writeFileSync(path.join(dataDir, "meta.json"), JSON.stringify({ lastUpdated: repoIso }));
		return dataDir;
	};
	const readOut = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, "publish-freshness.json"), "utf-8"));
	const okFetch = (liveIso) => async () => ({ ok: true, json: async () => ({ lastUpdated: liveIso }) });

	it("writes a stale verdict when live lags the repo beyond the threshold", async () => {
		const dataDir = setup(T0);
		const r = await checkPublishFreshness({
			fetchImpl: okFetch(hoursBefore(T0, 30)),
			dataDir,
			url: "https://example.org/data/meta.json",
			now: Date.parse(T0),
		});
		expect(r.status).toBe("stale");
		expect(r.lagHours).toBe(30);
		const out = readOut(dataDir);
		expect(out.status).toBe("stale");
		expect(out.repo).toBe(T0);
	});

	it("a failing fetch is unknown with a note — the probe's own luck never alarms", async () => {
		const dataDir = setup(T0);
		const r = await checkPublishFreshness({
			fetchImpl: async () => {
				throw new Error("ECONNREFUSED");
			},
			dataDir,
			url: "https://example.org/data/meta.json",
		});
		expect(r.status).toBe("unknown");
		expect(r.note).toContain("ECONNREFUSED");
		expect(readOut(dataDir).status).toBe("unknown"); // fila skrives uansett — historikken er signalet
	});

	it("a non-OK response is unknown with the HTTP status noted", async () => {
		const dataDir = setup(T0);
		const r = await checkPublishFreshness({
			fetchImpl: async () => ({ ok: false, status: 503 }),
			dataDir,
			url: "https://example.org/data/meta.json",
		});
		expect(r.status).toBe("unknown");
		expect(r.note).toContain("503");
	});

	it("missing repo meta.json is unknown (first run / sandbox), file still written", async () => {
		const dataDir = setup(null);
		const r = await checkPublishFreshness({ fetchImpl: okFetch(T0), dataDir, url: "https://example.org/x" });
		expect(r.status).toBe("unknown");
		expect(readOut(dataDir).note).toContain("meta.json");
	});

	it("no URL (no CNAME) is unknown and never fetches", async () => {
		const dataDir = setup(T0);
		let fetched = false;
		const r = await checkPublishFreshness({
			fetchImpl: async () => {
				fetched = true;
			},
			dataDir,
			url: null,
		});
		expect(r.status).toBe("unknown");
		expect(fetched).toBe(false);
		expect(r.note).toContain("CNAME");
	});
});
