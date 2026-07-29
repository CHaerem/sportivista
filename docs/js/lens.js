// lens.js — the SHIPPED personalisation lens for the web board.
//
// This is the JS twin of ios/Sportivista/Feed/FeedCompiler.swift, frozen
// bit-for-bit by the golden feed-vectors (tests/fixtures/feed-vectors). Before
// this file existed the web board was catalog-wide and the only "JS reference"
// the Swift port was proven against lived INSIDE tests/feed-vectors.test.js —
// so the code users ran was never the code the vectors pinned. lens.js closes
// that hole: it is the one lens, shipped to the browser AND asserted by the
// vectors.
//
// TUNABLES (the default follow list, the entity-gate, the retention window, the
// must-see importance threshold, the endurance-sport verb set, the sport words)
// come from the SHARED docs/config/lens-config.json — the SAME file iOS bundles
// (see LensConfig.swift). Change a value there and both platforms follow. The
// ALGORITHM stays twinned here <-> FeedCompiler.swift; only parameters are config.
//
// Two matchers, DELIBERATELY different (pinned, DIVERGENCES.md §2):
//   • relevance + the bell use WORD-BOUNDARY matching (ssContainsTerm), sport-scoped;
//   • must-see uses NAIVE lowercase substring (`.includes`) — "Brooklyn" matches "Lyn".
// Do NOT "unify" them.
//
// Depends on shared-constants.js (ssContainsTerm, ssNormalize, trackedTerms),
// loaded before this file. Plain window-globals, no build step.

/** Baked-in fallback identical to docs/config/lens-config.json — used when the
 *  config fetch fails so the lens degrades to today's behaviour, never breaks. */
const SS_LENS_DEFAULTS = Object.freeze({
	followBroadlyDefault: [
		'football', 'golf', 'f1', 'cycling',
		'biathlon', 'cross-country', 'alpine', 'nordic', 'ski jumping',
	],
	entityGatedSports: ['chess', 'esports'],
	retentionDays: 14,
	mustSeeImportance: 4,
	enduranceSports: [
		'cycling', 'athletics', 'biathlon', 'cross-country', 'alpine', 'nordic', 'ski jumping',
	],
	sportNb: {
		football: 'fotball', golf: 'golf', f1: 'Formel 1', cycling: 'sykkel',
		tennis: 'tennis', chess: 'sjakk', esports: 'esport', athletics: 'friidrett',
		biathlon: 'skiskyting', 'cross-country': 'langrenn', alpine: 'alpint',
	},
});

/** Coalesce a possibly-partial config with the baked-in defaults. */
function ssLensConfig(cfg) {
	if (!cfg) return SS_LENS_DEFAULTS;
	return {
		followBroadlyDefault: cfg.followBroadlyDefault || SS_LENS_DEFAULTS.followBroadlyDefault,
		entityGatedSports: cfg.entityGatedSports || SS_LENS_DEFAULTS.entityGatedSports,
		retentionDays: cfg.retentionDays != null ? cfg.retentionDays : SS_LENS_DEFAULTS.retentionDays,
		mustSeeImportance: cfg.mustSeeImportance != null ? cfg.mustSeeImportance : SS_LENS_DEFAULTS.mustSeeImportance,
		enduranceSports: cfg.enduranceSports || SS_LENS_DEFAULTS.enduranceSports,
		sportNb: cfg.sportNb || SS_LENS_DEFAULTS.sportNb,
	};
}

/** The haystack the relevance/bell matchers scan — mirror FeedCompiler
 *  serverHaystack / helpers.js coverageHaystack: title + tournament + home/away
 *  + Norwegian players' names + participants' names (venue excluded). */
function ssLensHaystack(e) {
	const parts = [e.title || '', e.tournament || '', e.homeTeam || '', e.awayTeam || ''];
	for (const p of e.norwegianPlayers || []) parts.push(p && (p.name || p) || '');
	for (const p of e.participants || []) parts.push(p && (p.name || p) || '');
	return parts.join(' ');
}

/** Normalise an alwaysTrack entry (bare string or {name,aliases,sport,notify})
 *  into {terms, sport, notify} — carrying sport (for scoping) and notify (for
 *  the bell), which trackedTerms() alone drops. */
function ssLensEntity(raw, defaultNotify) {
	if (typeof raw === 'string') return raw ? { terms: [raw], sport: null, notify: defaultNotify } : null;
	if (!raw) return null;
	// Idempotent: an already-normalised entity ({terms,…}) re-normalises to itself
	// (mirrors the server's idempotent normalizeEntity), so ssNotifyEntities' output
	// survives a second pass through ssMatchInterest.
	if (Array.isArray(raw.terms)) {
		return { terms: raw.terms, sport: raw.sport || null, notify: raw.notify == null ? defaultNotify : !!raw.notify };
	}
	if (!raw.name) return null;
	const terms = [raw.name];
	if (Array.isArray(raw.aliases)) for (const a of raw.aliases) if (a) terms.push(a);
	return { terms: ssWithEditionlessTerms(terms), sport: raw.sport || null, notify: raw.notify == null ? defaultNotify : !!raw.notify };
}

