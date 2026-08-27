// Sportivista — a calm overview of the sport you follow.
// One question, answered quietly: what's on, when (Oslo), and where to watch.
// One list, grouped by day. No dashboard, no noise.
//
// The Dashboard class is split across files that share ONE prototype (no build
// step — the window-global pattern, like shared-constants.js). This file owns the
// core: lifecycle (init/loadData/render), the hero headline, the row helpers, and
// the agenda itself. The other seams extend window.Dashboard.prototype and MUST
// load after this file:
//   js/live.js     — live-now line + ESPN live polling
//   js/detail.js   — progressive-disclosure event detail (tap to expand)
//   js/followed.js — "Dine neste" + "Hva vi følger" index
//   js/chrome.js   — shell chrome (date, footer, AI-budget, install hint)
// Depends on: shared-constants.js.

class Dashboard {
	constructor() {
		this.allEvents = [];
		this.featured = null;
		this.tracked = null;
		this.meta = null;
		this.liveScores = {};
		this.liveLeaderboard = null;
		this.liveF1 = null;
		this._liveInterval = null;
		this._liveVisible = !document.hidden;
		// Agenda rows the reader has expanded, by event id — remembered so the 60s
		// live-poll re-render (which rebuilds the agenda's innerHTML) re-opens them
		// instead of collapsing what's being read (WP-128; mirrors live.js' _liveOpen).
		this._agendaOpen = new Set();
	}

	async init() {
		// Theme is owned by js/theme.js (shared across pages).
		this.renderDate();
		await this.loadData();
		this.render();
		this._lastRefresh = Date.now();
		this.startLivePolling();
		this.bindAgendaExpand();
		this.bindFollowed();
		this.bindLive();
		this.maybeShowInstallHint();
		this.renderAppPromo();
		if (typeof this.bindAssistant === 'function') this.bindAssistant();
		if (typeof this.bindFollowSearch === 'function') this.bindFollowSearch();
		if (typeof this.bindRootTabs === 'function') this.bindRootTabs();
		if (typeof this.bindEntityPage === 'function') this.bindEntityPage();
		document.addEventListener('visibilitychange', () => {
			this._liveVisible = !document.hidden;
			if (this._liveVisible) this.onResume();
		});
	}

	/** Brought back to the foreground. On iOS a home-screen PWA resumes the old
	 *  page instead of reloading, so data is fetched only once (in init) and the
	 *  board would keep showing yesterday. Re-pull data + re-stamp the date so a
	 *  reopen always reflects today. Throttled so quick tab-switches don't refetch. */
	async onResume() {
		const now = Date.now();
		if (this._lastRefresh && now - this._lastRefresh < 30 * 1000) {
			this.pollLiveScores();
			return;
		}
		this._lastRefresh = now;
		this.renderDate();   // the day may have rolled over since it was opened
		try { await this.loadData(); } catch { /* keep showing what we have */ }
		this.render();
		this.pollLiveScores();
	}

