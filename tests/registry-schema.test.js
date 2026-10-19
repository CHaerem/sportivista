// WP-161: the world registry (scripts/config/registry/*.json) is the seeded,
// durable FOLLOW UNIVERSE — a lookup, never a coverage promise. This coherence
// test is its CI contract (à la catalog-schema.test.js): every file validates
// against registry.schema.json via the tiny dependency-free validator, plus the
// invariants the schema language can't express (kebab ids, global uniqueness,
// sorted determinism, non-empty external) and the acceptance floor (the world
// scale itself, both in the registry and in the built entity index).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { validateAgainstSchema } from "../scripts/lib/validate-schema.js";
import { buildEntityIndex } from "../scripts/build-entities.js";

const configDir = path.resolve(process.cwd(), "scripts", "config");
const registryDir = path.join(configDir, "registry");
const schema = JSON.parse(fs.readFileSync(path.join(configDir, "registry.schema.json"), "utf-8"));

const EXPECTED_FILES = [
	"athletics.json", "chess.json", "cycling.json", "esports.json", "f1.json",
	"football.json", "handball.json", "tennis.json", "winter.json",
];

const files = fs.readdirSync(registryDir).filter((f) => f.endsWith(".json")).sort();
const registries = files.map((f) => ({
	file: f,
	data: JSON.parse(fs.readFileSync(path.join(registryDir, f), "utf-8")),
	raw: fs.readFileSync(path.join(registryDir, f), "utf-8"),
}));

const validate = (data) => validateAgainstSchema(data, schema, schema);

describe("registry files against registry.schema.json", () => {
	it("all nine contracted sport files exist", () => {
		expect(files).toEqual(EXPECTED_FILES);
	});

	it("every registry file validates with zero errors", () => {
		for (const { file, data } of registries) {
			expect(validate(data), file).toEqual([]);
		}
	});

	it("the validator actually catches violations (so the contract has teeth)", () => {
		const base = registries[0].data;
		const bad = (mutate) => {
			const clone = JSON.parse(JSON.stringify(base));
			mutate(clone);
			return validate(clone).length;
		};
		expect(bad((r) => delete r.entities[0].id)).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].sport = "quidditch"))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].type = "mascot"))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].external.hltv = "123"))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].surprise = true))).toBeGreaterThan(0);
		expect(bad((r) => delete r.entities)).toBeGreaterThan(0);
		// WP-185 identity metadata — the `pattern` keyword must actually bite.
		expect(bad((r) => (r.entities[0].country = "Norge"))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].country = "GB-XXX"))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].colors = { primary: "e20520" }))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].colors = { secondary: "#003399" }))).toBeGreaterThan(0);
		expect(bad((r) => (r.entities[0].national = "yes"))).toBeGreaterThan(0);
	});
});

// The registry is the entity follow-universe; the schema's own description says
// its sport tag uses "samme vokabular som catalog.json". A value catalog.json can
// stamp on an entity (e.g. "beach volleyball" on Mol/Sørum, catalog tier2) but the
// registry schema rejects silently blocks the research/improve agents from
// registering that entity — the drift the research-log flagged as a FUNN for improve.
describe("sport vocabulary tracks catalog.json entity vocabulary", () => {
	const catalogSchema = JSON.parse(
		fs.readFileSync(path.join(configDir, "catalog.schema.json"), "utf-8")
	);
	const registrySports = schema.definitions.entity.properties.sport.enum;
	const catalogEntitySports =
		catalogSchema.definitions.entity.anyOf.find((s) => s.type === "object")
			.properties.sport.enum;

	it("the registry sport enum covers every catalog entity sport", () => {
		const missing = catalogEntitySports.filter((s) => !registrySports.includes(s));
		expect(missing, `registry sport enum missing: ${missing.join(", ")}`).toEqual([]);
	});

	it("includes beach volleyball (Mol/Sørum, catalog tier2)", () => {
		expect(registrySports).toContain("beach volleyball");
	});
});

