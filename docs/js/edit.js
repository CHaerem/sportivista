// Edit page: load what Sportivista COVERS and make each entry editable with one
// click — no typing, no JSON. Each action deep-links to the follow-request Issue
// Form with fields PRE-FILLED via query params (GitHub renders the form, the user
// just submits). The existing workflow turns it into a PR they merge. Nothing is
// written directly — same review-gated flow, just zero manual input.
// Repo slug (SS_REPO), escapeHtml, ssShortReason, ssCoreName, trackedTerms,
// ssContainsTerm and ssNextEventForEntity come from shared-constants.js (loaded
// before this script); theme lives in js/theme.js.
//
// WP-120 web-parity: every row answers «what does following this GIVE me?» — the
// entity's next event as a subtitle (or an honest «ikke satt opp ennå») + type
// grouping. Amber-overload fixed: the name is plain --fg, the row carries no amber
// (no 🔔 emoji), and the two actions moved off the row into a tap-to-expand detail
// (rad → detalj), so a row has at most one accent.
const KINDS = [
	['athletes', 'Utøver', 'Utøvere'],
	['teams', 'Lag', 'Lag'],
	['tournaments', 'Turnering', 'Turneringer'],
];

// The board of events behind the "next event" line on each row — set by the
// bootstrap before render(); row() reads it (defaulted so it stays testable).
let allEvents = [];

// GitHub Issue Forms DON'T prefill dropdowns from the URL — only text fields — so
// prefilling the template left Handling/Type unset. Instead compose the whole
// structured body (which the workflow's parser reads) and apply the label that
// triggers the workflow. Everything arrives filled in; the user just submits.
function issueUrl(f) {
	const lines = [
		'Send inn dette, så oppdaterer boten lista automatisk og bygger om siden.',
		`### Handling\n\n${f.action}`,
		`### Type\n\n${f.kind}`,
		`### Navn\n\n${f.name}`,
	];
	if (f.aliases) lines.push(`### Aliaser (komma-separert, valgfritt)\n\n${f.aliases}`);
	if (f.sport) lines.push(`### Sport (valgfritt, men hjelper matchingen)\n\n${f.sport}`);
	if (f.notify) lines.push(`### Kalendervarsel?\n\n${f.notify}`);
	const p = new URLSearchParams({
		labels: 'follow-request',
		title: `[følg] ${f.action}: ${f.name}`,
		body: lines.join('\n\n'),
	});
	return `https://github.com/${SS_REPO}/issues/new?${p.toString()}`;
}

// ── The "already followed?" test, extracted once (WP-120 dedup) ───────────────
// Two near-identical closures used to live in render() and buildLocalCandidates();
// they only differed in whether the candidate name was core-stripped before the
// reverse containment check. One builder + one factory now, parametrised by that.
/** The flat list of follow terms (name + aliases) across teams/athletes/tournaments. */
function buildFollowedSet(at) {
	return ['teams', 'athletes', 'tournaments'].flatMap((k) => trackedTerms((at || {})[k] || []));
}
/** A predicate: is `name` already one of `followed`? `core` strips a trailing
 *  year/parenthetical off `name` before the reverse check (for AI discoveries like
 *  "Tour de France 2026"); off for candidate names that are already clean. */
function makeIsFollowed(followed, { core = false } = {}) {
	return (name) => followed.some((t) => ssContainsTerm(name, t) || ssContainsTerm(t, core ? ssCoreName(name) : name));
}

/** Does this entry notify? Teams/athletes default on; tournaments default off. */
function notifies(entry, kindKey) {
	const def = kindKey !== 'tournaments';
	return entry && typeof entry === 'object' && entry.notify != null ? entry.notify : def;
}

/** The next-event subtitle for a row: «Neste: lør 25. jul · Strømsgodset – Lyn ·
 *  TV 2» or an honest «ikke satt opp ennå». */
function editNextLine(next) {
	if (!next) return 'ikke satt opp ennå';
	const d = new Date(next.time);
	const day = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
	const what = (next.homeTeam && next.awayTeam) ? `${ssShortName(next.homeTeam)} – ${ssShortName(next.awayTeam)}` : (next.title || '');
	const chan = (Array.isArray(next.streaming) && next.streaming[0] && (next.streaming[0].platform || next.streaming[0])) || '';
	return `Neste: ${[day, what, chan].filter(Boolean).join(' · ')}`;
}

