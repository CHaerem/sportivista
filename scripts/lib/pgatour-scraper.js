/**
 * pgatour.com Scraper
 *
 * Extracts field + tee-time data from pgatour.com's Next.js pages by reading the
 * embedded __NEXT_DATA__ JSON blob. This is the golf equivalent of the tvkampen
 * scraper: the network-facing scrape lives here, isolated behind an injectable
 * `fetcher` so it can be exercised network-free with fixture HTML.
 *
 * Pages used:
 *   /leaderboard — the week's field (used for player list + fallback tee times)
 *   /tee-times   — real per-round groups + tee times during an in-progress event
 *
 * ESPN provides the tournament schedule/venue; pgatour.com verifies the field and
 * supplies tee times. golf.js orchestrates the two.
 */

import { fetchText } from "./helpers.js";

const PGATOUR_HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; SportSync/1.0)" };
const PGATOUR_TIMEOUT_MS = 10000;

/** Format a Date as an Oslo-local 24h "HH:MM" string, falling back to system tz. */
function formatOsloTime(dt) {
	try {
		return dt.toLocaleTimeString("no-NO", {
			timeZone: "Europe/Oslo", hour: "2-digit", minute: "2-digit", hour12: false,
		});
	} catch {
		return dt.toLocaleTimeString("no-NO", {
			hour: "2-digit", minute: "2-digit", hour12: false,
		});
	}
}

/**
 * Derive { teeTime (Oslo display), teeTimeUTC (ISO) } from a Date, or nulls when
 * the Date is invalid. Single source of truth for the three tee-time-display
 * blocks that used to be copy-pasted across field + tee-times parsing.
 */
function teeTimeFromDate(dt) {
	if (isNaN(dt.getTime())) return { teeTime: null, teeTimeUTC: null };
	return { teeTime: formatOsloTime(dt), teeTimeUTC: dt.toISOString() };
}

/**
 * Parse a tee time string like "8:45 AM" to UTC ISO string,
 * given the tournament date and timezone.
 */
