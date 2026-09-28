// Sportivista Shared Constants & Utilities
// Canonical source of truth for values shared between client (dashboard.js) and server (helpers.js).
// Loaded as the first <script> tag — all symbols are globals.

// ── Repo ────────────────────────────────────────────────────────────────────
// The ONE repo slug — used for issue/PR deep links on all pages.
const SS_REPO = 'CHaerem/sportivista';

// ── Time constants ──────────────────────────────────────────────────────────
const MS_PER_MINUTE = 60000;
const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

// ── Pure utility functions ──────────────────────────────────────────────────

/** Check if an event overlaps a time window. Handles multi-day events (endTime). */
function isEventInWindow(event, windowStart, windowEnd) {
	if (!event?.time) return false;
	const start = new Date(event.time).getTime();
	const end = event.endTime ? new Date(event.endTime).getTime() : start;
	const ws = windowStart instanceof Date ? windowStart.getTime() : windowStart;
	const we = windowEnd instanceof Date ? windowEnd.getTime() : windowEnd;
	return start < we && end >= ws;
}

/** HTML-escape a string (& < > " ') */
function escapeHtml(str) {
	if (typeof str !== 'string') return '';
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

/** Strip FC/AFC/CF/FK suffixes and prefixes from team names */
function ssShortName(name) {
	if (!name) return '';
	return name.replace(/ FC$| AFC$| CF$| FK$/i, '').replace(/^FC |^AFC /i, '').trim();
}

/** The head-to-head matchup names for an event as a PLAIN "A – B" string — when
 *  `participants` is EXACTLY two named sides and there's no home/away pair — else
 *  null. Fires only for two: a golf/CS2 field of four is a tournament, not a
 *  matchup, and keeps its own title. Un-escaped: HTML callers escape the result
 *  (dashboard.js `participantMatchup`), plain-text callers (detail.js share/
 *  report titles) use it directly. Mirrors iOS `AgendaFormat.matchupTitle`. */
function ssParticipantMatchup(e) {
	if (!e || (e.homeTeam && e.awayTeam)) return null;
	const names = (Array.isArray(e.participants) ? e.participants : [])
		.map((p) => (p && p.name) || (typeof p === 'string' ? p : ''))
		.filter(Boolean);
	if (names.length !== 2) return null;
	return `${ssShortName(names[0])} – ${ssShortName(names[1])}`;
}

/** Fuzzy team name matching (normalize + substring inclusion) */
function ssTeamMatch(a, b) {
	const normalize = s => s.toLowerCase().replace(/ fc$| afc$| cf$| fk$/i, '').replace(/^fc |^afc /i, '').trim();
	return normalize(a) === normalize(b) || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}

/** Display name of an alwaysTrack entry (bare string or {name, aliases} object). */
function ssEntityName(entry) {
	return typeof entry === 'string' ? entry : (entry && entry.name) || '';
}

/** WP-162 — a name with its EDITION noise removed: a trailing "(…)" annotation
 *  and any 4-digit year / "2026/27" season token. "Tour de France 2026" → "Tour
 *  de France"; "The Open Championship 2026 (Royal Birkdale)" → "The Open
 *  Championship". The JS twin of build-entities.js `editionStrippedName` and
 *  iOS `EntityIndex.editionStripped` — a follow frozen against one edition must
 *  keep matching the next one. Returns '' when nothing meaningful remains. */
function ssEditionStripped(name) {
	return String(name || '')
		.replace(/\s*\([^)]*\)\s*$/g, ' ')
		.replace(/\b(?:19|20)\d{2}(?:\s*\/\s*\d{2})?\b/g, ' ')
		.replace(/\s{2,}/g, ' ')
		.replace(/^[\s–—-]+|[\s–—-]+$/g, '')
		.trim();
}

/** Flatten alwaysTrack entries into match terms (name + aliases), string or object. */
function trackedTerms(entries) {
	const out = [];
	for (const e of entries || []) {
		if (typeof e === 'string') { if (e) out.push(e); }
		else if (e && e.name) {
			out.push(e.name);
			if (Array.isArray(e.aliases)) for (const a of e.aliases) if (a) out.push(a);
		}
	}
	return out;
}

