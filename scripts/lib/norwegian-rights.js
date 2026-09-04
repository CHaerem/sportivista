// Norwegian broadcast rights — deterministic map applied at build time so followed
// events ALWAYS show a Norwegian channel (or honestly nothing), never a foreign
// broadcaster like FOX/ESPN. The verify agent refines per-event on top of this;
// this guarantees a correct default. Mirrors .claude/skills/norwegian-rights.

// ── Link honesty (WP-246): deep vs. landing ─────────────────────────────────
//
// A channel NAME ("TV 2 Play") is real, useful information. A channel URL that
// points at TV 2 Play's sport section is NOT an answer to "hvor ser jeg det" —
// it is the rights map wearing a link's clothes. Every streaming entry therefore
// declares what KIND of URL it carries, so the clients can show the name without
// dressing a front page up as a link to the broadcast:
//
//   "deep"    – points at the actual broadcast/match/stream page
//   "landing" – the service's front page or a generic section (sport/live/locale)
//   (absent)  – no URL at all, or a URL we can't parse
//
// Nothing here invents deep links; finding them per event is the research/verify
// agents' job. This only makes the difference visible and countable.

// Path segments that never identify a single broadcast: locale codes, a service's
// own section navigation, and plain sport names. A URL whose ENTIRE path is built
// from these is a landing page no matter which service it belongs to.
const GENERIC_SEGMENTS = new Set([
	// locale / site chrome
	"no", "nb", "en", "no-no", "nb-no", "en-no", "nn-no",
	// section navigation
	"sport", "sports", "sporten", "direkte", "live", "tv", "kanal", "kanaler",
	"stream", "streaming", "watch", "se", "channel", "channels", "home", "start",
	// sport sections
	"fotball", "football", "soccer", "golf", "pga-tour", "pgatour", "tennis",
	"sykkel", "cycling", "ski", "langrenn", "skiskyting", "biathlon", "friidrett",
	"athletics", "handball", "håndball", "ishockey", "hockey", "motorsport",
	"formel-1", "formula-1", "f1", "sjakk", "chess", "esport", "esports",
]);

/**
 * Classify a viewing URL: "deep" (the broadcast itself), "landing" (a service
 * front page / generic section), or "" when there is nothing to classify.
 * @param {string} url
 * @returns {"deep"|"landing"|""}
 */
export function classifyStreamingUrl(url) {
	const raw = String(url || "").trim();
	if (!raw) return "";
	let parsed;
	try {
		parsed = new URL(raw);
	} catch {
		return ""; // unparseable — say nothing rather than guess
	}
	let segments;
	try {
		segments = parsed.pathname.split("/").filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());
	} catch {
		segments = parsed.pathname.split("/").filter(Boolean).map((s) => s.toLowerCase());
	}
	if (!segments.length) return "landing"; // bare origin — never a broadcast
	if (segments.every((s) => GENERIC_SEGMENTS.has(s))) return "landing";
	return "deep";
}

/** Stamp `urlKind` on one streaming entry (objects only; strings pass through). */
function withUrlKind(c) {
	if (!c || typeof c !== "object") return c;
	const kind = classifyStreamingUrl(c.url);
	if (!kind) {
		if (!("urlKind" in c)) return c;
		const { urlKind, ...rest } = c; // eslint-disable-line no-unused-vars
		return rest; // a URL was removed — don't keep a stale claim
	}
	return c.urlKind === kind ? c : { ...c, urlKind: kind };
}

/**
 * Stamp `urlKind` on every entry of a streaming array. Idempotent, and the single
 * choke point callers use after rewriting URLs (see build-events.js) so the label
 * can never drift from the URL it describes.
 */
export function stampUrlKinds(streaming) {
	if (!Array.isArray(streaming)) return streaming;
	return streaming.map(withUrlKind);
}

