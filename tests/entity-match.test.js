// WP-251 — "which entity IS this board string?" is answered by the MOST SPECIFIC
// overlap, never by whichever entity happens to come first in the pool.
//
// The two bugs frozen here both shipped a WRONG mark, which is strictly worse
// than no mark — a crest is trusted wordlessly, so a wrong one lies faster than
// any text can:
//
//   «Nord-Irland» → `irland`         — the hyphen is a word boundary, so the
//                                      Republic of Ireland's entity overlapped a
//                                      Northern Ireland fixture and flew IE's flag.
//   «Inter Milan» → `ac-milan`       — AC Milan's ESPN shortDisplayName alias is
//                                      "Milan", which "Inter Milan" contains. A
//                                      REGRESSION: before the Serie A entities
//                                      landed, the same string resolved correctly.
//
// Neither was a matching bug in `containsName` — both overlaps are real. The bug
// was resolving a multi-candidate overlap by LIST INDEX, which is no reason at
// all for the right team to win.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { findEntityId, matchSpecificity, EXACT_MATCH } from "../scripts/lib/entity-match.js";
import { normalizeText } from "../scripts/lib/helpers.js";

const team = (id, name, aliases = [], sport = "football") => ({ id, name, aliases, sport, type: "team" });

/** The adversarial pool ORDER — the wrong entity first, exactly as shipped. */
const IRELAND_POOL = [
	team("irland", "Irland", ["Republic of Ireland", "Rep Ireland"]),
	team("nord-irland", "Nord-Irland", ["Northern Ireland", "N Ireland"]),
];
const MILAN_POOL = [
	team("ac-milan", "AC Milan", ["Milan"]),
	team("internazionale", "Internazionale", ["Inter Milan"]),
];

describe("findEntityId: the most specific match wins, not the first", () => {
	it("«Nord-Irland» is Nord-Irland, even with «Irland» first in the pool", () => {
		expect(findEntityId("Nord-Irland", IRELAND_POOL, "football")).toBe("nord-irland");
	});

	it("…and «Irland» still resolves to the Republic", () => {
		expect(findEntityId("Irland", IRELAND_POOL, "football")).toBe("irland");
	});

	it("«Inter Milan» is Internazionale, even with AC Milan's «Milan» alias first", () => {
		expect(findEntityId("Inter Milan", MILAN_POOL, "football")).toBe("internazionale");
	});

	it("…and «AC Milan» / bare «Milan» still resolve to AC Milan", () => {
		// "Milan" is AC Milan's own alias — an EXACT term match beats merely being
		// a word inside Internazionale's "Inter Milan".
		expect(findEntityId("AC Milan", MILAN_POOL, "football")).toBe("ac-milan");
		expect(findEntityId("Milan", MILAN_POOL, "football")).toBe("ac-milan");
	});

	it("order-independence is the actual property: reversing the pool changes nothing", () => {
		for (const [pool, cases] of [
			[IRELAND_POOL, { "Nord-Irland": "nord-irland", Irland: "irland" }],
			[MILAN_POOL, { "Inter Milan": "internazionale", "AC Milan": "ac-milan" }],
		]) {
			for (const [name, id] of Object.entries(cases)) {
				expect(findEntityId(name, pool, "football"), `${name} (pool order)`).toBe(id);
				expect(findEntityId(name, [...pool].reverse(), "football"), `${name} (reversed)`).toBe(id);
			}
		}
	});

	it("a longer partial beats a shorter one — «Nord-Irland U21» is still Nord-Irland", () => {
		// No exact match anywhere; "Nord-Irland" (11) must beat "Irland" (6).
		expect(findEntityId("Nord-Irland U21", IRELAND_POOL, "football")).toBe("nord-irland");
	});

	it("keeps the Brooklyn/Lyn word-boundary guarantee — specificity never loosens matching", () => {
		const pool = [team("fk-lyn-oslo", "Lyn", ["Lyn Oslo"])];
		expect(findEntityId("Brooklyn FC", pool, "football")).toBeNull();
		expect(findEntityId("Vålerenga-Lyn", pool, "football")).toBe("fk-lyn-oslo");
	});

	it("stays sport-scoped — a football club never claims a chess row", () => {
		const pool = [team("barcelona", "Barcelona", [], "football")];
		expect(findEntityId("Barcelona", pool, "chess")).toBeNull();
		expect(findEntityId("Barcelona", pool, "football")).toBe("barcelona");
	});

	it("ties keep POOL ORDER — that is what keeps team entities ahead of club-as-league duplicates", () => {
		const pool = [
			team("tromso", "Tromsø"),
			{ id: "tromso-conference-league-playoff-2026-27", name: "Tromsø", aliases: [], sport: "football", type: "league" },
		];
		expect(findEntityId("Tromsø", pool, "football")).toBe("tromso");
	});

	it("an unmatched name is null, not a nearest guess", () => {
		expect(findEntityId("Egnatia", MILAN_POOL, "football")).toBeNull();
		expect(findEntityId("", MILAN_POOL, "football")).toBeNull();
		expect(findEntityId(null, MILAN_POOL, "football")).toBeNull();
	});
});