export function parseTeeTimeToUTC(teeTimeStr, tournamentDate, timezone) {
	if (!teeTimeStr || !tournamentDate) return null;
	try {
		// Parse "8:45 AM" or "1:30 PM" format
		const match = teeTimeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
		if (!match) return null;
		let hours = parseInt(match[1], 10);
		const minutes = parseInt(match[2], 10);
		const period = match[3].toUpperCase();
		if (period === "PM" && hours !== 12) hours += 12;
		if (period === "AM" && hours === 12) hours = 0;

		// Build a date string in the tournament's local timezone
		const dateStr = typeof tournamentDate === "string"
			? tournamentDate.slice(0, 10)
			: new Date(tournamentDate).toISOString().slice(0, 10);
		const localStr = `${dateStr}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;

		// Use Intl to find the UTC offset for this timezone
		const tz = timezone || "America/New_York";
		const localDate = new Date(localStr);
		const utcFormatter = new Intl.DateTimeFormat("en-US", {
			timeZone: tz,
			year: "numeric", month: "2-digit", day: "2-digit",
			hour: "2-digit", minute: "2-digit", second: "2-digit",
			hour12: false,
		});
		const utcParts = utcFormatter.formatToParts(localDate);
		const get = (type) => utcParts.find(p => p.type === type)?.value;
		const tzDate = new Date(`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`);
		const offsetMs = tzDate.getTime() - localDate.getTime();
		const utcTime = new Date(localDate.getTime() + offsetMs);

		// Sanity check: reject tee times in the past or >7 days in the future
		const now = new Date();
		const maxFuture = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
		if (utcTime < now || utcTime > maxFuture) {
			console.warn(`Tee time ${utcTime.toISOString()} outside valid window, ignoring`);
			return null;
		}

		return utcTime.toISOString();
	} catch (err) {
		console.warn(`Failed to parse tee time "${teeTimeStr}": ${err.message}`);
		return null;
	}
}

/**
 * Check if two tournament names likely refer to the same event.
 * Requires at least 2 meaningful words in common to avoid false positives
 * (e.g. "Open" matching both "U.S. Open" and "British Open").
 */
export function tournamentNameMatches(espnName, pgaName) {
	if (!espnName || !pgaName) return false;
	const stopWords = new Set(["the", "at", "in", "of", "and", "a"]);
	const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").split(/\s+/)
		.filter(w => w.length > 1 && !stopWords.has(w));
	const aWords = tokenize(espnName);
	const bWords = new Set(tokenize(pgaName));
	const overlap = aWords.filter(w => bWords.has(w));
	return overlap.length >= 2;
}

/**
 * Fetch a PGA Tour page and extract __NEXT_DATA__ JSON.
 * Shared helper for both leaderboard and tee-times pages.
 * Returns { nextData, queries } or null on any failure.
 * @param {string} pagePath
 * @param {Function} [fetcher] - Optional text fetcher (for testing)
 */
export async function fetchPGATourPage(pagePath, fetcher = fetchText) {
	try {
		const url = `https://www.pgatour.com${pagePath}`;
		const html = await fetcher(url, { headers: PGATOUR_HEADERS, timeout: PGATOUR_TIMEOUT_MS });

		const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
		if (!match) {
			console.warn(`PGA Tour ${pagePath}: __NEXT_DATA__ script tag not found`);
			return null;
		}

		let nextData;
		try {
			nextData = JSON.parse(match[1]);
		} catch (parseErr) {
			console.warn(`PGA Tour ${pagePath}: Failed to parse __NEXT_DATA__: ${parseErr.message}`);
			return null;
		}

		const queries = nextData?.props?.pageProps?.dehydratedState?.queries;
		if (!Array.isArray(queries)) {
			console.warn(`PGA Tour ${pagePath}: No queries array in __NEXT_DATA__`);
			return null;
		}

		return { nextData, queries };
	} catch (err) {
		console.warn(`PGA Tour ${pagePath} fetch failed: ${err.message}`);
		return null;
	}
}

/**
 * Fetch the current week's PGA Tour field from pgatour.com.
 * Returns { tournamentName, timezone, players: [...] } or null on any failure.
 * @param {Function} [fetcher] - Optional text fetcher (for testing)
 */
export async function fetchPGATourField(fetcher = fetchText) {
	try {
		const page = await fetchPGATourPage("/leaderboard", fetcher);
		if (!page) return null;
		const { nextData, queries } = page;

		// Find the leaderboard query
		const lbQuery = queries.find(q =>
			q.queryKey?.some?.(k => typeof k === "string" && k.toLowerCase().includes("leaderboard"))
		) || queries.find(q => q.state?.data?.leaderboard);

		const leaderboard = lbQuery?.state?.data?.leaderboard || lbQuery?.state?.data;
		if (!leaderboard) {
			console.warn("PGA Tour: No leaderboard data found in queries");
			return null;
		}

		const tournamentName = leaderboard.tournament?.tournamentName
			|| leaderboard.tournamentName
			|| nextData?.props?.pageProps?.tournament?.tournamentName
			|| null;

		const timezone = leaderboard.tournament?.timezone
			|| leaderboard.timezone
			|| nextData?.props?.pageProps?.tournament?.timezone
			|| null;

		const tournamentDate = leaderboard.tournament?.date
			|| leaderboard.tournament?.startDate
			|| nextData?.props?.pageProps?.tournament?.date
			|| null;

		// Extract players from rows/players array
		const rows = leaderboard.rows || leaderboard.players || [];
		const players = rows.map(row => {
			const p = row.player || row;
			const sd = row.scoringData || {};

			// Tee time: PGA Tour uses epoch ms in scoringData.teeTime
			let teeTime = null;
			let teeTimeUTC = null;
			const rawTeeTime = sd.teeTime || row.teeTime || null;
			if (typeof rawTeeTime === "number" && rawTeeTime > 0) {
				({ teeTime, teeTimeUTC } = teeTimeFromDate(new Date(rawTeeTime)));
			} else if (typeof rawTeeTime === "string" && /\d{1,2}:\d{2}/.test(rawTeeTime)) {
				// Fallback: string format like "8:45 AM"
				teeTime = rawTeeTime;
				teeTimeUTC = parseTeeTimeToUTC(rawTeeTime, tournamentDate, timezone);
			}

			return {
				firstName: p.firstName || "",
				lastName: p.lastName || "",
				displayName: p.displayName || `${p.firstName || ""} ${p.lastName || ""}`.trim(),
				teeTime,
				teeTimeUTC,
				startingHole: sd.backNine ? 10 : (row.startingHole || null),
			};
		}).filter(p => p.displayName);

		if (players.length === 0) {
			console.warn("PGA Tour: Leaderboard parsed but 0 players extracted");
			return null;
		}

		console.log(`PGA Tour field loaded: ${tournamentName} (${players.length} players)`);
		return { tournamentName, timezone, players };
	} catch (err) {
		console.warn(`PGA Tour scrape failed: ${err.message}`);
		return null;
	}
}

