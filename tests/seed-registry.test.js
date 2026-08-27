// WP-161: the registry seed scripts (scripts/seed-registry/) — NETWORK-FREE.
// Every transform is pure (source payload in → entity candidates out) and is
// exercised here with fixture payloads shaped exactly like the live responses;
// the merge/serialization contract (stable ids across re-seeds, deterministic
// bytes) is what makes the checked-in registry files reviewable artifacts.
import { describe, it, expect } from "vitest";
import { mergeRegistry, serializeRegistry, slugify, normalizeHexColor, normalizeColors, normalizeIdentity } from "../scripts/seed-registry/seed-lib.js";
import { toIsoCountry, isIsoCountry } from "../scripts/lib/country.js";
import { footballEntitiesFromTeams, f1EntitiesFromStandings, tennisEntitiesFromRankings, FOOTBALL_LEAGUES } from "../scripts/seed-registry/espn.js";
import { chessEntitiesFromTopList, flipFideName } from "../scripts/seed-registry/fide.js";
import { esportsEntitiesFromPortalHtml, decodeHtmlEntities } from "../scripts/seed-registry/liquipedia.js";
import { cyclingTeamEntities, cyclingRiderEntities, athleteEntities, teamEntities, WINTER_SPORTS } from "../scripts/seed-registry/wikidata.js";

// --- fixtures (mirrors of the live response shapes) ---

const espnTeamsFixture = {
	sports: [{ leagues: [{ teams: [
		{ team: { id: "364", displayName: "Liverpool", shortDisplayName: "Liverpool", abbreviation: "LIV" } },
		{ team: { id: "349", displayName: "AFC Bournemouth", shortDisplayName: "Bournemouth", abbreviation: "BOU" } },
		{ team: { id: "0", abbreviation: "XXX" } }, // no displayName → dropped
	] }] }],
};

const espnRankingsFixture = {
	rankings: [{ name: "ATP", ranks: [
		{ current: 1, athlete: { id: "3623", displayName: "Jannik Sinner", shortname: "J. Sinner", citizenshipCountry: "ITA" } },
		{ current: 2, athlete: { id: "2989", displayName: "Casper Ruud", citizenshipCountry: "NOR" } },
		{ current: 3 }, // no athlete → dropped
	] }],
};

const espnF1Fixture = {
	children: [
		{ name: "Driver Standings", standings: { entries: [
			{ athlete: { id: "4665", displayName: "Max Verstappen", flag: { alt: "Netherlands" } } },
		] } },
		{ name: "Constructor Standings", standings: { entries: [
			{ team: { id: "106893", displayName: "Mercedes" } },
		] } },
	],
};

const fideHtmlFixture = `
<tr><td><span class="rank_span">1</span></td>
<td><a href=/profile/1503014>Carlsen, Magnus</a></td>
<td class="flag-wrapper"><img src="/images/flags/no.svg" height=20> NOR</td>
<td>2823</td><td>1990</td></tr>
<tr><td><span class="rank_span">2</span></td>
<td><a href=/profile/2020009>Nakamura, Hikaru</a></td>
<td class="flag-wrapper"><img src="/images/flags/us.svg" height=20> USA</td>
<td>2807</td><td>1987</td></tr>`;

const liquipediaHtmlFixture = `
<span class="team-template-text"><a href="/counterstrike/Natus_Vincere" title="Natus Vincere">Natus Vincere</a></span>
<span class="team-template-text"><a href="/counterstrike/Dobry%26Gaming" title="x">Dobry&amp;Gaming</a></span>
<span class="team-template-text"><a href="/counterstrike/Natus_Vincere" title="dup">Natus Vincere</a></span>
<span class="team-template-text"><a href="/counterstrike/index.php?title=Redlink&action=edit" title="x">Redlink</a></span>`;

const wd = (qid) => `http://www.wikidata.org/entity/${qid}`;

// --- transforms ---

