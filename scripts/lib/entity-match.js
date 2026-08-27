/**
 * WP-251 — which entity IS this board string?
 *
 * `containsName` answers "do these two names overlap?" Because it is
 * word-boundary and BIDIRECTIONAL, one board string legitimately overlaps
 * several entities at once: "Inter Milan" overlaps both Internazionale (whose
 * alias it is) and AC Milan (whose alias "Milan" it contains); "Nord-Irland"
 * overlaps both Nord-Irland and Irland, because the hyphen is a word boundary.
 *
 * Overlap is therefore not an ANSWER, only a candidate set — and build-events
 * used to resolve the set by taking whichever entity came first in the pool.
 * List order is no reason at all for the right team to win, and when it lost,
 * the board flew the Republic of Ireland's flag on a Northern Ireland match and
 * put AC Milan's crest on an Inter fixture. A wrong crest is worse than no
 * crest: the whole point of a club mark is that it is instantly, wordlessly
 * trusted (DESIGN.md § Ærlig innhold — «Aldri lat som»).
 *
 * So the answer is the MOST SPECIFIC overlap, never the first: the entity whose
 * own name IS the board's string beats one that merely shares a word with it.
 * Same longest-match-wins instinct the pipeline already uses for overlapping
 * competition names (findCompetition in lib/provenance.js, where "Tour de France
 * Femmes" must not fall through to "Tour de France").
 *
 * The invariant this buys, enforced in tests/entity-match.test.js: EVERY entity's
 * own canonical name resolves to that entity. Under first-hit matching that was
 * false for 62 entities in the shipped index; ordering happened to spare football
 * until this package's new Serie A entities landed next to Internazionale.
 */

import { normalizeText, containsName, entityTerms } from "./helpers.js";

// Normalized (name + alias) terms per entity, memoized on the entity object.
// findEntityId scores the WHOLE pool instead of returning the first hit, so the
// same handful of strings is normalized on every lookup; the pool is a build
// constant, so caching turns that back into one normalize per term per build.
const ENTITY_TERM_CACHE = new WeakMap();

/** Every string an entity can be recognised by, normalized once and cached. */
export function normalizedTerms(entity) {
	let terms = ENTITY_TERM_CACHE.get(entity);
	if (!terms) {
		terms = entityTerms(entity).map((t) => normalizeText(t).trim()).filter(Boolean);
		ENTITY_TERM_CACHE.set(entity, terms);
	}
	return terms;
}

// An exact name match cannot be beaten — equality means the term IS the query,
// so no other candidate can overlap it more. It both wins outright and lets the
// scan stop early, which keeps the common case (the board's spelling equals the
// entity's) exactly as cheap as the old first-hit loop.
export const EXACT_MATCH = Infinity;

/**
 * How SPECIFICALLY does `termN` identify `nameN`? 0 = no match at all.
 *   Infinity → the two are the same name
 *   n > 0    → word-boundary containment in either direction; `n` is the length
 *              of the overlap, i.e. of the shorter of the two strings
 * Both arguments must ALREADY be normalized + trimmed (normalizeText).
 */
export function matchSpecificity(nameN, termN) {
	if (!nameN || !termN) return 0;
	if (nameN === termN) return EXACT_MATCH;
	// Plain substring containment is a NECESSARY condition for word-boundary
	// containment, and String.includes is far cheaper than the boundary regex —
	// so reject the ~99.9 % of pool entries that cannot match before paying for it.
	if (!nameN.includes(termN) && !termN.includes(nameN)) return 0;
	if (!containsName(nameN, termN) && !containsName(termN, nameN)) return 0;
	return Math.min(nameN.length, termN.length);
}

/**
 * Word-boundary, sport-scoped entity lookup: the most specific match in `pool`,
 * or null. Never naive substring (the Brooklyn/Lyn trap: "Brooklyn FC" must not
 * match the tracked club "Lyn"; see tests/fixtures/feed-vectors/DIVERGENCES.md
 * and the negative test in tests/build-entities.test.js). Sport-scoped so a
 * same-named entity in another sport can't cross-match.
 *
 * Ties keep POOL ORDER, so the caller's ordering still decides between two
 * equally specific candidates — that is how build-events keeps team entities
 * ahead of tracked.json's club-as-league duplicates.
 */
export function findEntityId(name, pool, sport) {
	if (!name) return null;
	const nameN = normalizeText(name).trim();
	if (!nameN) return null;
	const sportN = sport ? normalizeText(sport) : null;
	let bestId = null;
	let bestScore = 0;
	for (const e of pool) {
		if (sportN && e.sport && normalizeText(e.sport) !== sportN) continue;
		for (const term of normalizedTerms(e)) {
			const score = matchSpecificity(nameN, term);
			if (score === EXACT_MATCH) return e.id;
			if (score > bestScore) {
				bestScore = score;
				bestId = e.id;
			}
		}
	}
	return bestId;
}
