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

	/** Whole-web-behind-login gate: the page shows NOTHING until the user signs in
	 *  with Apple. Reveals the board (after a first iCloud sync) on auth; re-shows
	 *  the gate on sign-out. Never leaves a blank page — a missing token / failed
	 *  CloudKit JS load shows a calm error in the gate, not emptiness.
	 *  Elements (in index.html): #auth-gate (overlay), #apple-sign-in-button (CloudKit
	 *  populates it), #auth-error (message), and body.gated (CSS hides the content). */
	function gate(opts) {
		const onAuthed = (opts && opts.onAuthed) || (() => {});
		// Called after a FOREGROUND re-sync with the sync result, so the caller can
		// re-render the board when returning to the tab picks up a phone change.
		const onResync = (opts && opts.onResync) || (() => {});
		const gateEl = () => document.getElementById('auth-gate');
		const errEl = () => document.getElementById('auth-error');
		// A calm retry control revealed ONLY on an auth error so a failed sign-in
		// isn't a dead end (the error copy tells the user to reload but the gate
		// otherwise has no button once CloudKit's own control fails to render).
		// index.html ships it as static markup; on pages that don't (gate-boot's
		// injected overlay) it's created on demand.
		const retryEl = () => document.getElementById('auth-retry');
		const hideRetry = () => { const r = retryEl(); if (r) r.hidden = true; };
		const showRetry = () => {
			const g = gateEl(); if (!g) return;
			let r = retryEl();
			if (!r) {
				r = document.createElement('button');
				r.id = 'auth-retry';
				r.type = 'button';
				r.className = 'auth-retry';
				r.textContent = 'Last inn på nytt';
				(g.querySelector('.auth-gate-inner') || g).appendChild(r);
			}
			r.onclick = () => window.location.reload();
			r.hidden = false;
		};
		// Reveal AT MOST ONCE per auth (setUpAuth AND whenUserSignsIn can both fire on
		// a fresh sign-in — without this they'd each run a sync and race a 409).
		// Reset on sign-out so a re-sign-in reveals again.
		let revealed = false;
		const signOutLink = () => document.getElementById('signout-link');
		// Drive our own calm «Logg ut» footer link by forwarding its click to
		// CloudKit's hidden sign-out control. Shown only when signed in (reveal),
		// hidden again when the gate re-shows. No-op on pages without the link.
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
		const showGate = () => { revealed = false; const g = gateEl(); if (g) g.hidden = false; if (document.body) document.body.classList.add('gated'); const l = signOutLink(); if (l) l.hidden = true; hideRetry(); };
		const showError = (m) => { showGate(); const e = errEl(); if (e) { e.textContent = m; e.hidden = false; } showRetry(); };
		const reveal = async () => {
			if (revealed) return;
			revealed = true;
			const e = errEl(); if (e) e.hidden = true;
			hideRetry();
			try { await sync(); } catch { /* offline-first: reveal on the local profile anyway */ }
			onAuthed();
			if (document.body) document.body.classList.remove('gated');
			const g = gateEl(); if (g) g.hidden = true;
			wireSignOut();
			wireForegroundResync();
		};

		// Re-sync when the tab returns to the foreground, so a change made on the
		// phone shows up without a manual refresh. Throttled (min 8s between rounds)
		// and skipped while gated/offline; sync() is itself re-entrant-safe.
		let lastResync = 0, foregroundWired = false;
		function wireForegroundResync() {
			if (foregroundWired) return;
			foregroundWired = true;
			const maybe = async () => {
				if (!revealed || document.hidden) return;
				const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
				if (now - lastResync < 8000) return;
				lastResync = now;
				const res = await sync();
				if (res) onResync(res);
			};
			document.addEventListener('visibilitychange', maybe);
			if (typeof window !== 'undefined') window.addEventListener('focus', maybe);
		}
		if (typeof CloudKit === 'undefined') { showError('Kunne ikke laste iCloud-innlogging. Sjekk nettforbindelsen og last siden på nytt.'); return; }
		if (!cfg.apiToken) { showError('iCloud-innlogging er ikke konfigurert.'); return; }
		if (!configure()) { showError('iCloud-innlogging er utilgjengelig akkurat nå.'); return; }
		showGate();
		// CloudKit renders Apple's own sign-in button into #apple-sign-in-button and
		// we show it directly (see base.css) — the user taps Apple's real control, so
		// there is no click-forwarding and no double-tap. configure() above has already
		// kicked off CloudKit, which populates the button shortly.
		container.setUpAuth().then((userIdentity) => { if (userIdentity) reveal(); }).catch((err) => {
			try { console.error('[Sportivista] CloudKit setUpAuth failed:', err && (err.ckErrorCode || err.reason || err.message) || err, err); } catch (e) {}
			const code = (err && (err.ckErrorCode || err.reason)) || '';
			showError('Kunne ikke starte Apple-innlogging' + (code ? ' (' + code + ')' : '') + '. Last siden på nytt, eller åpne DevTools → Console for detaljer.');
		});
		container.whenUserSignsIn().then(reveal).catch(() => {});
		container.whenUserSignsOut().then(showGate).catch(() => {});
	}

	return { enabled, init, gate, sync, mergeSnapshots, recordPayload, snapshotRecord, webRecordName };
})();
