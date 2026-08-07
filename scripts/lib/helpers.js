import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import zlib from "zlib";
import { USER_AGENT } from "./api-client.js";

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function iso(d = Date.now()) {
	return new Date(d).toISOString();
}

/** UTC calendar date as "YYYYMMDD" — the format ESPN's ?dates= parameter takes. */
export function yyyymmdd(d = Date.now()) {
	return new Date(d).toISOString().slice(0, 10).replace(/-/g, "");
}

/** The next `days` UTC dates (starting today) as yyyymmdd strings for ESPN ?dates=. */
export function espnDateRange(days) {
	const now = Date.now();
	return Array.from({ length: days }, (_, i) => yyyymmdd(now + i * MS_PER_DAY));
}

/**
 * Check if an event overlaps with a time window.
 * Handles multi-day events (endTime) and single-point events uniformly.
 * An event overlaps [windowStart, windowEnd) if it starts before the window
 * ends AND it ends at or after the window starts.
 */
export function isEventInWindow(event, windowStart, windowEnd) {
	if (!event?.time) return false;
	const start = new Date(event.time).getTime();
	const end = event.endTime ? new Date(event.endTime).getTime() : start;
	const ws = windowStart instanceof Date ? windowStart.getTime() : windowStart;
	const we = windowEnd instanceof Date ? windowEnd.getTime() : windowEnd;
	return start < we && end >= ws;
}

// --- Interest entity matching (shared, deterministic) ---
// alwaysTrack entries may be a bare string OR { name, aliases, sport, notify }.
// normalizeEntity upgrades either into a uniform shape so a stray string never
// crashes the pipeline. matchInterest is the ONE matcher used everywhere
// (fetchers, results, coverage gaps, relevance filter, must-watch/notify) so a
// name is matched the same way in every code path — same input, same output.

/** Lowercase + strip diacritics so "Barça" and "Barca" compare equal. */
export function normalizeText(s) {
	return (s || "")
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase();
}

// The boundary regex is a pure function of the (normalized) needle, so memoize it:
// containsName is the hottest path in the hourly build — tens of thousands of calls
// via findEntityId / detect-coverage-gaps / lib/news — and rebuilding the RegExp on
// every call dominated that cost. The needle set is bounded (tracked/catalog entities
// plus a handful of markers), so the cache stays small; no eviction needed. The regex
// carries no `g` flag, so `.test()` is stateless and the cached instance is reusable.
const NAME_REGEX_CACHE = new Map();

/**
 * Word-boundary, accent-insensitive containment. "Lyn" matches "Lyn Oslo" and
 * "Vålerenga-Lyn" but NOT "Brooklyn"/"lynnedslag" — boundaries kill the class of
 * false positive that plain substring matching produces.
 */
