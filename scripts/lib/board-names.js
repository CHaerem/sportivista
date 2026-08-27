/**
 * WP-251 — the ONE table that says what the board calls a club or a national side.
 *
 * The bug this file exists to close: Sportivista deliberately speaks Norwegian.
 * `scripts/fetch/football.js` rewrites ESPN's ASCII-folded English club names
 * into the ones a Norwegian reader actually uses ("Hamarkameratene" → "HamKam",
 * "Tromso" → "Tromsø"), and the research agent writes the same Norwegian
 * spellings for the leagues it fills by hand ("1. FC Köln", not "FC Cologne").
 * The WORLD REGISTRY, meanwhile, was seeded straight from ESPN and stored only
 * ESPN's spelling — with no alias bridging the two.
 *
 * So the very rewrite that makes the board Norwegian is what blinded the entity
 * index: `containsName` is accent-INSENSITIVE only for letters NFD decomposes,
 * and "ø"/"æ" are their own code points, so "Tromsø" never matched the registry's
 * "Tromso". The row lost its `entityId`, and with it its club mark, its colours
 * and its followability — and worse, "Tromsø" then fell through to tracked.json's
 * season-scoped "Tromsø IL – Conference League-playoff 2026/27" entry, stamping
 * an id that is not a club at all.
 *
 * The fix is data, not algorithm: the registry seed publishes the BOARD's
 * spelling as the entity's canonical `name` and folds ESPN's spelling in as an
 * alias (`mergeRegistry` keeps the id — ids are the follow primary key and never
 * change). Widening `normalizeText` to fold ø/æ globally was the other candidate
 * and was rejected: it is the shared JS↔Swift matching primitive that the golden
 * feed-vectors pin bit-for-bit, so a change there is a cross-surface behaviour
 * change to fix a naming-data gap.
 *
 * Three deliberately separate tables, because they answer to different sources:
 *
 *   NORWEGIAN_CLUBS — ESPN's spelling of a club in nor.1/nor.2 → the board's.
 *        This is the fetcher's own contract (`norwegianClubName`), unchanged and
 *        still applied ONLY to Norwegian-league fixtures in football.js.
 *   FOREIGN_CLUBS  — the handful of foreign clubs whose Norwegian/German name
 *        differs from ESPN's English one in a way word-boundary matching cannot
 *        bridge. Deliberately TINY: `containsName` is bidirectional, so
 *        "Roma" ⇄ "AS Roma", "Mainz 05" ⇄ "Mainz" and "Union Berlin" ⇄ "1. FC
 *        Union Berlin" already match on their own. Only a genuine word change
 *        ("Cologne" vs "Köln") or a changed stem ("Hamburg" vs "Hamburger")
 *        earns a row here.
 *   NATIONS        — the Norwegian exonym for a national side. ESPN names every
 *        landslag in English; a Norwegian board says "Danmark", "Tyskland",
 *        "Sveits". Without this the board's "Danmark – Norge" resolved only its
 *        Norwegian half, so Denmark got no entity, and therefore no flag.
 *
 * All three are CURATED, never heuristic. A wrong fold ships the wrong club's
 * crest, which is worse than no crest — the same fail-closed instinct that
 * governs scripts/lib/logo-license.js.
 */

/**
 * ESPN club names in the Norwegian leagues → what a Norwegian reader calls the
 * club. Only clubs where ESPN differs are listed; anything unmapped passes
 * through untouched, so a promoted club is never mangled, just left as ESPN
 * spells it. Derived from ESPN's own nor.1 `teams` endpoint (its 16
 * `displayName`s), not guessed.
 */
export const NORWEGIAN_CLUBS = {
	"Hamarkameratene": "HamKam",
	"Bodo/Glimt": "Bodø/Glimt",
	"Lillestrom": "Lillestrøm",
	"Tromso": "Tromsø",
	"SK Brann": "Brann",
	"IK Start": "Start",
	"Viking FK": "Viking",
	"Kristiansund BK": "Kristiansund",
	"Sarpsborg FK": "Sarpsborg 08",
};

