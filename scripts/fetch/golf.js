import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { fetchJson, iso, normalizeToUTC, espnDateRange } from "../lib/helpers.js";
import { golfParticipationStatus, isOutOfTournament } from "../lib/golf.js";
import { validateESPNScoreboard } from "../lib/response-validator.js";
import { fetchPGATourField, fetchPGATourTeeTimes, tournamentNameMatches } from "../lib/pgatour-scraper.js";

// Norwegian golf broadcast rights, 2026 season (web-verified 2026-07-18 — see
// `.claude/skills/norwegian-rights/SKILL.md` "Golf" for sources). The rights are
// TIERED, not a flat "all golf → Viaplay" (the pre-2026 assumption that produced
// the Corales Puntacana revert-war):
//   • Ordinary PGA Tour (incl. opposite-field events, e.g. Corales) → HBO Max
//     (Sport) / Eurosport Norge — Warner Bros. Discovery took PGA Tour for 2026;
//     Viaplay LOST it. (hbomax.com/no lists Corales/3M Open/Rocket Classic.)
//   • The Open Championship + US Open → Viaplay.
//   • DP World Tour + Ryder Cup → Viaplay.
//   • The Masters + PGA Championship → Warner Bros. Discovery (Discovery+/Max).
// Tier is decided by the event name (majors ride the PGA Tour scoreboard), with
// the tour name as a fallback for DP World Tour events.
const GOLF_STREAM = {
	viaplay: { platform: "Viaplay", url: "https://viaplay.no", type: "streaming" },
	hbomax: { platform: "HBO Max (Sport)", url: "https://www.hbomax.com/no/no/sports/pga-tour", type: "streaming" },
	eurosport: { platform: "Eurosport Norge", url: "https://www.hbomax.com/no/no/sports/pga-tour", type: "streaming" },
	discovery: { platform: "Discovery+", url: "https://www.discoveryplus.no", type: "streaming" },
};

function getNorwegianStreaming(_sport, tourName = "", eventName = "") {
	const name = `${eventName} ${tourName}`.toLowerCase();
	// The Masters + PGA Championship → Warner Bros. Discovery (Discovery+/Max).
	if (/\bmasters\b|pga championship/.test(name)) {
		return [GOLF_STREAM.discovery];
	}
	// The Open Championship + US Open → Viaplay.
	if (/\bthe open\b|open championship|british open|u\.?s\.? open/.test(name)) {
		return [GOLF_STREAM.viaplay];
	}
	// DP World Tour + Ryder Cup → Viaplay.
	if (tourName === "DP World Tour" || /dp world|ryder cup/.test(name)) {
		return [GOLF_STREAM.viaplay];
	}
	// Ordinary PGA Tour (incl. opposite-field, e.g. Corales) → HBO Max / Eurosport.
	return [GOLF_STREAM.hbomax, GOLF_STREAM.eurosport];
}

// Load Norwegian golfers from config
const configPath = path.resolve(process.cwd(), "scripts", "config", "norwegian-golfers.json");
let norwegianGolfers = [];
try {
	norwegianGolfers = JSON.parse(fs.readFileSync(configPath, "utf-8"));
} catch (err) {
	console.warn(`Failed to load norwegian-golfers.json: ${err.message}`);
}

/**
 * Check if an ESPN player name matches a configured golfer.
 * Uses full-name matching to avoid false positives (e.g. "Ventura" matching wrong player).
 */
function playerNameMatches(espnName, golfer) {
	const espn = espnName.toLowerCase().trim();
	const full = golfer.name.toLowerCase();
	// Exact or contains in either direction
	if (espn === full || espn.includes(full) || full.includes(espn)) return true;
	// All name parts must appear in the ESPN name
	const parts = full.split(" ");
	return parts.length >= 2 && parts.every(p => espn.includes(p));
}

/**
 * Given the configured golfer list (filtered by tour) and a PGA Tour field,
 * return only the golfers confirmed in the field.
 */
