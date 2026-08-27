#!/usr/bin/env node
/**
 * WP-119 · Portmåling-artefakt. Mechanises the four gates that decide whether
 * Sportivista is ready for external TestFlight testers — the gates that were,
 * until now, measured by hand ("vibes"):
 *
 *   1. coverage           — null tapte fulgte events
 *   2. amendRate          — amend-rate on near-term events ≈ 0
 *   3. silentStops        — null stille kritiske stopp
 *   4. participantStatus  — null feilaktige deltaker-statuser
 *   5. contracts          — dekningskontraktene holdt (WP-243, G2-føde)
 *
 * Reads the pipeline's own outputs (coverage-audit.json, verify-log.json,
 * calibration-ledger.jsonl, build-alert.json, manifest.json, catalog.json),
 * aggregates over a rolling ~14-day window, and writes:
 *
 *   docs/data/port-report.json
 *
 * Run as the last content step of build-events.js (before writeManifest, so the
 * manifest covers it) — NOT a new workflow step, because .github/workflows/** is
 * a protected path. Also runnable standalone (reads SPORTSYNC_DATA_DIR).
 *
 * HONESTY CONTRACT: a port is only coloured (green/yellow/red) when the sources
 * it depends on are present. When a source is missing the port reports "unknown"
 * — NEVER a silent green — and the reason is recorded in `basis.notes`. Every
 * read is fail-soft: a missing/empty/corrupt source degrades that port to
 * "unknown" and never throws.
 *
 * NB on history depth: only the calibration ledger carries genuine per-day
 * history (one timestamped record per source check), so `amendRate.byDay` is the
 * real per-day dimension. coverage-audit gaps carry age (`firstSeen`); verify-log,
 * build-alert and manifest are latest-snapshot only. The `basis` block is honest
 * about this rather than pretending to a 14-day depth the data can't back.
 *
 * No LLM here — pure aggregation. Agents / the owner interpret the report.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { rootDataPath, configDirPath, readJsonIfExists, iso, MS_PER_HOUR, MS_PER_DAY } from "./lib/helpers.js";

export const PORT_REPORT_NAME = "port-report.json";
export const WINDOW_DAYS = 14;

// ── Thresholds (constants so tests can target them) ─────────────────────────
// Port 1 · coverage: a low gap that has recurred this many times is the audit's
// own escalation trigger (coverage-critic bumps low→medium at >=3); an open gap
// older than this many days is stale enough to matter.
const GAP_ESCALATE_RECURRENCES = 3;
const GAP_STALE_DAYS = 14;
// Port 2 · amend-rate: near 0 is the goal. Verify amends a couple per ~10 near-term
// checks in healthy operation (~0.2), so that is the green ceiling.
const AMEND_GREEN = 0.2;
const AMEND_YELLOW = 0.4;
// Port 3 · silent stops: the static pipeline runs hourly 05–21 UTC, so the
// longest legitimate quiet gap is the ~8h overnight window. A daytime build miss
// shows as >12h; more than a full day-cycle (>26h) is a real stop. A fetcher file
// that hasn't refreshed in >26h is a stale hole even while the pipeline runs.
const STALE_YELLOW_HOURS = 12;
const STALE_RED_HOURS = 26;
const STALE_FILE_HOURS = 26;
// Port 4 · participant status: verify runs daily, so a verify-log older than this
// means the freshness guarantee is lagging and statuses may be rotting.
const VERIFY_STALE_HOURS = 48;

const COLORS = { green: 0, yellow: 1, red: 2 };
function worst(a, b) {
	return COLORS[a] >= COLORS[b] ? a : b;
}
function round2(n) {
	return Math.round(n * 100) / 100;
}
function ageHours(ts, now) {
	const t = Date.parse(ts);
	if (!Number.isFinite(t)) return null;
	return round2((now - t) / MS_PER_HOUR);
}
function dayKey(ts) {
	const t = Date.parse(ts);
	if (!Number.isFinite(t)) return null;
	return new Date(t).toISOString().slice(0, 10);
}

// ── Port 4 heuristics · verify-log notes about participant statuses ─────────
// A verify note touches participant status when it names a participant-status
// concept. Among those, an "unresolved" note (verify could not confirm / sources
// conflict) is the real failure; a plain correction is the WP-95 freshness
// mechanism WORKING (reality moved — a cut, a withdrawal — and verify updated it),
// so corrections are reported but do NOT redden the port.
const PARTICIPANT_STRONG = /wp-95|deltakelsessjekk|deltaker-?status|participation[- ]?status/i;
const PARTICIPANT_TOKEN = /norwegianplayers|\bdeltaker|deltakelse|startliste|\bcut\b|cutten|røk cutten|misset? cut|slått ut|trukket seg|trakk seg|trekning|withdrew|withdrawn|did not start|\bdns\b/i;
const PARTICIPANT_UNRESOLVED = /kunne ikke (bekreft|verifis)|ikke bekreftet|uklar|konflikt|motstrid|uenig|unresolved|unable to (confirm|verify)|mismatch|feil status/i;

function isParticipantNote(note) {
	return PARTICIPANT_STRONG.test(note) || PARTICIPANT_TOKEN.test(note);
}

// ── Port 1 · coverage ───────────────────────────────────────────────────────
function catalogTerms(catalog) {
	const terms = new Set();
	for (const s of catalog?.tier1 || []) if (s) terms.add(String(s).toLowerCase());
	const buckets = catalog?.tier2 || {};
	for (const bucket of Object.values(buckets)) {
		if (!Array.isArray(bucket)) continue;
		for (const e of bucket) {
			if (e?.name) terms.add(String(e.name).toLowerCase());
			for (const a of e?.aliases || []) if (a) terms.add(String(a).toLowerCase());
			if (e?.sport) terms.add(String(e.sport).toLowerCase());
		}
	}
	return terms;
}

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function gapMatchesCatalog(gap, terms) {
	if (!terms || !terms.size) return null; // catalog unavailable ⇒ can't cross-check
	const hay = `${gap?.interest || ""} ${gap?.whatsMissing || ""}`.toLowerCase();
	for (const t of terms) {
		if (t.length < 2) continue; // skip single-char terms (substring noise); "f1", "g2" etc. kept
		// Word-boundary match, not naive substring — "ao" (Australian Open alias)
		// must not match inside "kanoår"; "f1" must match "f1 hele sesongen".
		if (new RegExp(`\\b${escapeRegExp(t)}\\b`, "i").test(hay)) return true;
	}
	return false;
}

function assessCoverage(auditRaw, catalog, now) {
	if (!auditRaw || !Array.isArray(auditRaw.gaps)) {
		return { status: "unknown", detail: null, available: false };
	}
	const terms = catalogTerms(catalog);
	const bySeverity = { high: 0, medium: 0, low: 0 };
	let oldestAgeDays = null;
	let escalatable = 0;
	let catalogMatched = 0;
	const gaps = [];
	for (const g of auditRaw.gaps) {
		const sev = ["high", "medium", "low"].includes(g?.severity) ? g.severity : "low";
		bySeverity[sev]++;
		const seen = Date.parse(g?.firstSeen);
		const ageD = Number.isFinite(seen) ? round2((now - seen) / MS_PER_DAY) : null;
		if (ageD != null && (oldestAgeDays == null || ageD > oldestAgeDays)) oldestAgeDays = ageD;
		const recurrences = Number.isFinite(g?.recurrences) ? g.recurrences : 0;
		const aged = ageD != null && ageD >= GAP_STALE_DAYS;
		if (recurrences >= GAP_ESCALATE_RECURRENCES || aged) escalatable++;
		const matched = gapMatchesCatalog(g, terms);
		if (matched === true) catalogMatched++;
		gaps.push({
			interest: g?.interest || null,
			severity: sev,
			ageDays: ageD,
			recurrences,
			catalogMatched: matched,
		});
	}
	let status = "green";
	if (bySeverity.high > 0) status = "red";
	else if (bySeverity.medium > 0 || escalatable > 0) status = "yellow";
	return {
		status,
		available: true,
		detail: {
			openGaps: auditRaw.gaps.length,
			bySeverity,
			oldestGapAgeDays: oldestAgeDays,
			escalatable,
			catalogMatched: terms.size ? catalogMatched : null,
			auditedAt: auditRaw.auditedAt || null,
			gaps,
		},
	};
}

// ── Port 2 · amend-rate on near-term events ─────────────────────────────────
function assessAmendRate(verifyLog, ledgerLines, now) {
	const haveVerify = verifyLog && typeof verifyLog === "object";
	const haveLedger = Array.isArray(ledgerLines) && ledgerLines.length > 0;
	if (!haveVerify && !haveLedger) {
		return { status: "unknown", detail: null, available: false };
	}

	// Per-day trend from the ledger (the only genuinely per-day source). A
	// boardWasProvisional firm-up is the source correcting an estimate — NOT a
	// board error (WP-93) — so it is tracked as a `correction`, not an amendment.
	const cutoff = now - WINDOW_DAYS * MS_PER_DAY;
	const byDayMap = new Map();
	let windowChecks = 0;
	let windowAmendments = 0;
	let windowCorrections = 0;
	if (haveLedger) {
		for (const line of ledgerLines) {
			let rec;
			try {
				rec = JSON.parse(line);
			} catch {
				continue;
			}
			if (!rec || typeof rec.agreed !== "boolean") continue;
			const t = Date.parse(rec.checkedAt);
			if (!Number.isFinite(t) || t < cutoff) continue;
			const key = dayKey(rec.checkedAt);
			if (!key) continue;
			const corrected = rec.agreed === false && rec.boardWasProvisional === true;
			const amended = rec.agreed === false && !corrected;
			if (!byDayMap.has(key)) byDayMap.set(key, { date: key, checks: 0, amendments: 0, corrections: 0 });
			const d = byDayMap.get(key);
			d.checks++;
			windowChecks++;
			if (amended) {
				d.amendments++;
				windowAmendments++;
			}
			if (corrected) {
				d.corrections++;
				windowCorrections++;
			}
		}
	}
	const byDay = [...byDayMap.values()]
		.sort((a, b) => a.date.localeCompare(b.date))
		.map((d) => ({ ...d, rate: d.checks ? round2(d.amendments / d.checks) : null }));
	const windowRate = windowChecks ? round2(windowAmendments / windowChecks) : null;

	// Near-term rate: verify.md scopes its run to events in the next ~7 days, so
	// verify-log's amended/checked IS the near-term amend rate the port cares about
	// (the ledger doesn't record an event's lead time, so <72h can't be filtered
	// from it — see basis.notes). Prefer it; fall back to the ledger window rate.
	let nearTermRate = null;
	let nearTermChecked = null;
	let nearTermAmended = null;
	if (haveVerify && Number.isFinite(verifyLog.checked) && verifyLog.checked > 0) {
		nearTermChecked = verifyLog.checked;
		nearTermAmended = Number.isFinite(verifyLog.amended) ? verifyLog.amended : 0;
		nearTermRate = round2(nearTermAmended / nearTermChecked);
	}

	const rate = nearTermRate != null ? nearTermRate : windowRate;
	let status;
	if (rate == null) status = "unknown"; // sources present but no usable numbers yet
	else if (rate <= AMEND_GREEN) status = "green";
	else if (rate <= AMEND_YELLOW) status = "yellow";
	else status = "red";

	return {
		status,
		available: true,
		detail: {
			nearTermRate,
			nearTermChecked,
			nearTermAmended,
			verifyRunAt: haveVerify ? verifyLog.runAt || null : null,
			windowRate,
			windowChecks,
			windowAmendments,
			windowCorrections,
			byDay,
		},
	};
}

// ── Port 3 · silent stops ────────────────────────────────────────────────────
function assessSilentStops(buildAlert, manifest, now) {
	const haveAlert = buildAlert && typeof buildAlert === "object";
	const haveManifest = manifest && typeof manifest === "object";
	if (!haveAlert && !haveManifest) {
		return { status: "unknown", detail: null, available: false };
	}
	let status = "green";
	const detail = {
		buildOk: null,
		buildCheckedAt: null,
		buildAgeHours: null,
		manifestGeneratedAt: null,
		manifestAgeHours: null,
		staleFiles: [],
	};

	if (haveAlert) {
		detail.buildOk = buildAlert.ok === true ? true : buildAlert.ok === false ? false : null;
		detail.buildCheckedAt = buildAlert.checkedAt || null;
		detail.buildAgeHours = ageHours(buildAlert.checkedAt, now);
		if (detail.buildOk === false) status = worst(status, "red"); // a recorded degrade-gate trip
		if (detail.buildAgeHours != null) {
			if (detail.buildAgeHours > STALE_RED_HOURS) status = worst(status, "red");
			else if (detail.buildAgeHours > STALE_YELLOW_HOURS) status = worst(status, "yellow");
		}
	}

	if (haveManifest) {
		detail.manifestGeneratedAt = manifest.generatedAt || null;
		detail.manifestAgeHours = ageHours(manifest.generatedAt, now);
		if (detail.manifestAgeHours != null) {
			if (detail.manifestAgeHours > STALE_RED_HOURS) status = worst(status, "red");
			else if (detail.manifestAgeHours > STALE_YELLOW_HOURS) status = worst(status, "yellow");
		}
		const files = manifest.files && typeof manifest.files === "object" ? manifest.files : {};
		for (const [name, entry] of Object.entries(files)) {
			const stamp = entry && entry.sourceLastUpdated;
			if (!stamp) continue; // only fetcher files carry a freshness stamp
			const age = ageHours(stamp, now);
			if (age != null && age > STALE_FILE_HOURS) {
				detail.staleFiles.push({ file: name, sourceLastUpdated: stamp, ageHours: age });
			}
		}
		if (detail.staleFiles.length) status = worst(status, "yellow");
	}

	return { status, available: true, detail };
}

// ── Port 4 · participant status ──────────────────────────────────────────────
function assessParticipantStatus(verifyLog, now) {
	if (!verifyLog || typeof verifyLog !== "object") {
		return { status: "unknown", detail: null, available: false };
	}
	const notes = Array.isArray(verifyLog.notes) ? verifyLog.notes.map(String) : [];
	let corrections = 0;
	let unresolved = 0;
	const signals = [];
	for (const note of notes) {
		if (!isParticipantNote(note)) continue;
		const isUnresolved = PARTICIPANT_UNRESOLVED.test(note);
		if (isUnresolved) unresolved++;
		else corrections++;
		signals.push(note.length > 160 ? note.slice(0, 157) + "…" : note);
	}
	const verifyAge = ageHours(verifyLog.runAt, now);
	let status = "green";
	if (unresolved > 0) status = "red"; // a status verify could not confirm is the real failure
	else if (verifyAge == null || verifyAge > VERIFY_STALE_HOURS) status = "yellow"; // freshness lagging
	return {
		status,
		available: true,
		detail: { checkedAt: verifyLog.runAt || null, verifyAgeHours: verifyAge, corrections, unresolved, signals },
	};
}

/**
 * Pure aggregator. Takes already-parsed inputs (null / [] for missing sources)
 * and never throws. Returns the full port-report object.
 */