/** The fuller when·what·where line shown in the expanded detail. */
function editDetailLine(next) {
	const d = new Date(next.time);
	const when = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
	const what = (next.homeTeam && next.awayTeam) ? `${ssShortName(next.homeTeam)} – ${ssShortName(next.awayTeam)}` : (next.title || '');
	const chans = (Array.isArray(next.streaming) ? next.streaming : []).map((s) => s.platform || s).filter(Boolean).join(' · ') || '–';
	return [when, what, chans].filter(Boolean).join(' · ');
}

/** One coverage row: name + next-event subtitle, tap to reveal the detail (aliases,
 *  the fuller next-event line, and the two actions). No amber in the resting row. */
function row(entry, kindKey, kindLabel, events = allEvents, now = Date.now()) {
	const name = typeof entry === 'string' ? entry : entry.name;
	const on = notifies(entry, kindKey);
	const sport = typeof entry === 'object' && entry.sport ? entry.sport : '';
	const aliases = typeof entry === 'object' && Array.isArray(entry.aliases) ? entry.aliases.join(', ') : '';
	const next = ssNextEventForEntity(events, entry, now);
	const toggleUrl = issueUrl({ action: 'Endre varsel', kind: kindLabel, name, notify: on ? 'Nei' : 'Ja' });
	const removeUrl = issueUrl({ action: 'Fjern', kind: kindLabel, name });
	const detailWhen = next
		? `<div class="ed-detail-when">${escapeHtml(editDetailLine(next))}</div>`
		: '<div class="ed-detail-when muted">Ingen kommende hendelse akkurat nå.</div>';
	return `<li class="ed-item">
		<div class="ed-row" role="button" tabindex="0" aria-expanded="false">
			<span class="ed-main">
				<span class="ed-name">${escapeHtml(name)}</span>
				<span class="ed-next${next ? '' : ' no-event'}">${escapeHtml(editNextLine(next))}</span>
			</span>
			${sport ? `<span class="ed-meta">${escapeHtml(sport)}</span>` : ''}
		</div>
		<div class="ed-detail" hidden>
			${aliases ? `<div class="ed-alias">også: ${escapeHtml(aliases)}</div>` : ''}
			${detailWhen}
			<div class="ed-actions">
				<a class="btn" href="${toggleUrl}" target="_blank" rel="noopener">${on ? 'Slå av varsel' : 'Slå på varsel'}</a>
				<a class="btn btn-danger" href="${removeUrl}" target="_blank" rel="noopener">Fjern</a>
			</div>
		</div>
	</li>`;
}

/** A free-text interest line (e.g. an added sport) — tap to reveal a remove action. */
function briefRow(s) {
	const removeUrl = issueUrl({ action: 'Fjern', kind: 'Sport', name: s });
	return `<li class="ed-item">
		<div class="ed-row" role="button" tabindex="0" aria-expanded="false">
			<span class="ed-main"><span class="ed-name">${escapeHtml(s)}</span></span>
		</div>
		<div class="ed-detail" hidden><div class="ed-actions"><a class="btn btn-danger" href="${removeUrl}" target="_blank" rel="noopener">Fjern</a></div></div>
	</li>`;
}

/** "AI har funnet" row: a discovery, name + why + expiry, with a "Følg" action. */
function aiRow(x, kind) {
	const until = x.expires ? `<span class="ed-meta">ut ${escapeHtml(x.expires.slice(0, 10))}</span>` : '';
	const why = x.reason ? `<div class="ed-alias" title="${escapeHtml(x.reason)}">${escapeHtml(ssShortReason(x.reason))}</div>` : '';
	const followUrl = issueUrl({ action: 'Legg til', kind, name: ssCoreName(x.name), sport: x.sport || '', notify: 'Ja' });
	return `<li class="ed-item">
		<div class="ed-row" role="button" tabindex="0" aria-expanded="false">
			<span class="ed-main"><span class="ed-name">${escapeHtml(x.name)}</span></span>${until}
		</div>
		<div class="ed-detail" hidden>${why}<div class="ed-actions"><a class="btn" href="${followUrl}" target="_blank" rel="noopener">Følg</a></div></div>
	</li>`;
}