describe("espn transforms", () => {
	it("covers the leagues that reach the BOARD — the fetcher's, plus the ones research fills", () => {
		// WP-251: the registry is a LOOKUP, not a coverage promise, so it must span
		// every league whose clubs appear on the board — including ita.1/ger.1,
		// which no fetcher polls but the research agent fills (football is tier1,
		// covered wholesale). A club with no entity has no mark and no follow.
		expect(FOOTBALL_LEAGUES.map((l) => l.code)).toEqual([
			"eng.1", "esp.1", "nor.1", "nor.2", "uefa.champions", "ita.1", "ger.1", "fifa.world", "uefa.nations",
		]);
	});

	it("marks exactly the national-team seeds — the flag gate, and the zero-asset half of the seed", () => {
		expect(FOOTBALL_LEAGUES.filter((l) => l.national).map((l) => l.code)).toEqual(["fifa.world", "uefa.nations"]);
	});

	it("teams API → team candidates with espnId; shortDisplayName alias only when real (≥4 chars, different)", () => {
		const out = footballEntitiesFromTeams(espnTeamsFixture);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ name: "Liverpool", aliases: [], sport: "football", type: "team", external: { espnId: "364" } });
		expect(out[1].aliases).toEqual(["Bournemouth"]); // never the 3-letter abbreviation
	});

	it("WP-251: the entity's name is the BOARD's, and ESPN's spelling survives as an alias", () => {
		const json = { sports: [{ leagues: [{ teams: [
			{ team: { id: "5270", displayName: "Tromso", shortDisplayName: "Tromso" } },
			{ team: { id: "21380", displayName: "Hamarkameratene", shortDisplayName: "Hamarkameratene" } },
		] }] }] };
		const [tromso, hamkam] = footballEntitiesFromTeams(json);
		// Without this the board's "Tromsø" never matched the registry's "Tromso"
		// (NFD leaves "ø" intact), and the row lost its entityId — and its mark.
		expect(tromso.name).toBe("Tromsø");
		expect(tromso.aliases).toEqual(["Tromso"]);
		expect(hamkam.name).toBe("HamKam");
		expect(hamkam.aliases).toEqual(["Hamarkameratene"]);
	});

	it("national-team leagues stamp the country from ESPN's ENGLISH name, not the board's", () => {
		const json = { sports: [{ leagues: [{ teams: [{ team: { id: "463", displayName: "Denmark" } }] }] }] };
		const [dk] = footballEntitiesFromTeams(json, { national: true });
		expect(dk.name).toBe("Danmark");        // the board speaks Norwegian
		expect(dk.country).toBe("Denmark");     // lib/country.js's table is keyed on ESPN's dialect
		expect(mergeRegistry([], [dk])[0].country).toBe("DK");
		expect(dk.national).toBe(true);
	});

	it("national-team leagues (fifa.world) stamp the country", () => {
		const out = footballEntitiesFromTeams(espnTeamsFixture, { national: true });
		expect(out[0].country).toBe("Liverpool"); // display name IS the country for fifa.world payloads
	});

	it("F1 standings → drivers as athletes + constructors as teams", () => {
		const out = f1EntitiesFromStandings(espnF1Fixture);
		expect(out).toEqual([
			{ name: "Max Verstappen", aliases: [], sport: "f1", type: "athlete", country: "Netherlands", external: { espnId: "4665" } },
			{ name: "Mercedes", aliases: [], sport: "f1", type: "team", external: { espnId: "106893" } },
		]);
	});

	it("tennis rankings → top-N athletes, no surname/shortname aliases", () => {
		const out = tennisEntitiesFromRankings(espnRankingsFixture, { top: 1 });
		expect(out).toEqual([
			{ name: "Jannik Sinner", aliases: [], sport: "tennis", type: "athlete", country: "ITA", external: { espnId: "3623" } },
		]);
	});
});

describe("fide transforms", () => {
	it('flips "Lastname, Firstname" and keeps plain names as-is', () => {
		expect(flipFideName("Carlsen, Magnus")).toBe("Magnus Carlsen");
		expect(flipFideName("Praggnanandhaa R")).toBe("Praggnanandhaa R");
	});

	it("top-list HTML → athletes with fideId + federation, no surname aliases", () => {
		const out = chessEntitiesFromTopList(fideHtmlFixture);
		expect(out).toEqual([
			{ name: "Magnus Carlsen", aliases: [], sport: "chess", type: "athlete", country: "NOR", external: { fideId: "1503014" } },
			{ name: "Hikaru Nakamura", aliases: [], sport: "chess", type: "athlete", country: "USA", external: { fideId: "2020009" } },
		]);
	});
});