	async loadData() {
		const load = (f) => fetch(`data/${f}?t=${Date.now()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
		// WP-96: the web board is catalog-wide (what Sportivista COVERS). It loads
		// catalog.json — NOT a personal interests.json (that is no longer published;
		// the owner's personal view is the iOS app). `this.interests` stays null, so
		// the personal accents/lens degrade to event-intrinsic signals only.
		const [events, featured, standings, results, tracked, catalog, meta, usage, news, entities] = await Promise.all([
			load('events.json'), load('featured.json'), load('standings.json'), load('recent-results.json'), load('tracked.json'), load('catalog.json'), load('meta.json'), load('usage-state.json'),
			// news.json — lens-ready pointers (id/title/link/source/sport/entityIds/
			// publishedAt, never article text). Feeds the Nyheter board's NYTT section.
			load('news.json'),
			// entities.json — the stable-id index of athletes/teams/tournaments/leagues
			// (WP-05, folded from the catalog long-tail by WP-160). WP-163 uses it for
			// the search-and-follow flate AND to resolve an event's REAL entityId so a
			// web follow key-matches the iOS id across devices (no CRDT dupes).
			load('entities.json'),
		]);
		this.allEvents = Array.isArray(events) ? events : [];
		// The followable entity index — a bare array of {id,name,aliases,sport,type}.
		this.entities = Array.isArray(entities) ? entities : (entities && Array.isArray(entities.entities) ? entities.entities : []);
		this._identityIndex = null;   // WP-185: rebuilt lazily against the fresh index
		// news.json may be a bare array or {items:[…]} — normalise to an array.
		this.news = Array.isArray(news) ? news : (news && Array.isArray(news.items) ? news.items : []);
		// Prefer the server's stable id (build-events.js, WP-02) — a hash of
		// sport|title|time that survives re-renders/reorders. Fall back to the
		// old array-index synthesis only for a payload from before this field
		// existed (backward-compatible until the next rebuild republishes
		// events.json with ids). The live-score overlay (this.liveScores) keys
		// on this same e.id, so either source stays internally consistent.
		this.allEvents.forEach((e, i) => { if (!e.id) e.id = `${e.sport}|${e.title}|${e.time}|${i}`; });
		this.featured = featured;
		this.standings = standings;
		this.recentResults = results;
		this.tracked = tracked;
		this.catalog = catalog;
		// The SHARED lens tunables (docs/config/lens-config.json) — the SAME file
		// iOS bundles. Passed to lens.js; a fetch failure → lens.js's baked-in
		// defaults (byte-identical), so the board never breaks on a missing config.
		this.lensConfig = await fetch('config/lens-config.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
		// Shared assistant vocabulary (docs/config/assistant-vocab.json) — the SAME
		// file iOS bundles. A fetch failure → assistant.js's baked-in defaults.
		this.assistantVocab = await fetch('config/assistant-vocab.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
		// The personal profile makes the board YOURS: a stored follow list
		// (localStorage, synced via QR/iCloud) drives the accents, "dine lag og
		// utøvere", and why-shown. An EMPTY profile == today's catalog-wide board,
		// byte-for-byte (feed-vectors prove the equivalence). The web thus has NO
		// account requirement — it personalises only once you follow something.
		// WP-162: re-ground edition-stamped rule ids against the CURRENT index
		// FIRST — a follow made against `premier-league-2026-27` moves onto the
		// canonical `premier-league` (and its iOS twin does the byte-same move, so
		// the CRDT converges on one rule). No-op when nothing needs moving.
		const profile = (typeof ssProfileMigrateStored === 'function')
			? ssProfileMigrateStored(this.entities)
			: ((typeof ssProfileLoad === 'function') ? ssProfileLoad() : null);
		this.profile = profile;
		this.hasProfile = !!(profile && typeof ssStateIsEmpty === 'function' && !ssStateIsEmpty(profile));
		// WP-163 layering: the CATALOG (what we cover, ~130 names) is ALWAYS the base
		// layer — following something must never collapse "Dette dekker vi"/"Neste opp"
		// down to only your own list. `this.covers` = the catalog; `this.followed` =
		// your personal follows (shown as a "Det du følger" layer ABOVE the catalog).
		this.covers = catalog && catalog.tier2 ? { alwaysTrack: catalog.tier2 } : null;
		if (this.hasProfile) {
			// interests drives the LENS (isMustSee/whyShown/relevance) — unchanged.
			this.interests = ssProfileToInterests(profile);
			this.followed = { alwaysTrack: this.interests.alwaysTrack };
		} else {
			// interests null → isMustSee/emphasize use only event-intrinsic signals.
			this.interests = null;
			this.followed = null;
		}
		this.meta = meta;
		this.usage = usage;
	}

	render() {
		this.renderTodayLine();
		this.renderLive();
		// Agenda before "Neste opp": renderAgenda records which event ids are visible
		// in the window (this._agendaShownIds) so renderNextUp can dedupe a glance row
		// that already has its own agenda row (WP-128).
		this.renderAgenda();
		this.renderFremover();
		this.renderNextUp();
		this.renderFollowed();
		if (typeof this.renderNyheter === 'function') this.renderNyheter();
		this.renderFooter();
		this.renderUsage();
	}

	// ── Hero (the editorial brief) ────────────────────────────────────────────
	/** The hero headline — the editorial brief, set large in the display serif. */
	renderTodayLine(now = Date.now()) {
		const el = document.getElementById('hero-headline');
		if (!el) return;
		this.renderBriefTitle(now);
		el.innerHTML = this.emphasize(escapeHtml(this.heroHeadline(now)));
		this.bindBriefShare();
	}

	/** WP-181: the ritual NAME over the hero brief — «Morgenbriefen» before the
	 *  Oslo afternoon boundary, «Kveldsbriefen» after (ssBriefRitualName, the
	 *  cross-surface twin of iOS BriefRitual). A quiet section header in the same
	 *  grey footnote-semibold as the board's other headers; shown ONLY when the
	 *  hero actually carries a brief (a personal brief or a fresh editorial line),
	 *  never over the generic fallback — parity with iOS, where the brief section
	 *  is hidden then. */
	renderBriefTitle(now = Date.now()) {
		const el = document.getElementById('hero-brief-title');
		if (!el) return;
		const title = this.heroBriefTitle(now);
		if (title) {
			el.textContent = title;
			el.hidden = false;
		} else {
			el.textContent = '';
			el.hidden = true;
		}
	}

	/** The ritual name when the hero shows a real brief, else null. */
	heroBriefTitle(now = Date.now()) {
		return this.heroHasBrief(now) ? ssBriefRitualName(now) : null;
	}

	/** Whether the hero line is a real brief (personal or fresh editorial) rather
	 *  than the calm generic fallback — the same branch heroHeadline() takes. */
	heroHasBrief(now = Date.now()) {
		if (this.hasProfile && typeof this.personalBrief === 'function' && this.personalBrief(now)) return true;
		const editorial = this.featuredIsFresh(now)
			? this.featured?.blocks?.find((b) => b.type === 'headline')?.text
			: null;
		return !!editorial;
	}

	/** WP-182: reveal + wire «Del briefen» when the platform has a share sheet.
	 *  Hidden entirely otherwise (never a dead button). Bound once. */
	bindBriefShare() {
		const wrap = document.getElementById('hero-share-wrap');
		const btn = document.getElementById('hero-share');
		if (!wrap || !btn) return;
		if (typeof navigator === 'undefined' || !navigator.share || typeof this.shareBrief !== 'function') return;
		wrap.hidden = false;
		if (this._briefShareBound) return;
		this._briefShareBound = true;
		btn.addEventListener('click', () => this.shareBrief());
	}

	/** The hero line. WP-174: when the profile has follows, the DETERMINISTIC
	 *  personal brief («I din verden i dag …», composed on-device from your feed)
	 *  leads. It falls back — gracefully, never an empty «I din verden» — to the
	 *  editorial headline when there is nothing personal to say, and the whole
	 *  branch is skipped for an EMPTY profile, so a catalog-wide visitor sees the
	 *  editorial line byte-for-byte as before. `now` injectable so a foreground/
	 *  day-rollover re-render (and the tests) can prove the day-gate at a chosen
	 *  instant. */
	heroHeadline(now = Date.now()) {
		if (this.hasProfile && typeof this.personalBrief === 'function') {
			const brief = this.personalBrief(now);
			if (brief) return brief;
		}
		const headline = this.featuredIsFresh(now)
			? this.featured?.blocks?.find((b) => b.type === 'headline')?.text
			: null;
		return headline || this.heroFallback();
	}

	/** The editorial brief is trustworthy only on the Oslo calendar DAY it was
	 *  generated. Its language is day-relative ("i kveld"/"i morgen"), so a brief
	 *  that outlives its Oslo day is a factual error: a quota-skipped editorial run
	 *  that leaves yesterday's brief up — or a 15:00 evening brief still cached the
	 *  next morning — reads wrong the instant the Oslo day rolls (19.07: yesterday's
	 *  "finalen venter i kveld" stayed up through finale day; WP-136). Show it ONLY
	 *  while `generatedAt` is TODAY in Oslo — a pure calendar-day compare
	 *  (osloDayKey), no "N hours" heuristic, so the brief never survives its own day.
	 *  No/undateable generatedAt ⇒ not fresh (fall back) — we won't stand behind a
	 *  brief we can't date. (Supersedes the WP-111 ~20h window, which still showed an
	 *  evening brief the next morning.) */
	featuredIsFresh(now = Date.now()) {
		const ts = this.featured?.generatedAt;
		if (!ts) return false;
		const gen = new Date(ts);
		if (Number.isNaN(gen.getTime())) return false;
		return this.osloDayKey(gen) === this.osloDayKey(new Date(now));
	}

	/** Calm fallback when the editorial agent hasn't written a headline yet. */
	heroFallback() {
		return 'Sporten du følger — når det skjer, og hvor du ser det.';
	}

	/** Italic-accent the first Norwegian/tracked keyword — one editorial pop in the deck. */
	emphasize(safe) {
		const names = ['Norge', 'Norway', ...trackedTerms(this.interests?.alwaysTrack?.athletes), ...trackedTerms(this.interests?.alwaysTrack?.teams)];
		const lower = safe.toLowerCase();
		let best = -1, bestLen = 0;
		for (const n of names) {
			const i = lower.indexOf(n.toLowerCase());
			if (i >= 0 && (best === -1 || i < best)) { best = i; bestLen = n.length; }
		}
		if (best === -1) return safe;
		return safe.slice(0, best) + '<span class="em">' + safe.slice(best, best + bestLen) + '</span>' + safe.slice(best + bestLen);
	}

	// ── Helpers ─────────────────────────────────────────────────────────────
	osloTime(d) { return d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Oslo' }); }
	osloDayKey(d) { return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' }); }
	// The quiet visual accent. Delegates to the ONE shipped lens (lens.js,
	// loaded before this file) so the web and the golden feed-vectors run the
	// SAME code — see lens.js header. `this.interests` is null (catalog-wide) or
	// the personal profile; `this.lensConfig` is the shared lens-config.json
	// (undefined → baked-in defaults, byte-identical to the old inline logic).
	isMustSee(e) {
		return ssIsMustSee(e, this.interests, this.lensConfig);
	}

	/** WP-200: the board is YOURS. Runs the events through the shipped lens —
	 *  the same `ssIsRelevant` the golden feed-vectors freeze and the iOS agenda
	 *  compiles from — so a profile that follows only Formel 1 gets an agenda of
	 *  only F1, not the catalog's nine sports.
	 *
	 *  `this.interests` is null when there is no profile, and lens.js treats an
	 *  ABSENT `followBroadly` as "no profile speaks" — so an empty profile
	 *  reproduces today's catalog-wide board id-for-id. That equivalence is the
	 *  hard contract; vectors 15/16 pin the narrowing, 01–14 pin the default.
	 *
	 *  NB: only what the user SEES is lensed. `_eventById` deliberately keeps the
	 *  full set so a deep link or a series row can still resolve an event that the
	 *  lens filtered out of the agenda. */
	lensed(events) {
		if (typeof ssIsRelevant !== 'function') return events; // lens.js absent → unfiltered, never blank
		const now = Date.now();
		return events.filter((e) => ssIsRelevant(e, this.interests, now, this.lensConfig));
	}

	/** The time cell: a HH:MM for a single-day event, or a date window
	 *  ("13.–20. juli") that REPLACES the clock for a multi-day event — never
	 *  both, and never duplicated in the title. */
	timeLabel(e) {
		const start = new Date(e.time);
		if (e.endTime) {
			const end = new Date(e.endTime);
			if (this.osloDayKey(end) > this.osloDayKey(start)) {
				// nb-NO already renders the day with a trailing period ("15."), so
				// strip it and add exactly one — never "15.." (works either way).
				const day = (d) => d.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' }).replace(/\.$/, '');
				const mon = (d) => d.toLocaleDateString('nb-NO', { month: 'long', timeZone: 'Europe/Oslo' });
				return mon(start) === mon(end)
					? `${day(start)}.–${day(end)}. ${mon(end)}`
					: `${day(start)}. ${mon(start)}–${day(end)}. ${mon(end)}`;
			}
		}
		return this.osloTime(start);
	}

	/** A head-to-head read off `participants` (exactly two named sides, no home/away
	 *  pair): the escaped "Spania – Argentina" string, else null. The matchup logic
	 *  lives in shared-constants.js (`ssParticipantMatchup`) so detail.js can reuse
	 *  it for the share/report title; here it's escaped for HTML rendering. Fires
	 *  only for two — a golf/CS2 field of four is a tournament, not a matchup. */
	participantMatchup(e) {
		const m = ssParticipantMatchup(e);
		return m ? escapeHtml(m) : null;
	}

	eventTitle(e) {
		if (e.homeTeam && e.awayTeam) {
			return `${escapeHtml(ssShortName(e.homeTeam))} – ${escapeHtml(ssShortName(e.awayTeam))}`;
		}
		const matchup = this.participantMatchup(e);
		if (matchup) return matchup;
		return escapeHtml(e.title);
	}

	/** Golf's real "when" is the individual tee time, not the tournament's Thursday
	 *  start. A golf row's time column shows the four-day WINDOW ("27.–30. aug"),
	 *  which answers *which days* and never *when do I turn it on* — and the tee
	 *  time that does answer it sat only inside the tap-to-expand detail
	 *  (`detail.js addGolfField`). WP-250 lifts exactly ONE of them into the meta
	 *  line. `followed.js golfTeeForEntity` has applied the same rule in "Dine
	 *  neste" since WP-170; this is the agenda's half of it.
	 *
	 *  Honest by construction (DESIGN.md § Grunnlov 3): the hint REQUIRES
	 *  `teeTimeUTC`, because a bare "17:24" carries no day — without the timestamp
	 *  we cannot prove the tee time belongs to today's round, and a stale one on
	 *  the board (visible with no tap) would be a lie. No proof ⇒ no hint, and the
	 *  detail still shows whatever we have. A player with a `status` is out
	 *  (cut/WD, WP-95) and never gets a tee time.
	 *
	 *  Deliberately ONE name, never the whole field: the row must not swell. The
	 *  full list — every Norwegian, their tee time and who they are out with —
	 *  stays one tap away in the detail. Returns escaped HTML, or '' . */
	golfTeeHint(e, now = Date.now()) {
		if (!e || e.sport !== 'golf') return '';
		const todayKey = this.osloDayKey(new Date(now));
		const today = [];
		for (const p of e.norwegianPlayers || []) {
			if (!p || p.status || !p.teeTime || !p.teeTimeUTC) continue;
			const at = Date.parse(p.teeTimeUTC);
			if (!Number.isFinite(at) || this.osloDayKey(new Date(at)) !== todayKey) continue;
			today.push({ name: String(p.name || ''), teeTime: p.teeTime, at });
		}
		if (!today.length) return '';
		today.sort((a, b) => a.at - b.at);
		// The next Norwegian yet to tee off; once they have all started, the LATEST
		// one out (the round still running) — never a time that means nothing now.
		const pick = today.find((t) => t.at >= now) || today[today.length - 1];
		const short = pick.name.trim().split(/\s+/).pop() || pick.name;
		if (!short) return '';
		return `<span class="ev-tee">${escapeHtml(short)} ut ${escapeHtml(pick.teeTime)}</span>`;
	}

	/** The one muted meta line under a title: tournament · round · tee time (golf)
	 *  · where-to-watch (or, when the game is off/over/live, the status/result/
	 *  score instead of a channel). Parts are joined by a quiet middot. */
	eventMeta(e, trailing, tee) {
		const parts = [];
		const hasHomeAway = !!(e.homeTeam && e.awayTeam);
		const participantLed = !hasHomeAway && !!this.participantMatchup(e);
		// When a matchup (home/away OR a 2-participant head-to-head) leads the row, the
		// event's generic title (e.g. "VM-finalen 2026") is no longer the heading — it
		// drops to a quiet context part, but only when nothing else (tournament/round)
		// would otherwise carry it, so we never lose it yet never repeat it.
		const title = (hasHomeAway || participantLed) ? '' : (e.title || '');
		if (participantLed && e.title && !e.tournament && !e.round) parts.push(escapeHtml(e.title));
		// WP-250: when the tee time is on the line, the TOURNAMENT yields — the same
		// trade DESIGN.md § Radens anatomi already makes for a live score ("turneringen
		// viker for roens skyld", WP-172). The row keeps its two facts (når · hvor) and
		// its old height; the tour is one tap away, and the title usually names it
		// anyway ("TOUR Championship"). Without the trade the meta line wrapped onto a
		// third line at 375px — a row that swells to hold a hint is a bad row.
		if (e.tournament && e.tournament !== title && !tee) parts.push(escapeHtml(e.tournament));
		if (e.round) parts.push(`<span class="ev-round">${escapeHtml(e.round)}</span>`);
		// When · then where: the tee time sits directly before the channel.
		if (tee) parts.push(tee);
		if (trailing) parts.push(trailing);
		if (!parts.length) return '';
		return `<span class="ev-meta">${parts.join('<span class="ev-sep"> · </span>')}</span>`;
	}

	/** A channel is tappable when its URL points at the BROADCAST — but a TENTATIVE
	 *  (shared-rights) entry only links to a tvkampen match GUIDE, never to one
	 *  broadcaster (which would mislead when it might be the other).
	 *  WP-246: a `landing` URL (the service's front page / sport section) is not an
	 *  answer to «hvor ser jeg det» — it is the rights map wearing a link's clothes.
	 *  The channel NAME stays (it is true and useful); the link goes. Entries without
	 *  `urlKind` (older payloads) keep the previous behaviour. */
	streamLink(s) {
		if (!s || !s.url || s.urlKind === 'landing') return false;
		return !s.tentative || /tvkampen\.com/.test(s.url);
	}

	/** Where to watch — quiet, honest. First 1–2 Norwegian channels; faint dash if unknown. */
	whereToWatch(e) {
		const streams = Array.isArray(e.streaming) ? e.streaming : [];
		if (streams.length === 0) return `<span class="ev-where unknown">–</span>`;
		const s = streams[0];
		const p = escapeHtml(String(s.platform || s));
		const extra = streams.length > 1 ? `<span class="ev-where-more">+${streams.length - 1}</span>` : '';
		// Plain text — no link — whenever the URL isn't the broadcast: a tentative
		// (shared rights, exact channel not yet confirmed) entry, or a `landing` URL
		// that would drop you on a service front page (WP-246). The name is still the
		// answer to «hvor», so it stays; the absent dotted underline (.ev-where a) is
		// the whole signal that there is nothing to tap. No icon, no badge.
		const inner = this.streamLink(s) ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${p}</a>` : p;
		const cls = s.tentative ? 'ev-where tentative' : 'ev-where';
		return `<span class="${cls}">${inner}${extra}</span>`;
	}

	// ── The agenda: one list, grouped by day ─────────────────────────────────
	/** The pure grouping behind the agenda: the windowed, series-collapsed events
	 *  bucketed into day sections. Testable without a DOM. Also records
	 *  `this._agendaShownIds` (what's visible in the window) so "Neste opp" can
	 *  dedupe, and rebuilds `this._eventById` for tap-to-expand lookups.
	 *  Returns { groups: [{ key, name, isToday, events }], hasMore, empty }. */
	agendaDayGroups() {
		const now = Date.now();
		const start = now - 3 * SS_CONSTANTS.MS_PER_HOUR;
		const maxHorizon = now + 14 * SS_CONSTANTS.MS_PER_DAY;
		// Collapse multi-stage races (e.g. Tour de France) into ONE expandable row
		// so 20+ near-identical "Etappe N" rows don't drown the rest of the week.
		const items = this.collapseSeries(
			this.lensed(this.allEvents).filter((e) => isEventInWindow(e, start, maxHorizon)),
			now
		).sort((a, b) => new Date(a.time) - new Date(b.time));

		// Default to a calm 7-day horizon; a quiet "Vis mer" reveals the full 14.
		const cut = now + (this._fullHorizon ? 14 : 7) * SS_CONSTANTS.MS_PER_DAY;
		const shown = this._fullHorizon ? items : items.filter((e) => isEventInWindow(e, start, cut));
		const hasMore = items.length > shown.length;

		this._eventById = new Map(this.allEvents.map((e) => [e.id, e]));
		for (const it of items) if (it.isSeries) this._eventById.set(it.id, it);
		// The ids currently on the board (post-collapse) — "Neste opp" dedupes against these.
		this._agendaShownIds = new Set(shown.map((e) => e.id));

		if (shown.length === 0) return { groups: [], hasMore: false, empty: true };

		const todayKey = this.osloDayKey(new Date());
		const tomorrowKey = this.osloDayKey(new Date(now + SS_CONSTANTS.MS_PER_DAY));
		const groups = new Map();
		for (const e of shown) {
			// Anything still in the display window whose start day is already past —
			// a still-running OR just-finished multi-day event (kept briefly with its
			// FERDIG status/result), or a late-night event from yesterday still inside
			// the 3h tail — lives under "I dag". A past-day heading must NEVER render
			// above "I dag" (DESIGN § Agendaen, lov 1: "Aldri passerte dager"; WP-128).
			let key = this.osloDayKey(new Date(e.time));
			if (key < todayKey) key = todayKey;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(e);
		}

		const out = [];
		for (const [key, evs] of groups) {
			let name;
			if (key === todayKey) name = 'I dag';
			else if (key === tomorrowKey) name = 'I morgen';
			else name = new Date(evs[0].time).toLocaleDateString('nb-NO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Oslo' });
			out.push({ key, name, isToday: key === todayKey, events: evs });
		}
		return { groups: out, hasMore, empty: false };
	}

