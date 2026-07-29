// WP-241: authority.json er AUTORITETSKARTET — hvem SKAPER faktumet, per dekket
// konkurranse. To kilder per event fordi produktets to kjernefelt har to ulike
// skapere: arrangøren/ligaen/forbundet setter TIDEN, kringkasteren setter
// KANALEN. Denne koherenstesten er kartets CI-kontrakt (à la
// sources-schema.test.js): skjemavalidering med den samme avhengighetsfrie
// validatoren, pluss invariantene skjemaspråket ikke kan uttrykke — at hver
// sourceId faktisk finnes i sources.json (WP-240-registeret er sannheten om
// hvilket domene som ER arrangøren), at tidsautoriteter er primær/forbund og
// kanalautoriteter kringkaster/selv-strømmende arrangør (rolledoktrinen), og at
// et ærlig hull (tom kildeliste) alltid bærer en forklaring.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { validateAgainstSchema } from "../scripts/lib/validate-schema.js";

const configDir = path.resolve(process.cwd(), "scripts", "config");
const authority = JSON.parse(fs.readFileSync(path.join(configDir, "authority.json"), "utf-8"));
const schema = JSON.parse(fs.readFileSync(path.join(configDir, "authority.schema.json"), "utf-8"));
const register = JSON.parse(fs.readFileSync(path.join(configDir, "sources.json"), "utf-8"));

const validate = (data) => validateAgainstSchema(data, schema, schema);
const competitions = authority.competitions;
const sourceById = new Map(register.sources.map((s) => [s.id, s]));

// FRYST forankring i tavla slik den så ut da kartet ble seedet (29.07.2026) —
// konkurransene et events.json-øyeblikksbilde faktisk bar. Fryst med vilje
// (samme begrunnelse som sources-schema.test.js sin seed-liste): docs/data/
// skrives om hver time, og en test som drev med dataene ville rødne av
// datadrift alene. Kartet kan alltid VOKSE; disse skal aldri stille forsvinne.
const SEEDED_BOARD_COMPETITIONS_2026_07_29 = [
	"athletics:diamond-league",
	"athletics:em-friidrett",
	"athletics:nm-friidrett",
	"chess:esports-world-cup",
	"chess:grand-chess-tour",
	"cycling:arctic-race-of-norway",
	"cycling:danmark-rundt",
	"cycling:tour-de-france",
	"cycling:tour-de-france-femmes",
	"cycling:tour-de-pologne",
	"cycling:vuelta-a-espana",
	"esports:blast",
	"esports:esports-world-cup",
	"esports:starladder",
	"f1:world-championship",
	"football:champions-league",
	"football:club-friendlies",
	"football:community-shield",
	"football:conference-league",
	"football:eliteserien",
	"football:europa-league",
	"football:la-liga",
	"football:obos-ligaen",
	"football:premier-league",
	"football:super-cup",
	"football:world-cup",
	"golf:dp-world-tour",
	"golf:pga-tour",
	"tennis:tour",
];

describe("authority.json mot authority.schema.json", () => {
	it("kartet validerer med null feil", () => {
		expect(validate(authority)).toEqual([]);
	});

	it("validatoren fanger faktisk brudd (så kontrakten har tenner)", () => {
		const bad = (mutate) => {
			const clone = JSON.parse(JSON.stringify(authority));
			mutate(clone);
			return validate(clone).length;
		};
		expect(bad((a) => (a.competitions[0].id = "ikke sport-kolon-form"))).toBeGreaterThan(0);
		expect(bad((a) => delete a.competitions[0].time)).toBeGreaterThan(0);
		expect(bad((a) => delete a.competitions[0].channel)).toBeGreaterThan(0);
		expect(bad((a) => delete a.competitions[0].match)).toBeGreaterThan(0);
		expect(bad((a) => (a.competitions[0].time.sourceIds = "letour"))).toBeGreaterThan(0);
		expect(bad((a) => (a.competitions[0].channel.options = [{ platform: "TV 2" }]))).toBeGreaterThan(0);
		expect(bad((a) => (a.competitions[0].surprise = true))).toBeGreaterThan(0);
		expect(bad((a) => delete a.updatedAt)).toBeGreaterThan(0);
	});
});

