// WP-242 · Proveniens per faktum — den mekaniske migreringsbiten.
//
// Dagens ai-research-events bærer én flat `evidence`-liste for HELE eventet,
// som ikke sier hvilket faktum hver URL faktisk understøtter. Produktets to
// kjernefelt har to ulike skapere (arrangøren setter TIDEN, kringkasteren
// setter KANALEN — scripts/config/authority.json), så per-faktum-proveniensen
// er formet som `provenance: { time, streaming }` med sourceId/url/basis/
// retrievedAt per faktum (skjemaet: scripts/config/events.schema.json).
//
// Denne fila migrerer det som lar seg migrere MEKANISK, og ikke mer:
//   • et tidsfaktum stemples kun når evidensen inneholder en URL som beviselig
//     hører til en registrert tidsautoritet for konkurransen (authority.json),
//     eller en primær-/forbundskilde som er autoritativ for sporten
//     (sources.json-rolledoktrinen);
//   • et kanalfaktum stemples kun når evidensen inneholder en URL fra den
//     registrerte kringkasteren OG eventets streaming-plattform faktisk matcher
//     kartets opsjon;
//   • alt annet beholder bare sin flate evidence — å gjette hvilken URL som bar
//     hvilket faktum ville gjort proveniensen verdiløs.
//
// LOOKALIKE-VERNET er kjernen: domenetreff er eksakt vert eller ekte
// under-/overdomene av registerets registrerte verter — aldri fuzzy. Dermed kan
// franceletour.com (lookaliken som faktisk sto som evidens på en TdF-etappe)
// ALDRI migreres til A.S.O.-kilden `letour` (letour.fr).
//
// Brukes av build-events.js i den avsluttende normaliseringspassen (fail-soft:
// mangler authority.json/sources.json, skjer ingen migrering) og er
// nettverksfri — ren funksjon av (event, config).

const MIGRATED_NOTE = "migrert mekanisk fra evidence (WP-242)";

/** Rolledoktrinen (sources.json) → basis-enum (events.schema.json). */
export function basisForRole(role) {
	if (role === "primary" || role === "federation") return "primary";
	if (role === "official-broadcaster") return "official";
	return "secondary";
}

function hostOfUrl(u) {
	try {
		return new URL(u).hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return null;
	}
}

/** Alle vertene en kilde dekker: `url` + `endpoints`, uten www. */
export function sourceHosts(source) {
	return [source.url, ...(source.endpoints || [])].map(hostOfUrl).filter(Boolean);
}

/**
 * Hører URL-en beviselig til kilden? Eksakt vert eller ekte under-/overdomene
 * i begge retninger (hjelp.tv2.no ↔ tv2.no; en.wikipedia.org ↔ wikipedia.org)
 * — samme regel som tests/sources-schema.test.js. ALDRI fuzzy/likhets-match:
 * lookalike-vernet (franceletour.com ≠ letour.fr) er hele poenget.
 */
export function urlBelongsToSource(url, source) {
	const h = hostOfUrl(url);
	if (!h) return false;
	return sourceHosts(source).some((reg) => h === reg || h.endsWith(`.${reg}`) || reg.endsWith(`.${h}`));
}

/**
 * Alle domener autoritetskartet registrerer som LOOKALIKES — et domene som poserer
 * som arrangøren uten å være den (franceletour.com ved siden av ekte letour.fr).
 */
export function lookalikeHosts(authority) {
	const out = new Set();
	for (const comp of authority?.competitions || []) {
		for (const d of comp.lookalikes || []) {
			const h = String(d || "").trim().toLowerCase().replace(/^www\./, "");
			if (h) out.add(h);
		}
	}
	return out;
}

/**
 * Fjern evidens-URLer som serveres av et kjent lookalike-domene.
 *
 * `deriveProvenance` nekter allerede å SITERE en lookalike, men den flate
 * `evidence`-lista er det ⓘ-modalen rendrer til brukeren (detail.js) — så en
 * lookalike som blir stående der vises fortsatt som «kilde N». Det var nøyaktig
 * tilstanden da denne ble skrevet: franceletour.com sto som evidens på en
 * TdF-etappe, mens letour.fr ikke forekom én eneste gang i hele filen.
 *
 * Å fjerne den gjør eventet ÆRLIGERE, ikke fattigere: mister det sin eneste
 * tidskilde, er det nettopp det «weak time basis»-varselet skal telle.
 * Returnerer { urls, removed }.
 */
export function stripLookalikeEvidence(urls, hosts) {
	if (!Array.isArray(urls) || !hosts || hosts.size === 0) return { urls: urls || [], removed: 0 };
	const kept = urls.filter((u) => {
		const h = hostOfUrl(u);
		if (!h) return true; // uparsbar — la den stå, dette er ikke en URL-validator
		return ![...hosts].some((bad) => h === bad || h.endsWith(`.${bad}`));
	});
	return { urls: kept, removed: urls.length - kept.length };
}