	/** The empty board, explained — and, when it is YOUR list that is empty, the
	 *  way out of it (WP-253). Following something you can't see is the deepest
	 *  path in the product, and an empty agenda is the one moment the board itself
	 *  can hand you the search instead of making you go find it. With no profile
	 *  the wording is unchanged: nothing to add to, nothing to say. */
	agendaEmptyHtml() {
		if (!this.hasProfile) return '<p class="empty">Ingen kommende arrangementer akkurat nå.</p>';
		return '<p class="empty">Ingenting kommende for det du følger akkurat nå.<br>'
			+ '<button type="button" class="empty-search">Søk og følg noe mer</button></p>';
	}

	renderAgenda() {
		const el = document.getElementById('agenda');
		if (!el) return;
		const { groups, hasMore, empty } = this.agendaDayGroups();
		if (empty) {
			el.innerHTML = this.agendaEmptyHtml();
			return;
		}
		let html = '';
		for (const g of groups) {
			html += `<section class="day${g.isToday ? ' is-today' : ''}"><div class="day-name">${escapeHtml(g.name)}</div>${g.events.map((e) => this.eventRow(e)).join('')}</section>`;
		}
		if (hasMore) html += `<button type="button" class="agenda-more">Vis resten av de neste to ukene</button>`;
		el.innerHTML = html;
		// Play the entrance reveal ONCE on first load — not on every live-poll
		// re-render (which would re-flash the whole agenda each minute).
		if (!this._revealed) { el.classList.add('reveal'); this._revealed = true; }
		else { el.classList.remove('reveal'); }
	}