export function containsName(haystack, name) {
	const n = normalizeText(name).trim();
	if (!n) return false;
	const h = normalizeText(haystack);
	let re = NAME_REGEX_CACHE.get(n);
	if (!re) {
		const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped}(?:[^\\p{L}\\p{N}]|$)`, "iu");
		NAME_REGEX_CACHE.set(n, re);
	}
	return re.test(h);
}

/**
 * Coerce an alwaysTrack entry into { name, aliases, sport, notify }.
 * Accepts a bare string (defensive: never crash) or an object; returns null for
 * anything without a usable name. `defaultNotify` sets `notify` when the entry
 * doesn't specify it (teams/athletes default true, tournaments false).
 */
export function normalizeEntity(entry, { defaultNotify = true } = {}) {
	if (typeof entry === "string") {
		const name = entry.trim();
		return name ? { name, aliases: [], sport: null, notify: defaultNotify } : null;
	}
	if (entry && typeof entry === "object" && entry.name) {
		return {
			name: entry.name,
			aliases: Array.isArray(entry.aliases) ? entry.aliases.filter(Boolean) : [],
			sport: entry.sport || null,
			notify: entry.notify != null ? Boolean(entry.notify) : defaultNotify,
		};
	}
	return null;
}

/** Every string an entity can be recognised by: its name plus all aliases. */
export function entityTerms(entity) {
	return entity ? [entity.name, ...(entity.aliases || [])].filter(Boolean) : [];
}

/** Does `haystack` mention this entity (by canonical name or any alias)? */
export function matchesEntity(haystack, entity) {
	return entityTerms(entity).some((term) => containsName(haystack, term));
}

/**
 * Return the first entity whose name/alias appears in `haystack`, else null.
 * `entries` may hold bare strings or objects (normalized defensively). Pass
 * `opts.sport` to skip entities tagged to a different sport (a golf "US Open"
 * entity won't match a tennis event).
 */
export function matchInterest(haystack, entries, opts = {}) {
	const { sport } = opts;
	for (const raw of entries || []) {
		const e = normalizeEntity(raw, opts);
		if (!e) continue;
		if (sport && e.sport && normalizeText(e.sport) !== normalizeText(sport)) continue;
		if (matchesEntity(haystack, e)) return e;
	}
	return null;
}

/**
 * The tracked entities that should trigger a reminder/alarm ("must-watch").
 * Teams + athletes alarm by default; tournaments only when notify:true — so
 * following "Premier League" broadly doesn't alarm on every match, but Liverpool
 * (a followed team) or F1 (a tournament flagged notify:true) does. This keys ONLY
 * off the user-owned interests.json — never off an event's own isFavorite/importance
 * (which the AI can write), so what interrupts the user stays user-governed.
 */
export function notifyEntities(interests) {
	const at = interests?.alwaysTrack || {};
	const out = [];
	for (const raw of [...(at.teams || []), ...(at.athletes || [])]) {
		const e = normalizeEntity(raw, { defaultNotify: true });
		if (e && e.notify) out.push(e);
	}
	for (const raw of at.tournaments || []) {
		const e = normalizeEntity(raw, { defaultNotify: false });
		if (e && e.notify) out.push(e);
	}
	return out;
}

/** Which notify-entity (if any) makes this event a must-watch — else null. */
export function mustWatchEntity(event, interests) {
	if (!event) return null;
	// Same participant haystack the coverage gate scans (title + tournament +
	// home/away + Norwegian players + participants, venue excluded) — kept as the
	// single canonical builder so the two can't drift (WP-130).
	const hay = coverageHaystack(event);
	// Sport-scope so a sport-tagged entity (e.g. FC Barcelona) can't match a
	// different sport's event that merely mentions the name (a Tour de France
	// stage in the city of Barcelona). Untagged entities/events still match freely.
	return matchInterest(hay, notifyEntities(interests), { sport: event.sport });
}

// --- Server coverage gate (WP-96 / WP-110) ---
// "Does Sportivista COVER this event?" — the server-scope filter keyed off
// catalog.json ("hva vi DEKKER", never one person's follows). Extracted here
// (WP-110) so build-events.js (the board filter) and detect-coverage-gaps.js (its
// dropped-in-build anomaly) ask the EXACT same question and cannot drift: an event
// the catalog never covers is a legitimate build drop, not a "source dropped it"
// anomaly — that drift is exactly what produced the chronic "Sant Martí" chess
// HIGH false positive. See build-events.js + tests/build-events.test.js.

/** Sports covered WHOLESALE by default when catalog.tier1 is absent (tests, first build). */
export const DEFAULT_TIER1_SPORTS = ["football", "golf", "f1", "cycling", "biathlon", "cross-country", "alpine", "nordic", "ski jumping"];

/**
 * Sports covered ONLY through the named catalog long-tail, never wholesale: a
 * SPORT-SCOPED catalog-entity match is required — the norwegian / favorite /
 * importance / ai-research shortcuts do NOT apply. Without this a minor open with a
 * lone Norwegian club player (the "Sant Martí" case) or a CS2 match between two
 * uncovered teams slips through, because such events are often norwegian:true or
 * arrive as source:"ai-research".
 */
export const ENTITY_GATED_SPORTS = new Set(["chess", "esports"]);

/**
 * The haystack the coverage matcher scans: title + tournament + home/away +
 * Norwegian players + participants. Deliberately excludes venue (mirrors
 * mustWatchEntity, so a chess event in the CITY of Barcelona doesn't match the
 * football club).
 */
export function coverageHaystack(e) {
	return [e.title, e.tournament, e.homeTeam, e.awayTeam,
		...((e.norwegianPlayers || []).map((p) => p?.name || p)),
		...((e.participants || []).map((p) => p?.name || p))].join(" ");
}

/**
 * Build the server coverage gate from catalog.json: returns `isCovered(event)`.
 *   (1) wholesale-covered sport (tier1) → in, checked first so it wins over the gate;
 *   (2) entity-gated sport (chess/esports) → only a SPORT-SCOPED catalog-entity match
 *       admits it (sport-scoping stops a cross-sport entity — a chess event in the
 *       city of Barcelona must not match the football club "Barcelona");
 *   (3) any other non-broad sport (e.g. tennis) → a Norwegian / favorite /
 *       high-importance (≥4) event stays; ai-research is NOT a blanket pass on its own;
 *   (4) else an UNSCOPED catalog-entity match.
 */
export function makeCoverageGate(catalog = {}) {
	const coveredBroadly = new Set((catalog?.tier1 || DEFAULT_TIER1_SPORTS).map((s) => s.toLowerCase()));
	const catalogEntities = [
		...(catalog?.tier2?.teams || []),
		...(catalog?.tier2?.athletes || []),
		...(catalog?.tier2?.tournaments || []),
	];
	return function isCovered(e) {
		const sport = (e.sport || "").toLowerCase();
		if (coveredBroadly.has(sport)) return true;
		const hay = coverageHaystack(e);
		if (ENTITY_GATED_SPORTS.has(sport)) {
			return matchInterest(hay, catalogEntities, { sport: e.sport }) != null;
		}
		if (e.norwegian || e.isFavorite || (e.importance || 0) >= 4) return true;
		return matchInterest(hay, catalogEntities) != null;
	};
}

// --- Participation normalization (WP-04) ---
// Canonical form, enforced everywhere in the pipeline: `norwegianPlayers` and
// `participants` are always an array of { name, ... } objects — never bare
// strings, never a lone null, never a missing/null field (empty array instead).
// Older fetchers and events preserved from a pre-WP-04 events.json may still
// carry the old polymorphism (a plain string, `null` entries, or the whole
// field missing); these two functions coerce any of those into the canonical
// shape so every downstream consumer (schema validation, hay-building for
// relevance/must-watch, the client, the ICS export) can assume `.name`
// unconditionally. Applied at the fetcher layer (event-normalizer.js) AND in
// build-events.js (pushEvent + the final pass over `kept`) — see the comments
// there for why both call sites are needed.

/** Coerce one participant-ish entry (string | {name, ...} | null) to {name} or null. */
function normalizeNameEntry(p) {
	if (p == null) return null;
	if (typeof p === "string") {
		const name = p.trim();
		return name ? { name } : null;
	}
	if (typeof p === "object" && typeof p.name === "string" && p.name.trim()) {
		return p;
	}
	return null;
}

/** Canonical `participants`: [{name}], never strings/null; [] when none. */
export function normalizeParticipants(list) {
	if (!Array.isArray(list)) return [];
	return list
		.map((p) => {
			const e = normalizeNameEntry(p);
			return e ? { name: e.name } : null;
		})
		.filter(Boolean);
}

/**
 * Canonical `norwegianPlayers`: [{name, teeTime?, teeTimeUTC?, status?}], never
 * strings/null; [] when none. Preserves the optional golf tee-time/status
 * fields when the source already supplied an object.
 */
export function normalizeNorwegianPlayers(list) {
	if (!Array.isArray(list)) return [];
	return list
		.map((p) => {
			const e = normalizeNameEntry(p);
			if (!e) return null;
			const out = { name: e.name };
			if (e.teeTime != null) out.teeTime = e.teeTime;
			if (e.teeTimeUTC != null) out.teeTimeUTC = e.teeTimeUTC;
			if (e.status != null) out.status = e.status;
			return out;
		})
		.filter(Boolean);
}

export function normalizeToUTC(dateString) {
	// Handle various date formats from APIs and ensure proper UTC conversion
	if (!dateString) return new Date().toISOString();
	
	try {
		const date = new Date(dateString);
		
		// Check if the date is valid
		if (isNaN(date.getTime())) {
			console.warn(`Invalid date string: ${dateString}`);
			return new Date().toISOString();
		}
		
		return date.toISOString();
	} catch (error) {
		console.warn(`Error parsing date ${dateString}:`, error);
		return new Date().toISOString();
	}
}

export async function fetchJson(
	url,
	{ headers = {}, retries = 2, retryDelay = 500, timeout = 0 } = {}
) {
	// ESPN's Akamai edge now returns 403 "Access Denied" (an HTML body) to bare
	// requests — a lone User-Agent with no Accept/Accept-Encoding reads as a bot.
	// Send the same polite headers the APIClient already uses (honest descriptive
	// User-Agent + Accept + gzip) so ESPN serves JSON again; this is what broke
	// golf.js, fetch-standings.js and fetch-results.js. Callers can still override
	// any header. (gzip only: the response handler below decompresses gzip, not
	// br/deflate, so we must not advertise those.)
	headers["User-Agent"] = headers["User-Agent"] || USER_AGENT;
	headers["Accept"] = headers["Accept"] || "application/json";
	headers["Accept-Encoding"] = headers["Accept-Encoding"] || "gzip";
	return new Promise((resolve, reject) => {
		let settled = false;
		let timeoutId = null;

		function settle(fn, value) {
			if (settled) return;
			settled = true;
			if (timeoutId) clearTimeout(timeoutId);
			fn(value);
		}

		const req = https
			.get(url, { headers }, (res) => {
				let stream = res;
				if (res.headers["content-encoding"] === "gzip") {
					stream = res.pipe(zlib.createGunzip());
				}
				let body = "";
				stream.on("data", (c) => (body += c));
				stream.on("error", (err) => settle(reject, err));
				stream.on("end", async () => {
					if (res.statusCode && res.statusCode >= 500 && retries > 0) {
						await new Promise((r) => setTimeout(r, retryDelay));
						try {
							settle(resolve,
								await fetchJson(url, {
									headers,
									retries: retries - 1,
									retryDelay: retryDelay * 2,
									timeout,
								})
							);
						} catch (e) {
							settle(reject, e);
						}
						return;
					}
					try {
						settle(resolve, JSON.parse(body));
					} catch (e) {
						settle(reject, e);
					}
				});
			})
			.on("error", async (err) => {
				if (retries > 0) {
					await new Promise((r) => setTimeout(r, retryDelay));
					try {
						settle(resolve,
							await fetchJson(url, {
								headers,
								retries: retries - 1,
								retryDelay: retryDelay * 2,
								timeout,
							})
						);
					} catch (e) {
						settle(reject, e);
					}
				} else settle(reject, err);
			});

		if (timeout > 0) {
			timeoutId = setTimeout(() => {
				req.destroy();
				settle(reject, new Error(`Request timed out after ${timeout}ms: ${url}`));
			}, timeout);
		}
	});
}

/**
 * Fetch a URL and resolve its response body as text.
 *
 * The shared HTTP-GET-text client for the scrapers: picks http/https by the
 * URL protocol, sends a User-Agent (overridable), follows redirects (resolving a
 * relative Location against the request URL), and rejects on HTTP >= 400 or
 * timeout. Callers that need a different UA or timeout pass them in `opts`
 * (e.g. pgatour.com wants a browser-like UA and a 10s budget).
 *
 * @param {string} url
 * @param {{ headers?: Record<string,string>, timeout?: number }} [opts]
 * @returns {Promise<string>}
 */
export function fetchText(url, { headers = {}, timeout = 8000 } = {}) {
	const reqHeaders = { "User-Agent": "SportSync/1.0", ...headers };
	return new Promise((resolve, reject) => {
		const client = url.startsWith("https") ? https : http;
		const req = client.get(url, { headers: reqHeaders, timeout }, (res) => {
			if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
				const next = new URL(res.headers.location, url).toString();
				return fetchText(next, { headers, timeout }).then(resolve, reject);
			}
			if (res.statusCode >= 400) {
				return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
			}
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => resolve(body));
		});
		req.on("error", reject);
		req.on("timeout", () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
	});
}

export function readJsonIfExists(file) {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
}

export function writeJsonPretty(file, data) {
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

export function retainLastGood(targetFile, newData, maxAgeDays = 14) {
	const exists = readJsonIfExists(targetFile);
	const newHasEvents = hasEvents(newData);
	// Skip retention if fetcher explicitly says empty is intentional (not a failure)
	if (newData?._noRetain) {
		delete newData._noRetain;
		if (newData._retained) delete newData._retained;
		writeJsonPretty(targetFile, newData);
		return { kept: false, data: newData };
	}
	if (!newHasEvents && exists && hasEvents(exists)) {
		// Check if retained data is too old to keep
		const retainedAge = exists.lastUpdated
			? (Date.now() - new Date(exists.lastUpdated).getTime()) / (1000 * 60 * 60 * 24)
			: Infinity;
		if (retainedAge <= maxAgeDays) {
			// Mark the retained data so health checks can detect chronic retention
			exists._retained = {
				since: exists._retained?.since || new Date().toISOString(),
				consecutiveRetains: (exists._retained?.consecutiveRetains || 0) + 1,
				lastFreshFetch: exists._retained?.lastFreshFetch || exists.lastUpdated || null,
			};
			writeJsonPretty(targetFile, exists);
			return { kept: true, data: exists };
		}
		console.warn(`Retained data expired (${Math.round(retainedAge)} days old) for ${path.basename(targetFile)}`);
	}
	// Fresh data — clear retention marker
	if (newData && newData._retained) delete newData._retained;
	writeJsonPretty(targetFile, newData);
	return { kept: false, data: newData };
}

export function hasEvents(obj) {
	if (!obj) return false;
	if (Array.isArray(obj.tournaments)) {
		return obj.tournaments.some(
			(t) => Array.isArray(t.events) && t.events.length > 0
		);
	}
	return false;
}

export function rootDataPath() {
	return process.env.SPORTSYNC_DATA_DIR || path.resolve(process.cwd(), "docs", "data");
}

/**
 * The scripts/config directory — the ONE place the config-dir override is
 * resolved (mirrors rootDataPath). Honors SPORTSYNC_CONFIG_DIR so the
 * integration tests (and any sandboxed run) can point every script at a temp
 * config; falls back to the repo's scripts/config. Replaces five hand-rolled
 * copies of this expression (WP-130).
 */
export function configDirPath() {
	return process.env.SPORTSYNC_CONFIG_DIR || path.resolve(process.cwd(), "scripts", "config");
}
