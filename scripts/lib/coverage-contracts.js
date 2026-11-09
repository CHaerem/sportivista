// WP-243 · Dekningskontrakt per konkurranse.
//
// Research var opportunistisk hullfylling: tavla ble fylt der noen tilfeldigvis
// lette. Skal Sportivista være primærkilde («hele sporten», COMMERCIAL.md § 1),
// trengs en GARANTI per konkurranse: en navngitt autoritet (WP-241-kartet har
// den allerede) og et målbart løfte — «i sesong skal minst N events ligge på
// tavla innen H dager». Denne fila er den mekaniske halvdelen: den MÅLER
// løftet mot tavla. Judgement (er bruddet reelt? hva mangler?) er som alltid
// agentenes — et brudd blir en høy-alvorlighets gap i coverage-gaps.json som
// coverage-critic/research triagerer, og en egen port i port-report.json som
// mater G2 («coverage grønn ≥25/28 dager»).
//
// Kontrakten BOR i autoritetskartet (scripts/config/authority.json, valgfritt
// `contract`-felt per konkurranse) — løftet og autoriteten er samme oppslag:
//   contract: { horizonDays, minUpcoming, months, note? }
// `months` er kalendermånedene (UTC) konkurransen er i sesong; utenfor dem er
// status «off-season», aldri brudd (sesongærlighet — en taus vinterserie i
// juli er ikke et dekningshull).
//
// `breaks` (valgfritt) er kjente midt-i-sesongen-pauser der konkurransen IKKE
// spiller (FIFA-landslagsvinduer o.l.) — i disse vinduene er status «break»,
// aldri brudd. `months` dekker hele kalendermåneder og kan derfor ikke fange en
// midt-i-måneden-pause: under novembervinduet (9.–17. nov 2026) spilte verken
// Premier League eller Eliteserien, så `upcoming` falt under minUpcoming selv om
// ligaene lever og neste runde er bekreftet — et falskt HIGH-brudd hver kjøring
// gjennom hele pausen. `break` modellerer den dokumenterte årsaken (FIFAs
// landslagskalender) i stedet for å slakke minUpcoming (som ikke hjelper når
// upcoming = 0). Datoene er UTC date-only (YYYY-MM-DD), inklusive begge ender.
//
// Event→konkurranse-tilordningen GJENBRUKER provenance.findCompetition (samme
// lengste-treff-semantikk som proveniens-migreringen, WP-242), og vindus-
// tellingen bruker isEventInWindow (konvensjonen — flerdagers events teller).
// Ren funksjon av (authority, events, now); nettverksfri; fail-soft: uten
// kontrakter er resultatet tomt og ingenting alarmerer.

import { findCompetition } from "./provenance.js";
import { isEventInWindow, MS_PER_DAY } from "./helpers.js";

/**
 * Mål alle kontraktfestede konkurranser mot tavla.
 * Returnerer { contracts: [...], breached: [id, ...] } der hver kontrakt har
 * status "met" | "breached" | "off-season" + tellingene dommen bygger på.
 */
export function assessContracts(authority, events, now = Date.now()) {
	const contracted = (authority?.competitions || []).filter(
		(c) => c && c.contract && Number.isFinite(c.contract.horizonDays) && Number.isFinite(c.contract.minUpcoming)
	);
	if (!contracted.length) return { contracts: [], breached: [] };

	const month = new Date(now).getUTCMonth() + 1;
	const counts = new Map(contracted.map((c) => [c.id, 0]));
	for (const event of Array.isArray(events) ? events : []) {
		// Samme tilordning som proveniensen: lengste match vinner, så en
		// «Tour de France Femmes»-etappe teller aldri mot Tour de France-kontrakten.
		const comp = findCompetition(event, authority);
		if (!comp || !counts.has(comp.id)) continue;
		const windowEnd = now + comp.contract.horizonDays * MS_PER_DAY;
		if (isEventInWindow(event, now, windowEnd)) counts.set(comp.id, counts.get(comp.id) + 1);
	}

	const contracts = contracted.map((c) => {
		const inSeason = (c.contract.months || []).includes(month);
		const upcoming = counts.get(c.id);
		const inBreak = inSeason && isWithinBreak(c.contract.breaks, now);
		const status = !inSeason
			? "off-season"
			: inBreak
			? "break"
			: upcoming >= c.contract.minUpcoming
			? "met"
			: "breached";
		return {
			id: c.id,
			name: c.name,
			sport: c.sport,
			authority: (c.time?.sourceIds || []).join(", "),
			horizonDays: c.contract.horizonDays,
			minUpcoming: c.contract.minUpcoming,
			months: c.contract.months || [],
			...(c.contract.note ? { note: c.contract.note } : {}),
			inSeason,
			...(inBreak ? { inBreak: true } : {}),
			upcoming,
			status,
		};
	});
	return { contracts, breached: contracts.filter((c) => c.status === "breached").map((c) => c.id) };
}

/**
 * Er `now` innenfor et kjent pausevindu? `breaks` er [{ from, to }] med UTC
 * date-only-strenger (YYYY-MM-DD), inklusive begge ender. Ugyldige/manglende
 * vinduer ignoreres (fail-soft — en skrivefeil skal aldri krasje målingen).
 */
function isWithinBreak(breaks, now) {
	if (!Array.isArray(breaks)) return false;
	for (const b of breaks) {
		if (!b || typeof b.from !== "string" || typeof b.to !== "string") continue;
		const start = Date.parse(b.from.length <= 10 ? `${b.from}T00:00:00Z` : b.from);
		const end = Date.parse(b.to.length <= 10 ? `${b.to}T23:59:59.999Z` : b.to);
		if (Number.isFinite(start) && Number.isFinite(end) && now >= start && now <= end) return true;
	}
	return false;
}