	// ── "Fremover": the 14–42-day forward look (WP-124 horizon consistency) ───
	/** The events beyond the agenda's 14-day horizon but within ~42 days — the
	 *  quiet "forvarsler" (season starts, draws, majors booked far out). The
	 *  agenda hard-caps at `now + 14d` (agendaDayGroups' maxHorizon); this owns
	 *  the rest of what events.json carries (~42 d), so the two views PARTITION
	 *  the horizon and mirror the iOS split (Uka caps at 14 d, Nyheter-FREMOVER
	 *  owns beyond — NewsBoard.forwardHorizonDays = 14). fwStart is the SAME
	 *  `now + 14d` boundary the agenda stops at, so the handoff is seamless: an
	 *  event exactly on the boundary lands here (agenda's `time < maxHorizon` is
	 *  strict), never in both, never in neither. isEventInWindow (never a manual
	 *  `time >= x`) so a multi-day event overlapping the window survives. */
	forwardWindow() {
		const now = Date.now();
		const fwStart = now + 14 * SS_CONSTANTS.MS_PER_DAY;
		const fwEnd = now + 42 * SS_CONSTANTS.MS_PER_DAY;
		return this.collapseSeries(
			this.lensed(this.allEvents).filter((e) => isEventInWindow(e, fwStart, fwEnd)),
			now
		).sort((a, b) => new Date(a.time) - new Date(b.time));
	}