// ── Port 5 · contracts (WP-243) ─────────────────────────────────────────────
// The coverage-contract verdicts from coverage-contracts.json (written by
// build-events from authority.json's contract blocks): green = no in-season
// contract breached, yellow = one, red = two or more. Off-season contracts
// never colour the port. Unknown (never silent green) when the artifact is
// absent — e.g. before the first contracted build.
function assessContractsPort(contractReport) {
	if (!contractReport || !Array.isArray(contractReport.contracts) || contractReport.contracts.length === 0) {
		return { status: "unknown", detail: null, available: false };
	}
	const contracts = contractReport.contracts;
	const breached = contracts.filter((c) => c.status === "breached");
	const status = breached.length === 0 ? "green" : breached.length === 1 ? "yellow" : "red";
	return {
		status,
		available: true,
		detail: {
			total: contracts.length,
			inSeason: contracts.filter((c) => c.inSeason).length,
			breached: breached.map((c) => ({ id: c.id, name: c.name, upcoming: c.upcoming, minUpcoming: c.minUpcoming, horizonDays: c.horizonDays })),
			generatedAt: contractReport.generatedAt || null,
		},
	};
}

export function buildPortReport(inputs = {}, now = Date.now()) {
	const { coverageAudit = null, verifyLog = null, ledgerLines = [], buildAlert = null, manifest = null, catalog = null, coverageContracts = null } = inputs;

	const coverage = assessCoverage(coverageAudit, catalog, now);
	const amendRate = assessAmendRate(verifyLog, ledgerLines, now);
	const silentStops = assessSilentStops(buildAlert, manifest, now);
	const participantStatus = assessParticipantStatus(verifyLog, now);
	const contracts = assessContractsPort(coverageContracts);

	const basis = {
		coverageAudit: coverage.available,
		verifyLog: verifyLog != null,
		calibrationLedger: Array.isArray(ledgerLines) && ledgerLines.length > 0,
		buildAlert: buildAlert != null,
		manifest: manifest != null,
		catalog: catalog != null,
		notes: [],
	};
	if (!basis.coverageAudit) basis.notes.push("coverage-audit.json unavailable — coverage-porten er «ukjent», ikke grønn.");
	if (!basis.verifyLog) basis.notes.push("verify-log.json unavailable — amend-rate + deltaker-status mangler sin primærkilde.");
	if (!basis.calibrationLedger) basis.notes.push("calibration-ledger.jsonl unavailable/empty — ingen per-dag amend-trend.");
	if (!basis.buildAlert && !basis.manifest) basis.notes.push("build-alert.json + manifest.json unavailable — stille-stopp-porten er «ukjent».");
	if (!basis.catalog) basis.notes.push("catalog.json unavailable — coverage-gaps krysssjekkes ikke mot katalogen (severity/alder brukes fortsatt).");
	basis.coverageContracts = contracts.available;
	if (!basis.coverageContracts) basis.notes.push("coverage-contracts.json unavailable — contracts-porten (WP-243) er «ukjent», ikke grønn.");
	// Honest scope caveat: the ledger doesn't record an event's lead time, so the
	// <72h near-term filter is applied via verify-log's next-7-day scope, not the ledger.
	if (basis.calibrationLedger) basis.notes.push("amendRate.byDay dekker ALLE verify-kildesjekker (ledgeren registrerer ikke event-ledetid, så <72t-filteret kommer fra verify-log sitt neste-7-dager-omfang).");

	return {
		generatedAt: iso(now),
		windowDays: WINDOW_DAYS,
		ports: {
			coverage: coverage.status,
			amendRate: amendRate.status,
			silentStops: silentStops.status,
			participantStatus: participantStatus.status,
			contracts: contracts.status,
		},
		basis,
		coverage: coverage.detail,
		amendRate: amendRate.detail,
		silentStops: silentStops.detail,
		participantStatus: participantStatus.detail,
		contracts: contracts.detail,
	};
}

