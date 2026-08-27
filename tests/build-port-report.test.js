// WP-119: build-port-report.js — mechanical measurement of the four external-
// tester gates (coverage / amend-rate / silent stops / participant status).
// Pure-function fixtures prove green/yellow/red per port + missing-source ⇒
// "unknown" (never a silent green); integration proves the standalone CLI and
// that build-events wires it in before the manifest (which auto-covers it).
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { buildPortReport, PORT_REPORT_NAME } from "../scripts/build-port-report.js";

const NOW = Date.parse("2026-07-20T12:00:00Z");
const daysAgo = (d) => new Date(NOW - d * 86400000).toISOString();
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

function tmpDir(prefix) {
	return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("buildPortReport — topline + honesty contract", () => {
	it("all sources missing ⇒ every port is 'unknown', never a silent green", () => {
		const r = buildPortReport({}, NOW);
		expect(r.ports).toEqual({
			coverage: "unknown",
			amendRate: "unknown",
			silentStops: "unknown",
			participantStatus: "unknown",
			contracts: "unknown",
		});
		expect(r.windowDays).toBe(14);
		expect(r.generatedAt).toBe(new Date(NOW).toISOString());
		expect(r.basis).toMatchObject({
			coverageAudit: false,
			verifyLog: false,
			calibrationLedger: false,
			buildAlert: false,
			manifest: false,
			catalog: false,
		});
		expect(r.basis.notes.length).toBeGreaterThan(0);
	});

	it("never throws on empty / malformed inputs", () => {
		expect(() => buildPortReport({ coverageAudit: {}, verifyLog: {}, ledgerLines: ["not json", ""], buildAlert: {}, manifest: {} }, NOW)).not.toThrow();
	});
});

describe("port 1 · coverage", () => {
	const lowGap = { severity: "low", firstSeen: daysAgo(2), recurrences: 1, interest: "F1 hele sesongen", whatsMissing: "kvalifisering mangler" };

	it("green: only a fresh low gap", () => {
		const r = buildPortReport({ coverageAudit: { gaps: [lowGap] } }, NOW);
		expect(r.ports.coverage).toBe("green");
		expect(r.coverage.openGaps).toBe(1);
		expect(r.coverage.bySeverity).toEqual({ high: 0, medium: 0, low: 1 });
	});

	it("yellow: a medium-severity gap", () => {
		const r = buildPortReport({ coverageAudit: { gaps: [{ severity: "medium", firstSeen: daysAgo(1), recurrences: 1 }] } }, NOW);
		expect(r.ports.coverage).toBe("yellow");
	});

	it("yellow: a low gap that recurred past the escalation threshold", () => {
		const r = buildPortReport({ coverageAudit: { gaps: [{ severity: "low", firstSeen: daysAgo(3), recurrences: 3 }] } }, NOW);
		expect(r.ports.coverage).toBe("yellow");
		expect(r.coverage.escalatable).toBe(1);
	});

	it("red: any high-severity gap", () => {
		const r = buildPortReport({ coverageAudit: { gaps: [{ severity: "high", firstSeen: daysAgo(1), recurrences: 1 }, lowGap] } }, NOW);
		expect(r.ports.coverage).toBe("red");
	});

	it("unknown: no coverage-audit", () => {
		expect(buildPortReport({ verifyLog: {} }, NOW).ports.coverage).toBe("unknown");
	});

	it("cross-checks a gap against the catalog when present", () => {
		const catalog = { tier1: ["f1"], tier2: {} };
		const r = buildPortReport({ coverageAudit: { gaps: [lowGap] }, catalog }, NOW);
		expect(r.coverage.gaps[0].catalogMatched).toBe(true);
		expect(r.coverage.catalogMatched).toBe(1);
		// catalog absent ⇒ per-gap match is null, not a false claim
		const r2 = buildPortReport({ coverageAudit: { gaps: [lowGap] } }, NOW);
		expect(r2.coverage.gaps[0].catalogMatched).toBeNull();
		expect(r2.coverage.catalogMatched).toBeNull();
	});
});

describe("port 2 · amend-rate", () => {
	it("green: near-term verify amend rate ≤ 0.2", () => {
		const r = buildPortReport({ verifyLog: { runAt: hoursAgo(5), checked: 10, amended: 1 } }, NOW);
		expect(r.ports.amendRate).toBe("green");
		expect(r.amendRate.nearTermRate).toBe(0.1);
	});

	it("yellow: near-term amend rate in (0.2, 0.4]", () => {
		const r = buildPortReport({ verifyLog: { runAt: hoursAgo(5), checked: 10, amended: 3 } }, NOW);
		expect(r.ports.amendRate).toBe("yellow");
	});

	it("red: near-term amend rate > 0.4", () => {
		const r = buildPortReport({ verifyLog: { runAt: hoursAgo(5), checked: 10, amended: 6 } }, NOW);
		expect(r.ports.amendRate).toBe("red");
	});

	it("unknown: neither verify-log nor ledger", () => {
		expect(buildPortReport({ coverageAudit: { gaps: [] } }, NOW).ports.amendRate).toBe("unknown");
	});

	it("per-day trend from the ledger; provisional firm-ups are corrections, not amendments; old records fall outside the window", () => {
		const lines = [
			JSON.stringify({ checkedAt: daysAgo(2), sport: "golf", source: "pgatour.com", agreed: false }),
			JSON.stringify({ checkedAt: daysAgo(2), sport: "golf", source: "pgatour.com", agreed: true }),
			JSON.stringify({ checkedAt: daysAgo(1), sport: "cycling", source: "cyclingstage.com", agreed: false, boardWasProvisional: true }),
			JSON.stringify({ checkedAt: daysAgo(1), sport: "cycling", source: "cyclingstage.com", agreed: true }),
			JSON.stringify({ checkedAt: daysAgo(20), sport: "f1", source: "formula1.com", agreed: false }), // outside 14d window
		];
		const r = buildPortReport({ ledgerLines: lines }, NOW);
		expect(r.amendRate.windowChecks).toBe(4);
		expect(r.amendRate.windowAmendments).toBe(1);
		expect(r.amendRate.windowCorrections).toBe(1);
		expect(r.amendRate.windowRate).toBe(0.25);
		expect(r.amendRate.byDay).toHaveLength(2);
		const dayB = r.amendRate.byDay.find((d) => d.date === daysAgo(1).slice(0, 10));
		expect(dayB).toMatchObject({ checks: 2, amendments: 0, corrections: 1, rate: 0 });
		// no verify-log ⇒ port falls back to the ledger window rate (0.25 ⇒ yellow)
		expect(r.ports.amendRate).toBe("yellow");
	});

	it("verify-log near-term rate wins over the ledger window rate", () => {
		const lines = [JSON.stringify({ checkedAt: daysAgo(1), source: "x.com", agreed: false })]; // window rate 1.0
		const r = buildPortReport({ verifyLog: { runAt: hoursAgo(5), checked: 10, amended: 1 }, ledgerLines: lines }, NOW);
		expect(r.amendRate.windowRate).toBe(1);
		expect(r.amendRate.nearTermRate).toBe(0.1);
		expect(r.ports.amendRate).toBe("green");
	});
});

describe("port 3 · silent stops", () => {
	it("green: fresh ok build + fresh manifest + no stale files", () => {
		const r = buildPortReport({ buildAlert: { ok: true, checkedAt: hoursAgo(1) }, manifest: { generatedAt: hoursAgo(1), files: {} } }, NOW);
		expect(r.ports.silentStops).toBe("green");
		expect(r.silentStops.buildOk).toBe(true);
	});

	it("red: build-alert reports a degrade", () => {
		const r = buildPortReport({ buildAlert: { ok: false, checkedAt: hoursAgo(1) } }, NOW);
		expect(r.ports.silentStops).toBe("red");
	});

	it("red: build hasn't run in over a day", () => {
		const r = buildPortReport({ buildAlert: { ok: true, checkedAt: hoursAgo(30) } }, NOW);
		expect(r.ports.silentStops).toBe("red");
	});

	it("yellow: a daytime build was missed (12–26h)", () => {
		const r = buildPortReport({ buildAlert: { ok: true, checkedAt: hoursAgo(15) } }, NOW);
		expect(r.ports.silentStops).toBe("yellow");
	});

	it("yellow: a fetcher file stopped refreshing (stale sourceLastUpdated hole)", () => {
		const manifest = {
			generatedAt: hoursAgo(1),
			files: {
				"football.json": { bytes: 10, sha256: "x", sourceLastUpdated: hoursAgo(30) },
				"golf.json": { bytes: 10, sha256: "y", sourceLastUpdated: hoursAgo(1) },
				"events.json": { bytes: 10, sha256: "z" }, // no stamp ⇒ ignored
			},
		};
		const r = buildPortReport({ buildAlert: { ok: true, checkedAt: hoursAgo(1) }, manifest }, NOW);
		expect(r.ports.silentStops).toBe("yellow");
		expect(r.silentStops.staleFiles.map((f) => f.file)).toEqual(["football.json"]);
	});

	it("unknown: neither build-alert nor manifest", () => {
		expect(buildPortReport({ verifyLog: {} }, NOW).ports.silentStops).toBe("unknown");
	});
});

describe("port 4 · participant status", () => {
	it("green: verify recent + a correction (freshness working), no unresolved status", () => {
		const verifyLog = { runAt: hoursAgo(6), notes: ["Tennis Gstaad: Casper Ruud slått ut i kvartfinalen. Amendet norwegianPlayers-status til \"slått ut\" (WP-95 deltakelsessjekk)."] };
		const r = buildPortReport({ verifyLog }, NOW);
		expect(r.ports.participantStatus).toBe("green");
		expect(r.participantStatus.corrections).toBe(1);
		expect(r.participantStatus.unresolved).toBe(0);
		expect(r.participantStatus.signals).toHaveLength(1);
	});

	it("red: a participant status verify could not confirm", () => {
		const verifyLog = { runAt: hoursAgo(6), notes: ["Deltakelsessjekk: kunne ikke bekrefte om Hovland klarte cutten — kilder i konflikt."] };
		expect(buildPortReport({ verifyLog }, NOW).ports.participantStatus).toBe("red");
	});

	it("yellow: verify-log is stale (freshness guarantee lagging)", () => {
		const verifyLog = { runAt: hoursAgo(60), notes: [] };
		expect(buildPortReport({ verifyLog }, NOW).ports.participantStatus).toBe("yellow");
	});

	it("green ignores non-participant notes (e.g. streaming amendments)", () => {
		const verifyLog = { runAt: hoursAgo(6), notes: ["Amendet streaming-kanal til HBO Max for Corales.", "Ingen events fjernet."] };
		const r = buildPortReport({ verifyLog }, NOW);
		expect(r.ports.participantStatus).toBe("green");
		expect(r.participantStatus.corrections).toBe(0);
	});

	it("unknown: no verify-log", () => {
		expect(buildPortReport({ coverageAudit: { gaps: [] } }, NOW).ports.participantStatus).toBe("unknown");
	});
});

describe("integration · standalone CLI against a temp data dir", () => {
	it("reads the pipeline outputs and writes a coloured port-report.json", () => {
		const dataDir = tmpDir("ss-port-cli-");
		// The CLI evaluates freshness against the REAL clock (Date.now()), so the
		// fixtures must be relative to real-now — NOT the fixed test `NOW` — else a
		// simple calendar rollover makes fresh files look stale (green → yellow).
		const rNow = Date.now();
		const rHoursAgo = (h) => new Date(rNow - h * 3600000).toISOString();
		const rDaysAgo = (d) => new Date(rNow - d * 86400000).toISOString();
		fs.writeFileSync(path.join(dataDir, "coverage-audit.json"), JSON.stringify({ auditedAt: rHoursAgo(6), gaps: [{ severity: "high", firstSeen: rDaysAgo(2), recurrences: 1, interest: "Tour de France" }] }));
		fs.writeFileSync(path.join(dataDir, "verify-log.json"), JSON.stringify({ runAt: rHoursAgo(6), checked: 10, amended: 1, notes: [] }));
		fs.writeFileSync(path.join(dataDir, "calibration-ledger.jsonl"), [
			JSON.stringify({ checkedAt: rHoursAgo(20), source: "pgatour.com", agreed: true }),
			JSON.stringify({ checkedAt: rHoursAgo(20), source: "pgatour.com", agreed: false }),
		].join("\n") + "\n");
		fs.writeFileSync(path.join(dataDir, "build-alert.json"), JSON.stringify({ ok: true, checkedAt: rHoursAgo(1) }));
		fs.writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify({ generatedAt: rHoursAgo(1), files: {} }));
		fs.writeFileSync(path.join(dataDir, "catalog.json"), JSON.stringify({ tier1: ["cycling"], tier2: { tournaments: [{ name: "Tour de France", aliases: ["TdF"], sport: "cycling" }] } }));

		execFileSync("node", ["scripts/build-port-report.js"], { env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir } });

		const report = JSON.parse(fs.readFileSync(path.join(dataDir, PORT_REPORT_NAME), "utf-8"));
		expect(report.ports.coverage).toBe("red"); // the high gap
		expect(report.ports.amendRate).toBe("green"); // verify near-term 0.1
		expect(report.ports.silentStops).toBe("green");
		expect(report.basis).toMatchObject({ coverageAudit: true, verifyLog: true, calibrationLedger: true, buildAlert: true, manifest: true, catalog: true });
		expect(report.coverage.gaps[0].catalogMatched).toBe(true);

		fs.rmSync(dataDir, { recursive: true, force: true });
	});
});