	/** A forvarsel's DATE label — never a clock (a major weeks out is answered by
	 *  the day, not the minute; mirrors iOS NewsBoard.forwardDateLabel). A
	 *  multi-day span reads "20.–27. juli". */
	forwardDateLabel(e) {
		const start = new Date(e.time);
		const dayMon = (d) => d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
		if (e.endTime) {
			const end = new Date(e.endTime);
			if (this.osloDayKey(end) > this.osloDayKey(start)) {
				const dayOnly = (d) => d.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' }).replace(/\.$/, '');
				return `${dayOnly(start)}.–${dayMon(end)}`;
			}
		}
		return dayMon(start);
	}

	/** One quiet forward row: date · title · tournament. NO channel — a viewing
	 *  option this far out is unreliable (typically AI-research with wide margin),
	 *  and the row is a heads-up, not a "watch here" (DESIGN calm: honest, minimal). */
	forwardRow(e) {
		const title = this.eventTitle(e);
		const hasMatchup = !!(e.homeTeam && e.awayTeam) || !!this.participantMatchup(e);
		// Show the tournament as the quiet context, unless it already IS the title.
		const tour = e.tournament && (hasMatchup || e.tournament !== e.title)
			? `<span class="fwd-tour">${escapeHtml(e.tournament)}</span>` : '';
		return `<div class="fwd-row"><span class="fwd-date">${escapeHtml(this.forwardDateLabel(e))}</span><span class="fwd-main"><span class="fwd-title">${title}</span>${tour}</span></div>`;
	}

