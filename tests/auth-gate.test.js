// auth-gate.test.js — the FUNKSJONSGATE (WP-201): the board is open, and sign-in
// guards only the personal half (syncing your profile with the iPhone app).
//
// These tests exist because the old behaviour was a wall — `body.gated` hid the
// masthead, the agenda and the footer until Sign in with Apple — and a wall is
// exactly the kind of thing that creeps back in. They pin the contract: gate()
// never hides content, it offers a quiet way in when signed out, and it swaps to
// «Logg ut» + a synced profile when a session exists.
//
// Driven against a MOCK window.CloudKit and a minimal DOM stub (same vm-sandbox
// approach as icloud-integration.test.js — no jsdom, no network, no Apple ID).

import { describe, it, expect } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

// --- a DOM stub with just what the gate touches -----------------------------

function makeEl(id) {
	return {
		id,
		hidden: true,
		textContent: "",
		onclick: null,
		_l: {},
		addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); },
		click() { (this._l.click || []).forEach((fn) => fn()); if (this.onclick) this.onclick(); },
		setAttribute() {},
		appendChild() {},
		querySelector() { return null; },
	};
}

function makeDocument(ids) {
	const els = new Map(ids.map((id) => [id, makeEl(id)]));
	const classes = new Set();
	return {
		hidden: false,
		_l: {},
		els,
		addEventListener(type, fn) { (this._l[type] = this._l[type] || []).push(fn); },
		getElementById: (id) => els.get(id) || null,
		querySelector: () => null,
		createElement: () => makeEl("created"),
		body: {
			classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
			appendChild() {},
			addEventListener() {},
		},
		documentElement: { dataset: {} },
	};
}

const PAGE_IDS = ["auth-gate", "auth-reason", "auth-error", "auth-retry", "auth-dismiss", "signin-link", "signout-link"];

/** A mock CloudKit whose setUpAuth resolves an identity (signed in) or null, and
 *  whose whenUserSignsIn/Out promises can be fired from the test — CloudKit's
 *  resolve ONCE, which is exactly what the re-registration has to survive. */
function makeMockCloudKit({ identity = null } = {}) {
	const database = {
		saveRecordZones: () => Promise.resolve({}),
		performQuery: () => Promise.resolve({ records: [] }),
		saveRecords: (recs) => Promise.resolve({ records: recs }),
	};
	let inWaiters = [], outWaiters = [];
	const container = {
		privateCloudDatabase: database,
		setUpAuth: () => Promise.resolve(identity),
		whenUserSignsIn: () => new Promise((resolve) => inWaiters.push(resolve)),
		whenUserSignsOut: () => new Promise((resolve) => outWaiters.push(resolve)),
	};
	const CloudKit = { configure: () => {}, getDefaultContainer: () => container };
	CloudKit.fireSignIn = () => { const w = inWaiters; inWaiters = []; w.forEach((r) => r({ userRecordName: "user-1" })); };
	CloudKit.fireSignOut = () => { const w = outWaiters; outWaiters = []; w.forEach((r) => r()); };
	CloudKit.pendingSignIn = () => inWaiters.length;
	return CloudKit;
}

function loadSandbox({ CloudKit, token } = {}) {
	const sandbox = createClientSandbox();
	Object.assign(sandbox, {
		TextEncoder, TextDecoder, btoa, atob, Uint8Array, Response, Blob,
		crypto: globalThis.crypto,
		CompressionStream: globalThis.CompressionStream,
		DecompressionStream: globalThis.DecompressionStream,
		addEventListener: () => {},
		document: makeDocument(PAGE_IDS),
	});
	if (CloudKit) sandbox.CloudKit = CloudKit;
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "lens.js");
	loadClientScript(sandbox, "profile-sync.js");
	if (token === undefined) loadClientScript(sandbox, "icloud-config.js"); // ships the real public token
	else sandbox.SPORTIVISTA_ICLOUD = { containerIdentifier: "x", apiToken: token, environment: "production", zoneName: "SportivistaProfile" };
	loadClientScript(sandbox, "icloud-sync.js");
	return sandbox;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** Wait for a condition — a full sync round is several awaits deep (zone, query,
 *  deflate, save), so one microtask tick is not enough for onAuthed. */
async function until(predicate, tries = 100) {
	for (let i = 0; i < tries; i++) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	return false;
}

