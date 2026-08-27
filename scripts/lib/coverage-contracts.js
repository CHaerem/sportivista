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
		const status = !inSeason ? "off-season" : upcoming >= c.contract.minUpcoming ? "met" : "breached";
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
			upcoming,
			status,
		};
	});
	return { contracts, breached: contracts.filter((c) => c.status === "breached").map((c) => c.id) };
}