describe("liquipedia transforms", () => {
	it("Portal:Teams HTML → orgs deduped by page, redlinks skipped, HTML entities decoded", () => {
		const out = esportsEntitiesFromPortalHtml(liquipediaHtmlFixture);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ name: "Natus Vincere", aliases: [], sport: "esports", type: "team", external: { liquipedia: "Natus_Vincere" } });
		expect(out[1].name).toBe("Dobry&Gaming");
		expect(out[1].external.liquipedia).toBe("Dobry&Gaming");
	});

	it("decodes the MediaWiki entity set", () => {
		expect(decodeHtmlEntities("A&amp;B &#39;x&#039; &quot;q&quot;")).toBe("A&B 'x' \"q\"");
	});
});

describe("wikidata transforms", () => {
	it("WorldTeam bindings → newest official name wins, stale label kept as alias", () => {
		const bindings = [
			{ team: { value: wd("Q6233") }, teamLabel: { value: "Team Jumbo-Visma" }, official: { value: "Team Jumbo-Visma" }, start: { value: "2019-01-01" } },
			{ team: { value: wd("Q6233") }, teamLabel: { value: "Team Jumbo-Visma" }, official: { value: "Team Visma | Lease a Bike" }, start: { value: "2024-01-01" } },
		];
		expect(cyclingTeamEntities(bindings)).toEqual([
			{ name: "Team Visma | Lease a Bike", aliases: ["Team Jumbo-Visma"], sport: "cycling", type: "team", external: { wikidata: "Q6233" } },
		]);
	});

	it("rider bindings → athletes deduped by QID, label-less items dropped", () => {
		const bindings = [
			{ rider: { value: wd("Q26904312") }, riderLabel: { value: "Tadej Pogačar" }, countryLabel: { value: "Slovenia" } },
			{ rider: { value: wd("Q26904312") }, riderLabel: { value: "Tadej Pogačar" } },
			{ rider: { value: wd("Q999") }, riderLabel: { value: "Q999" } },
		];
		const out = cyclingRiderEntities(bindings);
		expect(out).toEqual([
			{ name: "Tadej Pogačar", aliases: [], sport: "cycling", type: "athlete", country: "Slovenia", external: { wikidata: "Q26904312" } },
		]);
	});

	it("winter athlete bindings map each sport QID to its Sportivista tag", () => {
		const bindings = [
			{ a: { value: wd("Q1334428") }, aLabel: { value: "Johannes Thingnes Bø" }, sportQ: { value: "Q166788" }, countryLabel: { value: "Norge" }, links: { value: "30" } },
		];
		const out = athleteEntities(bindings, (q) => WINTER_SPORTS[q]);
		expect(out).toEqual([
			{ name: "Johannes Thingnes Bø", aliases: [], sport: "biathlon", type: "athlete", country: "Norge", external: { wikidata: "Q1334428" } },
		]);
	});

	it("team bindings (handball) → teams with a fixed sport tag", () => {
		const bindings = [
			{ t: { value: wd("Q19377654") }, tLabel: { value: "Kolstad Håndball" }, countryLabel: { value: "Norge" } },
		];
		expect(teamEntities(bindings, "handball")).toEqual([
			{ name: "Kolstad Håndball", aliases: [], sport: "handball", type: "team", country: "Norge", external: { wikidata: "Q19377654" } },
		]);
	});
});

// --- merge + serialization (the re-seed contract) ---

