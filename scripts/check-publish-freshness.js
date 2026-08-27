#!/usr/bin/env node
// WP-248 · Publiserings-ferskhetsvakten.
//
// Lærdommen fra august 2026: én Pages-deploy ble stående i «waiting» og holdt
// `pages-deploy`-køgruppen i FIRE UKER — hver senere deploy stilte seg bak og
// ble kansellert av nestemann. Repoet fikk friske data hver time, agentene
// kjørte, alle helsesignaler lyste grønt … og nettsiden serverte en måned
// gamle data. Ingen vakt så det, av en presis grunn: alle signalene
// (build-alert, port-report, coverage-vaktene) dømmer REPOETS data — ingen
// dømte den PUBLISERTE kopien. self-repair leter etter FEILEDE kjøringer, og
// disse feilet aldri: de sto «pending»/«cancelled», som ser uskyldig ut.
//
// Denne proben lukker gapet mekanisk: hent den live sidens data/meta.json
// (domenet fra docs/CNAME), sammenlikn med repoets, og skriv dommen til
// docs/data/publish-freshness.json (committes av pipelinens datacommit, så
// git-historikken PER KJØRING er gratis). Ved etterslep over terskelen
// annoteres kjøringen med ::error:: — men proben feller ALDRI pipelinen
// (exit 0 alltid): en deploy-jam må aldri hindre at data commites og neste
// deploy forsøkes, for det er nettopp deployen som helbreder tilstanden.
// self-repair-agenten leser signalet og rydder køen (se self-repair.md).
//
// Terskel: crontab-hullene er maks 3 t (00→03) og en frisk deploy setter live
// nøyaktig lik forrige stamp — normalt etterslep er derfor 0–3 t. 6 t betyr
// flere misset deploys på rad, aldri et enkelt hikke.
//
// «unknown» (nettverksfeil, manglende CNAME, uparsbare stamp) alarmerer ikke
// — én mislykket henting er probens egen flaks, ikke sidens helse. Men en
// LANG stripe unknown i filas git-historikk er sin egen lukt; self-repair er
// bedt om å se etter den.

import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { rootDataPath, writeJsonPretty } from "./lib/helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Over dette etterslepet (repo-stamp minus live-stamp) er den publiserte kopien foreldet. */
export const STALE_THRESHOLD_HOURS = 6;
const FETCH_TIMEOUT_MS = 10_000;

/** Ren dom: fresh/stale/unknown + etterslep i timer (repo − live; negativt = fersk). */
export function assessPublishFreshness(liveIso, repoIso, { thresholdHours = STALE_THRESHOLD_HOURS } = {}) {
	const live = Date.parse(liveIso);
	const repo = Date.parse(repoIso);
	if (Number.isNaN(live) || Number.isNaN(repo)) return { status: "unknown", lagHours: null };
	const lagHours = Math.round(((repo - live) / 36e5) * 10) / 10;
	return { status: lagHours > thresholdHours ? "stale" : "fresh", lagHours };
}

/** Den live kopiens meta-URL, utledet fra docs/CNAME (null når domenet er ukjent). */
export function liveMetaUrl({ cnamePath } = {}) {
	const file = cnamePath || path.join(__dirname, "..", "docs", "CNAME");
	try {
		const domain = fs.readFileSync(file, "utf-8").split("\n")[0].trim();
		if (domain) return `https://${domain}/data/meta.json`;
	} catch {
		// intet CNAME — proben melder unknown i stedet for å gjette domene
	}
	return null;
}

/**
 * Kjør proben: les repoets meta.json, hent den live, døm, og skriv
 * publish-freshness.json til dataDir. Fail-soft hele veien — returnerer alltid
 * resultatobjektet, kaster aldri. fetchImpl injiseres i tester (nettverksfritt).
 */
export async function checkPublishFreshness({
	fetchImpl = fetch,
	dataDir = rootDataPath(),
	url = liveMetaUrl(),
	now = Date.now(),
} = {}) {
	const result = {
		checkedAt: new Date(now).toISOString(),
		url,
		thresholdHours: STALE_THRESHOLD_HOURS,
		status: "unknown",
		lagHours: null,
		live: null,
		repo: null,
		note: null,
	};
	try {
		result.repo = JSON.parse(fs.readFileSync(path.join(dataDir, "meta.json"), "utf-8")).lastUpdated || null;
	} catch {
		result.note = "repoets meta.json mangler/uleselig";
	}
	if (!url) {
		result.note = "docs/CNAME mangler — vet ikke hvor den publiserte kopien bor";
	} else if (result.repo) {
		try {
			// ?fresh= busts Pages/CDN-cachen så vi dømmer det som faktisk serveres nå
			const res = await fetchImpl(`${url}?fresh=${now}`, {
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
				headers: { "user-agent": "sportivista-publish-freshness (+https://github.com/CHaerem/sportivista)" },
			});
			if (!res.ok) {
				result.note = `live henting HTTP ${res.status}`;
			} else {
				result.live = (await res.json()).lastUpdated || null;
				const verdict = assessPublishFreshness(result.live, result.repo);
				result.status = verdict.status;
				result.lagHours = verdict.lagHours;
				if (verdict.status === "unknown") result.note = "uparsbare tidsstempler";
			}
		} catch (e) {
			result.note = `live henting feilet: ${e?.name === "TimeoutError" ? "timeout" : e?.message || e}`;
		}
	}
	writeJsonPretty(path.join(dataDir, "publish-freshness.json"), result);
	return result;
}

async function main() {
	const r = await checkPublishFreshness();
	const lag = r.lagHours != null ? ` (live henger ${r.lagHours} t bak repoet)` : "";
	console.log(`publish-freshness: ${r.status}${lag}${r.note ? ` — ${r.note}` : ""}`);
	if (r.status === "stale") {
		console.log(
			`::error title=Publisert kopi er foreldet::${r.url} sier lastUpdated=${r.live}, repoet sier ${r.repo} — ${r.lagHours} t etterslep (terskel ${r.thresholdHours} t). Deployene lander ikke: sjekk pages-deploy-køen for waiting/fastlåste kjøringer (self-repair.md har oppskriften).`
		);
	}
	// Aldri non-zero: en deploy-jam må ikke hindre datacommit + neste deploy-forsøk.
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	main();
}