describe("integration · build-events wires it in and the manifest covers it", () => {
	it("build-events writes port-report.json and manifest.json includes it", () => {
		const dataDir = tmpDir("ss-port-be-");
		const configDir = tmpDir("ss-port-be-cfg-");
		const env = { ...process.env, SPORTSYNC_DATA_DIR: dataDir, SPORTSYNC_CONFIG_DIR: configDir };
		const future = (d) => new Date(Date.now() + d * 86400000).toISOString();
		fs.writeFileSync(path.join(dataDir, "football.json"), JSON.stringify({ tournaments: [{ name: "Premier League", events: [{ title: "Liverpool vs Arsenal", time: future(1), homeTeam: "Liverpool", awayTeam: "Arsenal" }] }] }));
		fs.writeFileSync(path.join(configDir, "tracked.json"), JSON.stringify({ version: 1, leagues: [], athletes: [], tournaments: [], notes: [] }));

		execFileSync("node", ["scripts/build-events.js"], { env });

		const reportPath = path.join(dataDir, PORT_REPORT_NAME);
		expect(fs.existsSync(reportPath)).toBe(true);
		const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
		expect(Object.keys(report.ports).sort()).toEqual(["amendRate", "contracts", "coverage", "participantStatus", "silentStops"]);
		// build-events wrote a fresh build-alert this run ⇒ silent-stop port is assessable
		expect(report.ports.silentStops).toBe("green");

		const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, "manifest.json"), "utf-8"));
		expect(manifest.files).toHaveProperty(PORT_REPORT_NAME);

		fs.rmSync(dataDir, { recursive: true, force: true });
		fs.rmSync(configDir, { recursive: true, force: true });
	});
});