/** Round statuses that mean "this round is done" — its tee times are history. */
const FINISHED_ROUND_STATUS = new Set(["OFFICIAL", "COMPLETE", "COMPLETED", "FINAL"]);

/**
 * Which round's tee times answer «naar spiller han» RIGHT NOW.
 *
 * pgatour.com's own tee-times page opens on `teeTimeV3.defaultRound`, and that
 * is the field that advances the moment the next round's groups are published.
 * `pageProps.tournament.currentRound` does NOT: it tracks the round being
 * PLAYED, so on the Friday of the 2026 TOUR Championship it still read 1 hours
 * after round 1 had gone `OFFICIAL` — while round 2's groups sat in the very
 * same payload. Reading currentRound therefore re-published Thursday's 17:24
 * all through Friday, and both boards then correctly stripped the clock as
 * stale (`AgendaViewModel.place`, `dashboard.js` golfTeeHint). The owner saw a
 * golf row with NO tee time while the right one was one field away — which is
 * why the round is chosen here rather than fixed downstream.
 *
 * Order of preference: the site's own default -> the first round that has not
 * finished -> the round being played -> the old positional guess. Rounds are
 * matched on `roundInt`, not array position: the array is only incidentally
 * 1-indexed, and a cut event drops rounds from it.
 *
 * @param {Array} rounds
 * @param {{defaultRound?: number, currentRound?: number}} [hints]
 * @returns {object|null}
 */
export function pickTeeTimeRound(rounds, hints = {}) {
	if (!Array.isArray(rounds) || rounds.length === 0) return null;
	const { defaultRound, currentRound } = hints;
	const groupsOf = (r) => (r && (r.groups || r.teeTimeGroups)) || [];
	const byInt = (n) => (typeof n === "number" ? rounds.find(r => r.roundInt === n) : undefined);
	const unfinished = rounds.filter(r =>
		r.roundStatus && !FINISHED_ROUND_STATUS.has(String(r.roundStatus).toUpperCase()));
	const positional = rounds[Math.min(Math.max((currentRound || 1) - 1, 0), rounds.length - 1)];

	const candidates = [byInt(defaultRound), ...unfinished, byInt(currentRound), positional];
	// A round we can actually read groups out of beats a better-labelled empty one.
	return candidates.find(r => r && groupsOf(r).length > 0) || candidates.find(Boolean) || null;
}

/**
 * Fetch tee times from pgatour.com/tee-times page.
 * Returns { tournamentName, timezone, playerTeeTimes: Map<normalizedName, info> } or null.
 * The tee-times page has real tee times during in-progress tournaments
 * when the leaderboard page only shows scoring data.
 * @param {Function} [fetcher] - Optional text fetcher (for testing)
 */
