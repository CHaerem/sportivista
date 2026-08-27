/**
 * WP-161: ESPN seeds — the mechanical club/driver/player universe from the
 * SAME host the pipeline's APIClient already uses (site.api.espn.com):
 *
 *   - football: the teams API for every league that reaches the BOARD (see
 *     FOOTBALL_LEAGUES below). esp.copa_del_rey is deliberately SKIPPED: its 126
 *     entries reach deep into regional Spanish football (quality over raw count;
 *     esp.1 already covers La Liga).
 *   - f1: the standings API — the current drivers' + constructors' fields.
 *   - tennis: the atp/wta rankings API — top-100 per tour.
 *
 * Transforms are pure (JSON in → entity candidates out) so tests run
 * network-free with fixtures; only the seed* entry points fetch.
 */

import { normalizeColors } from "./seed-lib.js";
import { boardName } from "../lib/board-names.js";

const HOST = "https://site.api.espn.com/apis/site/v2/sports";
const F1_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/racing/f1/standings";

/**
 * The football leagues seeded into the registry.
 *
 * The selection rule (WP-251), stated so it can be applied again rather than
 * guessed at: **seed the leagues that reach the BOARD**, not only the ones the
 * fetcher polls. catalog.json makes football a tier1 sport — covered wholesale —
 * so the research agent fills leagues no fetcher touches, and every club it
 * names arrives with no entity, no colours and no mark. The registry is a
 * LOOKUP, never a coverage promise (registry.schema.json), so widening it costs
 * nothing at fetch time and is exactly what it is for.
 *
 * Two groups:
 *   - the leagues sports-config polls (eng.1, esp.1, nor.1, nor.2, uefa.champions);
 *   - the leagues the research agent demonstrably fills (ita.1, ger.1 — measured
 *     on the live board, where Serie A and Bundesliga clubs were 30 of the 44
 *     unidentified team rows).
 *
 * DELIBERATELY NOT HERE, and the honest reason: uefa.europa + uefa.europa.conf
 * would add 59 further clubs (~465 kB of marks) to identify the 3 board rows
 * their league phases actually cover — and the European rows a Norwegian club
 * plays are QUALIFYING rounds, whose opponents (Egnatia, NEC Nijmegen) are not
 * in ESPN's league-phase team lists at all. Poor value per byte, so those rows
 * keep an honest monogram. Add a league here when the board shows it, not before.
 *
 * `national: true` marks a landslag seed — the flag gate. Those entities are
 * excluded from the logo seed by design (a federation crest would quietly demote
 * the flag on "Norge – Sverige"), so a national league costs ZERO checked-in
 * assets while still giving every side an entity, a country and a flag.
 */
export const FOOTBALL_LEAGUES = [
	{ code: "eng.1", name: "Premier League" },
	{ code: "esp.1", name: "La Liga" },
	{ code: "nor.1", name: "Eliteserien" },
	{ code: "nor.2", name: "OBOS-ligaen" },
	{ code: "uefa.champions", name: "Champions League" },
	{ code: "ita.1", name: "Serie A" },
	{ code: "ger.1", name: "Bundesliga" },
	{ code: "fifa.world", name: "FIFA World Cup", national: true },
	{ code: "uefa.nations", name: "UEFA Nations League", national: true },
];

/** teams[] out of an ESPN teams-API response (defensive against shape drift). */
function espnTeams(json) {
	return (json?.sports?.[0]?.leagues?.[0]?.teams || []).map((t) => t.team).filter((t) => t?.displayName);
}

/**
 * One league's teams-API response → entity candidates. National-team leagues
 * (fifa.world, uefa.nations) carry the country in the display name itself; club
 * leagues get no country (ESPN doesn't expose it). shortDisplayName becomes an
 * alias only when it differs and is a real word (never the 3-letter abbreviation
 * — too collision-prone for word-boundary server matching).
 *
 * WP-251: the entity's canonical `name` is the name THE BOARD uses (`boardName`,
 * scripts/lib/board-names.js), and ESPN's own spelling is folded in as an alias.
 * Without it the registry stored "Tromso"/"Hamarkameratene"/"Denmark" while the
 * board rendered "Tromsø"/"HamKam"/"Danmark", the two never matched, and the row
 * silently lost its entityId — and with it its club mark, its colours and its
 * followability. `country` still comes from ESPN's ENGLISH display name, because
 * that is the dialect lib/country.js's curated table is keyed on.
 */