	/** The "Fremover" disclosure — one calm, collapsed section under the agenda.
	 *  Hidden entirely when nothing is booked beyond 14 days (no empty flate). */
	renderFremover() {
		const el = document.getElementById('fremover');
		if (!el) return;
		const items = this.forwardWindow();
		if (!items.length) { el.hidden = true; el.innerHTML = ''; return; }
		el.innerHTML = `<summary><span class="fwd-label">Fremover</span><span class="fwd-count">${items.length}</span></summary>`
			+ `<div class="fwd-body">${items.map((e) => this.forwardRow(e)).join('')}</div>`;
		el.hidden = false;
	}

	/** Is this row currently expanded? Read by eventRow/seriesRow so a re-render
	 *  bakes the open state back into the HTML — the reader's open row survives the
	 *  60s live-poll rebuild (WP-128). */
	isRowOpen(id) { return !!(this._agendaOpen && this._agendaOpen.has(id)); }

	/** Fold same-tournament stage races (cycling "Etappe N", etc.) into one series item. */
	collapseSeries(events, now) {
		const STAGE_RE = /\betappe\b|\bstage\s*\d/i;
		const groups = new Map();
		const out = [];
		for (const e of events) {
			if (STAGE_RE.test(e.title || '')) {
				const key = `${e.sport}||${e.tournament}`;
				(groups.get(key) || groups.set(key, []).get(key)).push(e);
			} else out.push(e);
		}
		for (const stages of groups.values()) {
			if (stages.length < 4) { out.push(...stages); continue; } // too few — keep as normal rows
			stages.sort((a, b) => new Date(a.time) - new Date(b.time));
			const upcoming = stages.find((s) => (s.endTime ? Date.parse(s.endTime) : Date.parse(s.time)) >= now);
			const next = upcoming || stages[stages.length - 1];
			const s0 = stages[0];
			out.push({
				isSeries: true,
				id: `series|${s0.sport}|${s0.tournament}`,
				sport: s0.sport,
				tournament: s0.tournament,
				title: s0.tournament,
				time: next.time,
				endTime: stages[stages.length - 1].endTime || stages[stages.length - 1].time,
				streaming: next.streaming || [],
				stages,
				nextStage: next,
			});
		}
		return out;
	}

	/** A cancelled/postponed match stays on the board, clearly labelled — it must
	 *  never silently vanish (the same failure as a live match dropping off).
	 *  Returns the Norwegian label or null. */
	statusLabel(e) {
		const s = String(e.status || '').toLowerCase();
		if (s === 'cancelled' || s === 'canceled') return 'Avlyst';
		if (s === 'postponed') return 'Utsatt';
		return null;
	}

	/** Is this event over? Returns { score } ("2–1", event-oriented) or { score: null }
	 *  (finished, score unknown), or null (not finished). A finished match stays on
	 *  the board briefly showing its result — never a "watch here" channel. */
	finishedInfo(e) {
		const live = this.liveScores[e.id];
		if (live && live.state === 'post') return { score: `${live.home}–${live.away}` };
		const score = this.finishedScore(e);
		if (score) return { score };
		// Time fallback only where the end is boundable: an explicit endTime, or a
		// football fixture (~2.5h). Never guess "finished" for open-ended entries.
		const start = new Date(e.time).getTime();
		if (!Number.isFinite(start)) return null;
		let end = null;
		if (e.endTime) end = new Date(e.endTime).getTime();
		else if (e.sport === 'football') end = start + 2.5 * SS_CONSTANTS.MS_PER_HOUR;
		if (end != null && Date.now() > end) return { score: null };
		return null;
	}

	/** Event-oriented final score ("2–1") from recent-results, or null. */
	finishedScore(e) {
		if (!e.homeTeam || !e.awayTeam) return null;
		const fb = this.recentResults?.football;
		if (!Array.isArray(fb)) return null;
		const hn = e.homeTeam.toLowerCase(), an = e.awayTeam.toLowerCase();
		const m = fb.find((r) => {
			const rh = (r.homeTeam || '').toLowerCase(), ra = (r.awayTeam || '').toLowerCase();
			return (rh.includes(hn) || hn.includes(rh)) && (ra.includes(an) || an.includes(ra)) && r.homeScore != null;
		});
		return m ? `${m.homeScore}–${m.awayScore}` : null;
	}

	/** The amber must-see dot, left of the time — or an empty cell that holds the
	 *  column so titles stay aligned. The dot is the whole must-see language. */
	dotCell(on) { return on ? '<span class="ev-dot" aria-hidden="true"></span>' : '<span></span>'; }

	/** The ⓘ provenance glyph — dempet, ONLY on AI-research rows; else nothing. */
	infoCell(e) {
		return e.source === 'ai-research'
			? '<span class="ev-info" aria-label="Funnet av AI — trykk for kilder">ⓘ</span>'
			: '';
	}