/** Lowercase + strip diacritics (mirrors the server's normalizeText). */
function ssNormalize(s) {
	return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Word-boundary, accent-insensitive containment (mirrors server containsName). */
function ssContainsTerm(haystack, term) {
	const n = ssNormalize(term).trim();
	if (!n) return false;
	const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:[^\\p{L}\\p{N}]|$)`, 'iu').test(ssNormalize(haystack));
}

/** Strip a trailing year / season / parenthetical from a tracked name for a clean
 *  follow ("Tour de France 2026" → "Tour de France"). Mirrors the iOS resolver's
 *  edition-stripping; shared so edit.js and detail.js don't each carry the regex. */
function ssCoreName(name) {
	return String(name).replace(/\s*\d{4}(?:\/\d{2})?/g, '').replace(/\s*\(.*?\)/g, '').trim();
}

/** The next upcoming event for a followed entity, searched across ALL events
 *  (not the agenda window). Sport-scoped so "Barcelona" (football) never matches
 *  a Tour stage through the city; a >3h-old event is treated as over. Returns the
 *  event or null. The ONE next-event matcher shared by the dashboard's «Dette
 *  dekker vi» rows (followed.js) and the rediger page (edit.js) — same word-
 *  boundary term match as the server, so both surfaces answer identically. */
function ssNextEventForEntity(events, entry, now = Date.now()) {
	const terms = trackedTerms([entry]).map((t) => t.toLowerCase()).filter(Boolean);
	if (!terms.length) return null;
	const sport = (entry && typeof entry === 'object') ? entry.sport : null;
	const floor = now - 3 * MS_PER_HOUR;
	let best = null, bestStart = Infinity;
	for (const e of events || []) {
		if (sport && e.sport && e.sport !== sport) continue;
		const start = new Date(e.time).getTime();
		const end = e.endTime ? new Date(e.endTime).getTime() : start;
		if (!(end >= floor)) continue; // already over
		const hay = [e.title, e.tournament, e.homeTeam, e.awayTeam,
			...(e.norwegianPlayers || []).map((p) => p.name || p),
			...(e.participants || []).map((p) => p.name || p)].filter(Boolean).join(' ');
		if (!terms.some((t) => ssContainsTerm(hay, t))) continue;
		if (start < bestStart) { best = e; bestStart = start; }
	}
	return best;
}

// ── Live state (WP-126: the ONE shared "is it live right now?" definition) ────
// Mirrored 1:1 in iOS `AgendaViewModel.liveState` (Swift). Returns:
//   'direkte' — now sits inside a plausible ACTIVE session → the ▌ live line
//   'pågår'   — a multi-day tournament that's underway but OUTSIDE today's
//               plausible daily playing window (calm; it has its own agenda
//               row and must NEVER get the live dot — the 03:00 golf bug)
//   null      — not started yet, or finished
//
// This is a HEURISTIC and deliberately CONSERVATIVE: we would rather say
// 'pågår' than a false 'direkte'. The rules, in order:
//   1. An authoritative source `status` naming an in-progress state wins.
//   2. Before `time`, or with no `time`, → null.
//   3. A multi-day tournament (endTime more than ~24h after start — golf weeks,
//      multi-day chess) can't tell us its per-day session start, so we fall back
//      to a plausible daily window in Oslo local time [08:00, 22:00): inside →
//      'direkte', otherwise 'pågår'; past its endTime → null. (We lack the
//      venue-local clock — hence the conservative Oslo-clock window; a US golf
//      afternoon read as 'pågår' late Oslo-evening is the accepted trade-off.)
//   4. A single session: trust `endTime` when present (a plausible session
//      length ≤ ~24h), else assume a sport-typed default duration from `time`
//      (football ~2h15, F1 session ~2h, cycling stage ~5h30, chess round ~5h,
//      CS2 match ~2h30, tennis ~3h30, golf-day ~10h, else ~3h). Live while
//      now ≤ effectiveEnd, then null.
const SS_MULTIDAY_MS = 24 * MS_PER_HOUR;

/** Sport-typed default session duration in ms (WP-126) — the fallback when an
 *  event carries no endTime. Kept identical to iOS `sportDefaultDuration`. */
function ssSportDefaultMs(sport) {
	switch ((sport || '').toLowerCase()) {
		case 'football': return 135 * MS_PER_MINUTE; // ~2h15 incl. stoppage + half-time
		case 'f1': case 'formula1': return 120 * MS_PER_MINUTE; // a race/quali/practice session
		case 'cycling': return 330 * MS_PER_MINUTE; // a road stage (~5h30)
		case 'chess': return 300 * MS_PER_MINUTE; // a classical round (~5h)
		case 'cs2': case 'esports': return 150 * MS_PER_MINUTE; // a best-of match (~2h30)
		case 'tennis': return 210 * MS_PER_MINUTE; // a best-of match (~3h30)
		case 'golf': return 600 * MS_PER_MINUTE; // a day's play fallback (~10h; golf is normally multi-day)
		default: return 180 * MS_PER_MINUTE; // conservative generic session (~3h)
	}
}

/** The Oslo-local hour (0–23) at `ms` — for the multi-day daily-window check.
 *  Uses Date's own tz formatter (not the Intl global, which the test sandbox
 *  doesn't stub); `% 24` folds the en-GB midnight "24" quirk back to 0. */
function ssOsloHour(ms) {
	const s = new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hour12: false });
	return parseInt(s, 10) % 24;
}

// ── Brief ritual boundary (WP-181) ───────────────────────────────────────────
// The Oslo wall-clock split that NAMES the personal brief («Min brief», WP-174):
// «Morgenbriefen» before this hour, «Kveldsbriefen» at/after. ONE shared
// definition across every surface — the web hero title, the iOS Nyheter brief
// header, and the widget's morning brief line — twinned bit-for-bit with
// ios/Sportivista/Feed/BriefRitual.swift. 15: «før ~12» is trivially morning and
// «etter ~15» flips to evening; the 12–15 afternoon resolves to morning (the
// evening editorial content doesn't refresh until 17:00 Oslo anyway). It names
// the RITUAL only — the brief TEXT is WP-174's frozen composer, untouched here.
const SS_BRIEF_EVENING_HOUR = 15;

/** 'morning' | 'evening' for the given instant, in Oslo time. `now` is a ms
 *  number or a Date (defaults to now). */
function ssBriefRitual(now = Date.now()) {
	const ms = now instanceof Date ? now.getTime() : now;
	return ssOsloHour(ms) >= SS_BRIEF_EVENING_HOUR ? 'evening' : 'morning';
}

/** The ritual's Norwegian name in bestemt form: «Morgenbriefen» / «Kveldsbriefen». */
function ssBriefRitualName(now = Date.now()) {
	return ssBriefRitual(now) === 'evening' ? 'Kveldsbriefen' : 'Morgenbriefen';
}

/** The ONE shared live definition — see the block comment above. Returns
 *  'direkte' | 'pågår' | null. `now` is a ms number or a Date (defaults to now). */
function ssLiveState(event, now) {
	if (!event) return null;
	const nowMs = now instanceof Date ? now.getTime() : (now == null ? Date.now() : now);
	// 1. authoritative in-progress status wins outright (mirror iOS substrings)
	const status = String(event.status || '').toLowerCase();
	if (status === 'in' || status.includes('in_progress') || status.includes('in-progress')
		|| status.includes('live') || status.includes('halftime')) return 'direkte';
	// 2. need a start, and it must have arrived
	if (!event.time) return null;
	const start = new Date(event.time).getTime();
	if (!Number.isFinite(start) || nowMs < start) return null;
	const rawEnd = event.endTime ? new Date(event.endTime).getTime() : null;
	const hasEnd = rawEnd != null && Number.isFinite(rawEnd);
	// 3. multi-day tournament → conservative daily window
	if (hasEnd && rawEnd - start > SS_MULTIDAY_MS) {
		if (nowMs > rawEnd) return null;
		const h = ssOsloHour(nowMs);
		return (h >= 8 && h < 22) ? 'direkte' : 'pågår';
	}
	// 4. single session
	const effectiveEnd = (hasEnd && rawEnd > start) ? rawEnd : start + ssSportDefaultMs(event.sport);
	return nowMs <= effectiveEnd ? 'direkte' : null;
}

// ── Live football leagues (WP-172) ───────────────────────────────────────────
// The ESPN soccer scoreboards the client live-poll may enrich a board row from.
// This is a DATA MIRROR of the football leagues in scripts/config/sports-config.js
// (`sportsConfig.football` ESPN source) — MINUS esp.copa_del_rey (the same set the
// seed-registry mirror already draws, scripts/seed-registry/espn.js FOOTBALL_LEAGUES:
// Copa reaches deep into regional Spanish football and is not worth the extra live
// scoreboard poll). `tests/live-leagues.test.js` PINS this against sports-config so a
// league added/removed there fails CI until this list follows. Eliteserien (nor.1) +
// OBOS-ligaen (nor.2) are in the list — the old hardcoded ['eng.1','esp.1','fifa.world']
// gate meant a Lyn match never got a live score (WP-172). The `name` is the ESPN
// display name, used to map a board event's `tournament` back to its league code.
const SS_FOOTBALL_LEAGUES = [
	{ code: 'eng.1', name: 'Premier League' },
	{ code: 'esp.1', name: 'La Liga' },
	{ code: 'ita.1', name: 'Serie A' },
	{ code: 'ger.1', name: 'Bundesliga' },
	{ code: 'nor.1', name: 'Eliteserien' },
	{ code: 'nor.2', name: 'OBOS-ligaen' },
	{ code: 'uefa.champions', name: 'Champions League' },
	{ code: 'fifa.world', name: 'FIFA World Cup' },
];

/** The SS_FOOTBALL_LEAGUES entry a football event belongs to, matched by its
 *  `tournament` against the league display name (accent-insensitive containment,
 *  either direction — "Eliteserien 2026" ⊇ "Eliteserien", "Champions" ⊆ "UEFA
 *  Champions League"), else null. Lets the live poll target ONLY the league a
 *  board match is actually in — one scoreboard, not the whole list. Mirrors iOS
 *  `LiveLeague.forEvent`. */
function ssFootballLeagueForEvent(event, leagues = SS_FOOTBALL_LEAGUES) {
	const t = ssNormalize(event && event.tournament).trim();
	if (!t) return null;
	for (const league of leagues) {
		const n = ssNormalize(league.name).trim();
		if (n && (t.includes(n) || n.includes(t))) return league;
	}
	return null;
}

/** Trim an agent reason to a one-line gist (drops the provenance prefix). */
function ssShortReason(r, max = 130) {
	if (!r) return '';
	let s = String(r).replace(/^\s*(alwaysTrack\.\w+\.?|interests\.json#\S+)\s*/i, '').replace(/^[,.\s]+/, '').trim();
	if (s.length > max) s = s.slice(0, max - 2).replace(/\s+\S*$/, '') + '…';
	return s;
}

// ── Expose globals ──────────────────────────────────────────────────────────
window.SS_CONSTANTS = Object.freeze({
	MS_PER_MINUTE,
	MS_PER_HOUR,
	MS_PER_DAY,
});

window.SS_REPO = SS_REPO;
window.SS_FOOTBALL_LEAGUES = SS_FOOTBALL_LEAGUES;
window.ssFootballLeagueForEvent = ssFootballLeagueForEvent;
window.isEventInWindow = isEventInWindow;
window.ssLiveState = ssLiveState;
window.ssBriefRitual = ssBriefRitual;
window.ssBriefRitualName = ssBriefRitualName;
window.ssShortReason = ssShortReason;
window.escapeHtml = escapeHtml;
window.ssShortName = ssShortName;
window.ssParticipantMatchup = ssParticipantMatchup;
window.ssTeamMatch = ssTeamMatch;
window.ssEntityName = ssEntityName;
window.trackedTerms = trackedTerms;
window.ssContainsTerm = ssContainsTerm;
window.ssNormalize = ssNormalize;
window.ssCoreName = ssCoreName;
window.ssNextEventForEntity = ssNextEventForEntity;
window.ssEditionStripped = ssEditionStripped;
