// icloud-sync.js — two-way profile sync with the iOS app via CloudKit JS.
//
// The browser CANNOT read the app's per-record encryptedValues (E2E), so the app
// also publishes a plaintext ProfileSnapshot per device (see CloudKitProfileSync
// .writeSnapshot). This module signs the user in with their own Apple ID, reads
// every device's ProfileSnapshot from THEIR OWN private database, merges them
// into this browser's local profile (the same CRDT as the app), and writes back
// this browser's own snapshot — genuine two-way sync, zero Sportivista server.
//
// Depends on: cloudkit.js (Apple CDN, loaded before this file), profile-sync.js
// (merge + codec + store), icloud-config.js (the public token). All CloudKit
// network calls are integration-only (verified on-device with a real account +
// the Dashboard schema); the pure record<->state mapping is unit-tested.
//
// Calm by DESIGN.md: one amber accent, a quiet status line, NO spinner. When the
// token is unset or the user isn't signed in, the board just keeps working on the
// local/QR profile — sync is strictly additive.

window.ssICloud = (function () {
	const cfg = (typeof window !== 'undefined' && window.SPORTIVISTA_ICLOUD) || {};
	const RECORD_TYPE = 'ProfileSnapshot';

	function enabled() {
		return !!(cfg.apiToken && typeof CloudKit !== 'undefined');
	}

	// --- pure mapping (unit-tested) ------------------------------------------

	/** A CloudKit record → its payload string (or null). Tolerant of the two
	 *  shapes CloudKit JS returns a String field in. */
	function recordPayload(record) {
		const f = record && record.fields && record.fields.payload;
		if (!f) return null;
		return typeof f === 'string' ? f : (f.value != null ? String(f.value) : null);
	}

	/** This browser's snapshot recordName — its stable device id (profile-sync). */
	function webRecordName() {
		return typeof ssDeviceId === 'function' ? ssDeviceId() : 'web-unknown';
	}

	/** The CloudKit record dict to save this browser's snapshot. `changeTag` is
	 *  required by CloudKit JS to OVERWRITE an existing record (omit on create). */
	function snapshotRecord(payload, changeTag) {
		const rec = {
			recordType: RECORD_TYPE,
			recordName: webRecordName(),
			zoneID: { zoneName: cfg.zoneName || 'SportivistaProfile' },
			fields: { payload: { value: payload } },
		};
		if (changeTag) rec.recordChangeTag = changeTag;
		return rec;
	}

	/** Decode every snapshot record → states, and fold them (+ local) into one
	 *  merged state via the shared CRDT. Async: decode is deflate-raw. */
	async function mergeSnapshots(records, localState) {
		let merged = localState;
		for (const rec of records || []) {
			const payload = recordPayload(rec);
			if (!payload) continue;
			try {
				const incoming = await ssProfileDecode(payload);
				merged = ssProfileMerge(merged, incoming).merged;
			} catch { /* skip a malformed snapshot */ }
		}
		return merged;
	}

	// --- CloudKit plumbing (integration-only) --------------------------------

	let container = null, database = null;

	function configure() {
		if (!enabled()) return false;
		CloudKit.configure({
			containers: [{
				containerIdentifier: cfg.containerIdentifier,
				apiTokenAuth: { apiToken: cfg.apiToken, persist: true },
				environment: cfg.environment || 'production',
			}],
		});
		container = CloudKit.getDefaultContainer();
		database = container.privateCloudDatabase;
		return true;
	}

	/** One sync round: pull all snapshots → merge into local → save own snapshot.
	 *  Returns {added, removed} or null on any failure (offline-first, never throws).
	 *  Re-entrant-safe: concurrent callers share the in-flight round, so a double
	 *  trigger (setUpAuth + whenUserSignsIn both firing) can't race two writes into
	 *  a 409 Conflict. */
	let syncInFlight = null;
	function sync() {
		if (syncInFlight) return syncInFlight;
		syncInFlight = syncOnce().finally(() => { syncInFlight = null; });
		return syncInFlight;
	}
	async function syncOnce() {
		if (!database) return null;
		try {
			const zoneName = cfg.zoneName || 'SportivistaProfile';
			// Ensure the custom zone exists — either side may bootstrap it, so a web
			// user who signs in BEFORE any device has written still gets a working
			// zone (else the query fails with "zone not found"). Best-effort: a
			// re-save of an existing zone / an unsupported call is harmless.
			try { await database.saveRecordZones([{ zoneID: { zoneName } }]); } catch { /* exists / unsupported */ }
			const resp = await database.performQuery({ recordType: RECORD_TYPE, zoneID: { zoneName } });
			if (resp.hasErrors) return null;
			const before = ssProfileLoad();
			const beforeLive = new Set(ssLiveRules(before).map((r) => r.entityId));
			const merged = await mergeSnapshots(resp.records || [], before);
			const saved = ssProfileSave(merged);
			// Publish this browser's own snapshot (upsert; carry the change tag if
			// our record already exists so CloudKit accepts the overwrite).
			const mine = (resp.records || []).find((r) => r.recordName === webRecordName());
			const payload = await ssProfileEncode(saved);
			await database.saveRecords([snapshotRecord(payload, mine && mine.recordChangeTag)]);
			const afterLive = new Set(ssLiveRules(saved).map((r) => r.entityId));
			let added = 0, removed = 0;
			for (const id of afterLive) if (!beforeLive.has(id)) added++;
			for (const id of beforeLive) if (!afterLive.has(id)) removed++;
			return { added, removed };
		} catch { return null; }
	}

	/** Wire the Sign in with Apple flow into #apple-sign-in-button / -out-button
	 *  and a #icloud-status line. No-op (and stays hidden) when the token is unset. */
	function init(opts) {
		const onSynced = (opts && opts.onSynced) || (() => {});
		const box = document.getElementById('icloud-box');
		const status = document.getElementById('icloud-status');
		const say = (m) => { if (status) { status.textContent = m; status.hidden = false; } };
		if (!enabled()) return; // token unset → leave the disclosure hidden
		if (box) box.hidden = false;
		if (!configure()) return;
		container.setUpAuth().then((userIdentity) => {
			if (userIdentity) whenSignedIn();
		});
		container.whenUserSignsIn().then(whenSignedIn).catch(() => {});
		container.whenUserSignsOut().then(() => say('Logget ut av iCloud.')).catch(() => {});
		async function whenSignedIn() {
			say('Synker med iCloud …');
			const res = await sync();
			if (!res) { say('Logget inn, men synk er ikke tilgjengelig akkurat nå — prøv igjen om litt.'); return; }
			if (!res.added && !res.removed) say('Synket med iCloud — alt er oppdatert.');
			else say(`Synket med iCloud · la til ${res.added}, fjernet ${res.removed}.`);
			onSynced(res);
		}
	}

	// --- funksjonsgate (WP-201) ----------------------------------------------
	//
	// The board is OPEN. It is catalog-wide and user-neutral (WP-131), every byte
	// of it is already public in docs/data/, and an EMPTY profile renders exactly
	// that board — so a login wall in front of it protected nothing while costing
	// the preview, the shared link and all SEO. Sign-in now guards only what is
	// genuinely PERSONAL: syncing your profile with the iPhone app via your own
	// iCloud. The overlay below is therefore a dialog you can open and close, not
	// a wall: `hidden` in the markup, shown by requireAuth() or the quiet
	// «Logg inn» footer entry.

	const byId = (id) => (typeof document !== 'undefined' && document.getElementById ? document.getElementById(id) : null);
	let signedIn = false;
	// The last sign-in failure. Kept QUIET on the open board — an error nobody
	// asked for is noise — and shown inside the overlay if the user tries to sign in.
	let authError = '';
	let dismissWired = false;
	// Whatever had focus when the dialog opened, so closing it hands focus back
	// (a keyboard user must not be dropped at the top of the board).
	let lastFocus = null;

	/** A calm retry control shown ONLY on an auth error, so a failed sign-in isn't
	 *  a dead end. index.html ships it as static markup; pages that inject their
	 *  own overlay (gate-boot.js) get it created on demand. */
	function retryControl(create) {
		let r = byId('auth-retry');
		if (r || !create) return r;
		const g = byId('auth-gate');
		if (!g) return null;
		r = document.createElement('button');
		r.id = 'auth-retry';
		r.type = 'button';
		r.className = 'auth-retry';
		r.textContent = 'Last inn på nytt';
		(g.querySelector('.auth-gate-inner') || g).appendChild(r);
		return r;
	}

	function wireDismiss() {
		if (dismissWired) return;
		dismissWired = true;
		const d = byId('auth-dismiss');
		if (d) d.addEventListener('click', overlayClose);
		if (typeof document !== 'undefined' && document.addEventListener) {
			document.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') overlayClose(); });
		}
	}

	/** Open the sign-in dialog. `reason` is one honest line about what the user
	 *  just asked for (optional — the footer entry passes none). */
	function overlayOpen(reason) {
		const g = byId('auth-gate');
		if (!g) return;
		const r = byId('auth-reason');
		if (r) { r.textContent = reason || ''; r.hidden = !reason; }
		const e = byId('auth-error');
		if (e) { e.textContent = authError; e.hidden = !authError; }
		const retry = retryControl(!!authError);
		if (retry) { retry.onclick = () => window.location.reload(); retry.hidden = !authError; }
		lastFocus = (typeof document !== 'undefined' && document.activeElement) || null;
		g.hidden = false;
		if (typeof g.focus === 'function') { g.setAttribute('tabindex', '-1'); g.focus(); }
		wireDismiss();
	}

	function overlayClose() {
		const g = byId('auth-gate');
		if (g) g.hidden = true;
		if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
		lastFocus = null;
	}

	/** The hook for anything PERSONAL: returns true when the user is already
	 *  signed in, otherwise opens the sign-in dialog and returns false. Callers
	 *  should treat false as "not now" — never as an error. */
	function requireAuth(reason) {
		if (signedIn) return true;
		overlayOpen(reason);
		return false;
	}

	function isSignedIn() { return signedIn; }

	/** Wire the funksjonsgate on a page: restore an existing session silently
	 *  (sync → onAuthed), offer the quiet «Logg inn» entry when signed out, and
	 *  swap it for «Logg ut» when signed in. NEVER hides content.
	 *  Elements (index.html): #auth-gate (overlay, `hidden` in the markup),
	 *  #apple-sign-in-button (CloudKit populates it), #auth-reason, #auth-error,
	 *  #auth-dismiss, #signin-link, #signout-link. Every one is optional — a page
	 *  without them still syncs, it just shows no account chrome. */
	function gate(opts) {
		// Called once a sign-in has produced a synced profile, so the caller can
		// re-render the board as the user's own.
		const onAuthed = (opts && opts.onAuthed) || (() => {});
		// Called after a FOREGROUND re-sync with the sync result, so the caller can
		// re-render the board when returning to the tab picks up a phone change.
		const onResync = (opts && opts.onResync) || (() => {});
		const signInLink = () => byId('signin-link');
		const signOutLink = () => byId('signout-link');
		let signInWired = false;
		const showSignIn = () => {
			const link = signInLink();
			if (!link) return;
			link.hidden = false;
			if (signInWired) return;
			signInWired = true;
			link.addEventListener('click', () => overlayOpen());
		};
		const hideSignIn = () => { const l = signInLink(); if (l) l.hidden = true; };
		// Drive our own calm «Logg ut» footer link by forwarding its click to
		// CloudKit's hidden sign-out control. Shown only when signed in.
		let signOutWired = false;
		const wireSignOut = () => {
			const link = signOutLink();
			if (!link) return;
			link.hidden = false;
			if (signOutWired) return;
			signOutWired = true;
			link.addEventListener('click', () => {
				const el = document.querySelector('#apple-sign-out-button a, #apple-sign-out-button button, #apple-sign-out-button [role="button"], #apple-sign-out-button [tabindex]');
				if (el && typeof el.click === 'function') el.click();
			});
		};

		// Handle auth AT MOST ONCE per session (setUpAuth AND whenUserSignsIn can
		// both fire on a fresh sign-in — without this they'd each run a sync and
		// race a 409). Reset on sign-out.
		// CloudKit's whenUserSignsIn/Out promises resolve ONCE, so each handler
		// re-registers the opposite listener — otherwise sign out → sign in again
		// went unnoticed until a page reload.
		// Each listener re-arms only once the previous one has actually resolved, so
		// a sign-out never leaves two pending sign-in listeners behind.
		let handled = false, signInListening = false, signOutListening = false;
		const listenSignIn = () => {
			if (signInListening) return;
			signInListening = true;
			container.whenUserSignsIn().then(() => { signInListening = false; becameAuthed(); }).catch(() => { signInListening = false; });
		};
		const listenSignOut = () => {
			if (signOutListening) return;
			signOutListening = true;
			container.whenUserSignsOut().then(() => { signOutListening = false; becameSignedOut(); }).catch(() => { signOutListening = false; });
		};
		const becameAuthed = async () => {
			if (handled) return;
			handled = true;
			signedIn = true;
			authError = '';
			overlayClose();
			hideSignIn();
			wireSignOut();
			listenSignOut();
			try { await sync(); } catch { /* offline-first: keep the local profile */ }
			onAuthed();
			wireForegroundResync();
		};
		const becameSignedOut = () => {
			handled = false;
			signedIn = false;
			const l = signOutLink(); if (l) l.hidden = true;
			showSignIn();
			listenSignIn();
		};

		// Re-sync when the tab returns to the foreground, so a change made on the
		// phone shows up without a manual refresh. Throttled (min 8s between rounds)
		// and skipped while signed out/offline; sync() is itself re-entrant-safe.
		let lastResync = 0, foregroundWired = false;
		function wireForegroundResync() {
			if (foregroundWired) return;
			foregroundWired = true;
			const maybe = async () => {
				if (!signedIn || document.hidden) return;
				const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
				if (now - lastResync < 8000) return;
				lastResync = now;
				const res = await sync();
				if (res) onResync(res);
			};
			document.addEventListener('visibilitychange', maybe);
			if (typeof window !== 'undefined') window.addEventListener('focus', maybe);
		}

		// No token → sync isn't configured at all (local dev / stripped build), so
		// there is nothing personal to offer. Stay silent rather than show a control
		// that can't work.
		if (!cfg.apiToken) { hideSignIn(); return; }
		// Token, but Apple's library never arrived: keep the entry — tapping it
		// explains why and offers a reload — and say nothing on the open board.
		showSignIn();
		if (typeof CloudKit === 'undefined') { authError = 'Kunne ikke laste Apple-innlogging. Sjekk nettforbindelsen og last siden på nytt.'; return; }
		if (!configure()) { authError = 'Apple-innlogging er utilgjengelig akkurat nå.'; return; }
		// CloudKit renders Apple's own sign-in button into #apple-sign-in-button and
		// we show it directly (see base.css) — the user taps Apple's real control, so
		// there is no click-forwarding and no double-tap. configure() above has already
		// kicked off CloudKit, which populates the button shortly.
		container.setUpAuth().then((userIdentity) => { if (userIdentity) becameAuthed(); }).catch((err) => {
			try { console.error('[Sportivista] CloudKit setUpAuth failed:', err && (err.ckErrorCode || err.reason || err.message) || err, err); } catch (e) {}
			const code = (err && (err.ckErrorCode || err.reason)) || '';
			authError = 'Kunne ikke starte Apple-innlogging' + (code ? ' (' + code + ')' : '') + '. Last siden på nytt, eller åpne DevTools → Console for detaljer.';
		});
		// Only the sign-IN listener is registered up front — a signed-out user has
		// nothing to sign out of; becameAuthed() registers the sign-out one.
		listenSignIn();
	}

	return { enabled, init, gate, requireAuth, isSignedIn, overlayOpen, overlayClose, sync, mergeSnapshots, recordPayload, snapshotRecord, webRecordName };
})();