/** Read the pipeline's outputs from disk, build the report, write it. Fail-soft. */
export function writePortReport(dataDir = rootDataPath(), configDir = configDirPath(), now = Date.now()) {
	const ledgerPath = path.join(dataDir, "calibration-ledger.jsonl");
	let ledgerLines = [];
	try {
		if (fs.existsSync(ledgerPath)) {
			ledgerLines = fs.readFileSync(ledgerPath, "utf-8").split("\n").filter(Boolean);
		}
	} catch {
		ledgerLines = [];
	}
	// catalog: prefer the copy already published to dataDir this build, fall back
	// to the source config (standalone runs before a publish).
	const catalog = readJsonIfExists(path.join(dataDir, "catalog.json")) || readJsonIfExists(path.join(configDir, "catalog.json"));

	const report = buildPortReport(
		{
			coverageAudit: readJsonIfExists(path.join(dataDir, "coverage-audit.json")),
			verifyLog: readJsonIfExists(path.join(dataDir, "verify-log.json")),
			ledgerLines,
			buildAlert: readJsonIfExists(path.join(dataDir, "build-alert.json")),
			manifest: readJsonIfExists(path.join(dataDir, "manifest.json")),
			catalog,
			coverageContracts: readJsonIfExists(path.join(dataDir, "coverage-contracts.json")),
		},
		now
	);
	fs.writeFileSync(path.join(dataDir, PORT_REPORT_NAME), JSON.stringify(report, null, 2));
	return report;
}

function main() {
	const report = writePortReport();
	const p = report.ports;
	console.log(
		`Port-report: coverage=${p.coverage} amendRate=${p.amendRate} silentStops=${p.silentStops} participantStatus=${p.participantStatus} contracts=${p.contracts} (window ${report.windowDays}d)`
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main();
}
