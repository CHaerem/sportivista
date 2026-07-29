#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { rootDataPath } from "./lib/helpers.js";
import { validateAgainstSchema } from "./lib/validate-schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const GRACE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — matches build-events.js day navigator history window
export const SCHEMA_PATH = path.join(__dirname, "config", "events.schema.json");

let _schemaCache = null;
/** Load (and cache) the events schema — shared by this CLI and build-events.js's pre-write gate. */
export function loadEventSchema() {
	if (!_schemaCache) _schemaCache = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));
	return _schemaCache;
}

/**
 * Core validation, pure: no filesystem writes, no process.exit. Used by this
 * CLI (validating events.json on disk) AND by build-events.js's in-process
 * pre-write gate (WP-94) — build-events runs this on the array it is ABOUT TO
 * write, before touching the file, so a schema violation can be caught and
 * degraded instead of freezing the whole hourly pipeline (see build-events.js
 * for the retain-previous-good-data + build-alert.json behaviour).
 *
 * Returns { errors, streamingMissing, streamingLandingOnly, enrichedCount, messages } — `errors` is
 * the hard-error count (a caller treats > 0 as "do not publish this array");
 * `messages` are the human-readable warn/violation lines, in the same wording
 * this script has always printed.
 */
export function validateEvents(events, eventSchema, { now = Date.now() } = {}) {
	const messages = [];
	let errors = 0;
	let streamingMissing = 0;
	let streamingLandingOnly = 0;
	const cutoff = now - GRACE_WINDOW_MS; // allow tiny grace window
	const seenKeys = new Set();
	for (const ev of events) {
		const key = ev.sport + ev.tournament + ev.title + ev.time;
		if (seenKeys.has(key)) {
			messages.push(`Duplicate event: ${key}`);
		}
		seenKeys.add(key);
		if (!ev.time) {
			messages.push(`Missing time for ${key}`);
			errors++;
			continue;
		}
		const ts = Date.parse(ev.time);
		if (isNaN(ts)) {
			messages.push(`Invalid time format for ${key} ${ev.time}`);
			errors++;
		}
		const endTs = ev.endTime ? Date.parse(ev.endTime) : ts;
		if (endTs < cutoff) {
			messages.push(`Past event found (will fail): ${key} ${ev.time}`);
			errors++;
		}
		if (!ev.title) {
			messages.push(`Missing title for ${key}`);
			errors++;
		}
		if (!ev.sport) {
			messages.push(`Missing sport for ${key}`);
			errors++;
		}
		// Validate enrichment fields if present
		if (ev.importance != null) {
			if (typeof ev.importance !== "number" || ev.importance < 1 || ev.importance > 5) {
				messages.push(`Invalid importance (must be 1-5) for ${key} ${ev.importance}`);
				errors++;
			}
		}
		if (ev.norwegianRelevance != null) {
			if (typeof ev.norwegianRelevance !== "number" || ev.norwegianRelevance < 1 || ev.norwegianRelevance > 5) {
				messages.push(`Invalid norwegianRelevance (must be 1-5) for ${key} ${ev.norwegianRelevance}`);
				errors++;
			}
		}
		if (ev.tags != null && !Array.isArray(ev.tags)) {
			messages.push(`Invalid tags (must be array) for ${key}`);
			errors++;
		}
		// AI-research contract: confidence levels and evidence requirements
		if (ev.source === "ai-research") {
			if (!["high", "medium", "low"].includes(ev.confidence)) {
				messages.push(`AI-research event missing valid confidence for ${key} ${ev.confidence}`);
				errors++;
			}
			if (ev.confidence === "high" && (!Array.isArray(ev.evidence) || ev.evidence.length < 2)) {
				messages.push(`AI-research event with high confidence needs 2+ evidence URLs for ${key}`);
				errors++;
			}
			// Streaming contract (soft): "hvor kan jeg se det" should be answered for
			// upcoming near-term events. Warning only — the research grader enforces harder.
			const ts2 = Date.parse(ev.time);
			if (!Number.isNaN(ts2) && ts2 > now - 4 * 60 * 60 * 1000 && ts2 < now + 7 * 24 * 60 * 60 * 1000) {
				if (!Array.isArray(ev.streaming) || ev.streaming.length === 0) {
					streamingMissing++;
				}
			}
		}
		// Link-honesty signal (soft, WP-246): a near-term event whose ONLY viewing URL
		// is a service landing page (front page / sport section) does not answer "hvor
		// ser jeg det" — the channel name is right, but the link is the rights map, not
		// the broadcast. Counted for EVERY source (not just ai-research: the static
		// pipeline's rights map is where most of these come from) so the gap the
		// research/verify agents must close is measurable instead of invisible.
		// Warning only — a landing URL is honest once it is labelled, just not useful.
		if (!Number.isNaN(ts) && ts > now - 4 * 60 * 60 * 1000 && ts < now + 7 * 24 * 60 * 60 * 1000) {
			const kinds = (Array.isArray(ev.streaming) ? ev.streaming : []).map((s) => s && s.urlKind);
			if (kinds.includes("landing") && !kinds.includes("deep")) streamingLandingOnly++;
		}
		// Formal schema check (scripts/config/events.schema.json) — catches shape
		// drift (wrong types, bad enums) that the ad-hoc checks above don't cover.
		const schemaErrors = validateAgainstSchema(ev, eventSchema, eventSchema);
		if (schemaErrors.length) {
			for (const msg of schemaErrors) messages.push(`Schema violation for ${key}:${msg}`);
			errors += schemaErrors.length;
		}
		// Timezone bleed check: endTime crossing midnight in CET but not UTC
		if (ev.endTime) {
			const endUTC = new Date(ev.endTime);
			const endCET = new Date(endUTC.getTime() + 3600000); // UTC+1
			const endUTCDay = endUTC.toISOString().slice(0, 10);
			const endCETDay = endCET.toISOString().slice(0, 10);
			if (endUTCDay !== endCETDay) {
				messages.push(`Timezone bleed: ${key} endTime ${ev.endTime} crosses midnight in CET (${endCETDay})`);
			}
		}
	}
	const enrichedCount = events.filter((e) => e.importance != null).length;
	return { errors, streamingMissing, streamingLandingOnly, enrichedCount, messages };
}

function main() {
	const dataDir = rootDataPath();
	const eventSchema = loadEventSchema();
	const file = path.join(dataDir, "events.json");
	if (!fs.existsSync(file)) {
		console.error("events.json not found. Run build-events.js first.");
		process.exit(1);
	}
	const raw = fs.readFileSync(file, "utf-8");
	let events;
	try {
		events = JSON.parse(raw);
	} catch (e) {
		console.error("Invalid JSON:", e.message);
		process.exit(1);
	}
	if (!Array.isArray(events)) {
		console.error("events.json root must be an array");
		process.exit(1);
	}

	const { errors, streamingMissing, streamingLandingOnly, enrichedCount, messages } = validateEvents(events, eventSchema);
	for (const m of messages) console.warn(m);
	if (streamingMissing > 0) {
		console.warn(`Streaming info missing on ${streamingMissing} near-term AI-research event(s) — "hvor kan jeg se det" unanswered.`);
	}
	if (streamingLandingOnly > 0) {
		console.warn(`Landing-page-only channel URL on ${streamingLandingOnly} near-term event(s) — the channel name is right, but the link points at a service front page, not the broadcast (WP-246).`);
	}
	console.log(`Validated ${events.length} events with ${errors} error(s). ${enrichedCount} enriched.`);
	if (errors) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main();
}