describe("funksjonsgate — signed out", () => {
	it("never hides the board: no `gated` class, dialog stays closed, quiet «Logg inn» offered", async () => {
		const sb = loadSandbox({ CloudKit: makeMockCloudKit({ identity: null }) });
		sb.window.ssICloud.gate({});
		await settle();
		const doc = sb.document;
		expect(doc.body.classList.contains("gated")).toBe(false);
		expect(doc.getElementById("auth-gate").hidden).toBe(true);
		expect(doc.getElementById("signin-link").hidden).toBe(false);
		expect(doc.getElementById("signout-link").hidden).toBe(true);
		expect(sb.window.ssICloud.isSignedIn()).toBe(false);
	});

	it("requireAuth() opens the dialog with the reason, reports not-signed-in, and «Lukk» closes it", async () => {
		const sb = loadSandbox({ CloudKit: makeMockCloudKit({ identity: null }) });
		sb.window.ssICloud.gate({});
		await settle();
		const doc = sb.document;
		expect(sb.window.ssICloud.requireAuth("Logg inn for å synke det du følger.")).toBe(false);
		expect(doc.getElementById("auth-gate").hidden).toBe(false);
		expect(doc.getElementById("auth-reason").hidden).toBe(false);
		expect(doc.getElementById("auth-reason").textContent).toBe("Logg inn for å synke det du følger.");
		// Still nothing hidden behind it.
		expect(doc.body.classList.contains("gated")).toBe(false);
		doc.getElementById("auth-dismiss").click();
		expect(doc.getElementById("auth-gate").hidden).toBe(true);
	});

	it("the footer «Logg inn» entry opens the same dialog (with no reason line)", async () => {
		const sb = loadSandbox({ CloudKit: makeMockCloudKit({ identity: null }) });
		sb.window.ssICloud.gate({});
		await settle();
		const doc = sb.document;
		doc.getElementById("signin-link").click();
		expect(doc.getElementById("auth-gate").hidden).toBe(false);
		expect(doc.getElementById("auth-reason").hidden).toBe(true);
	});
});

describe("funksjonsgate — signed in", () => {
	it("restores the session: syncs, calls onAuthed, swaps «Logg inn» for «Logg ut»", async () => {
		const sb = loadSandbox({ CloudKit: makeMockCloudKit({ identity: { userRecordName: "user-1" } }) });
		const authed = await new Promise((resolve) => {
			sb.window.ssICloud.gate({ onAuthed: () => resolve(true) });
		});
		const doc = sb.document;
		expect(authed).toBe(true);
		expect(doc.body.classList.contains("gated")).toBe(false);
		expect(doc.getElementById("auth-gate").hidden).toBe(true);
		expect(doc.getElementById("signin-link").hidden).toBe(true);
		expect(doc.getElementById("signout-link").hidden).toBe(false);
		expect(sb.window.ssICloud.isSignedIn()).toBe(true);
		// Nothing personal needs to ask again.
		expect(sb.window.ssICloud.requireAuth("uansett")).toBe(true);
		expect(doc.getElementById("auth-gate").hidden).toBe(true);
	});

	it("«Logg ut» returns the board to its open, signed-out state — and a new sign-in is still noticed", async () => {
		const CloudKit = makeMockCloudKit({ identity: { userRecordName: "user-1" } });
		const sb = loadSandbox({ CloudKit });
		let authedCount = 0;
		sb.window.ssICloud.gate({ onAuthed: () => { authedCount++; } });
		const doc = sb.document;
		expect(await until(() => authedCount === 1)).toBe(true);
		expect(sb.window.ssICloud.isSignedIn()).toBe(true);

		CloudKit.fireSignOut();
		await settle();
		expect(sb.window.ssICloud.isSignedIn()).toBe(false);
		expect(doc.getElementById("signout-link").hidden).toBe(true);
		expect(doc.getElementById("signin-link").hidden).toBe(false);
		// The board itself never went anywhere.
		expect(doc.body.classList.contains("gated")).toBe(false);
		expect(doc.getElementById("auth-gate").hidden).toBe(true);

		// CloudKit's promises resolve once, so signing back in only works if the
		// listener was re-registered.
		expect(CloudKit.pendingSignIn()).toBe(1);
		CloudKit.fireSignIn();
		expect(await until(() => authedCount === 2)).toBe(true);
		expect(sb.window.ssICloud.isSignedIn()).toBe(true);
		expect(doc.getElementById("signout-link").hidden).toBe(false);
		expect(doc.getElementById("signin-link").hidden).toBe(true);
	});
});

describe("funksjonsgate — sync not configured", () => {
	it("offers no sign-in entry at all when the token is unset (dev / stripped build / QA harness)", async () => {
		const sb = loadSandbox({ CloudKit: makeMockCloudKit({ identity: null }), token: "" });
		sb.window.ssICloud.gate({});
		await settle();
		const doc = sb.document;
		expect(doc.getElementById("signin-link").hidden).toBe(true);
		expect(doc.getElementById("auth-gate").hidden).toBe(true);
		expect(doc.body.classList.contains("gated")).toBe(false);
	});

	it("keeps the entry — and an honest explanation — when Apple's library never loaded", async () => {
		const sb = loadSandbox({}); // no window.CloudKit
		sb.window.ssICloud.gate({});
		await settle();
		const doc = sb.document;
		expect(doc.getElementById("signin-link").hidden).toBe(false);
		// Quiet until asked: the error lives in the dialog, never on the open board.
		expect(doc.getElementById("auth-error").hidden).toBe(true);
		sb.window.ssICloud.requireAuth();
		expect(doc.getElementById("auth-gate").hidden).toBe(false);
		expect(doc.getElementById("auth-error").hidden).toBe(false);
		expect(doc.getElementById("auth-error").textContent).toMatch(/Kunne ikke laste Apple-innlogging/);
		expect(doc.getElementById("auth-retry").hidden).toBe(false);
	});
});