/**
 * Slå opp konkurransen et event hører til i autoritetskartet: samme sport +
 * substring-treff i tournament/meta/title. Ved overlappende mønstre vinner det
 * LENGSTE treffet ("tour de france femmes" foran "tour de france").
 */
export function findCompetition(event, authority) {
	if (!event || !authority || !Array.isArray(authority.competitions)) return null;
	const hay = [event.tournament, event.meta, event.title]
		.filter((v) => typeof v === "string" && v)
		.join(" ")
		.toLowerCase();
	if (!hay) return null;
	let best = null;
	let bestLen = -1;
	for (const comp of authority.competitions) {
		if (comp.sport !== event.sport) continue;
		for (const m of comp.match || []) {
			if (typeof m !== "string" || !m) continue;
			const needle = m.toLowerCase();
			if (hay.includes(needle) && needle.length > bestLen) {
				best = comp;
				bestLen = needle.length;
			}
		}
	}
	return best;
}

/** Er kilden autoritativ for sporten (bar sport eller sport:konkurranse)? */
function coversSport(source, sport) {
	return (source.authorityFor || []).some((a) => a === sport || a.startsWith(`${sport}:`));
}

/** Ord-prefiks-match mellom events plattformnavn og kartets opsjon ("TV 2" dekker "TV 2 Play"). */
function platformMatches(eventPlatform, optionPlatform) {
	const ev = String(eventPlatform || "").toLowerCase();
	const opt = String(optionPlatform || "").toLowerCase();
	return !!ev && !!opt && ev.startsWith(opt);
}

/** Første URL i lista som beviselig hører til en av kandidatkildene. */
function pickFact(urls, candidateSources) {
	for (const url of urls) {
		for (const source of candidateSources) {
			if (urlBelongsToSource(url, source)) {
				return { sourceId: source.id, url, basis: basisForRole(source.role) };
			}
		}
	}
	return null;
}

/**
 * Mekanisk migrering: utled per-faktum-proveniens for ett ai-research-event fra
 * dets flate evidence (+ verificationSources), autoritetskartet og
 * kilderegisteret. Konservativ: returnerer null når ingenting kan migreres
 * trygt, og rører ALDRI et event som allerede har eksplisitt `provenance`
 * (agent-skrevet proveniens vinner alltid over en mekanisk utledning).
 * retrievedAt settes til verifiedAt/researchedAt — tidspunktet faktumet
 * beviselig sist ble lest av en agent — og hver migrert oppføring bærer en
 * `note` som sier at den er migrert, så den kan skilles fra førstehånds
 * proveniens.
 */
export function deriveProvenance(event, { authority, sources } = {}) {
	if (!event || event.source !== "ai-research" || event.provenance) return null;
	const register = Array.isArray(sources) ? sources : [];
	if (!register.length) return null;
	const urls = [...(event.evidence || []), ...(event.verificationSources || [])].filter(
		(u) => typeof u === "string" && u
	);
	if (!urls.length) return null;
	const retrievedAt = event.verifiedAt || event.researchedAt || null;
	const byId = new Map(register.map((s) => [s.id, s]));
	const comp = findCompetition(event, authority);
	const out = {};

	// TID — kartets registrerte tidsautoritet for konkurransen først; ellers en
	// primær-/forbundskilde som er autoritativ for sporten (klubbens egen side
	// for egne kamper hører hjemme her via rolledoktrinen).
	const mappedTimeAuthorities = (comp?.time?.sourceIds || [])
		.map((id) => byId.get(id))
		.filter(Boolean);
	const sportAuthorities = register.filter(
		(s) => (s.role === "primary" || s.role === "federation") && coversSport(s, event.sport)
	);
	const timeFact = pickFact(urls, mappedTimeAuthorities) || pickFact(urls, sportAuthorities);
	if (timeFact) {
		out.time = { ...timeFact, ...(retrievedAt ? { retrievedAt } : {}), note: MIGRATED_NOTE };
	}

	// KANAL — kun via kartets kanal-opsjoner, og kun når eventets synlige
	// plattform matcher opsjonen OG evidensen faktisk inneholder en URL fra den
	// registrerte kringkasteren. Alt annet er for usikkert å migrere.
	const platforms = (event.streaming || []).map((s) => s && s.platform).filter(Boolean);
	for (const opt of comp?.channel?.options || []) {
		if (!platforms.some((p) => platformMatches(p, opt.platform))) continue;
		const source = byId.get(opt.sourceId);
		if (!source) continue;
		const url = urls.find((u) => urlBelongsToSource(u, source));
		if (url) {
			out.streaming = {
				sourceId: source.id,
				url,
				basis: basisForRole(source.role),
				...(retrievedAt ? { retrievedAt } : {}),
				note: MIGRATED_NOTE,
			};
			break;
		}
	}

	return out.time || out.streaming ? out : null;
}
