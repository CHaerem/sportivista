import { BaseFetcher } from "../lib/base-fetcher.js";
import { sportsConfig } from "../config/sports-config.js";
import { EventNormalizer } from "../lib/event-normalizer.js";
import { EventFilters } from "../lib/filters.js";

/**
 * Parse Liquipedia Matches HTML into structured match objects.
 * The HTML comes from Liquipedia's MediaWiki parse API (action=parse&page=Liquipedia:Matches).
 * Uses regex-based parsing to avoid adding DOM dependencies.
 */
export function parseLiquipediaMatches(html) {
	if (!html || typeof html !== "string") return [];

	const matches = [];
	// Split on match-info containers (exact class, not sub-classes like match-info-tournament-name)
	const matchBlocks = html.split(/class="match-info(?:\s[^"]*)?(?=")/);

	for (let i = 1; i < matchBlocks.length; i++) {
		const block = matchBlocks[i];

		// Extract timestamp from timer-object data-timestamp attribute
		const timestampMatch = block.match(/data-timestamp="(\d+)"/);
		if (!timestampMatch) continue;
		const timestamp = parseInt(timestampMatch[1], 10) * 1000;

		// Extract team names - look for team name spans with anchors
		const teamNames = [];
		const teamMatches = [...block.matchAll(/class="name"[^>]*>(?:<a[^>]*>)?([^<]+)(?:<\/a>)?/g)];
		for (const tm of teamMatches) {
			const name = tm[1].trim();
			if (name && name !== "TBD") teamNames.push(name);
		}

		// Extract tournament name (name sits in a <span> inside the <a>)
		const tournamentMatch = block.match(/class="match-info-tournament-name"[^>]*>(?:<a[^>]*>)?(?:<span[^>]*>)?([^<]+)/);
		const tournament = tournamentMatch ? tournamentMatch[1].trim() : "CS2 Match";

		// Extract format (Bo1, Bo3, Bo5)
		const formatMatch = block.match(/(?:Bo|Best of\s*)(\d)/i);
		const format = formatMatch ? `Bo${formatMatch[1]}` : null;

		// Extract scores if available
		const scoreMatches = [...block.matchAll(/class="match-info-header-scoreholder-score[^"]*"[^>]*>(\d+)/g)];
		const scores = scoreMatches.map(s => parseInt(s[1], 10));

		const team1 = teamNames[0] || "TBD";
		const team2 = teamNames[1] || "TBD";

		matches.push({
			team1,
			team2,
			timestamp,
			time: new Date(timestamp).toISOString(),
			tournament,
			format,
			score1: scores[0] ?? null,
			score2: scores[1] ?? null
		});
	}

	return matches;
}

export class EsportsFetcher extends BaseFetcher {
	constructor() {
		super(sportsConfig.esports);
	}

	async fetchFromSource(source) {
		if (source.api === "liquipedia") {
			return await this.fetchLiquipedia(source);
		}
		return [];
	}

	async fetchLiquipedia(source) {
		const matches = [];

		try {
			const params = new URLSearchParams(source.params);
			const url = `${source.url}?${params.toString()}`;
			console.log("Fetching Liquipedia CS2 matches from:", url);

			const data = await this.apiClient.fetchJSON(url, {
				headers: {
					"User-Agent": "SportSync/2.0 (https://github.com; sports dashboard; 1 req/2h)",
					"Accept": "application/json"
				},
				retries: 1
			});

			if (!data?.parse?.text) {
				console.warn("Liquipedia API did not return expected structure");
				return matches;
			}

			// The API returns { parse: { text: { "*": "<html>..." } } }
			const html = data.parse.text["*"] || data.parse.text;
			if (typeof html !== "string") {
				console.warn("Liquipedia HTML content not found in response");
				return matches;
			}

			const parsed = parseLiquipediaMatches(html);
			console.log(`Parsed ${parsed.length} Liquipedia matches`);

			const focusTeams = this.config.filters?.teams || [];

			// Owner interest: CS2 is only relevant when the focus team (100 Thieves /
			// rain) plays. Everything else — even top-tier majors without 100 Thieves —
			// is intentionally dropped.
			const filtered = parsed.filter(match =>
				focusTeams.some(team =>
					match.team1.toLowerCase().includes(team.toLowerCase()) ||
					match.team2.toLowerCase().includes(team.toLowerCase())
				)
			);

			console.log(`Filtered to ${filtered.length} matches (focus team only: ${focusTeams.join(", ")})`);

			// Attest upstream health so an EMPTY result can be told apart from a
			// DEAD fetcher: "parsed 56, focus-filtered to 0" is the focus team
			// simply having no scheduled matches — a legitimate, fresh answer.
			this._fetchMetadata = {
				...this._fetchMetadata,
				liquipedia: { parsedMatches: parsed.length, focusMatches: filtered.length },
			};

			for (const match of filtered.slice(0, 10)) {
				matches.push({
					title: `${match.team1} vs ${match.team2}`,
					time: match.time,
					venue: "Online",
					tournament: match.tournament,
					format: match.format,
					norwegian: this.isNorwegianTeamFromNames(match.team1, match.team2),
					meta: match.tournament
				});
			}
		} catch (error) {
			console.error("Failed to fetch Liquipedia data:", error.message);
		}

		return matches;
	}

	isNorwegianTeamFromNames(team1, team2) {
		const norwegianTeams = this.config.norwegian?.teams || [];
		const text = `${team1} ${team2}`.toLowerCase();
		return norwegianTeams.some(team => text.includes(team.toLowerCase()));
	}

	transformToEvents(rawData) {
		const events = [];

		for (const item of rawData) {
			const normalized = EventNormalizer.normalize(item, this.config.sport);
			if (normalized && EventNormalizer.validateEvent(normalized)) {
				// Add streaming platforms
				if (this.config.streaming && normalized.norwegian) {
					normalized.streaming = this.config.streaming;
				}
				events.push(normalized);
			}
		}

		return EventNormalizer.deduplicate(events);
	}

	applyCustomFilters(events) {
		// Apply current week filter if configured
		if (this.config.filters?.currentWeek) {
			events = EventFilters.filterCurrentWeek(events);
		}

		return super.applyCustomFilters(events);
	}

	formatResponse(events) {
		const response = super.formatResponse(events);
		const upstream = this._fetchMetadata?.liquipedia;
		// Honest-empty: upstream parse succeeded (matches existed, none with the
		// focus team) — tell retainLastGood NOT to re-serve the old file. Without
		// this, "100 Thieves has no scheduled matches" was indistinguishable from
		// a dead fetcher and kept a stale file + a false stale-retained alarm for
		// days. parsedMatches === 0 stays retention-eligible: an empty PARSE is
		// the parser-regression case retention exists for.
		if ((response.tournaments?.length ?? 0) === 0 && upstream?.parsedMatches > 0) {
			response._noRetain = true;
		}
		return response;
	}
}

export async function fetchEsports() {
	const fetcher = new EsportsFetcher();
	return await fetcher.fetch();
}