// ── Port 5 · contracts (WP-243) ─────────────────────────────────────────────
describe("port 5 · contracts", () => {
	const contract = (id, status, over = {}) => ({
		id, name: id, sport: "football", horizonDays: 14, minUpcoming: 4,
		inSeason: status !== "off-season", upcoming: status === "met" ? 8 : 1, status, ...over,
	});

	it("green when no in-season contract is breached (off-season never colours)", () => {
		const r = buildPortReport(
			{ coverageContracts: { contracts: [contract("a", "met"), contract("b", "off-season")] } },
			NOW
		);
		expect(r.ports.contracts).toBe("green");
		expect(r.contracts.total).toBe(2);
		expect(r.contracts.inSeason).toBe(1);
	});

	it("yellow at one breach, red at two", () => {
		expect(
			buildPortReport({ coverageContracts: { contracts: [contract("a", "breached"), contract("b", "met")] } }, NOW)
				.ports.contracts
		).toBe("yellow");
		const r = buildPortReport(
			{ coverageContracts: { contracts: [contract("a", "breached"), contract("b", "breached")] } },
			NOW
		);
		expect(r.ports.contracts).toBe("red");
		expect(r.contracts.breached.map((b) => b.id)).toEqual(["a", "b"]);
	});

	it("unknown (never silent green) without the artifact, with an honest basis note", () => {
		const r = buildPortReport({}, NOW);
		expect(r.ports.contracts).toBe("unknown");
		expect(r.basis.coverageContracts).toBe(false);
		expect(r.basis.notes.some((n) => n.includes("coverage-contracts"))).toBe(true);
	});
});