describe("mergeRegistry", () => {
	const existing = [
		{ id: "team-jumbo-visma", name: "Team Jumbo-Visma", aliases: [], sport: "cycling", type: "team", external: { wikidata: "Q6233" } },
	];

	it("a rename keeps the id (external match) and folds the old name into aliases", () => {
		const fresh = [{ name: "Team Visma | Lease a Bike", aliases: [], sport: "cycling", type: "team", external: { wikidata: "Q6233" } }];
		const out = mergeRegistry(existing, fresh);
		expect(out).toHaveLength(1);
		expect(out[0].id).toBe("team-jumbo-visma"); // stable primary key
		expect(out[0].name).toBe("Team Visma | Lease a Bike");
		expect(out[0].aliases).toContain("Team Jumbo-Visma");
	});

	it("slug match works when the source has no overlapping external id yet", () => {
		const fresh = [{ name: "Team Jumbo-Visma", aliases: ["TJV"], sport: "cycling", type: "team", external: { espnId: "77" } }];
		const out = mergeRegistry(existing, fresh);
		expect(out).toHaveLength(1);
		expect(out[0].external).toEqual({ wikidata: "Q6233", espnId: "77" });
		expect(out[0].aliases).toContain("TJV");
	});

	it("entities missing from a fresh seed are KEPT (the registry is durable)", () => {
		const out = mergeRegistry(existing, []);
		expect(out).toHaveLength(1);
		expect(out[0].name).toBe("Team Jumbo-Visma");
	});

	it("a new entity colliding with a reserved slug (another file) gets a deterministic suffix", () => {
		const fresh = [{ name: "Norway", aliases: [], sport: "handball", type: "team", external: { wikidata: "Q1" } }];
		const out = mergeRegistry([], fresh, new Set(["norway"]));
		expect(out[0].id).toBe("norway-2");
	});
});

describe("serializeRegistry (deterministic artifact)", () => {
	const meta = { $schema: "note", source: "test" };
	const entities = [
		{ id: "b-team", name: "B", aliases: [], sport: "football", type: "team", external: { espnId: "2" } },
		{ id: "a-team", name: "A", aliases: [], sport: "football", type: "team", country: "Norge", external: { espnId: "1" } },
	];

	it("sorts by id, uses tabs, ends with a newline, and is byte-stable across runs", () => {
		const one = serializeRegistry(meta, entities);
		const two = serializeRegistry(meta, [...entities].reverse());
		expect(one).toBe(two); // input order never leaks into the artifact
		expect(one.startsWith('{\n\t"$schema"')).toBe(true);
		expect(one.endsWith("}\n")).toBe(true);
		const parsed = JSON.parse(one);
		expect(parsed.entities.map((e) => e.id)).toEqual(["a-team", "b-team"]);
		// stable key order per entity
		expect(Object.keys(parsed.entities[0])).toEqual(["id", "name", "aliases", "sport", "type", "country", "external"]);
	});

	it("slugify matches build-entities (one slug algorithm across seed + build)", () => {
		expect(slugify("Søren Wærenskjold")).toBe("soren-waerenskjold");
		expect(slugify("Team Visma | Lease a Bike")).toBe("team-visma-lease-a-bike");
	});
});


// --- WP-185: identity metadata (ISO country, club colours, landslag flag) ---

describe("country normalisation (scripts/lib/country.js)", () => {
	it("folds all three source dialects into ISO alpha-2", () => {
		expect(toIsoCountry("NOR")).toBe("NO");      // FIDE federation code
		expect(toIsoCountry("Norway")).toBe("NO");   // ESPN English name
		expect(toIsoCountry("Norge")).toBe("NO");    // Wikidata nb label
		expect(toIsoCountry("Tyskland")).toBe("DE");
		expect(toIsoCountry("United States")).toBe("US");
		expect(toIsoCountry("Türkiye")).toBe("TR");  // diacritics stripped
		expect(toIsoCountry("Sør-Afrika")).toBe("ZA");
	});

	it("keeps the UK home nations distinct — sport does", () => {
		expect(toIsoCountry("ENG")).toBe("GB-ENG");
		expect(toIsoCountry("Scotland")).toBe("GB-SCT");
		expect(toIsoCountry("Great Britain")).toBe("GB");
	});

	it("passes an already-ISO value through unchanged (idempotent)", () => {
		expect(toIsoCountry("NO")).toBe("NO");
		expect(toIsoCountry("GB-ENG")).toBe("GB-ENG");
	});

	it("returns null rather than guessing a successor state", () => {
		// Registered federations/birth states with no ISO code today. A wrong flag
		// on a person is worse than no flag — the row keeps its sport glyph.
		for (const v of ["Sovjetunionen", "Jugoslavia", "Tsjekkoslovakia", "Øst-Tyskland", "Serbia og Montenegro", "FID", "", null]) {
			expect(toIsoCountry(v), String(v)).toBeNull();
		}
	});

	it("isIsoCountry accepts exactly what the schema pattern accepts", () => {
		expect(isIsoCountry("NO")).toBe(true);
		expect(isIsoCountry("GB-SCT")).toBe(true);
		expect(isIsoCountry("Norge")).toBe(false);
		expect(isIsoCountry("nor")).toBe(false);
	});
});