function filterNorwegiansAgainstField(golfers, pgaField) {
	return golfers.filter(golfer => {
		return pgaField.players.some(p => playerNameMatches(p.displayName, golfer));
	});
}

/**
 * Find a PGA Tour field player matching a golfer config entry.
 */
function findFieldPlayer(golfer, pgaField) {
	return pgaField.players.find(p => playerNameMatches(p.displayName, golfer));
}

/**
 * Build featured groups for Norwegian players.
 * If pgaTeeTimes is available (from /tee-times page), use its real group data.
 * Otherwise fall back to synthetic grouping from pgaField (leaderboard page).
 */
function buildFeaturedGroups(norwegianPlayersList, pgaField, pgaTeeTimes) {
	// Prefer tee-times data (has real groups from the /tee-times page)
	if (pgaTeeTimes?.playerTeeTimes?.size > 0) {
		const featuredGroups = [];
		for (const np of norwegianPlayersList) {
			const info = pgaTeeTimes.playerTeeTimes.get(np.name.toLowerCase());
			if (!info?.teeTime || !info.groupmates?.length) continue;
			featuredGroups.push({
				player: np.name,
				teeTime: info.teeTime,
				groupmates: info.groupmates.map(name => ({ name, teeTime: info.teeTime })),
			});
		}
		return featuredGroups;
	}

	// Fallback: synthetic grouping from leaderboard field
	if (!pgaField?.players?.length) return [];
	const groups = new Map();
	for (const p of pgaField.players) {
		if (!p.teeTime) continue;
		const key = `${p.teeTime}|${p.startingHole || 1}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(p);
	}
	const featuredGroups = [];
	for (const np of norwegianPlayersList) {
		const fieldPlayer = pgaField.players.find(p => playerNameMatches(p.displayName, { name: np.name }));
		if (!fieldPlayer?.teeTime) continue;
		const key = `${fieldPlayer.teeTime}|${fieldPlayer.startingHole || 1}`;
		const group = groups.get(key);
		if (!group || group.length <= 1) continue;
		const groupmates = group
			.filter(p => p.displayName !== fieldPlayer.displayName)
			.map(p => ({ name: p.displayName, teeTime: p.teeTime }));
		if (groupmates.length > 0) {
			featuredGroups.push({ player: np.name, teeTime: np.teeTime, groupmates });
		}
	}
	return featuredGroups;
}

/**
 * Get the tour key used in config for a given tour name.
 */
function tourConfigKey(tourName) {
	if (tourName === "PGA Tour") return "pga";
	if (tourName === "DP World Tour") return "dpWorld";
	return tourName.toLowerCase();
}

/**
 * Golf tournaments run Thu–Sun (~4 days). Derive the tournament end time as
 * start + 3 days, clamped to 20:00 UTC (end of Sunday play).
 */
function tournamentEndTime(startTime) {
	const endDate = new Date(new Date(startTime).getTime() + 3 * 24 * 60 * 60 * 1000);
	endDate.setUTCHours(20, 0, 0, 0);
	return endDate.toISOString();
}

/**
 * Build a golf tournament entry ({ name, events: [event] }).
 * Single source of truth for the three push sites in fetchGolfESPN — the field
 * order is fixed so golf.json output stays byte-identical.
 */
function buildGolfTournament(tourName, ev, venue, { norwegian, norwegianPlayers, featuredGroups, totalPlayers, fieldPending = false }) {
	const startTime = normalizeToUTC(ev.date);
	const event = {
		title: ev.name || "Golf Tournament",
		meta: tourName,
		tournament: tourName,
		time: startTime,
		endTime: tournamentEndTime(startTime),
		venue,
		sport: "golf",
		streaming: getNorwegianStreaming("golf", tourName, ev.name),
		norwegian,
		norwegianPlayers,
		featuredGroups,
		totalPlayers,
	};
	if (fieldPending) event.fieldPending = true;
	return { name: tourName, events: [event] };
}

/**
 * Fetch per-player participation status (cut/WD/DQ) for the Norwegian competitors
 * of an in-progress tournament from ESPN's core-API competitor status endpoint.
 * The scoreboard competitor `id` doubles as the core-API competitor id, so this
 * is one cheap fetch per followed player — not per full field. Returns a
 * Map<competitorId, norwegianLabel> holding only players who are OUT (active
 * players are omitted). Fail-soft: a failed fetch leaves that player unlabelled.
 * @param {string} leagueSlug  ESPN golf league slug ("pga" | "eur")
 * @param {string} eventId     ESPN event id
 * @param {object[]} competitors  scoreboard competitors (need `.id`)
 * @param {Function} [fetcher]  injectable JSON fetcher (for tests)
 */
export async function fetchGolfPlayerStatuses(leagueSlug, eventId, competitors, fetcher = fetchJson) {
	const out = new Map();
	if (!leagueSlug || !eventId) return out;
	await Promise.all((competitors || []).map(async (comp) => {
		if (!comp?.id) return;
		const url = `https://sports.core.api.espn.com/v2/sports/golf/leagues/${leagueSlug}/events/${eventId}/competitions/${eventId}/competitors/${comp.id}/status`;
		try {
			const label = golfParticipationStatus(await fetcher(url));
			if (label) out.set(comp.id, label);
		} catch (err) {
			console.warn(`Golf status fetch failed for competitor ${comp.id} (${eventId}): ${err.message}`);
		}
	}));
	return out;
}