export function footballEntitiesFromTeams(json, { national = false } = {}) {
	return espnTeams(json).map((t) => {
		const name = boardName(t.displayName);
		const aliases = [];
		// ESPN's own spelling is what every other ESPN-fed surface says, so it must
		// stay matchable — it is an alias precisely when the board renamed it.
		if (name !== t.displayName) aliases.push(t.displayName);
		if (t.shortDisplayName && t.shortDisplayName !== name && t.shortDisplayName !== t.displayName && t.shortDisplayName.length >= 4) {
			aliases.push(t.shortDisplayName);
		}
		const entity = {
			name,
			aliases,
			sport: "football",
			type: "team",
			external: { espnId: String(t.id) },
		};
		if (national) {
			entity.country = t.displayName;   // ESPN's English name — normalised to ISO by mergeRegistry
			entity.national = true;           // WP-185: a landslag flies the FLAG, a club wears the MONOGRAM
		}
		const colors = espnColors(t);
		if (colors) entity.colors = colors;
		return entity;
	});
}

/**
 * WP-185: ESPN's `color` / `alternateColor` (bare 6-digit hex, no "#") → the
 * registry's `colors` block, the source of the club MONOGRAM's two tints.
 * `normalizeColors` (seed-lib) canonicalises and drops a secondary identical to
 * the primary; a team with no usable colour simply gets no `colors` and the
 * client degrades to the sport glyph.
 */
export function espnColors(team) {
	return normalizeColors({ primary: team?.color, secondary: team?.alternateColor });
}

/** The F1 standings response → driver (athlete) + constructor (team) candidates. */
export function f1EntitiesFromStandings(json) {
	const out = [];
	for (const child of json?.children || []) {
		for (const entry of child?.standings?.entries || []) {
			if (entry.athlete?.displayName) {
				const e = {
					name: entry.athlete.displayName,
					aliases: [],
					sport: "f1",
					type: "athlete",
					external: { espnId: String(entry.athlete.id) },
				};
				if (entry.athlete.flag?.alt) e.country = entry.athlete.flag.alt;
				out.push(e);
			} else if (entry.team?.displayName) {
				const team = {
					name: entry.team.displayName,
					aliases: [],
					sport: "f1",
					type: "team",
					external: { espnId: String(entry.team.id) },
				};
				const colors = espnColors(entry.team);
				if (colors) team.colors = colors;
				out.push(team);
			}
		}
	}
	return out;
}

/**
 * A tennis rankings response → top-N athlete candidates. No aliases: the
 * "J. Sinner" shortname is app-side sugar the resolver derives itself, and a
 * bare surname is too collision-prone for word-boundary server matching.
 */
export function tennisEntitiesFromRankings(json, { top = 100 } = {}) {
	const ranks = json?.rankings?.[0]?.ranks || [];
	return ranks
		.filter((r) => r?.athlete?.displayName)
		.slice(0, top)
		.map((r) => {
			const e = {
				name: r.athlete.displayName,
				aliases: [],
				sport: "tennis",
				type: "athlete",
				external: { espnId: String(r.athlete.id) },
			};
			if (r.athlete.citizenshipCountry) e.country = r.athlete.citizenshipCountry;
			return e;
		});
}

/**
 * Live seed: football (all covered leagues, deduped downstream by mergeRegistry).
 *
 * WP-251: a league that returns ZERO teams is reported, not swallowed. ESPN's
 * `nor.2` (OBOS-ligaen) has been answering 200-with-an-empty-list, so the seed
 * quietly contributed nothing for a whole league — which is why Kongsvinger and
 * Åsane reach the board with no entity at all. A silent zero looks exactly like
 * a league with no clubs; saying so out loud is the difference between a known
 * hole and an invisible one.
 */
export async function seedFootball(fetchJson, { log = console.log } = {}) {
	const out = [];
	for (const league of FOOTBALL_LEAGUES) {
		const json = await fetchJson(`${HOST}/soccer/${league.code}/teams?limit=400`);
		const entities = footballEntitiesFromTeams(json, { national: !!league.national });
		if (!entities.length) log(`   ⚠ ${league.code} (${league.name}): 0 lag fra ESPN — ligaen bidrar ingenting til registeret`);
		out.push(...entities);
	}
	return out;
}

/** Live seed: F1 drivers + constructors. */
export async function seedF1(fetchJson) {
	return f1EntitiesFromStandings(await fetchJson(F1_STANDINGS_URL));
}

/** Live seed: ATP + WTA top-100. */
export async function seedTennis(fetchJson) {
	const atp = tennisEntitiesFromRankings(await fetchJson(`${HOST}/tennis/atp/rankings`));
	const wta = tennisEntitiesFromRankings(await fetchJson(`${HOST}/tennis/wta/rankings`));
	return [...atp, ...wta];
}