// Fallback landing URLs — the sport/live section, not the bare homepage, so a tap
// lands closer to the broadcast and is likelier to be claimed by the app's
// universal links (deep per-event URLs from the verify agent override these).
// They are stamped `urlKind: "landing"` at construction: honest by default, and
// the clients refuse to present them as a link to the match (WP-246).
const ch = (platform, url, extra) => withUrlKind({ platform, url, ...(extra || {}) });
const CH = {
	viaplay: ch("Viaplay", "https://viaplay.no/no-no/sport"),
	tv2: ch("TV 2 Play", "https://play.tv2.no/sport"),
	nrk: ch("NRK", "https://tv.nrk.no/direkte"),
	discovery: ch("Discovery+", "https://www.discoveryplus.no"),
	eurosport: ch("Eurosport", "https://www.eurosport.no"),
	hbomax: ch("HBO Max (Sport)", "https://www.hbomax.com/no/no/sports/pga-tour"),
	max: ch("Max", "https://www.max.com"),
};

// Anything matching this is a Norwegian service we can trust to keep as-is.
// `direktesport` (+ `avisa nordland` / `an.no`) are the free local holders that
// carry Norwegian clubs' early European qualifiers — without them here, a match
// whose only channel is Direktesport would be filtered out to nothing the moment
// the rights map declines to guess (see the qualifier carve-out in norwegianRights).
const NORWEGIAN_RE = /viaplay|tv\s?2|nrk|discovery\+?|eurosport|\bmax\b|v sport|vg\+?|amedia|direktesport|avisa nordland|an\.no|strim/i;

// National sides — ESPN often labels these matches only "International", so we
// detect nation-vs-nation to route World Cup / landskamper to NRK/TV 2 (never FOX).
const NATIONS = new Set([
	"argentina", "brazil", "norway", "france", "spain", "portugal", "belgium", "germany",
	"italy", "netherlands", "croatia", "switzerland", "denmark", "sweden", "united states",
	"usa", "mexico", "canada", "colombia", "paraguay", "uruguay", "ghana", "morocco",
	"cape verde", "japan", "south korea", "korea republic", "australia", "senegal", "nigeria",
	"egypt", "cameroon", "poland", "austria", "serbia", "ecuador", "iran", "saudi arabia",
	"qatar", "tunisia", "ivory coast", "algeria", "england", "scotland", "wales",
]);

// Norwegian → English canonical nation names. ESPN emits English ("Morocco"),
// tvkampen emits Norwegian ("Marokko"); without this map the two never match
// and every national-team fixture falls back to the shared-rights guess.
// Keys are pre-normalized the same way normTeam() normalizes (lowercase, no
// punctuation — so "Sør-Korea" → "sørkorea").
const NATION_CANON = {
	marokko: "morocco", frankrike: "france", brasil: "brazil", norge: "norway",
	spania: "spain", tyskland: "germany", sveits: "switzerland", danmark: "denmark",
	østerrike: "austria", island: "iceland", belgia: "belgium", nederland: "netherlands",
	sverige: "sweden", kroatia: "croatia", sørkorea: "south korea", "korea republic": "south korea",
	japan: "japan", mexico: "mexico", portugal: "portugal", england: "england",
	skottland: "scotland", wales: "wales", usa: "usa", "united states": "usa",
	"forente stater": "usa", argentina: "argentina", egypt: "egypt", colombia: "colombia",
	canada: "canada", paraguay: "paraguay", uruguay: "uruguay", ecuador: "ecuador",
	australia: "australia", senegal: "senegal", nigeria: "nigeria", ghana: "ghana",
	kamerun: "cameroon", algerie: "algeria", tunisia: "tunisia", elfenbenskysten: "ivory coast",
	kappverde: "cape verde", "kapp verde": "cape verde", saudiarabia: "saudi arabia",
	"saudi arabia": "saudi arabia", qatar: "qatar", iran: "iran", polen: "poland",
	serbia: "serbia", italia: "italy", sørafrika: "south africa",
};

function isNationVsNation(ev) {
	const h = normTeam(ev.homeTeam || "");
	const a = normTeam(ev.awayTeam || "");
	return NATIONS.has(h) && NATIONS.has(a);
}

// A World Cup fixture — ESPN sometimes labels these only "International", so we
// also treat any nation-vs-nation match as WC-adjacent for channel resolution.
function isWorldCup(ev) {
	const hay = `${ev.tournament || ""} ${ev.context || ""} ${ev.meta || ""} ${ev.title || ""}`.toLowerCase();
	return /world cup|fifa|\bvm\b/.test(hay) || isNationVsNation(ev);
}