	/** The per-sport row glyph (app-parity, WP-154). Guarded so a row still renders
	 *  if sport-icons.js is absent (e.g. the vm-sandbox unit tests). */
	sportIconCell(sport) { return typeof ssSportIcon === 'function' ? ssSportIcon(sport) : ''; }

	/** WP-185 — the row's ENTITY lookup, built ONCE per data load: normalised
	 *  name/alias → entity, restricted to entities that actually carry identity
	 *  metadata (country or colours). O(1) per row. The alternative — reusing
	 *  `resolveEntity`'s word-boundary scan — is a linear pass over ~3 700 entities
	 *  PER ROW, i.e. the at-scale trap WP-161 already paid for once. */
	identityIndex() {
		if (this._identityIndex) return this._identityIndex;
		const byName = new Map(), byId = new Map();
		for (const ent of this.entities || []) {
			if (!ent || !ent.id) continue;
			const hasIdentity = (ent.country && (ent.type === 'athlete' || ent.national)) || (ent.colors && ent.colors.primary);
			if (!hasIdentity) continue;
			byId.set(ent.id, ent);
			for (const term of [ent.name, ...(ent.aliases || [])]) {
				const k = ssNormalize(term || '').trim();
				if (k && !byName.has(k)) byName.set(k, ent);
			}
		}
		this._identityIndex = { byName, byId };
		return this._identityIndex;
	}

	/** The ONE entity an agenda row is anchored on (DESIGN § Entitets-avatar: max
	 *  one coloured surface per row). Resolution order — the server's own stamped
	 *  ids first (authoritative), then the team names, then a Norwegian
	 *  participant, then a named participant. The AWAY team is tried too: on a
	 *  board built for a Norwegian fan the away side is often the one they came
	 *  for ("Universitatea Cluj – Brann"). Returns null when nothing resolves; the
	 *  caller then falls back to the sport glyph. */
	rowEntity(e) {
		if (!e) return null;
		const { byName, byId } = this.identityIndex();
		if (!byId.size && !byName.size) return null;
		const look = (name) => (name ? byName.get(ssNormalize(name).trim()) || null : null);
		return (e.homeTeamEntityId && byId.get(e.homeTeamEntityId))
			|| (e.awayTeamEntityId && byId.get(e.awayTeamEntityId))
			|| look(e.homeTeam)
			|| look(e.awayTeam)
			|| ((e.norwegianPlayers || []).map((p) => p && p.entityId && byId.get(p.entityId)).find(Boolean) || null)
			|| ((e.norwegianPlayers || []).map((p) => look(p && (p.name || p))).find(Boolean) || null)
			|| ((e.participants || []).map((p) => look(p && (p.name || p))).find(Boolean) || null);
	}

	/** WP-185 — the row's leading identity cell: the entity's flag/monogram when we
	 *  know it, else the WP-154 sport glyph. Never an empty hole. */
	identityCell(e, sport) {
		if (typeof ssEntityIdentity === 'function' && typeof ssEntityAvatar === 'function') {
			const avatar = ssEntityAvatar(ssEntityIdentity(this.rowEntity(e)));
			if (avatar) return avatar;
		}
		return this.sportIconCell(sport);
	}