/** WP-162 — the SEASON-PROOF term set: every term plus its edition-stripped form.
 *  A follow freezes the entity NAME at follow time ("Premier League 2026/27"),
 *  so without this a rule created against one edition word-boundary-matches
 *  NOTHING once the next edition's title lands on the board — a follow that dies
 *  silently. The stripped form is a full, yearless name ("Premier League"), so it
 *  is a legitimate word-boundary term and never an acronym-style near-collision.
 *  Additive and idempotent: a term with no edition token contributes nothing. */
function ssWithEditionlessTerms(terms) {
	if (typeof ssEditionStripped !== 'function') return terms;
	const out = terms.slice();
	const seen = new Set(out.map((t) => ssNormalize(t)));
	for (const t of terms) {
		const stripped = ssEditionStripped(t);
		if (!stripped) continue;
		const key = ssNormalize(stripped);
		if (!key || seen.has(key)) continue;
		seen.add(key);
		out.push(stripped);
	}
	return out;
}

/** Port of server matchInterest (helpers.js:120) / FeedCompiler.matchInterest:
 *  the first entity whose name/alias WORD-BOUNDARY-matches haystack, else null.
 *  When `sport` is given AND the entity carries its own sport, a mismatch skips
 *  it (sport-scoping); an entity with no sport, or no sport arg, matches freely. */
function ssMatchInterest(haystack, entries, opts) {
	const sport = opts && opts.sport;
	for (const raw of entries || []) {
		const e = ssLensEntity(raw, opts && opts.defaultNotify);
		if (!e) continue;
		if (sport && e.sport && ssNormalize(e.sport) !== ssNormalize(sport)) continue;
		if (e.terms.some((t) => ssContainsTerm(haystack, t))) return e;
	}
	return null;
}

/** Port of notifyEntities (helpers.js:139): teams & athletes default notify:true,
 *  tournaments default notify:false — only notify:true entities arm the bell. */
function ssNotifyEntities(interests) {
	const at = (interests && interests.alwaysTrack) || {};
	const out = [];
	for (const raw of [...(at.teams || []), ...(at.athletes || [])]) {
		const e = ssLensEntity(raw, true);
		if (e && e.notify) out.push(e);
	}
	for (const raw of at.tournaments || []) {
		const e = ssLensEntity(raw, false);
		if (e && e.notify) out.push(e);
	}
	return out;
}

/** WP-200 — is `followBroadly` PRESENT on this interests object? Absent (nil /
 *  undefined / not an array) means "no profile speaks here": the lens falls back
 *  to the config default AND keeps the historic un-scoped blanket (rule 3). An
 *  explicit array — including `[]` — means a profile OWNS this board, and the
 *  blanket is narrowed to the sports that profile covers (`ssLensSportScope`).
 *  The absent-vs-empty distinction is the same one Interests.followBroadly has
 *  documented since WP-13 (`[]` is honoured as-is, nil falls back). */
function ssLensExplicitBroad(interests) {
	const fb = interests && interests.followBroadly;
	return Array.isArray(fb) ? fb : null;
}

/** WP-200 — the sports a profile-shaped board actually COVERS: the sports it
 *  follows wholesale PLUS the sport of every tracked entity. This is the scope
 *  of the norwegian/favorite/importance blanket (rule 3).
 *
 *  Before WP-200 that blanket was a blank cheque: ANY Norwegian, favourite or
 *  importance>=4 event reached the board whatever the profile said, so a user
 *  who picked only "Formel 1" still got golf, cycling and biathlon. Scoping it
 *  keeps the blanket where it belongs — inside the sports you chose — without
 *  demanding an entity match for every big moment in those sports (following
 *  Hovland still surfaces a Norwegian golf week; it just can't surface an F1-only
 *  user's golf week). An entity with no `sport` widens nothing; it still matches
 *  through the UNSCOPED rule (4). */
function ssLensSportScope(interests) {
	const scope = new Set((ssLensExplicitBroad(interests) || []).map((s) => String(s).toLowerCase()));
	const at = (interests && interests.alwaysTrack) || {};
	for (const raw of [...(at.teams || []), ...(at.athletes || []), ...(at.tournaments || [])]) {
		const sport = raw && typeof raw === 'object' ? raw.sport : null;
		if (sport) scope.add(String(sport).toLowerCase());
	}
	return scope;
}

/** §relevant — feed inclusion. Port of FeedCompiler.isRelevant (+ 14d cutoff).
 *  Order (WP-92): (1) followBroadly wholesale; (2) chess/esports SPORT-SCOPED
 *  entity-gate only; (3) norwegian/favorite/importance>=threshold blanket —
 *  SPORT-SCOPED to the profile's coverage since WP-200; (4) UNSCOPED
 *  tracked-entity match (DIVERGENCES §1). */