// Norwegian WC 2026 rights are shared by NRK + TV 2 ONLY. When we can't confirm
// which of the two carries a specific match, this single tentative label is more
// honest (and calmer) than two chips that read as "airs on both".
const WC_SHARED = ch("NRK / TV 2", "https://tv.nrk.no", { tentative: true });

/** The confident Norwegian rights for an event, or [] when we shouldn't guess. */
export function norwegianRights(ev) {
	const sport = (ev.sport || "").toLowerCase();
	const comp = `${ev.tournament || ""} ${ev.context || ""} ${ev.meta || ""}`.toLowerCase();
	const title = (ev.title || "").toLowerCase();
	const hay = `${comp} ${title}`;

	if (sport === "football") {
		if (/world cup|fifa|\bvm\b/.test(hay)) return [WC_SHARED]; // NRK/TV 2 shared — exact channel TBD
		if (/premier league/.test(hay)) return [CH.tv2];
		if (/la\s?liga/.test(hay)) return [CH.tv2];
		// UEFA club competitions split in Norway (verified 2026-07-27 vs
		// presse.viaplaygroup.no + tvkampen.com, rights t.o.m. 2030/31): Champions
		// League → TV 2, Europa + Conference League → Viaplay. "champions" is tested
		// first so the Super Cup (CL winner vs EL winner) still maps to TV 2.
		//
		// EXCEPT the qualifying rounds when a Norwegian club is involved: those are
		// routinely sub-licensed FREE to local holders (Direktesport/Amedia/VG TV /
		// Avisa Nordland), NOT the aggregator that holds the competition proper. A
		// confident Viaplay/TV 2 here silently clobbers the researched local channel
		// on every hourly rebuild — the Glimt/Brann/Tromsø revert-war flagged across
		// research-log + verify-log (verify amends → the map re-derives → repeat). So
		// for a Norwegian-club qualifier we decline to guess (→ normalizeStreaming
		// keeps the event's own Norwegian streaming). The generic foreign-vs-foreign
		// qualifier still falls through to the aggregator mapping below.
		if (/champions|europa|conference/.test(hay) &&
			/kvalifisering|kvalik|qualify|qualifier|\bq[123]\b|play-?off round/.test(hay) &&
			ev.norwegian) {
			return [];
		}
		if (/champions/.test(hay)) return [CH.tv2];
		if (/europa|conference/.test(hay)) return [CH.viaplay];
		if (/obos|eliteserie|norwegian|cup|nm\b/.test(hay)) return [CH.tv2];
		if (isNationVsNation(ev)) return [WC_SHARED]; // landskamp / WC labelled only "International"
		return [];
	}
	if (sport === "golf") {
		// Tiered rights, 2026 season (web-verified 2026-07-18; see the golf section of
		// .claude/skills/norwegian-rights/SKILL.md). NOT a flat "all golf → Viaplay":
		// Warner Bros. Discovery took ordinary PGA Tour + the Masters/PGA Championship,
		// Viaplay keeps The Open + US Open + DP World Tour + Ryder Cup.
		// DP World Tour FIRST — a DP World event whose TITLE happens to contain
		// "Masters" (Omega European Masters) or "PGA Championship" (BMW PGA
		// Championship) must NOT fall into the major-championship (Discovery+)
		// branch below. The tour tag ("DP World Tour" in tournament/meta) is the
		// reliable signal; check it before the title-keyword majors. (Without this
		// the researched Viaplay value was clobbered to Discovery+ on every build,
		// a recurring summary↔streaming mismatch on those two events.)
		if (/dp world|ryder cup/.test(hay)) return [CH.viaplay];
		if (/masters|pga championship/.test(hay)) return [CH.discovery];
		if (/\bthe open\b|open championship|british open|u\.?s\.? open/.test(hay)) return [CH.viaplay];
		// Only assert PGA Tour rights (HBO Max) when the haystack POSITIVELY says PGA.
		// The fetcher stamps meta/tournament "PGA Tour" on every PGA event (incl.
		// opposite-field, e.g. Corales), so this covers the fetcher wholesale. For a
		// golf event we CANNOT classify — an untagged AI-research event, or a tour we
		// don't map (LPGA / Ladies European / Solheim) — DECLINE to guess rather than
		// force the PGA channel: returning [] lets normalizeStreaming keep the event's
		// own researched Norwegian streaming instead of clobbering a correct value to
		// HBO Max (same guess-no-more principle as the UEFA-qualifier carve-out above;
		// visual-qa 2026-08-13 caught a DP World event (Danish Golf Championship)
		// wrongly shown on HBO Max via this default).
		if (/\bpga\b/.test(hay)) return [CH.hbomax, CH.eurosport]; // ordinary PGA Tour
		return [];
	}
	if (sport === "f1" || sport === "formula1") return [CH.viaplay];
	// Tour de France 2026 rights are shared: TV 2 (Play/Direkte) + WBD (Max/Eurosport
	// carries the first hour of each stage). The owner follows the Tour on TV 2 Play,
	// so we show that single channel rather than a "+1" — a viewing preference, not a
	// rights claim (Max still carries the opening hour).
	if (sport === "cycling") return /tour de france/.test(hay) ? [CH.tv2] : [];
	if (sport === "tennis") {
		// Wimbledon (like all Grand Slams) is Warner Bros. Discovery in Norway —
		// HBO Max + Eurosport, NOT TV 2. Finals are also free on WBD's REX channel.
		if (/wimbledon/.test(hay)) return [CH.max, CH.eurosport];
		if (/roland|french open|australian open|us open/.test(hay)) return [CH.discovery, CH.eurosport];
		return [];
	}
	if (/biathlon|skiskyting|cross-country|langrenn|nordic|ski jump|hopp|alpine|alpint/.test(`${sport} ${hay}`)) return [CH.nrk];
	// chess has no Norwegian TV rights — Sjakk-NM streams on Direktesport/Lichess,
	// international chess (EWC etc.) on Chess.com/Twitch/YouTube. Keep the event's
	// own free streams (handled in normalizeStreaming) rather than guessing a channel.
	return [];
}

