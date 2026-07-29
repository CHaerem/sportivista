// gate-boot.js — wires the funksjonsgate (WP-201) on the SECONDARY pages
// (rediger.html, activity.html). index.html has its own inline wiring because it
// also has to re-render the board once a session is restored.
//
// Until WP-201 this file was a WALL: it stamped `body.gated` on load and the page
// stayed blank until Sign in with Apple. Neither page mutates the profile —
// «Be om dekning» opens a GitHub Issue (owner-gated on the server side) and
// «Aktivitet» only reads the public ops files — so neither had anything to guard.
// Login is required where something PERSONAL happens; that check now lives in
// ssICloud.requireAuth(), which any action can call.
//
// What is left here: take off any `gated` class an older cached page still carries,
// put a HIDDEN sign-in dialog in the DOM (so CloudKit has somewhere to render
// Apple's own button, and a later requireAuth() has something to open), then hand
// off to ssICloud.gate() so an existing iCloud session keeps the profile in sync
// while the user is on these pages.
//
// Each page includes: icloud-config.js + cloudkit.js + icloud-sync.js + this.
// No token configured → no sync, and the page is open exactly as before.

(function () {
	function unhide() {
		// Defensive: the class is gone from the markup, but a browser holding an old
		// cached HTML with a fresh base.css must never render a blank page.
		if (document.body) document.body.classList.remove('gated');
	}

	// The dialog is created HIDDEN and stays hidden until something personal asks
	// for it (ssICloud.requireAuth). It must exist BEFORE gate() runs: CloudKit
	// renders Apple's control into #apple-sign-in-button at setUpAuth time, and an
	// absent element there would leave a later dialog without a button.
	function ensureOverlay() {
		if (document.getElementById('auth-gate')) return;
		var g = document.createElement('div');
		g.id = 'auth-gate';
		g.className = 'auth-gate';
		g.hidden = true;
		g.setAttribute('role', 'dialog');
		g.setAttribute('aria-modal', 'true');
		g.setAttribute('aria-label', 'Logg inn med Apple');
		g.innerHTML = '<div class="auth-gate-inner">'
			+ '<span class="wordmark-lockup"><span class="wordmark">Sportivista</span><span class="wordmark-colon" aria-hidden="true">:</span></span>'
			+ '<p class="auth-gate-reason" id="auth-reason" hidden></p>'
			+ '<p class="auth-gate-lead">Logg inn med Apple for å synke det du følger med iPhone-appen — via din egen iCloud.</p>'
			+ '<div id="apple-sign-in-button"></div>'
			+ '<p class="auth-error" id="auth-error" hidden></p>'
			+ '<button type="button" class="auth-dismiss" id="auth-dismiss">Lukk</button></div>';
		document.body.appendChild(g);
	}

	function start() {
		unhide();
		var cfg = window.SPORTIVISTA_ICLOUD;
		if (!cfg || !cfg.apiToken || !window.ssICloud || typeof window.ssICloud.gate !== 'function') return;
		ensureOverlay();
		var tries = 0;
		var t = setInterval(function () {
			if (typeof CloudKit !== 'undefined' || ++tries > 40) {
				clearInterval(t);
				window.ssICloud.gate({});
			}
		}, 250);
	}

	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
	else start();
})();