function render(interests, tracked) {
	const at = interests.alwaysTrack || {};
	const root = document.getElementById('edit-root');
	if (!root) return;
	let html = KINDS.map(([key, kindLabel, groupLabel]) => {
		const items = at[key] || [];
		const rows = items.length
			? `<ul class="ed-list">${items.map((e) => row(e, key, kindLabel)).join('')}</ul>`
			: '<p class="muted">Ingenting her ennå.</p>';
		return `<section class="edit-group"><h2>${groupLabel}</h2>${rows}</section>`;
	}).join('');
	const briefs = interests.interests || [];
	if (briefs.length) {
		html += `<section class="edit-group"><h2>Brede interesser</h2><p class="muted brief-note">Fritekst AI-en leter events fra. Legg til en sport via søket under.</p><ul class="ed-list">${briefs.map(briefRow).join('')}</ul></section>`;
	}
	// AI har funnet — the research agent's discoveries; promote any to a real follow.
	const isFollowed = makeIsFollowed(buildFollowedSet(at), { core: true });
	const trk = (label, items, kind) => {
		const disc = (items || []).filter((x) => x?.name && !isFollowed(x.name)); // only genuine discoveries
		return disc.length ? `<div class="edit-subhead">${label}</div><ul class="ed-list">` + disc.map((x) => aiRow(x, kind)).join('') + '</ul>' : '';
	};
	const aiHtml = trk('Turneringer', tracked?.tournaments, 'Turnering') + trk('Ligaer', tracked?.leagues, 'Turnering') + trk('Utøvere', tracked?.athletes, 'Utøver');
	if (aiHtml) html += `<section class="edit-group"><h2>AI har funnet for deg</h2><p class="muted brief-note">Ting AI-en fant utover lista di. Trykk «Følg» for å få det som fast følge med varsel.</p>${aiHtml}</section>`;
	root.innerHTML = html;
	bindEditRows();
}

/** Tap/keyboard expand for the coverage rows — one detail open per tap, action
 *  links still work (delegated on #edit-root, survives re-render). */
let editRowsBound = false;
function bindEditRows() {
	if (editRowsBound) return;
	const root = document.getElementById('edit-root');
	if (!root) return;
	editRowsBound = true;
	const toggle = (rowEl) => {
		const detail = rowEl.parentElement.querySelector('.ed-detail');
		if (!detail) return;
		const open = rowEl.getAttribute('aria-expanded') === 'true';
		rowEl.setAttribute('aria-expanded', String(!open));
		detail.hidden = open;
	};
	root.addEventListener('click', (evt) => {
		if (evt.target.closest('a')) return; // let the action links work
		const rowEl = evt.target.closest('.ed-item .ed-row');
		if (rowEl) toggle(rowEl);
	});
	root.addEventListener('keydown', (evt) => {
		if (evt.key !== 'Enter' && evt.key !== ' ') return;
		const rowEl = evt.target.closest('.ed-item .ed-row');
		if (rowEl) { evt.preventDefault(); toggle(rowEl); }
	});
}

// ── Add: search local data + TheSportsDB (teams) → prefilled "Legg til" issue ──
// Local data (your standings/board) has the RIGHT athletes/tournaments; TheSportsDB
// broadens teams reliably (CORS-ok, sport-specific). Its player search is football-
// skewed/unreliable, so athletes/tournaments come from local + a manual fallback.
const SPORT_MAP = { Soccer: 'football', Golf: 'golf', Tennis: 'tennis', Cycling: 'cycling', Motorsport: 'f1', Athletics: 'athletics', Esports: 'esports' };
// Sports a user might add as a free-text interest (the AI then researches them).
const SPORTS_NB = ['Håndball', 'Ishockey', 'Friidrett', 'Langrenn', 'Skiskyting', 'Alpint', 'Skihopp', 'Kombinert', 'Svømming', 'Roing', 'Bryting', 'Boksing', 'MMA', 'Basketball', 'Volleyball', 'Bordtennis', 'Badminton', 'Padel', 'Motorsport', 'Rally', 'Sjakk', 'Esport', 'Golf', 'Tennis', 'Sykkel', 'Fotball'];
let localCandidates = [];

function buildLocalCandidates(events, standings, interests) {
	const at = interests?.alwaysTrack || {};
	const isFollowed = makeIsFollowed(buildFollowedSet(at));
	const seen = new Set();
	const out = [];
	const add = (name, kind, sport) => {
		name = (name || '').trim();
		if (name.length < 2) return;
		const key = kind + '|' + ssNormalize(name);
		if (seen.has(key) || isFollowed(name)) return;
		seen.add(key);
		out.push({ name, kind, sport: sport || '', source: 'lokal' });
	};
	const tbl = standings?.football || {};
	for (const arr of [tbl.premierLeague, tbl.laLiga]) for (const r of (arr || [])) add(r.team, 'Lag', 'football');
	for (const e of (events || [])) {
		add(e.homeTeam, 'Lag', e.sport);
		add(e.awayTeam, 'Lag', e.sport);
		add(e.tournament, 'Turnering', e.sport);
		for (const p of (e.norwegianPlayers || [])) add(p.name || p, 'Utøver', e.sport);
	}
	return out;
}