/**
 * Foreign clubs the board names differently from ESPN. Two — and only two —
 * things earn a row here, and tests/board-names.test.js enforces the pair:
 *
 *   1. ESPN's name cannot REACH the board's by word-boundary containment in
 *      either direction, so the entity would never match. `containsName` is
 *      bidirectional, so "Roma" ⇄ "AS Roma", "Mainz 05" ⇄ "Mainz" and
 *      "Union Berlin" ⇄ "1. FC Union Berlin" already match unaided and must NOT
 *      be listed — a redundant row is noise that will rot.
 *   2. The two forms are the same letters and differ only TYPOGRAPHICALLY. Those
 *      match fine (matching is case-insensitive); the row exists so the calm
 *      board is not shouted at by a source's capitalisation.
 */
export const FOREIGN_CLUBS = {
	"FC Cologne": "1. FC Köln",      // unmatchable: "Cologne" and "Köln" share no token
	"Hamburg SV": "Hamburger SV",    // unmatchable: "Hamburg" is no word-boundary match inside "Hamburger"
	"SV ELVERSBERG": "SV Elversberg", // typography: ESPN shouts; DESIGN.md's calm board does not
};

/**
 * National sides: ESPN's English name → the Norwegian one. Covers every nation
 * the two national seeds return (uefa.nations' 54 UEFA members and fifa.world's
 * tournament field). Nations whose Norwegian name is identical are deliberately
 * ABSENT rather than listed as identity rows — an unmapped name passes through.
 */
export const NATIONS = {
	// --- UEFA ---
	Austria: "Østerrike",
	Azerbaijan: "Aserbajdsjan",
	Belarus: "Hviterussland",
	Belgium: "Belgia",
	"Bosnia-Herzegovina": "Bosnia-Hercegovina",
	Croatia: "Kroatia",
	Cyprus: "Kypros",
	Czechia: "Tsjekkia",
	Denmark: "Danmark",
	Estonia: "Estland",
	"Faroe Islands": "Færøyene",
	France: "Frankrike",
	Germany: "Tyskland",
	Greece: "Hellas",
	Hungary: "Ungarn",
	Iceland: "Island",
	Italy: "Italia",
	Kazakhstan: "Kasakhstan",
	Lithuania: "Litauen",
	Netherlands: "Nederland",
	"North Macedonia": "Nord-Makedonia",
	"Northern Ireland": "Nord-Irland",
	Norway: "Norge",
	Poland: "Polen",
	"Republic of Ireland": "Irland",
	Scotland: "Skottland",
	Spain: "Spania",
	Sweden: "Sverige",
	Switzerland: "Sveits",
	"Türkiye": "Tyrkia",
	Ukraine: "Ukraina",
	// --- the rest of the fifa.world field ---
	Algeria: "Algerie",
	Brazil: "Brasil",
	"Cape Verde": "Kapp Verde",
	"Congo DR": "DR Kongo",
	Iraq: "Irak",
	"Ivory Coast": "Elfenbenskysten",
	Morocco: "Marokko",
	"Saudi Arabia": "Saudi-Arabia",
	"South Africa": "Sør-Afrika",
	"South Korea": "Sør-Korea",
	"United States": "USA",
	Uzbekistan: "Usbekistan",
};

/**
 * The fetcher's contract, unchanged: an ESPN club name from a NORWEGIAN league
 * → the board's spelling. Scoped to the Norwegian table on purpose — football.js
 * calls this only for nor.* fixtures, and a fetcher must not silently rename
 * clubs in leagues it was not asked to translate.
 */
export function norwegianClubName(name) {
	const n = String(name || "").trim();
	return NORWEGIAN_CLUBS[n] || n;
}

/**
 * The REGISTRY's contract: any ESPN name → the name the board uses for it,
 * across all three tables. Used when seeding the world registry, where every
 * league matters (the research agent writes Serie A and Bundesliga rows the
 * fetcher never sees).
 */
export function boardName(name) {
	const n = String(name || "").trim();
	return NORWEGIAN_CLUBS[n] || FOREIGN_CLUBS[n] || NATIONS[n] || n;
}
