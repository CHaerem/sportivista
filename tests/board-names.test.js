// WP-251: the board-name table (scripts/lib/board-names.js) and the invariant it
// exists to hold — the WORLD REGISTRY must store the name THE BOARD USES, so an
// event row and its entity actually match and the row keeps its club mark.
//
// The bug these tests freeze: Sportivista renames ESPN's clubs into Norwegian
// ("Hamarkameratene" → "HamKam", "Tromso" → "Tromsø") while the registry stored
// only ESPN's spelling. `containsName` folds only what NFD decomposes, and "ø"
// is its own code point — so "Tromsø" never matched "Tromso", the row lost its
// entityId, and the mark, colours and followability went with it.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { NORWEGIAN_CLUBS, FOREIGN_CLUBS, NATIONS, boardName, norwegianClubName } from "../scripts/lib/board-names.js";
import { containsName } from "../scripts/lib/helpers.js";
import { norwegianClubName as fetcherClubName } from "../scripts/fetch/football.js";

const registryPath = path.join(process.cwd(), "scripts", "config", "registry", "football.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")).entities;

/** The exact reachability question findEntityId asks (build-events.js). */
const reaches = (a, b) => containsName(a, b) || containsName(b, a);

describe("the table maps ESPN's spelling to the board's", () => {
	it("folds the Norwegian clubs the fetcher renames", () => {
		expect(boardName("Tromso")).toBe("Tromsø");
		expect(boardName("Hamarkameratene")).toBe("HamKam");
		expect(boardName("Sarpsborg FK")).toBe("Sarpsborg 08");
		expect(boardName("Bodo/Glimt")).toBe("Bodø/Glimt");
	});

	it("folds the foreign clubs and the national sides", () => {
		expect(boardName("FC Cologne")).toBe("1. FC Köln");
		expect(boardName("Hamburg SV")).toBe("Hamburger SV");
		expect(boardName("Denmark")).toBe("Danmark");
		expect(boardName("Germany")).toBe("Tyskland");
	});

	it("passes an unmapped name through untouched — a promoted club is never mangled", () => {
		expect(boardName("Liverpool")).toBe("Liverpool");
		expect(boardName("Bryne")).toBe("Bryne");
		expect(boardName("")).toBe("");
		expect(boardName(undefined)).toBe("");
	});

	it("norwegianClubName stays scoped to the Norwegian leagues — the fetcher's contract", () => {
		// football.js applies it ONLY to nor.* fixtures, so it must not rename
		// clubs in leagues it was never asked to translate.
		expect(norwegianClubName("Tromso")).toBe("Tromsø");
		expect(norwegianClubName("FC Cologne")).toBe("FC Cologne");
		expect(norwegianClubName("Denmark")).toBe("Denmark");
	});

	it("the fetcher re-exports the SAME function — one table, not two copies", () => {
		expect(fetcherClubName).toBe(norwegianClubName);
	});
});

describe("every row in the tables earns its place", () => {
	it("no row is a no-op", () => {
		for (const [espn, board] of Object.entries({ ...NORWEGIAN_CLUBS, ...FOREIGN_CLUBS, ...NATIONS })) {
			expect(espn, `«${espn}» maps to itself`).not.toBe(board);
		}
	});

	it("a FOREIGN_CLUBS row is either unmatchable or purely typographic — never noise", () => {
		// containsName is BIDIRECTIONAL, so "Roma" ⇄ "AS Roma" and "Mainz 05" ⇄
		// "Mainz" already match unaided. A row that ESPN's name can already reach
		// is dead weight unless it is fixing how the name READS (ESPN's shouting).
		for (const [espn, board] of Object.entries(FOREIGN_CLUBS)) {
			if (!reaches(board, espn)) continue; // justification 1: unmatchable
			expect(espn.toLowerCase(), `«${espn}» → «${board}» is already matchable and is not a typography fix`).toBe(board.toLowerCase());
		}
	});

	it("the Norwegian clubs really are unreachable without the table — the accent trap", () => {
		// The four that motivated the WP: without the alias these never matched.
		for (const espn of ["Tromso", "Lillestrom", "Hamarkameratene", "Sarpsborg FK"]) {
			expect(reaches(NORWEGIAN_CLUBS[espn], espn), `«${espn}» unexpectedly reachable`).toBe(false);
		}
	});
});

describe("the seeded registry stores board names, not source names", () => {
	it("no football entity carries a name the board would rename", () => {
		const drifted = registry.filter((e) => boardName(e.name) !== e.name);
		expect(drifted.map((e) => `${e.id}: ${e.name} → ${boardName(e.name)}`)).toEqual([]);
	});

	it("a renamed entity keeps ESPN's spelling as an alias — ESPN-fed text must still match", () => {
		for (const [espn, board] of Object.entries(NORWEGIAN_CLUBS)) {
			const entity = registry.find((e) => e.name === board);
			if (!entity) continue; // not every mapped club is in a seeded league
			const terms = [entity.name, ...(entity.aliases || [])];
			expect(terms.some((t) => reaches(t, espn)), `${entity.id} lost «${espn}»`).toBe(true);
		}
	});

	it("the clubs whose rows were unidentified now resolve, mark and all", () => {
		// The exact names the live board renders (Serie A + Bundesliga via the
		// research agent, the Norwegian clubs via the fetcher's own renaming).
		for (const name of ["Tromsø", "Lillestrøm", "HamKam", "Sarpsborg 08", "AC Milan", "Bologna", "Cagliari", "1. FC Köln", "Hamburger SV", "Borussia Mönchengladbach"]) {
			const hit = registry.find((e) => [e.name, ...(e.aliases || [])].some((t) => reaches(name, t)));
			expect(hit, `board row «${name}» has no entity`).toBeTruthy();
			expect(hit.logo?.file, `«${name}» (${hit.id}) has an entity but no mark`).toBeTruthy();
		}
	});

	it("national sides carry a country instead of a mark — the flag rung of the ladder", () => {
		for (const name of ["Norge", "Danmark", "Portugal"]) {
			const hit = registry.find((e) => e.name === name);
			expect(hit, `no entity for «${name}»`).toBeTruthy();
			expect(hit.national).toBe(true);
			expect(hit.country).toMatch(/^([A-Z]{2}|GB-(ENG|SCT|WLS|NIR))$/);
			expect(hit.logo, "a landslag flies the flag; a federation crest would demote it").toBeUndefined();
		}
	});
});

describe("every shipped mark has an asset AND its provenance", () => {
	it("no registry record points at a missing file", () => {
		const missing = registry
			.filter((e) => e.logo)
			.filter((e) => !fs.existsSync(path.join(process.cwd(), "docs", "logos", e.logo.file)));
		expect(missing.map((e) => e.id)).toEqual([]);
	});

	it("every mark names its basis and where it came from — no anonymous crests", () => {
		for (const e of registry.filter((x) => x.logo)) {
			expect(["free-license", "editorial-use"], `${e.id}`).toContain(e.logo.basis);
			expect(e.logo.source, `${e.id} has no source`).toBeTruthy();
			expect(e.logo.sourceUrl, `${e.id} has no sourceUrl`).toBeTruthy();
			if (e.logo.basis === "free-license") expect(e.logo.license, `${e.id} claims a free licence but names none`).toBeTruthy();
		}
	});
});