// De-dupe ESPN scoreboard events into `allEvents`, keyed by id (or name). `seen`
// maps that key → the event's index in allEvents; when the same tournament comes
// back under an EARLIER date (a multi-day event's Thursday start beating a later
// default-endpoint copy), keep the earlier one. Shared by the per-date and
// default-endpoint passes below, which ran byte-identical merge loops (WP-130).
function mergeEvents(events, allEvents, seen) {
	for (const ev of events) {
		const key = ev.id || ev.name;
		const idx = seen.get(key);
		if (idx === undefined) {
			seen.set(key, allEvents.length);
			allEvents.push(ev);
		} else if (new Date(ev.date) < new Date(allEvents[idx].date)) {
			allEvents[idx] = ev;
		}
	}
}

export async function fetchGolfESPN() {
	// Get golfers filtered by tour
	const getGolfersForTour = (tourName) => {
		const key = tourConfigKey(tourName);
		return norwegianGolfers.filter(g => g.tours.includes(key));
	};

	const tours = [
		{
			url: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard",
			name: "PGA Tour",
		},
		{
			url: "https://site.api.espn.com/apis/site/v2/sports/golf/eur/scoreboard",
			name: "DP World Tour",
		},
	];

	const tournaments = [];
	const now = new Date();
	const seen = new Map();

	// Query every day for next 14 days so we always catch the Thursday
	// start of multi-day tournaments (golf events are Thu-Sun).
	const datesToQuery = espnDateRange(14);

	// Fetch PGA Tour field and tee times in parallel
	console.log("Fetching PGA Tour field + tee times for verification...");
	const [pgaField, pgaTeeTimes] = await Promise.allSettled([
		fetchPGATourField(),
		fetchPGATourTeeTimes(),
	]).then(results => results.map(r => r.status === "fulfilled" ? r.value : null));

	if (pgaField) {
		console.log(`PGA Tour field: ${pgaField.tournamentName} (${pgaField.players.length} players)`);
	} else {
		console.warn("PGA Tour field unavailable — tournaments without ESPN field data will be skipped");
	}
	if (pgaTeeTimes) {
		console.log(`PGA Tour tee-times: ${pgaTeeTimes.tournamentName} (${pgaTeeTimes.playerTeeTimes.size} players)`);
	}

	for (const tour of tours) {
		const tourGolfers = getGolfersForTour(tour.name);
		if (tourGolfers.length === 0) {
			console.warn(`No Norwegian golfers configured for ${tour.name}, skipping`);
			continue;
		}

		try {
			const allEvents = [];

			for (const dateStr of datesToQuery) {
				try {
					const data = await fetchJson(`${tour.url}?dates=${dateStr}`);
					const v = validateESPNScoreboard(data, tour.name, { requireCompetitors: false });
					for (const w of v.warnings) console.warn(w);
					mergeEvents(v.events, allEvents, seen);
				} catch (err) {
					console.warn(`${tour.name} date query ${dateStr} failed: ${err.message}`);
				}
			}

			// Also query default endpoint for current/in-progress events
			try {
				const data = await fetchJson(tour.url);
				const v = validateESPNScoreboard(data, tour.name, { requireCompetitors: false });
				for (const w of v.warnings) console.warn(w);
				mergeEvents(v.events, allEvents, seen);
			} catch (err) {
				console.warn(`${tour.name} default query failed: ${err.message}`);
			}

			// Golf tournaments run Thu–Sun (4 days). Allow events that started
			// up to 4 days ago so in-progress tournaments aren't dropped.
			const lookback = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 4);
			const events = allEvents
				.filter(e =>
					new Date(e.date) >= lookback &&
					!["STATUS_FINAL"].includes(e.status?.type?.name)
				)
				.sort((a, b) => new Date(a.date) - new Date(b.date))
				.slice(0, 4);

			console.log(`${tour.name}: found ${events.length} upcoming events`);

			for (const ev of events) {
				const competitors = ev.competitions?.[0]?.competitors || [];

				// Find Norwegian players in this tournament via full-name matching
				const norwegianCompetitors = competitors.filter(competitor => {
					const playerName = competitor.athlete?.displayName || "";
					return tourGolfers.some(golfer => playerNameMatches(playerName, golfer));
				});

				const venue = ev.competitions?.[0]?.venue?.fullName ||
					ev.competitions?.[0]?.venue?.address?.city || "TBD";

				if (norwegianCompetitors.length > 0) {
					// Confirmed Norwegian players in field from ESPN
					const isPGATour = tour.name === "PGA Tour";
					const teeTimesMatch = isPGATour && pgaTeeTimes && tournamentNameMatches(ev.name, pgaTeeTimes.tournamentName);
					const fieldMatch = isPGATour && pgaField && tournamentNameMatches(ev.name, pgaField.tournamentName);

					// WP-95 participation freshness: for a tournament already under way,
					// pull each Norwegian's cut/WD/DQ status so an eliminated player is
					// never shown as still playing. Only when the event has begun (a
					// scheduled future tournament cannot have a cut yet).
					const leagueSlug = tour.url.match(/sports\/golf\/([^/]+)\//)?.[1] || null;
					const eventStarted = ev.status?.type?.state && ev.status.type.state !== "pre";
					const statusById = eventStarted
						? await fetchGolfPlayerStatuses(leagueSlug, ev.id, norwegianCompetitors)
						: new Map();

					const norwegianPlayersList = norwegianCompetitors.map(comp => {
						const name = comp.athlete?.displayName || "Unknown";
						const status = statusById.get(comp.id) || null;
						let teeTime = null;
						let teeTimeUTC = null;
						// A player who is out of the tournament (cut/WD/DQ) gets no tee
						// time or featured group for the remaining rounds.
						if (!isOutOfTournament(status)) {
							// Prefer tee-times page (has real tee times during in-progress tournaments)
							if (teeTimesMatch) {
								const info = pgaTeeTimes.playerTeeTimes.get(name.toLowerCase());
								if (info?.teeTime) {
									teeTime = info.teeTime;
									teeTimeUTC = info.teeTimeUTC;
								}
							}
							// Fallback to leaderboard field
							if (!teeTime && fieldMatch) {
								const golfer = tourGolfers.find(g => playerNameMatches(name, g));
								if (golfer) {
									const fieldPlayer = findFieldPlayer(golfer, pgaField);
									if (fieldPlayer?.teeTime) {
										teeTime = fieldPlayer.teeTime;
										teeTimeUTC = fieldPlayer.teeTimeUTC;
									}
								}
							}
						}
						return { name, teeTime, teeTimeUTC, status };
					});

					console.log(`Found ${norwegianCompetitors.length} Norwegian player(s) in ${ev.name}: ${norwegianPlayersList.map(p => p.status ? `${p.name} (${p.status})` : p.name).join(", ")}`);

					// Players who are out of the tournament get no featured groups either.
					const activePlayers = norwegianPlayersList.filter(p => !isOutOfTournament(p.status));
					const matchedTeeTimes = teeTimesMatch ? pgaTeeTimes : null;
					tournaments.push(buildGolfTournament(tour.name, ev, venue, {
						norwegian: true,
						norwegianPlayers: norwegianPlayersList,
						featuredGroups: (teeTimesMatch || fieldMatch)
							? buildFeaturedGroups(activePlayers, fieldMatch ? pgaField : null, matchedTeeTimes)
							: [],
						totalPlayers: competitors.length,
					}));
				} else if (competitors.length === 0) {
					// Scheduled tournament with no field on ESPN yet — try PGA Tour verification
					const isPGA = tour.name === "PGA Tour";

					if (isPGA && pgaField && tournamentNameMatches(ev.name, pgaField.tournamentName)) {
						const confirmed = filterNorwegiansAgainstField(tourGolfers, pgaField);
						const teeTimesMatch2 = pgaTeeTimes && tournamentNameMatches(ev.name, pgaTeeTimes.tournamentName);
						if (confirmed.length > 0) {
							console.log(`Verified ${confirmed.length} Norwegian player(s) in ${ev.name} via pgatour.com`);

							const playersList2 = confirmed.map(golfer => {
								let teeTime = null;
								let teeTimeUTC = null;
								// Prefer tee-times page
								if (teeTimesMatch2) {
									const info = pgaTeeTimes.playerTeeTimes.get(golfer.name.toLowerCase());
									if (info?.teeTime) {
										teeTime = info.teeTime;
										teeTimeUTC = info.teeTimeUTC;
									}
								}
								// Fallback to leaderboard field
								if (!teeTime) {
									const fieldPlayer = findFieldPlayer(golfer, pgaField);
									teeTime = fieldPlayer?.teeTime || null;
									teeTimeUTC = fieldPlayer?.teeTimeUTC || null;
								}
								return { name: golfer.name, teeTime, teeTimeUTC, status: "Confirmed" };
							});

							const matchedTeeTimes2 = teeTimesMatch2 ? pgaTeeTimes : null;
							tournaments.push(buildGolfTournament(tour.name, ev, venue, {
								norwegian: true,
								norwegianPlayers: playersList2,
								featuredGroups: buildFeaturedGroups(playersList2, pgaField, matchedTeeTimes2),
								totalPlayers: pgaField.players.length,
							}));
						} else {
							console.log(`No Norwegian players in ${ev.name} field (verified via pgatour.com), skipping`);
						}
					} else {
						// Cannot verify Norwegian participation — include as pending so
						// golf.json stays fresh and retainLastGood doesn't trigger
						console.log(`Including ${ev.name} (${tour.name}) with pending field (no ESPN competitors, no PGA Tour match)`);
						tournaments.push(buildGolfTournament(tour.name, ev, venue, {
							norwegian: false,
							norwegianPlayers: [],
							featuredGroups: [],
							totalPlayers: 0,
							fieldPending: true,
						}));
					}
				}
				// If competitors exist but no Norwegians found, skip silently (not relevant)
			}
		} catch (error) {
			console.warn(`Failed to fetch ${tour.name}: ${error.message}`);
		}
	}

	return {
		lastUpdated: iso(),
		source: "ESPN + PGA Tour",
		tournaments
	};
}

// Exported for testing
export { playerNameMatches, filterNorwegiansAgainstField, buildFeaturedGroups, buildGolfTournament, getNorwegianStreaming };

// Run if executed directly
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	fetchGolfESPN().then(data => {
		console.log(JSON.stringify(data, null, 2));
	}).catch(err => {
		console.error('Error:', err);
		process.exit(1);
	});
}