describe("colour + identity normalisation (seed-lib)", () => {
	it("canonicalises ESPN's bare hex", () => {
		expect(normalizeHexColor("E20520")).toBe("#e20520");
		expect(normalizeHexColor("#fff")).toBe("#ffffff");
		expect(normalizeHexColor("chartreuse")).toBeNull();
	});

	it("drops a secondary identical to the primary (no pointless gradient)", () => {
		expect(normalizeColors({ primary: "e20520", secondary: "E20520" })).toEqual({ primary: "#e20520" });
		expect(normalizeColors({ primary: "e20520", secondary: "003399" })).toEqual({ primary: "#e20520", secondary: "#003399" });
	});

	it("a secondary without a primary is no colour pair at all", () => {
		expect(normalizeColors({ secondary: "003399" })).toBeNull();
	});

	it("normalizeIdentity drops what it cannot canonicalise instead of keeping junk", () => {
		expect(normalizeIdentity({ id: "x", country: "Sovjetunionen", colors: { primary: "nope" } })).toEqual({ id: "x" });
		expect(normalizeIdentity({ id: "x", country: "NOR" })).toEqual({ id: "x", country: "NO" });
	});

	it("a re-seed converges EXISTING rows too, not just the ones the source returned", () => {
		const existing = [{ id: "a", name: "A", aliases: [], sport: "chess", type: "athlete", country: "GER", external: { fideId: "1" } }];
		const merged = mergeRegistry(existing, []);
		expect(merged[0].country).toBe("DE");
	});
});

describe("ESPN seeds carry the identity the avatar needs", () => {
	it("club teams get their kit colours", () => {
		const json = { sports: [{ leagues: [{ teams: [
			{ team: { id: "359", displayName: "Arsenal", color: "e20520", alternateColor: "003399" } },
			{ team: { id: "438", displayName: "Rosenborg", color: "ffffff", alternateColor: "ffffff" } },
			{ team: { id: "1", displayName: "Fargeøs FK" } },
		] }] }] };
		const [arsenal, rosenborg, plain] = footballEntitiesFromTeams(json);
		expect(arsenal.colors).toEqual({ primary: "#e20520", secondary: "#003399" });
		expect(rosenborg.colors).toEqual({ primary: "#ffffff" });
		expect(plain.colors).toBeUndefined();     // no colour → the sport glyph, honestly
		expect(arsenal.national).toBeUndefined(); // a club is not a landslag
	});

	it("only a national seed marks a team `national` (the flag gate)", () => {
		const json = { sports: [{ leagues: [{ teams: [{ team: { id: "464", displayName: "Norway", color: "c8102e" } }] }] }] };
		const [national] = footballEntitiesFromTeams(json, { national: true });
		expect(national.national).toBe(true);
		expect(national.name).toBe("Norge");
		expect(mergeRegistry([], [national])[0].country).toBe("NO");
	});
});

describe("Wikidata handball teams: landslag vs. klubb", () => {
	it("the ?national BIND separates the two UNION branches", () => {
		const bindings = [
			{ t: { value: "http://www.wikidata.org/entity/Q852003" }, tLabel: { value: "Norges herrelandslag i håndball" }, countryLabel: { value: "Norge" }, national: { value: "true" } },
			{ t: { value: "http://www.wikidata.org/entity/Q1" }, tLabel: { value: "Elverum Håndball" }, countryLabel: { value: "Norge" }, national: { value: "false" } },
		];
		const [landslag, klubb] = teamEntities(bindings, "handball");
		expect(landslag.national).toBe(true);
		expect(klubb.national).toBeUndefined();   // a club must never fly the flag
		expect(klubb.country).toBe("Norge");      // ISO-folded by mergeRegistry
	});
});