describe("matchSpecificity scores overlap, not mere truthiness", () => {
	const s = (a, b) => matchSpecificity(normalizeText(a).trim(), normalizeText(b).trim());

	it("equality outranks every containment", () => {
		expect(s("Nord-Irland", "Nord-Irland")).toBe(EXACT_MATCH);
		expect(s("Nord-Irland", "Irland")).toBeLessThan(EXACT_MATCH);
	});

	it("equality is accent- and case-folded, like the rest of the matcher", () => {
		expect(s("Barça", "BARCA")).toBe(EXACT_MATCH);
	});

	it("a partial scores the length of the OVERLAP, in either direction", () => {
		expect(s("Nord-Irland", "Irland")).toBe(6);
		expect(s("Irland", "Nord-Irland")).toBe(6);
		expect(s("Inter Milan", "Milan")).toBe(5);
	});

	it("no word-boundary overlap scores 0 — substring alone is never a match", () => {
		expect(s("Brooklyn FC", "Lyn")).toBe(0);
		expect(s("Hamburger SV", "Hamburg")).toBe(0);
		expect(s("Liverpool", "")).toBe(0);
	});
});

// The pool-wide invariant. Under first-hit matching this was false for 62
// entities in the shipped registry (esports "BIG Academy" → `big`, handball
// "Tysklands herrelandslag" → `ost-tysklands-…`); ordering happened to spare
// football until this package's Serie A entities landed next to Internazionale.
// Reading the registry files directly is deliberate — it is the seeder's own
// output, the artifact a re-seed can regress, and it needs no index build.
describe("registry invariant: every entity's own name resolves to itself", () => {
	const registryDir = path.join(process.cwd(), "scripts", "config", "registry");
	const files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json")).sort();
	const entities = files.flatMap((f) => JSON.parse(fs.readFileSync(path.join(registryDir, f), "utf8")).entities || []);

	it("holds for every canonical name in every registry file", () => {
		const pool = entities;
		const broken = entities
			.map((e) => ({ e, got: findEntityId(e.name, pool, e.sport) }))
			.filter(({ e, got }) => got !== e.id)
			.map(({ e, got }) => `${e.sport}: «${e.name}» (${e.id}) → ${got}`);
		expect(broken).toEqual([]);
	});

	it("holds for every alias too — an alias must not hand a row to a neighbour", () => {
		const pool = entities;
		const broken = entities
			.flatMap((e) => (e.aliases || []).map((a) => ({ e, a, got: findEntityId(a, pool, e.sport) })))
			.filter(({ e, got }) => got !== e.id)
			.map(({ e, a, got }) => `${e.sport}: «${a}» (alias of ${e.id}) → ${got}`);
		expect(broken).toEqual([]);
	});

	it("names the two rows that sent this package back, against the real registry", () => {
		const football = entities.filter((e) => e.sport === "football");
		expect(findEntityId("Nord-Irland", football, "football")).toBe("nord-irland");
		expect(findEntityId("Inter Milan", football, "football")).toBe("internazionale");
		// The Norwegian exonym gap in the same class: a board row writing
		// «Hviterussland» reached no entity at all, so Belarus got no flag.
		expect(findEntityId("Hviterussland", football, "football")).toBe("belarus");
	});
});
