import { ESPNAdapter } from "../lib/adapters/espn-adapter.js";
import { sportsConfig } from "../config/sports-config.js";

export class TennisFetcher extends ESPNAdapter {
	constructor() {
		super(sportsConfig.tennis);
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