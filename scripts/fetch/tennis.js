import { ESPNAdapter } from "../lib/adapters/espn-adapter.js";
import { sportsConfig } from "../config/sports-config.js";
import { EventNormalizer } from "../lib/event-normalizer.js";

export class TennisFetcher extends ESPNAdapter {
	constructor() {
		super(sportsConfig.tennis);
	}

	// The owner interest is «Casper Ruud kamper», not just the tournament: ESPN's
	// scoreboard carries every match in `groupings[].competitions`, so alongside
	// the tournament umbrella we emit one event per not-yet-finished match that
	// features a followed Norwegian player — with the actual match time, court
	// and opponent. Future rounds sit as TBD-vs-TBD upstream and are skipped
	// until the draw names the player, so a row only appears once it is real.
	transformToEvents(rawData) {
		const events = super.transformToEvents(rawData);
		for (const espnEvent of rawData) {
			for (const raw of this.extractFocusMatches(espnEvent)) {
				const normalized = EventNormalizer.normalize(raw, this.config.sport);
				if (normalized && EventNormalizer.validateEvent(normalized)) {
					events.push(normalized);
				}
			}
		}
		return EventNormalizer.deduplicate(events);
	}

	extractFocusMatches(espnEvent) {
		const players = this.config.norwegian?.players || [];
		if (players.length === 0 || !Array.isArray(espnEvent?.groupings)) return [];

		const out = [];
		for (const grouping of espnEvent.groupings) {
			for (const comp of grouping.competitions || []) {
				// Finished matches belong to results, not the agenda. A live match
				// (state "in", completed false) stays.
				if (comp.status?.type?.completed === true) continue;
				if (!comp.date) continue;

				const names = (comp.competitors || [])
					.map((c) => c.athlete?.displayName || c.team?.displayName || "")
					.filter(Boolean);
				const focus = names.find((n) =>
					players.some((p) => n.toLowerCase() === p.toLowerCase() || n.toLowerCase().includes(p.toLowerCase()))
				);
				if (!focus) continue;

				const opponent = names.find((n) => n !== focus) || "TBD";
				const court = comp.venue?.court;
				out.push({
					title: `${focus} – ${opponent}`,
					time: comp.date,
					venue: court || comp.venue?.fullName || espnEvent.venue?.fullName || "TBD",
					tournament: espnEvent.name,
					meta: grouping.grouping?.displayName
						? `${espnEvent.name} · ${grouping.grouping.displayName}`
						: espnEvent.name,
					streaming: [],
					status: comp.status?.type?.name,
					norwegian: true,
				});
			}
		}
		return out;
	}

	transformESPNEvent(espnEvent) {
		const event = super.transformESPNEvent(espnEvent);

		// If parent returns null (no competitions), create tournament-level event
		// for focused mode — shows tournament schedule even without match data
		if (!event && espnEvent && this.config.norwegian?.filterMode === "focused") {
			const statusName = espnEvent.status?.type?.name || "";
			// Skip completed tournaments. ESPN stamps a RUNNING multi-day tournament
			// STATUS_FINAL after each finished session (bit us for the whole US Open
			// 2026), so when endDate exists the calendar decides — status alone only
			// decides for events without one.
			const ended = espnEvent.endDate
				? new Date(espnEvent.endDate) < new Date()
				: statusName === "STATUS_FINAL";
			if (ended) return null;
			if (!espnEvent.name || !espnEvent.date) return null;

			const tournamentEvent = {
				title: espnEvent.name,
				time: espnEvent.date,
				endTime: espnEvent.endDate || null,
				venue: espnEvent.venue?.fullName || espnEvent.venue?.address?.city || "TBD",
				tournament: espnEvent.sourceName || "ATP/WTA Tour",
				streaming: [],
				status: statusName,
				_isTournament: true,
			};
			tournamentEvent.norwegian = this._checkNorwegian(espnEvent);
			return tournamentEvent;
		}

		if (!event) return null;

		// Handle different tennis data structures
		if (espnEvent.competitors && !espnEvent.competitions) {
			const competitors = espnEvent.competitors;
			event.participants = [
				competitors[0]?.displayName || competitors[0]?.team?.displayName || "TBD",
				competitors[1]?.displayName || competitors[1]?.team?.displayName || "TBD"
			];
			event.title = event.participants.join(" vs ");
		}

		// Extract from event name if needed
		if (!event.participants && espnEvent.name?.includes(" vs ")) {
			const parts = espnEvent.name.split(" vs ");
			if (parts.length === 2) {
				event.participants = parts.map(p => p.trim());
				event.title = espnEvent.name;
			}
		}

		event.norwegian = this._checkNorwegian(espnEvent);
		return event;
	}

	_checkNorwegian(espnEvent) {
		if (!this.config.norwegian?.players) return false;
		const eventText = JSON.stringify(espnEvent).toLowerCase();
		return this.config.norwegian.players.some(player => {
			const nameParts = player.toLowerCase().split(/[\s,]+/).filter(p => p.length >= 3);
			if (nameParts.length === 0) return false;
			return nameParts.every(part => eventText.includes(part));
		});
	}

	applyCustomFilters(events) {
		// For tennis, only show matches with Norwegian players
		if (this.config.norwegian?.filterMode === "exclusive") {
			return events.filter(event => event.norwegian);
		}
		return super.applyCustomFilters(events);
	}
}

export async function fetchTennis() {
	const fetcher = new TennisFetcher();
	return await fetcher.fetch();
}