/**
 * Normalize an event's streaming to Norwegian options:
 *   1. confident rights map wins;
 *   2. else keep only already-Norwegian entries (drop FOX/ESPN/Apple TV/…);
 *   3. esports keeps its (free, platform-agnostic) streams as-is.
 */
export function normalizeStreaming(ev) {
	const sport = (ev.sport || "").toLowerCase();
	// esports and chess are watched on event-specific free streams (BLAST.tv /
	// Twitch / YouTube; Lichess / Chess.com / Direktesport), not Norwegian TV —
	// keep whatever the event/researcher supplied rather than forcing a channel.
	if (sport === "esports" || sport === "chess") return stampUrlKinds(ev.streaming || []);
	const mapped = norwegianRights(ev);
	if (mapped.length) return stampUrlKinds(mapped);
	return stampUrlKinds((ev.streaming || []).filter((s) => NORWEGIAN_RE.test(s.platform || s)));
}

// ── Real Norwegian TV listings (tvkampen.com) — actual data over the static map ──

const CHANNEL_URLS = [
	["tv 2 play", "https://play.tv2.no/sport"], ["tv2 play", "https://play.tv2.no/sport"],
	["tv 2 sport", "https://play.tv2.no/sport"], ["tv 2", "https://play.tv2.no/sport"],
	["viaplay", "https://viaplay.no/no-no/sport"], ["v sport", "https://viaplay.no/no-no/sport"],
	["nrk", "https://tv.nrk.no/direkte"],
	["discovery", "https://www.discoveryplus.no"], ["eurosport", "https://www.eurosport.no"],
	["max", "https://www.max.com"], ["vg", "https://www.vg.no/sport"],
];
function urlForChannel(name) {
	const k = name.trim().toLowerCase();
	for (const [needle, url] of CHANNEL_URLS) if (k.includes(needle)) return url;
	return "";
}