export async function fetchPGATourTeeTimes(fetcher = fetchText) {
	try {
		const page = await fetchPGATourPage("/tee-times", fetcher);
		if (!page) return null;
		const { nextData, queries } = page;

		const tournamentName = nextData?.props?.pageProps?.tournament?.tournamentName || null;
		const timezone = nextData?.props?.pageProps?.tournament?.timezone || null;
		const currentRound = nextData?.props?.pageProps?.tournament?.currentRound || 1;

		// Find tee-times query — try multiple key patterns
		const ttQuery = queries.find(q =>
			q.queryKey?.some?.(k => typeof k === "string" &&
				(k.toLowerCase().includes("teetimes") || k.toLowerCase().includes("tee-times") || k.toLowerCase().includes("tee_times"))
			)
		) || queries.find(q => q.state?.data?.rounds);

		const ttData = ttQuery?.state?.data?.teeTimeV3 || ttQuery?.state?.data;
		if (!ttData) {
			console.warn("PGA Tour tee-times: No tee-time data found in queries");
			return null;
		}

		// Navigate to rounds array
		const rounds = ttData.rounds || ttData.teeTimeRounds || [];
		if (!Array.isArray(rounds) || rounds.length === 0) {
			console.warn("PGA Tour tee-times: No rounds data");
			return null;
		}

		const round = pickTeeTimeRound(rounds, { defaultRound: ttData.defaultRound, currentRound });
		if (!round) {
			console.warn(`PGA Tour tee-times: Round ${currentRound} not found`);
			return null;
		}
		const roundInt = typeof round.roundInt === "number" ? round.roundInt : currentRound;

		const groups = round.groups || round.teeTimeGroups || [];
		const playerTeeTimes = new Map();

		for (const group of groups) {
			const rawTeeTime = group.time || group.teeTime || null;
			const startTee = group.startTee || group.startingHole || 1;
			const courseName = group.course?.courseName || group.courseName || null;
			const players = group.players || group.golfers || [];

			// Parse group tee time
			let teeTimeDisplay = null;
			let teeTimeUTC = null;
			if (typeof rawTeeTime === "number" && rawTeeTime > 0) {
				({ teeTime: teeTimeDisplay, teeTimeUTC } = teeTimeFromDate(new Date(rawTeeTime)));
			} else if (typeof rawTeeTime === "string" && rawTeeTime) {
				// May be "8:45 AM" format or ISO
				if (/\d{4}-\d{2}-\d{2}/.test(rawTeeTime)) {
					({ teeTime: teeTimeDisplay, teeTimeUTC } = teeTimeFromDate(new Date(rawTeeTime)));
				} else {
					teeTimeDisplay = rawTeeTime;
				}
			}

			// Build groupmate names for this group
			const groupPlayerNames = players.map(p => {
				const display = p.displayName || p.playerName || `${p.firstName || ""} ${p.lastName || ""}`.trim();
				return display;
			}).filter(Boolean);

			for (const p of players) {
				const displayName = p.displayName || p.playerName || `${p.firstName || ""} ${p.lastName || ""}`.trim();
				if (!displayName) continue;
				const key = displayName.toLowerCase();
				const groupmates = groupPlayerNames.filter(n => n.toLowerCase() !== key);

				playerTeeTimes.set(key, {
					teeTime: teeTimeDisplay,
					teeTimeUTC,
					startingHole: typeof startTee === "number" ? startTee : parseInt(startTee, 10) || 1,
					courseName,
					groupmates,
				});
			}
		}

		if (playerTeeTimes.size === 0) {
			console.warn("PGA Tour tee-times: Parsed page but 0 player tee times extracted");
			return null;
		}

		console.log(`PGA Tour tee-times loaded: ${tournamentName} round ${roundInt} (${playerTeeTimes.size} players)`);
		return { tournamentName, timezone, round: roundInt, playerTeeTimes };
	} catch (err) {
		console.warn(`PGA Tour tee-times scrape failed: ${err.message}`);
		return null;
	}
}
