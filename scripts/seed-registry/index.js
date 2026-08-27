#!/usr/bin/env node
/**
 * WP-161: seed the world registry — `npm run seed:registry [sport ...]`.
 *
 * Fetches each sport's mechanical source (ESPN teams/rankings/standings,
 * Wikidata SPARQL, FIDE top lists, Liquipedia Portal:Teams), merges the fresh
 * seed into the existing scripts/config/registry/<sport>.json (ids are stable:
 * external-id/slug matching keeps them across re-seeds; entities missing from
 * a fresh seed are kept — the registry is durable, pruning is the weekly AI
 * maintenance job), and writes the file deterministically (sorted by id).
 *
 * MANUAL/RARE by design: this hits third-party endpoints (Liquipedia asks for
 * ~30s between parse requests) and is run by a human or the improve agent —
 * never the hourly pipeline. A monthly re-seed GitHub Action is a documented
 * OWNER follow-up (`.github/workflows/**` is a protected path).
 *
 * Cross-file id uniqueness: before seeding a sport, every OTHER registry
 * file's ids are reserved, so a new slug that would collide gets a
 * deterministic suffix (tests/registry-schema.test.js enforces the invariant).
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { APIClient } from "../lib/api-client.js";
import { fetchText, configDirPath, readJsonIfExists } from "../lib/helpers.js";
import { mergeRegistry, serializeRegistry, schemaNote } from "./seed-lib.js";
import { seedFootball, seedF1, seedTennis } from "./espn.js";
import { seedChess } from "./fide.js";
import { seedEsports } from "./liquipedia.js";
import { seedCycling, seedWinter, seedAthletics, seedHandball } from "./wikidata.js";

const client = new APIClient({ timeout: 120000, cacheTimeout: 0 });
const fetchJson = (url, options) => client.fetchJSON(url, options);
const fetchHtml = (url) => fetchText(url, { headers: { "User-Agent": "Mozilla/5.0 (Sportivista registry seeder)" }, timeout: 60000 });

export const SEEDS = {
	football: {
		run: () => seedFootball(fetchJson),
		source: "espn-teams: eng.1 + esp.1 + nor.1 + nor.2 + uefa.champions + ita.1 + ger.1 + fifa.world + uefa.nations (landslag)",
		what: "fotball — alle klubber i ligaene som når tavla (fetcher + research) + VM- og Nations League-landslagene",
	},
	f1: {
		run: () => seedF1(fetchJson),
		source: "espn-standings: racing/f1 (førere + konstruktører)",
		what: "F1 — feltets førere og team",
	},
	tennis: {
		run: () => seedTennis(fetchJson),
		source: "espn-rankings: tennis/atp + tennis/wta (topp 100 per tour)",
		what: "tennis — ATP- og WTA-topp-100",
	},
	chess: {
		run: () => seedChess(fetchHtml),
		source: "fide-toplists: ratings.fide.com a_top open + women (topp 100 hver)",
		what: "sjakk — FIDE-topplistene (åpen + kvinner)",
	},
	esports: {
		run: () => seedEsports(fetchJson),
		source: "liquipedia: counterstrike Portal:Teams (aktive, navngitte orgs)",
		what: "esport (CS2) — aktive orgs fra Liquipedia",
		notes: "NB: noen org-navn er vanlige engelske gloser (Legacy, Wildcard, Aurora …). Server-siden er trygg der matchingen er sport-scopet (build-events), men news-matchingen er ikke — falske entityIds på nyheter treffer kun følgere av akkurat de orgene. WP-175 (register-basert news-matching) strammer dette.",
	},
	cycling: {
		run: () => seedCycling(fetchJson),
		source: "wikidata-sparql: UCI WorldTeams (menn+kvinner, nyeste offisielle navn) + nåværende ryttere (P54 uten sluttdato)",
		what: "sykkel — WorldTour-lag + deres nåværende ryttere",
	},
	winter: {
		run: () => seedWinter(fetchJson),
		source: "wikidata-sparql: aktive utøvere i skiskyting/langrenn/alpint/hopp/kombinert (norske + internasjonalt notable)",
		what: "vintersport — aktiv generasjon utøvere (tynnere v0 — AI-vedlikehold utvider)",
	},
	handball: {
		run: () => seedHandball(fetchJson),
		source: "wikidata-sparql: aktive håndballspillere (norske + notable) + norske klubber + landslag",
		what: "håndball — spillere, norske klubber og landslag (tynnere v0)",
	},
	athletics: {
		run: () => seedAthletics(fetchJson),
		source: "wikidata-sparql: aktive friidrettsutøvere (norske + internasjonalt notable)",
		what: "friidrett — aktiv generasjon utøvere (tynnere v0)",
	},
};

export function registryDirPath(configDir = configDirPath()) {
	return path.join(configDir, "registry");
}

/** Ids used by every registry file EXCEPT `skipFile` (cross-file uniqueness). */
export function reservedSlugsFor(registryDir, skipFile) {
	const reserved = new Set();
	if (!fs.existsSync(registryDir)) return reserved;
	for (const f of fs.readdirSync(registryDir)) {
		if (!f.endsWith(".json") || f === skipFile) continue;
		for (const e of readJsonIfExists(path.join(registryDir, f))?.entities || []) {
			if (e?.id) reserved.add(e.id);
		}
	}
	return reserved;
}

async function seedOne(sport, registryDir) {
	const seed = SEEDS[sport];
	const file = `${sport}.json`;
	const target = path.join(registryDir, file);
	const existing = readJsonIfExists(target)?.entities || [];
	const fresh = await seed.run();
	const merged = mergeRegistry(existing, fresh, reservedSlugsFor(registryDir, file));
	fs.writeFileSync(target, serializeRegistry({ $schema: schemaNote(seed.what), source: seed.source }, merged));
	console.log(`registry/${file}: ${merged.length} entities (${fresh.length} fra kilden, ${existing.length} fra før).`);
	return merged.length;
}

async function main() {
	const requested = process.argv.slice(2);
	const sports = requested.length ? requested : Object.keys(SEEDS);
	const unknown = sports.filter((s) => !SEEDS[s]);
	if (unknown.length) {
		console.error(`Ukjent sport: ${unknown.join(", ")}. Gyldige: ${Object.keys(SEEDS).join(", ")}`);
		process.exit(1);
	}
	const registryDir = registryDirPath();
	fs.mkdirSync(registryDir, { recursive: true });
	let total = 0;
	for (const [i, sport] of sports.entries()) {
		// Politeness pause between sources (Wikidata 429s on back-to-back heavy
		// SPARQL queries; Liquipedia asks for spacing). Manual runs only.
		if (i > 0) await new Promise((r) => setTimeout(r, 15000));
		total += await seedOne(sport, registryDir);
	}
	console.log(`Totalt ${total} entiteter i de seedede filene.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
