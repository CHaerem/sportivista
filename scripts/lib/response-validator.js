/**
 * Response validators for external API data.
 * Each validator returns { valid: boolean, data: any, warnings: string[] }.
 * Validators preserve resilience: they filter invalid items rather than
 * rejecting the entire response.
 */

function warn(warnings, code, message) {
	warnings.push(`[${code}] ${message}`);
}

/**
 * Validate an ESPN scoreboard response, dropping malformed events.
 *
 * @param {object} data        the parsed ESPN scoreboard response
 * @param {string} sportName   label for warnings
 * @param {object} [opts]
 * @param {boolean} [opts.requireCompetitors=true]  when false, an event whose
 *   competition has an empty `competitors` array is KEPT. Most ESPN fetchers
 *   (football, F1, tennis) legitimately need two competitors to describe a
 *   fixture, so the default drops the competitor-less event. Golf is the
 *   exception: a tournament's field is not published until tournament week, so
 *   a scheduled FUTURE tournament arrives with `competitions:[{competitors:[]}]`
 *   — dropping it here is why golf.json went empty between tournaments and the
 *   WP-243 golf coverage-contract kept breaching (the research agent then
 *   hand-boarded the next event every week). golf.js passes false so those
 *   future tournaments survive to its own "field pending" handling. The default
 *   is unchanged, so every other caller behaves byte-identically.
 */
export function validateESPNScoreboard(data, sportName = "unknown", { requireCompetitors = true } = {}) {
	const warnings = [];

	if (!data || typeof data !== "object") {
		warn(warnings, "invalid_response", `${sportName}: response is not an object`);
		return { valid: false, events: [], warnings };
	}

	if (!Array.isArray(data.events)) {
		warn(warnings, "missing_events", `${sportName}: response missing 'events' array`);
		return { valid: false, events: [], warnings };
	}

	const validEvents = data.events.filter((event) => {
		if (!event || typeof event !== "object") {
			warn(warnings, "invalid_event", `${sportName}: non-object event filtered out`);
			return false;
		}
		if (!event.date) {
			warn(warnings, "missing_date", `${sportName}: event missing 'date'`);
			return false;
		}
		if (!Array.isArray(event.competitions) || event.competitions.length === 0) {
			warn(warnings, "missing_competitions", `${sportName}: event '${event.name || "unknown"}' has no competitions`);
			return false;
		}
		const comp = event.competitions[0];
		if (requireCompetitors && (!Array.isArray(comp.competitors) || comp.competitors.length === 0)) {
			warn(warnings, "missing_competitors", `${sportName}: event '${event.name || "unknown"}' has no competitors`);
			return false;
		}
		return true;
	});

	return { valid: true, events: validEvents, warnings };
}

export function validateESPNStandings(data, standingType = "unknown") {
	const warnings = [];

	if (!data || typeof data !== "object") {
		warn(warnings, "invalid_response", `${standingType}: response is not an object`);
		return { valid: false, entries: [], warnings };
	}

	const group = data.children?.[0];
	if (!group?.standings?.entries) {
		warn(warnings, "missing_entries", `${standingType}: no standings entries found`);
		return { valid: false, entries: [], warnings };
	}

	if (!Array.isArray(group.standings.entries) || group.standings.entries.length === 0) {
		warn(warnings, "empty_entries", `${standingType}: standings entries array is empty`);
		return { valid: true, entries: [], warnings };
	}

	return { valid: true, entries: group.standings.entries, warnings };
}