	/** A quiet disclosure chevron (app-parity, WP-154) — shown on expandable rows,
	 *  rotated 90° when open. Decorative; the row's role="button"/aria-expanded
	 *  carries the affordance for assistive tech. */
	chevronCell(expandable, open) {
		return expandable
			? `<svg class="ev-chevron${open ? ' open' : ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
			: '';
	}

	/** The trailing cell: the AI ⓘ (if any) then the disclosure chevron (if
	 *  expandable), grouped so the grid keeps one trailing column. */
	trailCell(e, expandable, open) {
		return `<span class="ev-trail">${this.infoCell(e)}${this.chevronCell(expandable, open)}</span>`;
	}

	eventRow(e) {
		if (e.isSeries) return this.seriesRow(e);
		const live = this.liveScores[e.id];
		const status = this.statusLabel(e);
		const done = (!status && !(live && live.state === 'in')) ? this.finishedInfo(e) : null;
		let trailing;
		if (status) trailing = `<span class="ev-status">${escapeHtml(status)}</span>`;
		else if (live && live.state === 'in') trailing = `<span class="ev-where ev-live">${live.home}–${live.away}</span>`;
		else if (done) trailing = `<span class="ev-done">Ferdig${done.score ? `<span class="ev-done-score">${escapeHtml(done.score)}</span>` : ''}</span>`;
		else trailing = this.whereToWatch(e);
		// WP-250 — golf's own "when". Suppressed once the row carries a status or a
		// finished result: a tee time is a promise about a round that is still to
		// come, and an avlyst/ferdig row has none.
		const tee = (!status && !done) ? this.golfTeeHint(e) : '';
		const expandable = this.hasDetail(e);
		const open = expandable && this.isRowOpen(e.id);
		const attrs = expandable
			? ` role="button" tabindex="0" aria-expanded="${open}" data-event-id="${escapeHtml(e.id)}"`
			: '';
		return `<div class="ev-wrap"><div class="ev${this.isMustSee(e) ? ' must' : ''}${status ? ' cancelled' : ''}${done ? ' done' : ''}${expandable ? ' expandable' : ''}"${attrs}>
			${this.dotCell(this.isMustSee(e))}
			<span class="ev-time">${escapeHtml(this.timeLabel(e))}</span>
			${this.identityCell(e, e.sport)}
			<span class="ev-main"><span class="ev-title">${this.eventTitle(e)}</span>${this.eventMeta(e, trailing, tee)}</span>
			${this.trailCell(e, expandable, open)}
		</div><div class="ev-detail"${open ? '' : ' hidden'}>${open ? this.eventDetail(e) : ''}</div></div>`;
	}

	/** A stage race collapsed to one line: next stage + count, tap to expand. */
	seriesRow(s) {
		const date = new Date(s.nextStage.time);
		const m = String(s.nextStage.title || '').match(/(etappe|stage)\s*\d+/i);
		const nextLabel = m ? m[0] : ssShortName(s.nextStage.title || '');
		const meta = `neste: ${escapeHtml(nextLabel)}<span class="ev-sep"> · </span>${s.stages.length} etapper<span class="ev-sep"> · </span>${this.whereToWatch(s.nextStage)}`;
		const open = this.isRowOpen(s.id);
		return `<div class="ev-wrap"><div class="ev expandable series" role="button" tabindex="0" aria-expanded="${open}" data-event-id="${escapeHtml(s.id)}">
			${this.dotCell(false)}
			<span class="ev-time">${escapeHtml(this.osloTime(date))}</span>
			${this.identityCell(s.nextStage, s.nextStage.sport)}
			<span class="ev-main"><span class="ev-title">${escapeHtml(s.tournament)}</span><span class="ev-meta">${meta}</span></span>
			${this.trailCell(s.nextStage, true, open)}
		</div><div class="ev-detail"${open ? '' : ' hidden'}>${open ? this.eventDetail(s) : ''}</div></div>`;
	}

	/** Expanded series: every stage as a quiet line (past ones dimmed). */
	seriesDetail(s) {
		const now = Date.now();
		// Header: the Norwegian squad + the current-stage context. A stage race (TdF)
		// has no standings feed, but the research agent captures the riders and a
		// per-stage note — surface those instead of leaving the detail a bare list.
		let head = '';
		const riders = [];
		const seen = new Set();
		for (const st of s.stages) for (const p of (st.norwegianPlayers || [])) {
			const n = (p && p.name) || p;
			if (n && !seen.has(n)) { seen.add(n); riders.push(n); }
		}
		if (riders.length) head += `<div class="d-row"><span class="d-k">Norske</span><span class="d-v">${escapeHtml(riders.join(', '))}</span></div>`;
		// WP-148: the current-stage note ("Nå") is PROSE — render it FULL-WIDTH like
		// eventDetail's "Om" (.d-prose + aboutParagraphs), not squeezed into the narrow
		// d-v value column. WP-127 broke the ~700-char wall for every summary path
		// EXCEPT this stage-race one; this closes it.
		if (s.nextStage?.summary) {
			const proseParas = this.aboutParagraphs(s.nextStage.summary);
			if (proseParas.length) {
				const body = proseParas.map((p) => `<p class="d-p">${p}</p>`).join('');
				head += `<div class="d-prose"><span class="d-k">Nå</span><div class="d-prose-body">${body}</div></div>`;
			}
		}
		const rows = s.stages.map((st) => {
			const d = new Date(st.time);
			const when = d.toLocaleDateString('nb-NO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });
			const ch = (st.streaming || []).map((x) => x.platform || x)[0];
			const past = (st.endTime ? Date.parse(st.endTime) : Date.parse(st.time)) < now;
			return `<div class="d-row stage${past ? ' past' : ''}"><span class="d-k">${escapeHtml(when)} ${escapeHtml(this.osloTime(d))}</span><span class="d-v">${escapeHtml(ssShortName(st.title))}${ch ? ` · <span class="tbd">${escapeHtml(ch)}</span>` : ''}</span></div>`;
		}).join('');
		return head + rows;
	}

	bindAgendaExpand() {
		const agenda = document.getElementById('agenda');
		if (!agenda) return;
		const toggle = (row) => {
			const id = row.dataset.eventId;
			const e = this._eventById?.get(id);
			const detail = row.parentElement.querySelector('.ev-detail');
			if (!e || !detail) return;
			const open = row.getAttribute('aria-expanded') === 'true';
			if (!open && !detail.innerHTML) detail.innerHTML = this.eventDetail(e);
			row.setAttribute('aria-expanded', String(!open));
			detail.hidden = open;
			// Remember open rows so the 60s live-poll re-render (renderAgenda's
			// innerHTML rebuild) re-opens whatever the reader has expanded — eventRow
			// reads this set and bakes the open state back into the HTML (WP-128).
			this._agendaOpen = this._agendaOpen || new Set();
			if (open) this._agendaOpen.delete(id); else this._agendaOpen.add(id);
		};
		agenda.addEventListener('click', (evt) => {
			const link = evt.target.closest('a');
			if (link) return; // let channel/source links work normally
			const share = evt.target.closest('.ev-share');
			if (share) { this.shareEvent(this._eventById?.get(share.dataset.eventId)); return; }
			const report = evt.target.closest('.ev-report');
			if (report) { this.reportEvent(this._eventById?.get(report.dataset.eventId)); return; }
			const follow = evt.target.closest('.ev-follow');
			if (follow) { this.toggleFollow(follow); return; }
			// The empty board's way into the search (WP-253).
			if (evt.target.closest('.empty-search')) {
				if (typeof this.openFollowSearch === 'function') this.openFollowSearch();
				return;
			}
			if (evt.target.closest('.agenda-more')) { this._fullHorizon = true; this.renderAgenda(); return; }
			const row = evt.target.closest('.ev.expandable');
			if (row) toggle(row);
		});
		agenda.addEventListener('keydown', (evt) => {
			if (evt.key !== 'Enter' && evt.key !== ' ') return;
			const row = evt.target.closest('.ev.expandable');
			if (row) { evt.preventDefault(); toggle(row); }
		});
	}

}

window.Dashboard = Dashboard;
const dashboard = new Dashboard();
window.dashboard = dashboard;
document.addEventListener('DOMContentLoaded', () => {
	// Whole-web-behind-login: the board renders only after Sign in with Apple.
	// index.html defines ssBootGate, which waits for CloudKit JS + auth, then calls
	// dashboard.init(). If no gate is wired (dev / test / stripped build), init now.
	if (typeof window.ssBootGate === 'function') window.ssBootGate(dashboard);
	else dashboard.init();
});
