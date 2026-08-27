import { ESPNAdapter } from "../lib/adapters/espn-adapter.js";
import { sportsConfig } from "../config/sports-config.js";
import { fetchOBOSLigaenFromFotballNo } from "./fotball-no.js";
import { EventNormalizer } from "../lib/event-normalizer.js";
import { readJsonIfExists, matchInterest } from "../lib/helpers.js";
import { norwegianClubName } from "../lib/board-names.js";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// WP-96: highlight the catalog's covered clubs (tier2), falling back to the
// owner's interests.json seed, then a hard default. Favorite-tagging on the
// shared board reflects coverage, not one person's follows.
const catalog = readJsonIfExists(path.join(__dirname, "..", "config", "catalog.json")) || {};
const interests = readJsonIfExists(path.join(__dirname, "..", "config", "interests.json")) || {};
const FAVORITE_TEAMS = catalog.tier2?.teams || interests.alwaysTrack?.teams || ["Barcelona", "Liverpool", "Lyn"];

// WP-251: the ESPN→board club-name table moved to scripts/lib/board-names.js so
// the WORLD REGISTRY can be seeded from the SAME table. It used to live only
// here, which meant the board said "Tromsø" while the registry said "Tromso" and
// the two never matched — the row lost its entityId, and with it its club mark.
// NB: ESPN's per-event `name` ("Hamarkameratene at Valerenga") is ASCII-folded
// even where `team.displayName` has the diacritics right ("Vålerenga") — which is
// why we rebuild the title from the team names instead of trusting `event.name`.

/**
 * Is this a domestic Norwegian league fixture? Matched on the tournament label rather
 * than `leagueCode`, because EventNormalizer drops `leagueCode` and this runs after
 * normalisation. Eliteserien and OBOS-ligaen are the two leagues sports-config fetches
 * (nor.1 / nor.2); OBOS also arrives from fotball.no already labelled.
 */
export function isNorwegianLeagueEvent(e) {
	const hay = `${e?.tournament || ""} ${e?.meta || ""} ${e?.leagueName || ""}`.toLowerCase();
	return /eliteserien|obos/.test(hay) || String(e?.leagueCode || "").startsWith("nor");
}

export { norwegianClubName };

/**
 * Rewrite an ESPN match from a Norwegian league into the board's own voice:
 * canonical club names and the "Hjemme – Borte" title every other football row
 * uses. Mutates in place. Without this the static fetcher emitted ESPN's English
 * "Sandefjord at Fredrikstad" onto a Norwegian-language board — fine while the
 * research agent was hand-filling every round, glaring once the fetcher is the
 * one supplying rounds nobody has written by hand.
 */
export function norwegianiseMatch(event) {
	if (!event?.homeTeam || !event?.awayTeam) return event;
	event.homeTeam = norwegianClubName(event.homeTeam);
	event.awayTeam = norwegianClubName(event.awayTeam);
	event.title = `${event.homeTeam} – ${event.awayTeam}`;
	return event;
}

export class FootballFetcher extends ESPNAdapter {
	constructor() {
		super(sportsConfig.football);
	}

	async fetchFromSource(source) {
		if (source.api === "fotball.no" && source.enabled) {
			const fotballNoEvents = await this.fetchFotballNo();
			// Return events with proper metadata for grouping
			return fotballNoEvents.map(event => ({
				...event,
				tournament: event.meta || "OBOS-ligaen",
				leagueName: "OBOS-ligaen",
				leagueCode: "nor.2"
			}));
		}
		
		return await super.fetchFromSource(source);
	}

	async fetchFotballNo() {
		try {
			console.log("Fetching OBOS-ligaen data from fotball.no...");
			const fotballNoData = await fetchOBOSLigaenFromFotballNo();
			
			if (fotballNoData?.tournaments?.length > 0) {
				const events = [];
				for (const tournament of fotballNoData.tournaments) {
					events.push(...(tournament.events || []));
				}
				console.log(`Added ${events.length} Lyn matches from fotball.no`);
				return events;
			}
		} catch (error) {
			console.warn("Failed to fetch from fotball.no:", error.message);
		}
		
		return [];
	}

	transformToEvents(rawData) {
		const events = [];

		for (const item of rawData) {
			try {
				// Check if this is already a formatted event from fotball.no
				if (item.sport === "football" && item.meta === "OBOS-ligaen") {
					// It's already in the correct format, just validate and add
					// Ensure tournament field is set for proper grouping
					item.tournament = item.tournament || item.meta || "OBOS-ligaen";
					item.isFavorite = this.checkFavorite(item.homeTeam, item.awayTeam);
					const normalized = EventNormalizer.normalize(item, this.config.sport);
					if (normalized && EventNormalizer.validateEvent(normalized)) {
						events.push(normalized);
					}
				} else {
					// It's an ESPN event, transform it
					const event = this.transformESPNEvent(item);
					if (event) {
						if (String(item.leagueCode || "").startsWith("nor")) norwegianiseMatch(event);
						event.isFavorite = this.checkFavorite(event.homeTeam, event.awayTeam);
						const normalized = EventNormalizer.normalize(event, this.config.sport);
						if (normalized && EventNormalizer.validateEvent(normalized)) {
							events.push(normalized);
						}
					}
				}
			} catch (error) {
				console.error(`Error transforming event:`, error.message);
			}
		}

		return EventNormalizer.deduplicate(events);
	}

	checkFavorite(homeTeam, awayTeam) {
		const hay = `${homeTeam || ""} ${awayTeam || ""}`;
		return matchInterest(hay, FAVORITE_TEAMS, { sport: "football" }) != null;
	}

	/**
	 * No coverage FILTER (see the note below) — but coverage does need an ORDER, because
	 * `applyFilters` slices to `maxEvents` (30) right after this runs. From mid-August
	 * the Premier League, La Liga and the Champions League are all in season at once, and
	 * a 7-day window across seven leagues comfortably exceeds 30. Whatever falls past the
	 * cut is decided here, so the domestic leagues must be ahead of it: a Norwegian sports
	 * board that drops Eliteserien to make room for a midweek La Liga fixture has its
	 * priorities inverted — and it would have failed the same silent way as the bug above,
	 * with the file merely looking healthy. Norwegian leagues first, then the adapter's own
	 * `focused` ordering (owner-relevant ahead of the rest) decides the remainder.
	 */
	applyCustomFilters(events) {
		const domestic = [], rest = [];
		for (const e of events) (isNorwegianLeagueEvent(e) ? domestic : rest).push(e);
		return [...domestic, ...super.applyCustomFilters(rest)];
	}

	// NB (WP-96): there is deliberately NO coverage filter here. This override used to
	// keep a Norwegian-league or World Cup match ONLY when `event.norwegian` was true —
	// and `event.norwegian` is the OWNER's precision list (sports-config `norwegian.teams`
	// = Lyn / Norge). Lyn plays in OBOS-ligaen, so EVERY Eliteserien match failed the gate
	// and football.json went empty; `retainLastGood` then froze the last non-empty file
	// (the 19 July World Cup final) for 137 consecutive runs while the board looked fine
	// because the research agent was hand-filling each round as `source: "ai-research"`.
	//
	// `football` is catalog tier1 — covered WHOLESALE. Coverage is the catalog's call
	// (build-events' `isCovered`), never one person's follow list; owner precision belongs
	// in the on-device lens (WP-131). So the fetcher keeps what it fetches and lets the
	// adapter's `focused` mode order Norwegian-interest matches first under `maxEvents`.
}

export async function fetchFootballESPN() {
	const fetcher = new FootballFetcher();
	return await fetcher.fetch();
}