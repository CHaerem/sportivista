// profile-ui.js — the follow/unfollow affordance that makes the web board
// personal. Extends the Dashboard prototype (loaded AFTER dashboard.js/detail.js).
// A tap on an event row → follow that team/athlete → the board re-renders with
// your accents. Storage + merge live in profile-sync.js; this is only the wiring.
//
// Calm by DESIGN.md: reuses the existing .ev-act button style, one amber accent
// for the followed state, no toast/badge/spinner. Degrades to nothing when
// profile-sync.js isn't present (so nothing breaks in a stripped context).

Object.assign(window.Dashboard.prototype, {
	/** Whether the personal-profile machinery is available in this context. */
	profileAvailable() {
		return typeof ssProfileFollows === 'function' && typeof ssProfileFollow === 'function';
	},

	// ── Entity index (docs/data/entities.json) ───────────────────────────────
	/** The followable named long-tail — teams, athletes, tournaments, leagues.
	 *  Excludes the server-inert `sport`/`category` meta entities (those drive the
	 *  assistant's sport filter, not a personal follow). Empty until loadData runs
	 *  (so the pure helpers degrade gracefully in a stripped/test context). */
	followableEntities() {
		const FOLLOWABLE = new Set(['team', 'league', 'tournament', 'athlete']);
		return (this.entities || []).filter((e) => e && e.type && FOLLOWABLE.has(e.type));
	},

	/** The follow `kind` for an entities.json `type` — the bucket ssProfileToInterests
	 *  files it under. Mirrors the iOS mapping; league counts as a team. */
	entityFollowKind(type) {
		if (type === 'team' || type === 'league') return 'team';
		if (type === 'tournament') return 'tournament';
		return 'athlete'; // athlete + anything unexpected
	},

	/** Resolve a name (+ optional sport) to its REAL entities.json entity via a
	 *  word-boundary term match (name/alias, either direction — never naive substring,
	 *  so "Brooklyn" never resolves to "Lyn"). Sport-scoped when both carry a sport.
	 *  Returns the entity object or null. This is what lets a web follow reuse the
	 *  stable iOS id instead of a synthetic one. */
	resolveEntity(name, sport) {
		const q = (name || '').trim();
		if (!q) return null;
		const sp = sport ? ssNormalize(sport) : null;
		for (const ent of this.followableEntities()) {
			if (sp && ent.sport && ssNormalize(ent.sport) !== sp) continue;
			const terms = [ent.name, ...(ent.aliases || [])].filter(Boolean);
			if (terms.some((t) => ssContainsTerm(q, t) || ssContainsTerm(t, q))) return ent;
		}
		return null;
	},

	/** Substring search over the entity index (name + aliases, normalised), ranked
	 *  exact → prefix → substring, capped. Powers the search-and-follow box. */
	searchEntities(query, limit = 8) {
		const q = ssNormalize((query || '').trim());
		if (q.length < 2) return [];
		const scored = [];
		for (const ent of this.followableEntities()) {
			const names = [ent.name, ...(ent.aliases || [])].filter(Boolean);
			let best = Infinity;
			for (const n of names) {
				const nn = ssNormalize(n);
				const idx = nn.indexOf(q);
				if (idx < 0) continue;
				best = Math.min(best, idx === 0 ? (nn.length === q.length ? 0 : 1) : 2);
			}
			if (best < Infinity) scored.push({ ent, rank: best });
		}
		scored.sort((a, b) => a.rank - b.rank || a.ent.name.localeCompare(b.ent.name, 'nb', { sensitivity: 'accent' }));
		return scored.slice(0, limit).map((x) => x.ent);
	},

	/** The followable entities on an event: each team (with its id) and each
	 *  Norwegian player. Prefers the event's server-stamped entityId; else looks up
	 *  the REAL entities.json id (so a web follow key-matches the iOS WP-05 id across
	 *  devices — no CRDT dupes); only then falls back to a synthesized
	 *  `normalize(name)|sport` id (best-effort, documented divergence). */
	followTargets(e) {
		const out = [];
		const seen = new Set();
		const push = (name, id, kind) => {
			const nm = (name || '').trim();
			if (!nm) return;
			let entityId = id;
			let ekind = kind;
			if (!entityId) {
				const ent = this.resolveEntity(nm, e.sport);
				if (ent) { entityId = ent.id; ekind = this.entityFollowKind(ent.type); }
			}
			if (!entityId) entityId = `${ssNormalize(nm)}|${e.sport || ''}`;
			if (seen.has(entityId)) return;
			seen.add(entityId);
			out.push({ entityId, entityName: nm, sport: e.sport || '', kind: ekind });
		};
		push(e.homeTeam, e.homeTeamEntityId, 'team');
		push(e.awayTeam, e.awayTeamEntityId, 'team');
		for (const p of e.norwegianPlayers || []) push(p.name || p, p.entityId, 'athlete');
		return out;
	},

	/** Every stable entity id this event carries — the exact half of the match
	 *  below (no name guessing when the server already told us who this is). */
	eventEntityIds(e) {
		const out = [];
		const push = (id) => { if (id) out.push(id); };
		push(e.entityId); push(e.homeTeamEntityId); push(e.awayTeamEntityId);
		for (const id of e.entityIds || []) push(id);
		for (const p of e.norwegianPlayers || []) push(p && p.entityId);
		for (const p of e.participants || []) push(p && p.entityId);
		return out;
	},

	/** WP-253 — everything you ALREADY follow that this row is about, including
	 *  the tournament, league or wholesale sport that put it on the board.
	 *
	 *  This is the asymmetry the sheet had: `followTargets` is the ADD side (the
	 *  two teams + the Norwegians — the things it makes sense to offer), and the
	 *  thing you want GONE is usually not one of them. So the REMOVE side reads
	 *  the profile instead of the row: every live rule this event matches earns a
	 *  «Slutt å følge» right here, where you noticed you weren't interested.
	 *
	 *  Matching is the lens's own matcher (ssMatchInterest — word-boundary,
	 *  season-proof terms, sport-scoped) so the sheet offers to remove exactly
	 *  what the lens used to let the row in; plus the event's stamped ids (exact),
	 *  plus a sport equality check for a wholesale `sport-…` rule, whose name
	 *  («Skiskyting») never appears in an event title. Rule-shaped so «Angre» can
	 *  restore the follow as it was, not a fresh default one. */
	unfollowTargets(e) {
		if (!e || !this.profileAvailable() || typeof ssLiveRules !== 'function') return [];
		const hay = typeof ssLensHaystack === 'function'
			? ssLensHaystack(e)
			: `${e.title || ''} ${e.tournament || ''} ${e.homeTeam || ''} ${e.awayTeam || ''}`;
		const ids = new Set(this.eventEntityIds(e));
		const out = [];
		for (const r of ssLiveRules(ssProfileLoad())) {
			const kind = typeof ssRuleKind === 'function' ? ssRuleKind(r) : (r.kind || 'athlete');
			const wholesale = kind === 'sport';
			let hit = ids.has(r.entityId);
			if (!hit && wholesale) hit = !!(r.sport && e.sport && ssNormalize(r.sport) === ssNormalize(e.sport));
			if (!hit && typeof ssMatchInterest === 'function') {
				hit = !!ssMatchInterest(hay, [{ name: r.entityName, aliases: [], sport: r.sport || null }], { sport: e.sport });
			}
			if (!hit) continue;
			out.push({
				entityId: r.entityId, entityName: r.entityName || r.entityId,
				sport: r.sport || '', kind, wholesale,
				scope: r.scope, weight: r.weight, reason: r.reason,
			});
		}
		return out;
	},

	/** One flat action button in the detail sheet's action row. `on` = you follow
	 *  this, so the button says the ACTION («Slutt å følge X»), never the state
	 *  («Følger X») — a state label is not an affordance, and removing was the
	 *  half of the pair nobody could find. A wholesale sport follow says what it
	 *  costs in the label itself; that honesty replaces a confirmation dialog.
	 *
	 *  NO `aria-pressed`. The label is a VERB, and a toggle-state on a verb tells
	 *  a screen-reader user the opposite of the truth: «Slutt å følge Brann,
	 *  veksleknapp, PÅ» announces the state as *pressed* while the button's own
	 *  words promise the removal. Action label ⇒ plain button — the same choice
	 *  the iOS sheet made (a `Button` with the verb, no toggle semantics). The
	 *  state-labelled twin lives in the search list (`followSearchRow`: «Følg» /
	 *  «Følger»), and THAT one keeps `aria-pressed`, where it is true. */
	followActionButton(t, on) {
		const name = escapeHtml(t.entityName);
		const label = on
			? `Slutt å følge ${name}${t.wholesale ? ' (hele sporten)' : ''}`
			: `Følg ${name}`;
		return `<button type="button" class="ev-act ev-follow${on ? ' is-following' : ''}"`
			+ ` data-entity-id="${escapeHtml(t.entityId)}" data-entity-name="${name}"`
			+ ` data-entity-sport="${escapeHtml(t.sport || '')}" data-kind="${escapeHtml(t.kind || '')}"`
			+ ` data-follow-state="${on ? 'on' : 'off'}">${label}</button>`;
	},

	/** The profile's own rule order — sport, then name. `ssLiveRules` sorts by
	 *  exactly this, so a subject that came from the profile keeps the SAME slot
	 *  whether it is followed right now or standing there as its own way back. */
	compareSubjects(a, b) {
		const sa = a.sport || '';
		const sb = b.sport || '';
		if (sa !== sb) return sa < sb ? -1 : 1;
		return String(a.entityName || '').localeCompare(String(b.entityName || ''), undefined, { sensitivity: 'accent' });
	},

	/** WP-253 — the sheet's action row as ONE ordered list of SUBJECTS, each with
	 *  the direction that applies to it right now (`on`). One list, not an add
	 *  list concatenated with a remove list.
	 *
	 *  Why it matters: two lists meant a button MOVED the instant you used it.
	 *  «Følg Brann» sat first, you tapped it, and it reappeared last as «Slutt å
	 *  følge Brann» while everything else slid up a place — so the next thing you
	 *  meant to tap was no longer under your finger. In a package about making
	 *  removal easy, the act of removing rearranged the controls.
	 *
	 *  The order here is a property of the EVENT and the profile, never of what
	 *  you follow: the subjects the row is about, in the order they appear in it
	 *  (home, away, the Norwegians), then whatever else in your profile put the
	 *  row on the board (tournament, league, wholesale sport) in the profile's own
	 *  (sport, name) order. Toggling changes a LABEL, never a position — the same
	 *  promise the iOS sheet makes («raden BLIR STÅENDE og vipper til motsatt
	 *  handling», DESIGN.md § Event-detalj).
	 *
	 *  A subject that lives only in the profile — the tournament, the sport —
	 *  would otherwise VANISH the moment you stopped following it, which is worse
	 *  than moving: the way back disappears with it. So the sheet remembers what
	 *  it has shown for as long as it stays open (the web twin of the iOS sheet's
	 *  `followOverride`) and keeps it standing, flipped to «Følg X». */
	followRowSubjects(e) {
		if (!this.profileAvailable()) return [];
		const removes = this.unfollowTargets(e);
		const byId = new Map();
		const byName = new Map();
		for (const r of removes) {
			if (!byId.has(r.entityId)) byId.set(r.entityId, r);
			const n = ssNormalize(r.entityName);
			if (!byName.has(n)) byName.set(n, r);
		}
		// The subjects the ROW is about, in the row's own order. A rule stored
		// under another id for the same subject (an iOS-created follow, an older
		// synthesized id) is matched by NAME too, so a followed team never earns
		// «Følg X» beside its own «Slutt å følge X».
		const rows = [];
		const claimed = new Set();
		for (const t of this.followTargets(e)) {
			const rule = byId.get(t.entityId) || byName.get(ssNormalize(t.entityName));
			if (!rule) { rows.push(Object.assign({}, t, { wholesale: false, on: false })); continue; }
			if (claimed.has(rule.entityId)) continue;
			claimed.add(rule.entityId);
			rows.push(Object.assign({}, rule, { on: true }));
		}
		const claimedNames = new Set(rows.map((r) => ssNormalize(r.entityName)));
		// What ELSE in your profile put this row here, plus anything the sheet has
		// already shown and is holding open as its own undo.
		const rest = [];
		const push = (t, on) => {
			if (claimed.has(t.entityId) || claimedNames.has(ssNormalize(t.entityName))) return;
			claimed.add(t.entityId);
			claimedNames.add(ssNormalize(t.entityName));
			rest.push(Object.assign({}, t, { on }));
		};
		for (const r of removes) push(r, true);
		for (const prev of this.shownSubjects(e)) push(prev, false);
		rest.sort((a, b) => this.compareSubjects(a, b));
		const out = rows.concat(rest);
		this.rememberShownSubjects(e, out);
		return out;
	},

	/** What this event's sheet has shown since it was opened. Empty for a sheet
	 *  that has never rendered, and cleared when the row collapses — a removed
	 *  tournament stands by for as long as you are looking at it, not forever. */
	shownSubjects(e) {
		const key = e && e.id;
		if (!key || !this._sheetSubjects) return [];
		return this._sheetSubjects.get(key) || [];
	},

	rememberShownSubjects(e, subjects) {
		const key = e && e.id;
		if (!key) return;
		this._sheetSubjects = this._sheetSubjects || new Map();
		this._sheetSubjects.set(key, subjects.map((t) => Object.assign({}, t)));
	},

	/** The row closed — forget what its sheet was holding open. */
	forgetShownSubjects(id) {
		if (this._sheetSubjects) this._sheetSubjects.delete(id);
	},

	/** The symmetric follow/unfollow row for the detail sheet: «Følg X» for what
	 *  this row offers to add, «Slutt å følge Y» for everything you already follow
	 *  that put it here. Where you can do a thing, you can undo it — in the same
	 *  place, in the same tap, and (see `followRowSubjects`) at the same spot in
	 *  the row. Empty string when the profile machinery is absent. */
	followButtonsHtml(e) {
		if (!this.profileAvailable()) return '';
		return this.followRowSubjects(e).map((t) => this.followActionButton(t, t.on)).join('');
	},

	/** Push the local profile change to iCloud right away (fire-and-forget) so the
	 *  phone picks it up on its next sync — no waiting for a later web sync round.
	 *  No-op when iCloud isn't wired (dev/test) or the user isn't signed in. */
	pushProfileToICloud() {
		if (window.ssICloud && typeof ssICloud.enabled === 'function' && ssICloud.enabled()) {
			try { Promise.resolve(ssICloud.sync()).catch(() => {}); } catch { /* ignore */ }
		}
	},

	/** Commit a follow: persist the rule, re-personalise the board locally (no
	 *  network refetch), and push to iCloud. The ONE write path shared by the detail
	 *  sheet, the search-and-follow box, and the assistant. Returns true on success. */
	commitFollow(entity) {
		if (!this.profileAvailable()) return false;
		// A button that flips back to «Følg» IS an undo, so it undoes as well as
		// the undo line does: when the standing offer still holds this rule, its
		// weight/scope/reason come back with it instead of a fresh, flattened
		// default. The caller's own values still win where it passed any.
		const pending = (this._undoFollows || []).find((r) => r.entityId === entity.entityId);
		const rule = Object.assign({}, pending || {}, entity);
		// scope/weight/reason are passed THROUGH when present (undefined ⇒ the same
		// defaults ssProfileFollow always applied), so «Angre» restores the rule it
		// removed rather than a fresh, flattened one.
		ssProfileFollow({
			entityId: rule.entityId, entityName: rule.entityName, sport: rule.sport, kind: rule.kind,
			scope: rule.scope, weight: rule.weight, reason: rule.reason,
		});
		this.applyProfile(ssProfileLoad());
		this.render();
		this.pushProfileToICloud();
		// …and the line stops offering to undo something you already put back.
		if (pending) this.dropPendingUndo(entity.entityId);
		return true;
	},

	/** Commit an unfollow (tombstone the rule), then re-personalise + push — and
	 *  leave the removal standing as one quiet «Angre» (see below). No dialog:
	 *  the rule is captured BEFORE the tombstone, so the way back is one tap. */
	commitUnfollow(entityId) {
		if (!this.profileAvailable()) return false;
		const rule = this.liveRuleFor(entityId);
		ssProfileUnfollow(entityId);
		this.applyProfile(ssProfileLoad());
		this.render();
		this.pushProfileToICloud();
		if (rule) this.rememberUnfollow(rule);
		return true;
	},

	// ── Angre, ikke bekreft (WP-253) ─────────────────────────────────────────
	// Å slutte å følge er trivielt reverserbart — du kan bare følge igjen — så vi
	// spør ALDRI først. En «Slutt å følge X?»-modal beskytter mot nesten ingenting
	// og koster et trykk hver gang du luker. Fjerningen skjer med én gang, og blir
	// liggende som ETT rolig tilbud om å angre.
	//
	// Angre-linja er sidenivå og ikke en del av raden, med vilje: en fjerning kan
	// ta bort nettopp den raden du sto i (linsen filtrerer tavla), og da ville et
	// angre-tilbud inne i arket forsvinne sammen med den — akkurat når du trenger
	// det. Den ligger over tavla som assistent-knappen, ikke i innholdet.
	//
	// Ingen bekreftelse noe sted: den eneste fjerningen som er stor nok til å
	// fortjene en (en hel sport) sier hva den koster i selve knappe-etiketten
	// («… (hele sporten)»), og angres på samme måte som alt annet.

	/** How long the undo offer stands (ms). */
	UNDO_MS: 12000,

	/** The live profile rule for an entity, in the shape commitFollow takes back —
	 *  captured before a tombstone so an undo restores weight/scope/reason too. */
	liveRuleFor(entityId) {
		if (typeof ssLiveRules !== 'function') return null;
		const r = ssLiveRules(ssProfileLoad()).find((x) => x.entityId === entityId);
		if (!r) return null;
		return {
			entityId: r.entityId, entityName: r.entityName || r.entityId, sport: r.sport || '',
			kind: typeof ssRuleKind === 'function' ? ssRuleKind(r) : r.kind,
			scope: r.scope, weight: r.weight, reason: r.reason,
		};
	},

	/** Stack a just-removed rule onto the pending undo and (re)show the line.
	 *  Removals made while the line stands accumulate, so luking three rows in a
	 *  row is still ONE «Angre» — the tidy-up you regret is undone in one tap. */
	rememberUnfollow(rule) {
		this._undoFollows = (this._undoFollows || []).filter((r) => r.entityId !== rule.entityId);
		this._undoFollows.push(rule);
		this.renderUndoBar();
	},

	/** Names up to two; beyond that it counts, honestly. */
	undoNameList() {
		const names = (this._undoFollows || []).map((r) => r.entityName);
		if (!names.length) return '';
		if (names.length === 1) return `${names[0]}`;
		if (names.length === 2) return `${names[0]} og ${names[1]}`;
		return `${names[0]}, ${names[1]} og ${names.length - 2} til`;
	},

	/** The undo line's text. */
	undoText() {
		const names = this.undoNameList();
		return names ? `Sluttet å følge ${names}.` : '';
	},

	/** Take one entity off the standing offer — it has been put back by hand (the
	 *  button flipped to «Følg» again), so the line must stop claiming it is gone.
	 *  The offer lapses entirely when nothing is left to undo. */
	dropPendingUndo(entityId) {
		const rest = (this._undoFollows || []).filter((r) => r.entityId !== entityId);
		if (!rest.length) { this.dismissUndo(); return; }
		this._undoFollows = rest;
		this.renderUndoBar();
	},

	/** Put back everything the standing undo line covers — one re-render, one
	 *  iCloud push, whatever the number of removals. */
	undoUnfollow() {
		const pending = this._undoFollows || [];
		this.dismissUndo();
		if (!pending.length || !this.profileAvailable()) return false;
		for (const r of pending) {
			ssProfileFollow({
				entityId: r.entityId, entityName: r.entityName, sport: r.sport, kind: r.kind,
				scope: r.scope, weight: r.weight, reason: r.reason,
			});
		}
		this.applyProfile(ssProfileLoad());
		this.render();
		this.pushProfileToICloud();
		return true;
	},

	/** Let the offer lapse (timeout, or it was just taken). */
	dismissUndo() {
		this._undoFollows = [];
		if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
		const el = this._undoBar;
		if (el) { el.innerHTML = ''; el.hidden = true; }
	},

	/** The undo line's element, created once and parked on <body> (it must outlive
	 *  the agenda re-render that the removal triggers). Returns null in a DOM-less
	 *  or stripped context — the undo state above still works, it just has no line. */
	undoBarEl() {
		if (this._undoBar) return this._undoBar;
		if (this._undoBarUnavailable) return null;
		const doc = typeof document !== 'undefined' ? document : null;
		if (!doc || typeof doc.createElement !== 'function' || !doc.body || typeof doc.body.appendChild !== 'function') {
			this._undoBarUnavailable = true;
			return null;
		}
		const el = doc.createElement('div');
		el.id = 'undo-bar';
		el.className = 'undo-bar';
		el.hidden = true;
		if (typeof el.setAttribute === 'function') {
			el.setAttribute('role', 'status');
			el.setAttribute('aria-live', 'polite');
		}
		if (typeof el.addEventListener === 'function') {
			el.addEventListener('click', (evt) => {
				const t = evt && evt.target;
				if (t && typeof t.closest === 'function' && t.closest('.undo-act')) this.undoUnfollow();
			});
		}
		doc.body.appendChild(el);
		// A node we can't find again isn't in a real document (test/stripped DOM):
		// stand down entirely rather than arm a timer nothing will ever show.
		if (typeof doc.getElementById === 'function' && doc.getElementById('undo-bar') !== el) {
			this._undoBarUnavailable = true;
			return null;
		}
		this._undoBar = el;
		return el;
	},

	renderUndoBar() {
		const el = this.undoBarEl();
		if (!el) return;
		const text = this.undoText();
		if (!text) { el.innerHTML = ''; el.hidden = true; return; }
		el.innerHTML = `<span class="undo-text">${escapeHtml(text)}</span>`
			+ '<button type="button" class="undo-act">Angre</button>';
		el.hidden = false;
		if (this._undoTimer) clearTimeout(this._undoTimer);
		this._undoTimer = setTimeout(() => this.dismissUndo(), this.UNDO_MS);
	},

	/** Take the reader to the one place they can follow something that ISN'T on
	 *  the board: the search field inside «Dette dekker vi». Opens the disclosure,
	 *  scrolls to it and puts the caret in the field — the same move `.nu-more`
	 *  makes, so there is ONE way in, reachable from more than one place. */
	openFollowSearch() {
		if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
		const wrap = document.getElementById('followed');
		if (wrap) {
			wrap.open = true;
			if (typeof wrap.scrollIntoView === 'function') wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
		const input = document.getElementById('follow-search-input');
		if (input && typeof input.focus === 'function') input.focus();
	},

	/** Toggle a follow from a button's data-* attrs (the detail-sheet buttons and
	 *  the search results). */
	toggleFollow(btn) {
		if (!this.profileAvailable()) return;
		const d = btn.dataset;
		if (d.followState === 'on') this.commitUnfollow(d.entityId);
		else this.commitFollow({ entityId: d.entityId, entityName: d.entityName, sport: d.entitySport, kind: d.kind });
	},

	/** Execute an assistant follow/unfollow intent ("følg Liverpool"). Resolves the
	 *  subject against entities.json and commits it — never invents an entity, never
	 *  claims a follow it can't ground. Returns { ok, text } for a calm confirmation
	 *  line (the DOM wiring in bindAssistant renders it). */
	handleFollowIntent(subject, unfollow) {
		const q = (subject || '').trim();
		if (!q) return { ok: false, text: 'Hvem vil du følge? Prøv «følg Hovland».' };
		if (!this.profileAvailable()) return { ok: false, text: 'Følging er ikke tilgjengelig akkurat nå.' };
		const ent = this.resolveEntity(q);
		if (!ent) return { ok: false, text: `Fant ikke «${q}». Søk i «Dette dekker vi» for å følge.` };
		const isOn = ssProfileFollows(ent.id);
		if (unfollow) {
			if (!isOn) return { ok: false, text: `Du følger ikke ${ent.name}.` };
			this.commitUnfollow(ent.id);
			// `undo: true` is what makes the offer VISIBLE here — see
			// `assistantMutationHtml`. The page-level line is armed as well, so
			// closing the sheet within the window still finds it.
			return { ok: true, text: `Sluttet å følge ${ent.name}.`, undo: true };
		}
		if (isOn) return { ok: true, text: `Du følger allerede ${ent.name}.` };
		this.commitFollow({ entityId: ent.id, entityName: ent.name, sport: ent.sport || '', kind: this.entityFollowKind(ent.type) });
		return { ok: true, text: `Følger ${ent.name} nå.` };
	},

	/** The assistant's answer to a follow/unfollow — with «Angre» offered RIGHT
	 *  HERE when the answer was a removal.
	 *
	 *  A removal typed into the assistant («slutt å følge Brann») arms the same
	 *  undo line every other removal does, but the assistant sheet lies OVER it
	 *  (z-index 70 vs 65): the offer stood behind the surface the user was
	 *  looking at and expired unseen. An armed undo nobody can see is worse than
	 *  no undo — it promises a way back and then quietly withdraws it. So the
	 *  answer carries the tap itself, into the SAME pending undo (one offer, one
	 *  timer, either door) — the iOS rule that the undo belongs where the user
	 *  ends up, not on the surface that happened to raise it. */
	assistantMutationHtml(res) {
		const line = escapeHtml(res.text);
		if (!res.undo) return `<p class="assistant-answer">${line}</p>`;
		return `<p class="assistant-answer">${line} · <button type="button" class="assistant-undo">Angre</button></p>`;
	},

	/** The line after the undo was taken: what you follow again, said plainly.
	 *  One «Angre» covers every removal still standing, so the sentence names
	 *  them the same way the undo line did. */
	undoneText(names) {
		if (!names) return 'Følget er tilbake.';
		return `Følger ${names} igjen.`;
	},

	/** Wire the deterministic assistant: a floating bottom-trailing button opens a
	 *  conversation sheet (mirrors the iOS AssistantButton + AssistantSheetView).
	 *  Type a question → grounded answer + matching event rows; no spinner, no model. */
	bindAssistant() {
		const fab = document.getElementById('assistant-fab');
		const sheet = document.getElementById('assistant-sheet');
		const input = document.getElementById('assistant-input');
		const results = document.getElementById('assistant-results');
		const examples = document.getElementById('assistant-examples');
		if (!fab || !sheet || !input || !results || typeof ssAssistant !== 'function') return;

		const run = () => {
			const q = input.value.trim();
			if (!q) { results.hidden = true; results.innerHTML = ''; if (examples) examples.hidden = false; return; }
			const r = ssAssistant(q, { events: this.allEvents || [], interests: this.interests, config: this.lensConfig, vocab: this.assistantVocab, nowMs: Date.now() });
			// A follow/unfollow intent is EXECUTED here (WP-163) — the assistant used to
			// return kind:'mutation' that nothing consumed. Resolve + commit the follow,
			// then show a calm confirmation instead of the dead "trykk raden" hint.
			if (r.kind === 'mutation') {
				const res = this.handleFollowIntent(r.subject, r.unfollow);
				results.innerHTML = this.assistantMutationHtml(res);
				results.hidden = false;
				if (examples) examples.hidden = true;
				return;
			}
			const rows = (r.eventIds || [])
				.map((id) => (this._eventById && this._eventById.get(id)) || (this.allEvents || []).find((e) => e.id === id))
				.filter(Boolean);
			const body = rows.length ? rows.map((e) => this.eventRow(e)).join('') : '';
			results.innerHTML = `<p class="assistant-answer">${escapeHtml(r.text)}</p>${body}`;
			results.hidden = false;
			if (examples) examples.hidden = true; // the thread replaces the examples (iOS parity)
		};

		// «Angre» inside the answer — the undo for a removal made HERE, where the
		// sheet would otherwise hide the page-level line (see assistantMutationHtml).
		results.addEventListener('click', (evt) => {
			const t = evt && evt.target;
			if (!t || typeof t.closest !== 'function' || !t.closest('.assistant-undo')) return;
			const names = this.undoNameList();
			if (!this.undoUnfollow()) return;
			results.innerHTML = `<p class="assistant-answer">${escapeHtml(this.undoneText(names))}</p>`;
		});

		// Sheet open/close. Focus the field on open so the keyboard/dictation is ready.
		const open = () => {
			sheet.hidden = false;
			// Defer focus a frame so the rise animation doesn't fight the caret.
			requestAnimationFrame(() => input.focus());
		};
		const close = () => { sheet.hidden = true; input.blur(); };
		fab.addEventListener('click', open);
		sheet.querySelectorAll('[data-assistant-close]').forEach((el) => el.addEventListener('click', close));
		document.addEventListener('keydown', (evt) => { if (evt.key === 'Escape' && !sheet.hidden) close(); });

		// Example rows fill the field and run — the sheet's calm guiding (iOS parity).
		if (examples) examples.querySelectorAll('.ex-row').forEach((el) => el.addEventListener('click', () => {
			input.value = el.dataset.ex || el.textContent || '';
			run();
		}));

		input.addEventListener('keydown', (evt) => { if (evt.key === 'Enter') { evt.preventDefault(); run(); } });
		// Clearing the field brings the examples back.
		input.addEventListener('input', () => { if (!input.value.trim()) { results.hidden = true; results.innerHTML = ''; if (examples) examples.hidden = false; } });

		// Collapse the FAB to the bare glyph while the board scrolls (iOS WP-146
		// idiom); expanded at the top / at rest. A small dead-zone keeps a resting
		// board expanded. Reduce Motion: the CSS transition is disabled there anyway.
		const onScroll = () => { fab.classList.toggle('collapsed', window.scrollY > 40); };
		window.addEventListener('scroll', onScroll, { passive: true });
		onScroll();
	},

	/** Recompute interests/covers from a profile state (mirrors loadData's branch).
	 *  WP-163: the catalog stays the base `covers` layer; `followed` is your personal
	 *  list, shown ABOVE the catalog — following never collapses the catalog away. */
	applyProfile(profile) {
		this.profile = profile;
		this.hasProfile = !!(profile && typeof ssStateIsEmpty === 'function' && !ssStateIsEmpty(profile));
		this.covers = this.catalog && this.catalog.tier2 ? { alwaysTrack: this.catalog.tier2 } : null;
		if (this.hasProfile) {
			this.interests = ssProfileToInterests(profile);
			this.followed = { alwaysTrack: this.interests.alwaysTrack };
		} else {
			this.interests = null;
			this.followed = null;
		}
	},

	// ── Coverage-request demand signal (WP-165) ──────────────────────────────
	/** Build the PRE-FILLED, public GitHub issue URL for a coverage request. A miss
	 *  in search (something outside the catalog/register) offers ONE calm optional tap
	 *  that opens this — the user reviews and sends it themselves (no auto-post,
	 *  privacy-honest). The issue carries ONLY the entity name + optional sport (never
	 *  a profile/device), and its `### Entitet` / `### Sport` body + `coverage-request`
	 *  label are what scripts/lib/demand.js aggregates into coverage-gaps.json.demand[].
	 *  The body shape mirrors the iOS builder (CoverageRequest.swift) and the issue
	 *  form (coverage-request.yml) so all three parse identically. */
	coverageRequestUrl(name, sport) {
		const nm = (name || '').trim();
		const sp = (sport || '').trim() || '(ikke satt)';
		const body = [
			'Offentlig, anonymt ønske om dekning fra Sportivista — kun navn + sport, ingen profil- eller enhetsdata.',
			`### Entitet\n\n${nm}`,
			`### Sport\n\n${sp}`,
		].join('\n\n');
		const p = new URLSearchParams({
			labels: 'coverage-request',
			title: `[dekning] ${nm}`,
			body,
		});
		return `https://github.com/${SS_REPO}/issues/new?${p.toString()}`;
	},

	// ── Search-and-follow (WP-163) ───────────────────────────────────────────
	/** Wire the search box inside the "Dette dekker vi" disclosure: type a name →
	 *  matching entities from entities.json → tap to follow directly (ssProfileFollow)
	 *  with a calm inline confirmation. This is the vanilla-user path to follow
	 *  something that isn't on the board (the detail-sheet buttons only cover rows).
	 *  Calm by DESIGN.md: hairline rows, one amber accent, no toast/spinner. */
	bindFollowSearch() {
		const input = document.getElementById('follow-search-input');
		const results = document.getElementById('follow-search-results');
		if (!input || !results || !this.profileAvailable()) return;

		const render = () => {
			const q = input.value.trim();
			if (q.length < 2) { results.hidden = true; results.innerHTML = ''; return; }
			const hits = this.searchEntities(q);
			if (!hits.length) {
				// WP-165: a miss is not a dead end — offer to signal the demand. One calm
				// optional tap opens a pre-filled, public coverage-request issue (name +
				// sport only); the user sends it themselves. The server folds open requests
				// into coverage-gaps.json.demand[] and research widens the catalog from there.
				const url = this.coverageRequestUrl(q);
				results.innerHTML = `<p class="fs-empty">Ingen treff på «${escapeHtml(q)}».`
					+ ` <a class="fs-request" href="${escapeHtml(url)}" target="_blank" rel="noopener">Meld inn ønsket →</a></p>`
					+ `<p class="fs-request-note">Sender et offentlig, anonymt ønske (kun navn + sport). Du ser og sender det selv.</p>`;
				results.hidden = false;
				return;
			}
			results.innerHTML = hits.map((ent) => this.followSearchRow(ent)).join('');
			results.hidden = false;
		};

		input.addEventListener('input', render);
		results.addEventListener('click', (evt) => {
			const row = evt.target.closest('.fs-result');
			if (!row) return;
			const d = row.dataset;
			const on = ssProfileFollows(d.entityId);
			if (on) this.commitUnfollow(d.entityId);
			else this.commitFollow({ entityId: d.entityId, entityName: d.entityName, sport: d.entitySport, kind: d.kind });
			render(); // reflect the new follow state on the row (Følg ⇄ Følger)
		});
	},

	/** One search result row: name · sport · a Følg/Følger toggle. */
	followSearchRow(ent) {
		const on = ssProfileFollows(ent.id);
		const kind = this.entityFollowKind(ent.type);
		const sport = ent.sport ? `<span class="fs-sport">${escapeHtml((typeof ssLensConfig === 'function' && ssLensConfig(this.lensConfig).sportNb[ent.sport]) || ent.sport)}</span>` : '';
		return `<button type="button" class="fs-result${on ? ' is-following' : ''}"`
			+ ` data-entity-id="${escapeHtml(ent.id)}" data-entity-name="${escapeHtml(ent.name)}"`
			+ ` data-entity-sport="${escapeHtml(ent.sport || '')}" data-kind="${escapeHtml(kind)}"`
			+ ` aria-pressed="${on}"><span class="fs-name">${escapeHtml(ent.name)}</span>${sport}`
			+ `<span class="fs-follow">${on ? 'Følger' : 'Følg'}</span></button>`;
	},
});
