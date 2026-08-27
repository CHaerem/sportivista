// WP-245 · Kalibreringen styrer kildevalget bindende.
//
// `calibration.json` (mekanisk aggregert fra verify-agentens ledger) og
// `source-quirks` fantes og virket allerede — men de STYRTE ikke noe: en kilde
// målt til 0,53 kunne fortsatt stå som eneste grunnlag for et high-confidence-
// event (cyclingstage.com på TdF-etappene var det kanoniske tilfellet). Denne
// fila er den bindende biten: en kilde med MÅLT reliabilitet under
// RELIABILITY_FLOOR kan mekanisk aldri stå som eneste grunnlag.
//
// Bindingen er bevisst kirurgisk:
//   • Den fyrer kun når HELE evidensgrunnlaget (evidence + verificationSources)
//     løses til mistrodde kilder. Én ukjent kilde blokkerer — ukjent betyr
//     «ikke målt» (kalibreringen holder reliabilitet tilbake under 5 sjekker),
//     ikke «dårlig», og en uavhengig andre kilde er nettopp det korroborering er.
//   • `reliability: null` (for få sjekker) mistros aldri — bare et MÅLT lavt
//     tall binder. En gjettet dom ville vært verre enn ingen (WP-240-lærdommen).
//   • Uparsbare oppføringer blokkerer også — dette er ikke en URL-validator
//     (samme holdning som stripLookalikeEvidence).
//
// URL → kalibreringsnøkkel løses via kilderegisteret først (`calibrationKey`
// per entry, WP-240 — det som lar hjelp.tv2.no og letour.fr peke på samme
// målte kilde som tv2.no/letourfemmes.fr), med direkte vertsmatch mot
// kalibreringsnøklene som fallback. Aldri fuzzy (lookalike-vernet, WP-242).
//
// Brukes av build-events.js (demoterer high → medium før publisering) og
// validate-events.js (hard feil på high + sole-distrusted — samme form som
// «high ⇒ 2+ evidens-URLer» — så post-write-hooken binder research-agenten
// ved skrivetid). Ren funksjon av (event, konfig); nettverksfri; fail-soft:
// mangler kalibreringen, skjer ingen binding.

import { urlBelongsToSource } from "./provenance.js";

/** Under dette MÅLTE reliabilitetsnivået kan en kilde aldri stå som eneste grunnlag. */
export const RELIABILITY_FLOOR = 0.7;

function hostOfUrl(u) {
	try {
		return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return null;
	}
}

/** Bare et MÅLT lavt tall binder — null (for få sjekker) er «ukjent», ikke «dårlig». */
export function isDistrusted(reliability) {
	return typeof reliability === "number" && reliability < RELIABILITY_FLOOR;
}

/**
 * Slå opp URL-ens kalibrerte kilde: { key, reliability } eller null når kilden
 * ikke er målt. Registeret (calibrationKey) først — det er den kuraterte
 * koblingen som samler en kildes verter under én målt nøkkel — så direkte
 * vertsmatch (eksakt eller ekte underdomene) mot kalibreringsnøklene.
 */
export function urlReliability(url, { calibration, sources } = {}) {
	const stats = calibration?.sources;
	if (!stats) return null;
	const host = hostOfUrl(url);
	if (!host) return null;
	for (const src of Array.isArray(sources) ? sources : []) {
		if (!src?.calibrationKey || !(src.calibrationKey in stats)) continue;
		if (urlBelongsToSource(url, src)) {
			return { key: src.calibrationKey, reliability: stats[src.calibrationKey].reliability ?? null };
		}
	}
	for (const key of Object.keys(stats)) {
		const k = key.trim().toLowerCase();
		if (host === k || host.endsWith(`.${k}`)) {
			return { key, reliability: stats[key].reliability ?? null };
		}
	}
	return null;
}

/**
 * Er et per-faktum-proveniensfelt ({ sourceId, url } — WP-242) stemplet av en
 * mistrodd kilde? Registeroppslag på sourceId først, så faktumets egen URL.
 */
export function factDistrusted(fact, { calibration, sources } = {}) {
	if (!fact) return false;
	const stats = calibration?.sources;
	if (!stats) return false;
	const src = (Array.isArray(sources) ? sources : []).find((s) => s?.id === fact.sourceId);
	if (src?.calibrationKey && src.calibrationKey in stats) {
		return isDistrusted(stats[src.calibrationKey].reliability);
	}
	const r = fact.url ? urlReliability(fact.url, { calibration, sources }) : null;
	return r ? isDistrusted(r.reliability) : false;
}

/**
 * Den bindende regelen: hviler eventets HELE evidensgrunnlag på mistrodde
 * kilder? Returnerer de mistrodde kalibreringsnøklene når hver eneste
 * oppføring i evidence + verificationSources løses til en kilde med målt
 * reliabilitet < RELIABILITY_FLOOR — ellers null (én ukjent, uparsbar eller
 * betrodd oppføring er et selvstendig grunnlag og blokkerer). Kun ai-research-
 * events — statiske fetchere kalibreres ikke i denne ledgeren.
 */
export function soleDistrustedBasis(event, config = {}) {
	if (!event || event.source !== "ai-research") return null;
	const urls = [...(event.evidence || []), ...(event.verificationSources || [])].filter(
		(u) => typeof u === "string" && u
	);
	if (!urls.length) return null;
	const keys = new Set();
	for (const url of urls) {
		const r = urlReliability(url, config);
		if (!r || !isDistrusted(r.reliability)) return null;
		keys.add(r.key);
	}
	return [...keys];
}