function ssIsRelevant(event, interests, nowMs, config) {
	const cfg = ssLensConfig(config);
	if (!event.time) return false;
	const relevantTime = event.endTime ? Date.parse(event.endTime) : Date.parse(event.time);
	if (relevantTime < nowMs - cfg.retentionDays * 86400000) return false;

	const explicitBroad = ssLensExplicitBroad(interests);
	const followBroadly = new Set((explicitBroad || cfg.followBroadlyDefault).map((s) => s.toLowerCase()));
	const sport = (event.sport || '').toLowerCase();
	if (followBroadly.has(sport)) return true;                               // (1)

	const at = (interests && interests.alwaysTrack) || {};
	const tracked = [...(at.teams || []), ...(at.athletes || []), ...(at.tournaments || [])];
	const hay = ssLensHaystack(event);
	if (new Set(cfg.entityGatedSports).has(sport)) {                         // (2)
		return ssMatchInterest(hay, tracked, { sport: event.sport }) != null;
	}
	// (3) WP-200: the blanket only fires inside the sports this board covers. With
	// no profile speaking (followBroadly absent) the scope is "every sport", i.e.
	// exactly the pre-WP-200 behaviour — the empty-profile guarantee.
	if (explicitBroad === null || ssLensSportScope(interests).has(sport)) {
		if (event.norwegian || event.isFavorite || (event.importance || 0) >= cfg.mustSeeImportance) return true;
	}
	return ssMatchInterest(hay, tracked) != null;                           // (4) unscoped
}

/** §mustWatch — the reminder bell. Port of mustWatchEntity: sport-scoped
 *  word-boundary match against the notify-set. */
function ssMustWatchEntity(event, interests) {
	if (!event) return null;
	return ssMatchInterest(ssLensHaystack(event), ssNotifyEntities(interests), { sport: event.sport });
}
function ssMustWatch(event, interests) {
	return ssMustWatchEntity(event, interests) != null;
}

/** §mustSee — the quiet visual accent. Port of dashboard.js isMustSee. NAIVE
 *  lowercase substring team/athlete matching (pinned, DIVERGENCES §2). */
function ssIsMustSee(event, interests, config) {
	if (event.isSeries) return false;
	const cfg = ssLensConfig(config);
	if (event.isFavorite || (event.importance || 0) >= cfg.mustSeeImportance
		|| (event.norwegian && (event.norwegianPlayers && event.norwegianPlayers.length))) return true;
	const at = (interests && interests.alwaysTrack) || {};
	const teams = [event.homeTeam || '', event.awayTeam || ''].map((t) => t.toLowerCase());
	if (teams.some((t) => /\bnorway\b|\bnorge\b/.test(t))) return true;
	const trackedTeams = trackedTerms(at.teams).map((t) => t.toLowerCase());
	if (teams.some((t) => t && trackedTeams.some((tt) => tt && t.includes(tt)))) return true;
	const hay = `${event.title || ''} ${(event.norwegianPlayers || []).map((p) => p.name || p).join(' ')}`.toLowerCase();
	const trackedAthletes = trackedTerms(at.athletes).map((a) => a.toLowerCase());
	return trackedAthletes.some((a) => a && hay.includes(a));
}

/** §whyShown — "hvorfor vises denne?" Port of FeedCompiler.whyShown: sport-scoped
 *  tracked-entity hit (athlete → team → tournament), then ai-research / norwegian
 *  / followed-sport / generic, + the bell tail. Personal voice ("Fordi X spiller"). */
function ssWhyShown(event, interests, config) {
	const cfg = ssLensConfig(config);
	const hay = ssLensHaystack(event);
	const firstHit = (entries) => {
		for (const raw of entries || []) {
			const e = ssLensEntity(raw, false);
			if (!e) continue;
			if (e.sport && ssNormalize(e.sport) !== ssNormalize(event.sport)) continue;
			if (e.terms.some((t) => ssContainsTerm(hay, t))) return typeof raw === 'string' ? raw : raw.name;
		}
		return null;
	};
	const at = (interests && interests.alwaysTrack) || {};
	const verb = new Set(cfg.enduranceSports).has(event.sport) ? 'er med' : 'spiller';
	let why;
	const athlete = firstHit(at.athletes);
	const team = athlete ? null : firstHit(at.teams);
	const tourn = athlete || team ? null : firstHit(at.tournaments);
	if (athlete) why = `Fordi ${athlete} ${verb}`;
	else if (team) why = `Fordi ${team} ${verb}`;
	else if (tourn) why = `Del av ${tourn}, som du følger`;
	else if (event.source === 'ai-research') why = 'AI-research fant dette for deg';
	else if (event.norwegian) why = 'Norsk deltakelse';
	else if (((interests && interests.followBroadly) || cfg.followBroadlyDefault).map((s) => s.toLowerCase()).includes((event.sport || '').toLowerCase())) {
		why = `Du følger ${cfg.sportNb[event.sport] || event.sport}`;
	} else why = 'Passer interessene dine';
	if (ssMustWatch(event, interests)) why += ' · varsler deg før start';
	return why;
}

// Node/vitest interop — the browser ignores this (no module.exports global).
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		SS_LENS_DEFAULTS, ssLensConfig, ssLensHaystack, ssMatchInterest,
		ssNotifyEntities, ssIsRelevant, ssMustWatchEntity, ssMustWatch,
		ssIsMustSee, ssWhyShown, ssLensExplicitBroad, ssLensSportScope,
	};
}