async function searchTeamsExternal(q) {
	try {
		const r = await fetch(`https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=${encodeURIComponent(q)}`);
		if (!r.ok) return [];
		const d = await r.json();
		return (d.teams || []).slice(0, 6).map((t) => ({
			name: t.strTeam, kind: 'Lag',
			sport: SPORT_MAP[t.strSport] || '',
			source: 'ekstern',
		}));
	} catch { return []; }
}

function dedupe(list) {
	const seen = new Set();
	return list.filter((c) => { const k = c.kind + '|' + ssNormalize(c.name); if (seen.has(k)) return false; seen.add(k); return true; });
}

function suggestionEl(c) {
	const url = issueUrl({ action: 'Legg til', kind: c.kind, name: c.name, sport: c.sport, notify: c.kind === 'Sport' ? undefined : 'Standard' });
	const sport = c.sport ? `<span class="s-sport">${escapeHtml(c.sport)}</span>` : '';
	return `<a class="suggestion" href="${url}" target="_blank" rel="noopener"><span>${escapeHtml(c.name)}</span>${sport}<span class="s-kind">${escapeHtml(c.kind)}${c.source === 'ekstern' ? ' · søk' : ''}</span></a>`;
}

function renderSuggestions(list, q) {
	const box = document.getElementById('add-suggestions');
	if (!box) return;
	const manualUrl = `https://github.com/${SS_REPO}/issues/new?${new URLSearchParams({ template: 'follow.yml', name: q }).toString()}`;
	const manual = `<a class="suggestion manual" href="${manualUrl}" target="_blank" rel="noopener">Legg til «${escapeHtml(q)}» manuelt — velg type + sport</a>`;
	box.innerHTML = list.slice(0, 8).map(suggestionEl).join('') + manual;
}

let searchTimer;
function onSearch(q) {
	q = (q || '').trim();
	const box = document.getElementById('add-suggestions');
	if (!box) return;
	if (q.length < 2) { box.innerHTML = ''; return; }
	const nq = ssNormalize(q);
	const local = localCandidates.filter((c) => ssNormalize(c.name).includes(nq));
	const sports = SPORTS_NB.filter((s) => ssNormalize(s).includes(nq)).map((s) => ({ name: s, kind: 'Sport', sport: '', source: 'sport' }));
	renderSuggestions(dedupe([...local, ...sports]), q); // instant
	clearTimeout(searchTimer);
	searchTimer = setTimeout(async () => {
		const ext = await searchTeamsExternal(q);
		if ((document.getElementById('add-search')?.value || '').trim() !== q) return; // stale query
		renderSuggestions(dedupe([...local, ...sports, ...ext]), q);
	}, 300);
}

// WP-96: this page now shows what Sportivista COVERS (catalog.json) and lets a
// user REQUEST additional coverage — interests.json is no longer published. The
// catalog's tier2 maps onto the alwaysTrack shape render() expects. TODO (WP-96
// follow-up): the follow-request Issue Form + apply-follow-request.js still write
// the owner's interests.json (the OWNER-gated seed path); rewiring the public
// "request coverage" flow to feed catalog tier2 / demand-aggregation is WP-23.
// Guarded so loading this file in a test sandbox (no #edit-root) doesn't fire the
// async fetch chain (WP-120 — makes the pure helpers unit-testable).
function initEditPage() {
	Promise.all([
		fetch('data/catalog.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
		fetch('data/events.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => []),
		fetch('data/standings.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
		fetch('data/tracked.json', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
	]).then(([catalog, events, standings, tracked]) => {
		const covered = { alwaysTrack: (catalog && catalog.tier2) || {}, interests: [] };
		allEvents = Array.isArray(events) ? events : [];
		render(covered, tracked);
		localCandidates = buildLocalCandidates(events, standings, covered);
		document.getElementById('add-search')?.addEventListener('input', (e) => onSearch(e.target.value));
	}).catch(() => {
		const root = document.getElementById('edit-root');
		if (root) root.innerHTML = '<p class="muted">Kunne ikke laste lista. Prøv å laste siden på nytt.</p>';
	});
}

if (typeof document !== 'undefined' && document.getElementById('edit-root')) initEditPage();