describe("authority.json — identitet og determinisme", () => {
	it("id-ene er unike", () => {
		const ids = competitions.map((c) => c.id);
		expect(ids.length).toBe(new Set(ids).size);
	});

	it("konkurransene er sortert på id (ren diff ved endringer)", () => {
		const ids = competitions.map((c) => c.id);
		expect(ids).toEqual([...ids].sort());
	});

	it("id-ens sport-prefiks stemmer med sport-feltet", () => {
		for (const c of competitions) {
			expect(c.id.split(":")[0], c.id).toBe(c.sport);
		}
	});

	it("hvert match-mønster er små bokstaver (substring-kontrakten i provenance.js)", () => {
		for (const c of competitions) {
			for (const m of c.match) {
				expect(m, `${c.id}: "${m}"`).toBe(m.toLowerCase());
				expect(m.trim().length, `${c.id}: tomt mønster`).toBeGreaterThan(0);
			}
		}
	});
});

describe("authority.json — rolledoktrinen (broen til sources.json)", () => {
	it("hver tids-sourceId finnes i registeret og er primær eller forbund", () => {
		for (const c of competitions) {
			for (const id of c.time.sourceIds) {
				const src = sourceById.get(id);
				expect(src, `${c.id}: ukjent tidskilde "${id}"`).toBeTruthy();
				expect(["primary", "federation"], `${c.id}: ${id} (${src.role}) kan ikke skape tiden`).toContain(src.role);
			}
		}
	});

	it("hver kanal-sourceId finnes i registeret og er kringkaster (eller selv-strømmende arrangør)", () => {
		for (const c of competitions) {
			for (const opt of c.channel.options) {
				const src = sourceById.get(opt.sourceId);
				expect(src, `${c.id}: ukjent kanalkilde "${opt.sourceId}"`).toBeTruthy();
				expect(
					["official-broadcaster", "primary"],
					`${c.id}: ${opt.sourceId} (${src.role}) kan ikke bære kanalen`
				).toContain(src.role);
			}
		}
	});

	it("en tidsautoritet er faktisk autoritativ for konkurransens sport", () => {
		for (const c of competitions) {
			for (const id of c.time.sourceIds) {
				const src = sourceById.get(id);
				const covers = (src.authorityFor || []).some((a) => a === c.sport || a.startsWith(`${c.sport}:`));
				expect(covers, `${c.id}: ${id} hevder ingen autoritet i ${c.sport} (authorityFor: ${JSON.stringify(src.authorityFor)})`).toBe(true);
			}
		}
	});

	it("et ærlig hull (tom kildeliste) bærer alltid en forklaring", () => {
		for (const c of competitions) {
			if (c.time.sourceIds.length === 0) {
				expect(c.time.note, `${c.id}: tom time.sourceIds uten note`).toBeTruthy();
			}
			if (c.channel.options.length === 0) {
				expect(c.channel.note, `${c.id}: tomme channel.options uten note`).toBeTruthy();
			}
		}
	});
});

describe("authority.json — dekning og lookalike-vernet", () => {
	it("hver konkurranse fra seed-tavla står fortsatt i kartet", () => {
		const ids = new Set(competitions.map((c) => c.id));
		const missing = SEEDED_BOARD_COMPETITIONS_2026_07_29.filter((id) => !ids.has(id));
		expect(missing, `seedede konkurranser borte fra kartet: ${missing.join(", ")}`).toEqual([]);
	});

	it("opphavseksempelet er registrert: franceletour.com står som lookalike på Tour de France", () => {
		const tdf = competitions.find((c) => c.id === "cycling:tour-de-france");
		expect(tdf.lookalikes).toContain("franceletour.com");
	});

	it("et lookalike-domene er ALDRI samtidig en registrert vert i kilderegisteret", () => {
		const hostOf = (u) => {
			try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
		};
		const registered = new Set(
			register.sources.flatMap((s) => [s.url, ...(s.endpoints || [])].map(hostOf).filter(Boolean))
		);
		for (const c of competitions) {
			for (const domain of c.lookalikes || []) {
				expect(registered.has(domain.toLowerCase()), `${c.id}: lookalike "${domain}" er registrert som ekte kilde`).toBe(false);
			}
		}
	});
});
