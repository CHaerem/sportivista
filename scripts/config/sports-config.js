export const sportsConfig = {
	football: {
		sport: "football",
		enabled: true,
		source: "ESPN API + fotball.no",
		sources: [
			{
				api: "espn",
				type: "scoreboard",
				baseUrl: "https://site.api.espn.com/apis/site/v2/sports/soccer",
				leagues: [
					{ code: "eng.1", name: "Premier League" },
					{ code: "esp.1", name: "La Liga" },
					{ code: "ita.1", name: "Serie A" },
					{ code: "ger.1", name: "Bundesliga" },
					{ code: "esp.copa_del_rey", name: "Copa del Rey" },
					{ code: "uefa.champions", name: "Champions League" },
					{ code: "nor.1", name: "Eliteserien" },
					{ code: "nor.2", name: "OBOS-ligaen" },
					// NB: ESPN has no Norwegian Cup (NM Cupen) endpoint — "nor.cup"
					// returns HTTP 400 (nor.1/nor.2 return 200). The research agent
					// covers NM Cupen instead. Do not re-add a nor.cup source here.
					{ code: "fifa.world", name: "FIFA World Cup" }
				]
			},
			{
				api: "fotball.no",
				type: "custom",
				enabled: true
			}
		],
		filters: {
			// Was 30 — too small once Serie A (ita.1) + Bundesliga (ger.1) joined the
			// wholesale ESPN leagues (improve PR #466). Every normal matchweek the seven
			// configured leagues (PL/La Liga/Serie A/Bundesliga/CL/Eliteserien/OBOS) over a
			// 7-day window exceed 30 — measured 42 on a non-CL week, 66 on a Champions League
			// week — so a 30-cut silently dropped whole COVERED leagues (Bundesliga vanished
			// entirely, Serie A truncated), and build-events' graft-then-drop then made
			// hand-boarded CL fixtures disappear for good on the next window (the recurring
			// Sep MD1 regression, flagged run-after-run in tracked.json). football is catalog
			// tier1 (wholesale), so the cap is a swamp guard only — every fixture it produces
			// is already covered — set to comfortably hold the heaviest realistic week.
			maxEvents: 90,
			custom: true
		},
		norwegian: {
			// WP-133: "Norge" before "Norway" so the consolidated national-team
			// entity is `norge` (the Norwegian display name); build-entities folds
			// "Norway" in as an alias via the curated known-alias table. Order is
			// registration priority only — fetcher relevance filtering treats this
			// list as a set, so the reorder is behaviourally inert there.
			teams: ["FK Lyn Oslo", "Lyn", "Norge", "Norway"],
			filterMode: "focused"
		},
		streaming: {
			norwegian: [
				{ platform: "TV2 Play", url: "https://play.tv2.no", type: "tv2" }
			]
		}
	},

	tennis: {
		sport: "tennis",
		enabled: true,
		source: "ESPN Tennis API",
		sources: [
			{
				api: "espn",
				type: "scoreboard",
				baseUrl: "https://site.api.espn.com/apis/site/v2/sports/tennis",
				leagues: [
					{ code: "atp", name: "ATP Tour" },
					{ code: "wta", name: "WTA Tour" }
				]
			}
		],
		filters: {
			timeRange: 7,
			maxEvents: 10,
			custom: true
		},
		norwegian: {
			players: ["Casper Ruud"],
			filterMode: "focused"
		}
	},

	golf: {
		sport: "golf",
		enabled: true,
		source: "ESPN API + PGA Tour",
		sources: [
			{
				api: "espn",
				type: "scoreboard",
				tours: [
					{ url: "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard", name: "PGA Tour" },
					{ url: "https://site.api.espn.com/apis/site/v2/sports/golf/eur/scoreboard", name: "DP World Tour" }
				]
			}
		],
		filters: {
			timeRange: 14,
			maxEvents: 6,
			custom: true
		},
		norwegian: {
			players: [
				"Viktor Hovland",
				"Kristoffer Reitan",
				"Kris Ventura",
				"Espen Kofstad",
				"Anders Krogstad",
				"Kristian Krogh Johannessen",
				"Eivind Henriksen",
				"Andreas Halvorsen"
			],
			filterMode: "exclusive"
		}
	},

	f1: {
		sport: "formula1",
		enabled: true,
		source: "ESPN F1 Racing API",
		sources: [
			{
				api: "espn",
				type: "scoreboard",
				url: "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard"
			}
		],
		filters: {
			timeRange: 30,
			maxEvents: 4
		},
		norwegian: {
			enabled: false
		}
	},

	chess: {
		sport: "chess",
		enabled: true,
		source: "Lichess + AI research",
		// The old "curated" source read scripts/config/chess-tournaments.json and
		// norwegian-chess-players.json, both removed in the v2 rebuild (chess is an
		// API-less sport maintained by the research agent per CLAUDE.md). Keeping the
		// source made the fetcher throw ENOENT on every pipeline run. Lichess is the
		// only live source; upcoming/off-API events come from the research agent.
		sources: [
			{
				api: "lichess",
				type: "broadcast",
				url: "https://lichess.org/api/broadcast",
				filterProfessional: true
			}
		],
		filters: {
			currentWeek: true,
			custom: true
		},
		norwegian: {
			players: ["Magnus Carlsen", "Johan-Sebastian Christiansen", "Aryan Tari"],
			filterMode: "inclusive"
		},
		streaming: [
			{ platform: "Chess24", url: "https://chess24.com", type: "chess24" },
			{ platform: "Lichess", url: "https://lichess.org", type: "lichess" }
		]
	},

	cycling: {
		sport: "cycling",
		enabled: true,
		source: "Curated configs",
		sources: [
			{
				api: "curated-configs",
				type: "local",
				enabled: true,
				note: "No live API — build-events.js's generic config pass reads curated configs; events come from the research agent"
			}
		],
		filters: {
			timeRange: 30,
			maxEvents: 10
		},
		norwegian: {
			teams: ["Uno-X Mobility", "Uno-X"],
			players: [
				"Tobias Halland Johannessen",
				"Jonas Abrahamsen",
				"Søren Wærenskjold",
				"Markus Hoelgaard",
				"Andreas Leknessund"
			],
			filterMode: "inclusive"
		},
		streaming: [
			{ platform: "Eurosport", url: "https://www.eurosport.no", type: "eurosport" },
			{ platform: "Discovery+", url: "https://www.discoveryplus.no", type: "streaming" }
		]
	},

	esports: {
		sport: "esports",
		enabled: true,
		source: "Liquipedia matches + curated configs",
		sources: [
			{
				// Ground truth for CS2 match times. The Liquipedia:Matches widget lists
				// upcoming matches (all tiers) with exact timestamps, usually well before
				// a team's own X post — so this catches 100 Thieves matches (majors AND
				// smaller tournaments, kept via the focus-team filter) hourly.
				api: "liquipedia",
				type: "api",
				enabled: true,
				url: "https://liquipedia.net/counterstrike/api.php",
				params: { action: "parse", page: "Liquipedia:Matches", format: "json" },
				note: "MediaWiki parse API; parsed by parseLiquipediaMatches()"
			}
		],
		filters: {
			timeRange: 14,
			maxEvents: 10,
			// Owner interest: CS2 only matters when 100 Thieves (rain) plays. This is
			// the sole focus-team filter — matches without 100 Thieves are dropped.
			teams: ["100 Thieves", "100T"]
		},
		norwegian: {
			teams: ["100 Thieves", "100T"],
			players: ["rain"],
			filterMode: "inclusive"
		},
		// CS2 broadcasts are free on the tournament's own stream — usually Twitch,
		// increasingly Kick. Generic platform pointers (honest about where, not a
		// specific wrong channel); the cs2-sources skill has research/verify resolve
		// the exact tournament channel when it can.
		streaming: [
			{ platform: "Twitch", url: "https://twitch.tv", type: "twitch" },
			{ platform: "Kick", url: "https://kick.com", type: "kick" }
		]
	}
};