function normTeam(s) {
	const n = (s || "").toLowerCase()
		.replace(/\b(fc|fk|cf|afc|sk|if|il|bk|ff)\b/g, "")
		.replace(/[^a-z0-9æøå ]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	return NATION_CANON[n] || n; // map Norwegian nation names to English canonical
}
function teamsMatch(a, b) {
	const na = normTeam(a), nb = normTeam(b);
	return !!(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}

/** Find the tvkampen listing for a football event by team names. */
export function matchTvListing(ev, listings) {
	if (!ev.homeTeam || !ev.awayTeam || !Array.isArray(listings)) return null;
	return listings.find((l) => teamsMatch(l.homeTeam, ev.homeTeam) && teamsMatch(l.awayTeam, ev.awayTeam)) || null;
}

/** Convert a tvkampen listing's broadcasters to Norwegian streaming objects (drops foreign/betting). */
function listingStreaming(listing) {
	const seen = new Set();
	const out = [];
	for (const b of listing.broadcasters || []) {
		let name = String(b).trim();
		if (!NORWEGIAN_RE.test(name)) continue; // drop betting/foreign leftovers
		// NRK's channels (NRK1/NRK2/NRK TV/NRK Sport) are interchangeable to a
		// viewer and all live at tv.nrk.no — collapse to a single "NRK" so a match
		// doesn't show "NRK1 +1" for what is really one broadcaster.
		if (/^nrk/i.test(name)) name = "NRK";
		const key = name.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(withUrlKind({ platform: name, url: urlForChannel(name) }));
	}
	// tvkampen pads most listings with generic aggregators (Viaplay/Eurosport/MAX)
	// after the real broadcaster(s), which are listed primary-first. Keep the calm
	// UI to the first two so "where to watch" stays a glance, not a sprawl.
	return out.slice(0, 2);
}

/**
 * For a World Cup fixture, keep only the actual Norwegian rights holders
 * (NRK / TV 2) and collapse channel variants (NRK1, NRK TV → NRK; TV 2 Sport 1
 * → TV 2 Play). tvkampen pads WC listings with aggregators (Viaplay/Eurosport/
 * MAX) and foreign nets (SVT) that don't hold WC rights in Norway — drop them so
 * a match resolves to its single true broadcaster instead of a noisy list.
 */
function worldCupChannels(channels) {
	const out = [];
	const seen = new Set();
	for (const c of channels) {
		const p = String(c.platform || c).toLowerCase();
		let entry = null;
		if (/nrk/.test(p)) entry = CH.nrk;
		else if (/tv\s?2/.test(p)) entry = CH.tv2;
		else continue; // not a WC rights holder → drop
		if (seen.has(entry.platform)) continue;
		seen.add(entry.platform);
		out.push(entry);
	}
	return out;
}

/**
 * Resolve an event's streaming, preferring REAL scraped Norwegian TV listings
 * (tvkampen) for football, falling back to the deterministic rights map.
 * @param {object} ev
 * @param {Array} tvListings - tv-listings.json `listings` array
 */
export function resolveStreaming(ev, tvListings) {
	if ((ev.sport || "").toLowerCase() === "football") {
		const listing = matchTvListing(ev, tvListings);
		if (listing) {
			let s = listingStreaming(listing);
			// WC: trust the real listing to say WHICH of NRK/TV 2, drop aggregator noise.
			if (isWorldCup(ev)) s = worldCupChannels(s);
			if (s.length) {
				// Point TV 2 / Viaplay at the tvkampen MATCH page — a per-match
				// "when & where" guide — since they don't expose linkable per-match
				// app URLs. Keep NRK's own URL (tv.nrk.no), which opens the NRK app.
				if (listing.url) {
					s = s.map((c) => {
						const isNrk = /nrk/i.test(c.platform || "") || /tv\.nrk\.no/.test(c.url || "");
						return isNrk ? c : withUrlKind({ ...c, url: listing.url });
					});
				}
				return stampUrlKinds(s);
			}
			// Listing exists but no confirmable Norwegian rights holder (e.g. only
			// SVT): still offer the match's tvkampen page as a linkable guide so the
			// user can at least see when & on which channel it airs.
			if (isWorldCup(ev) && listing.url) return [withUrlKind({ ...WC_SHARED, url: listing.url })];
		}
	}
	return normalizeStreaming(ev);
}