// WP-185: the row avatar is only as honest as this metadata. These pin the
// invariants the JSON-Schema keywords can't state.
describe("WP-185 identity metadata (country / national / colors)", () => {
	it("every country is ISO 3166 — no source dialect survives the seed", () => {
		for (const { file, data } of registries) {
			for (const e of data.entities) {
				if (!e.country) continue;
				expect(e.country, `${file}: ${e.id}`).toMatch(/^([A-Z]{2}|GB-(ENG|SCT|WLS|NIR))$/);
			}
		}
	});

	it("colours are canonical lowercase #rrggbb, and a secondary never repeats the primary", () => {
		for (const { file, data } of registries) {
			for (const e of data.entities) {
				if (!e.colors) continue;
				expect(e.colors.primary, `${file}: ${e.id}`).toMatch(/^#[0-9a-f]{6}$/);
				if (e.colors.secondary) {
					expect(e.colors.secondary, `${file}: ${e.id}`).toMatch(/^#[0-9a-f]{6}$/);
					expect(e.colors.secondary).not.toBe(e.colors.primary);
				}
			}
		}
	});

	it("`national` is only ever true, and only on teams (a person is not a landslag)", () => {
		for (const { file, data } of registries) {
			for (const e of data.entities) {
				if (e.national === undefined) continue;
				expect(e.national, `${file}: ${e.id}`).toBe(true);
				expect(e.type, `${file}: ${e.id}`).toBe("team");
			}
		}
	});

	it("the seed actually delivered identity at scale (the acceptance floor)", () => {
		const all = registries.flatMap(({ data }) => data.entities);
		expect(all.filter((e) => e.country).length).toBeGreaterThanOrEqual(2000);  // flags
		expect(all.filter((e) => e.colors).length).toBeGreaterThanOrEqual(100);    // monograms
		expect(all.filter((e) => e.national).length).toBeGreaterThanOrEqual(40);
	});
});

describe("registry invariants the schema can't express", () => {
	it("ids are kebab-slugs, globally unique across ALL registry files", () => {
		const seen = new Map();
		for (const { file, data } of registries) {
			for (const e of data.entities) {
				expect(e.id, `${file}: "${e.id}"`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
				expect(seen.has(e.id), `${file}: duplicate id "${e.id}" (also in ${seen.get(e.id)})`).toBe(false);
				seen.set(e.id, file);
			}
		}
	});

	it("entities are sorted by id (deterministic serialization — re-seeds diff cleanly)", () => {
		for (const { file, data } of registries) {
			const ids = data.entities.map((e) => e.id);
			expect(ids, file).toEqual([...ids].sort());
		}
	});

	it("every entity carries at least one external source id (the re-seed/dedup key)", () => {
		for (const { file, data } of registries) {
			for (const e of data.entities) {
				expect(Object.keys(e.external || {}).length, `${file}: ${e.id} has empty external`).toBeGreaterThan(0);
			}
		}
	});

	it("files are tab-indented with a trailing newline (stable serialization)", () => {
		for (const { file, raw } of registries) {
			expect(raw.startsWith("{\n\t"), file).toBe(true);
			expect(raw.endsWith("}\n"), file).toBe(true);
		}
	});

	it("the registry carries the world scale the WP contracts (~1 500–5 000)", () => {
		const total = registries.reduce((n, { data }) => n + data.entities.length, 0);
		expect(total).toBeGreaterThanOrEqual(1500);
		expect(total).toBeLessThanOrEqual(5000);
	});
});

describe("the built entity index at world scale (real config)", () => {
	// One real build, shared across the assertions below (it costs seconds).
	const entities = buildEntityIndex(configDir);
	const byId = new Map(entities.map((e) => [e.id, e]));

	it("entities.json reaches the acceptance floor with external ids", () => {
		expect(entities.length).toBeGreaterThanOrEqual(1500);
		const withExternal = entities.filter((e) => e.external && Object.keys(e.external).length > 0);
		expect(withExternal.length).toBeGreaterThanOrEqual(1500);
	});

	it("pre-registry follow-targets keep their published ids and gain external ids from the registry", () => {
		// The registry folds LAST so no published id ever silently changes —
		// these are ids real profiles may already follow (WP-160/WP-163/164).
		expect(byId.get("liverpool")).toMatchObject({ type: "team", sport: "football" });
		expect(byId.get("liverpool").external).toMatchObject({ espnId: expect.any(String) });
		expect(byId.get("norge")).toMatchObject({ name: "Norge", type: "team" });
		expect(byId.get("norge").external).toMatchObject({ espnId: expect.any(String) });
		expect(byId.get("magnus-carlsen").external).toMatchObject({ fideId: "1503014" });
		expect(byId.get("uno-x-mobility").external).toMatchObject({ wikidata: expect.stringMatching(/^Q\d+$/) });
		expect(byId.get("100-thieves").external).toMatchObject({ liquipedia: "100_Thieves" });
	});

	it("the manifest contract handles the size: a serialized index stays well under 1 MB", () => {
		// Chunking per sport is the DOCUMENTED fallback if this ever crosses
		// 1 MB (see registry.schema.json / PLAN.md WP-161); this pins that we
		// have not crossed it silently.
		const bytes = Buffer.byteLength(JSON.stringify(entities, null, 2));
		expect(bytes).toBeLessThan(1024 * 1024);
	});
});
