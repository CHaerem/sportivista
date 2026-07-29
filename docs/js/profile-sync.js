// profile-sync.js — the web twin of the iOS profile sync core:
//   ProfileMerge.swift + ProfileSyncModel.swift + ProfileShareCodec.swift + the store.
//
// A personal profile on the web is a ProfileSyncState — {rules, episodic,
// counters, facts} — the SAME mergeable shape iOS syncs. The web only ever
// WRITES rules (follow/unfollow); episodic/counters/facts are carried opaquely
// so an imported phone payload round-trips without losing memory or tombstones.
//
// The merge is a CRDT: rules/facts = last-writer-wins on modifiedAt/updatedAt
// (tie-break: tombstone wins → higher deviceID → payloadKey); episodic = union
// with deterministic reconcile; counters = grow-only G-counter. It is
// commutative, idempotent and convergent — proven against Swift's ProfileMerge
// by tests/profile-vectors.test.js.
//
// INTEROP LANDMINES (see plan Risk #1): the QR/CloudKit payload is Apple's
// `.zlib` = RAW DEFLATE (RFC 1951, no zlib header) → the browser MUST use
// deflate-raw / inflate-raw (native CompressionStream), never plain deflate.
// Dates are ISO-8601 at SECOND precision (Swift `.iso8601` rejects the `.123`
// milliseconds JS emits) and JSON keys are recursively sorted — both handled by
// ssStableStringify below so an exported payload is byte-compatible with iOS.
//
// Plain window-globals, no build step. Depends on nothing else.

const SS_PROFILE_KEY = 'ss-profile';
const SS_DEVICE_KEY = 'ss-device-id';
const SS_US = ''; // ASCII Unit Separator — the payloadKey join char (Swift \u{1F})

// ---------------------------------------------------------------------------
// Canonical JSON — recursively sorted keys + ISO-8601 second precision, so an
// exported state is byte-identical to Swift's JSONEncoder(.sortedKeys,.iso8601).
// ---------------------------------------------------------------------------

/** Truncate a JS ISO string (…:00.000Z) to Swift's second precision (…:00Z). */
function ssIsoSeconds(iso) {
	return typeof iso === 'string' ? iso.replace(/\.\d{3}(Z|[+-]\d{2}:?\d{2})$/, '$1') : iso;
}

function ssCanonical(v) {
	if (Array.isArray(v)) return v.map(ssCanonical);
	if (v && typeof v === 'object') {
		const out = {};
		for (const k of Object.keys(v).sort()) out[k] = ssCanonical(v[k]);
		return out;
	}
	return v;
}

/** Deterministic, Swift-compatible JSON string of a state (dates already ISO). */
function ssStableStringify(v) {
	return JSON.stringify(ssCanonical(v));
}

/** Deep structural equality via canonical JSON (mirrors Swift value `==`). */
function ssDeepEqual(a, b) {
	return ssStableStringify(a) === ssStableStringify(b);
}

// ---------------------------------------------------------------------------
// Payload keys — the final, total-order tie-break (must match ProfileMerge).
// ---------------------------------------------------------------------------

/** Lens → its payloadKey token: "s" | "n" | "a:<sorted entityIds>". Mirrors the
 *  Swift synthesized Lens Codable shape ({sportAsSuch:{}} / {throughNorwegians:{}}
 *  / {throughAthletes:{_0:[{entityId,name}]}}). */
function ssLensToken(lens) {
	const L = lens || { sportAsSuch: {} };
	if (L.throughNorwegians) return 'n';
	if (L.throughAthletes) {
		const arr = (L.throughAthletes && L.throughAthletes._0) || [];
		return 'a:' + arr.map((a) => a.entityId).sort().join(',');
	}
	return 's';
}

function ssRulePayloadKey(rule) {
	const w = Number(rule.weight == null ? 0 : rule.weight).toFixed(6); // Swift %.6f
	return [
		rule.entityId, rule.entityName, rule.sport, rule.scope || '',
		w, rule.reason, ssLensToken(rule.lens),
	].join(SS_US);
}

function ssFactPayloadKey(f) {
	return [f.entityId || '', f.sport || '', f.kind, f.value, f.reason].join(SS_US);
}

// ---------------------------------------------------------------------------
// Per-record winners (LWW + tombstone; reconcile; G-counter). Mirror ProfileMerge.
// ---------------------------------------------------------------------------

const ssMs = (iso) => Date.parse(iso); // ISO -> epoch ms (Date equality via ==)

function ssPickNewerRule(a, b) {
	const am = ssMs(a.modifiedAt), bm = ssMs(b.modifiedAt);
	if (am !== bm) return am > bm ? a : b;
	if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
	if (a.deviceID !== b.deviceID) return a.deviceID > b.deviceID ? a : b;
	return ssRulePayloadKey(a.rule) >= ssRulePayloadKey(b.rule) ? a : b;
}

function ssPickNewerFact(a, b) {
	const am = ssMs(a.updatedAt), bm = ssMs(b.updatedAt);
	if (am !== bm) return am > bm ? a : b;
	if (!!a.deleted !== !!b.deleted) return a.deleted ? a : b;
	if (a.deviceID !== b.deviceID) return a.deviceID > b.deviceID ? a : b;
	return ssFactPayloadKey(a) >= ssFactPayloadKey(b) ? a : b;
}

/** Deterministic, symmetric reconcile of two copies of the SAME episodic note
 *  (mirrors EpisodicNote.reconcile). */
function ssReconcileNote(a, b) {
	const maxStr = (x, y) => (x >= y ? x : y);
	const serialize = (p) => Object.keys(p || {}).sort().map((k) => `${k}=${p[k] || ''}`).join(';');
	const reconcileNote = (x, y) => {
		if (x != null && y != null) return maxStr(x, y);
		return x != null ? x : (y != null ? y : null);
	};
	const earliest = (x, y) => {
		if (x != null && y != null) return ssMs(x) <= ssMs(y) ? x : y;
		return x != null ? x : (y != null ? y : null);
	};
	return {
		id: a.id,
		kind: a.kind === b.kind ? a.kind : maxStr(a.kind, b.kind),
		createdAt: ssMs(a.createdAt) <= ssMs(b.createdAt) ? a.createdAt : b.createdAt,
		payload: ssDeepEqual(a.payload, b.payload) ? a.payload : (serialize(a.payload) >= serialize(b.payload) ? a.payload : b.payload),
		note: reconcileNote(a.note == null ? null : a.note, b.note == null ? null : b.note),
		resolvedAt: earliest(a.resolvedAt == null ? null : a.resolvedAt, b.resolvedAt == null ? null : b.resolvedAt),
	};
}

/** Grow-only G-counter merge: per-device MAX (mirror Counter.merge). */
function ssCounterMerge(a, b) {
	const per = Object.assign({}, a.perDevice);
	for (const [d, v] of Object.entries(b.perDevice || {})) per[d] = Math.max(per[d] || 0, v);
	return { key: a.key, perDevice: per };
}

// ---------------------------------------------------------------------------
// State: normalize / deduplicate / merge (mirror ProfileSyncState + ProfileMerge).
// ---------------------------------------------------------------------------

function ssEmptyState() { return { rules: [], episodic: [], counters: [], facts: [] }; }

function ssNormalizeState(s) {
	const st = s || ssEmptyState();
	return {
		rules: [...(st.rules || [])].sort((a, b) => (a.rule.entityId < b.rule.entityId ? -1 : a.rule.entityId > b.rule.entityId ? 1 : 0)),
		episodic: [...(st.episodic || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
		counters: [...(st.counters || [])].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)),
		facts: [...(st.facts || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
	};
}

/** Fold a single state to one-per-id, resolving accidental dupes the same way
 *  the cross-device merge does (mirror ProfileSyncState.deduplicated). */
function ssDeduplicateState(s) {
	const st = s || ssEmptyState();
	const byRule = {}, byNote = {}, byCounter = {}, byFact = {};
	for (const r of st.rules || []) byRule[r.rule.entityId] = byRule[r.rule.entityId] ? ssPickNewerRule(byRule[r.rule.entityId], r) : r;
	for (const n of st.episodic || []) byNote[n.id] = byNote[n.id] ? ssReconcileNote(byNote[n.id], n) : n;
	for (const c of st.counters || []) byCounter[c.key] = byCounter[c.key] ? ssCounterMerge(byCounter[c.key], c) : c;
	for (const f of st.facts || []) byFact[f.id] = byFact[f.id] ? ssPickNewerFact(byFact[f.id], f) : f;
	return ssNormalizeState({
		rules: Object.values(byRule), episodic: Object.values(byNote),
		counters: Object.values(byCounter), facts: Object.values(byFact),
	});
}

/** The CRDT merge — {merged, toPush}. Port of ProfileMerge.merge. `toPush` = the
 *  winners the REMOTE is behind on (remote !== winner). */
function ssProfileMerge(rawLocal, rawRemote) {
	const local = ssDeduplicateState(rawLocal);
	const remote = ssDeduplicateState(rawRemote);
	const keyBy = (arr, k) => { const m = {}; for (const x of arr) m[k(x)] = x; return m; };

	const lRule = keyBy(local.rules, (r) => r.rule.entityId), rRule = keyBy(remote.rules, (r) => r.rule.entityId);
	const lNote = keyBy(local.episodic, (n) => n.id), rNote = keyBy(remote.episodic, (n) => n.id);
	const lCtr = keyBy(local.counters, (c) => c.key), rCtr = keyBy(remote.counters, (c) => c.key);
	const lFact = keyBy(local.facts, (f) => f.id), rFact = keyBy(remote.facts, (f) => f.id);

	const mergedRules = [], pushRules = [];
	for (const id of new Set([...Object.keys(lRule), ...Object.keys(rRule)])) {
		const l = lRule[id], r = rRule[id];
		const w = l && r ? ssPickNewerRule(l, r) : (l || r);
		mergedRules.push(w);
		if (!r || !ssDeepEqual(r, w)) pushRules.push(w);
	}
	const mergedNotes = [], pushNotes = [];
	for (const id of new Set([...Object.keys(lNote), ...Object.keys(rNote)])) {
		const l = lNote[id], r = rNote[id];
		const w = l && r ? ssReconcileNote(l, r) : (l || r);
		mergedNotes.push(w);
		if (!r || !ssDeepEqual(r, w)) pushNotes.push(w);
	}
	const mergedCounters = [], pushCounters = [];
	for (const key of new Set([...Object.keys(lCtr), ...Object.keys(rCtr)])) {
		const l = lCtr[key], r = rCtr[key];
		const w = l && r ? ssCounterMerge(l, r) : (l || r);
		mergedCounters.push(w);
		if (!r || !ssDeepEqual(r, w)) pushCounters.push(w);
	}
	const mergedFacts = [], pushFacts = [];
	for (const id of new Set([...Object.keys(lFact), ...Object.keys(rFact)])) {
		const l = lFact[id], r = rFact[id];
		const w = l && r ? ssPickNewerFact(l, r) : (l || r);
		mergedFacts.push(w);
		if (!r || !ssDeepEqual(r, w)) pushFacts.push(w);
	}

	const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
	return {
		merged: ssNormalizeState({ rules: mergedRules, episodic: mergedNotes, counters: mergedCounters, facts: mergedFacts }),
		toPush: {
			rules: pushRules.sort((a, b) => cmp(a.rule.entityId, b.rule.entityId)),
			episodic: pushNotes.sort((a, b) => cmp(a.id, b.id)),
			counters: pushCounters.sort((a, b) => cmp(a.key, b.key)),
			facts: pushFacts.sort((a, b) => cmp(a.id, b.id)),
		},
	};
}

function ssPushIsEmpty(p) {
	return !p || (!p.rules.length && !p.episodic.length && !p.counters.length && !p.facts.length);
}

// ---------------------------------------------------------------------------
// Write-time stamping — follow/unfollow (mirror ProfileSyncState.updatingRules).
// ---------------------------------------------------------------------------

/** Live (non-tombstoned) rules as an InterestProfile-like sorted list. */
function ssLiveRules(state) {
	return (state.rules || []).filter((r) => !r.deleted).map((r) => r.rule)
		.sort((a, b) => {
			if (a.sport !== b.sport) return a.sport < b.sport ? -1 : 1;
			return a.entityName.localeCompare(b.entityName, undefined, { sensitivity: 'accent' });
		});
}

/** Produce a new state whose live rules equal `desiredRules`, stamping only what
 *  changed with (nowIso, deviceID) and tombstoning removals once. */
function ssUpdatingRules(state, desiredRules, nowIso, deviceID) {
	const existing = {};
	for (const r of state.rules || []) existing[r.rule.entityId] = r;
	const next = [];
	const desiredIds = new Set();
	for (const rule of desiredRules) {
		desiredIds.add(rule.entityId);
		const prior = existing[rule.entityId];
		if (prior && !prior.deleted && ssDeepEqual(prior.rule, rule)) next.push(prior); // unchanged → keep stamp
		else next.push({ rule, modifiedAt: nowIso, deviceID, deleted: false });
	}
	for (const [id, prior] of Object.entries(existing)) {
		if (desiredIds.has(id)) continue;
		if (prior.deleted) next.push(prior);
		else next.push({ rule: prior.rule, modifiedAt: nowIso, deviceID, deleted: true });
	}
	return ssNormalizeState({ rules: next, episodic: state.episodic || [], counters: state.counters || [], facts: state.facts || [] });
}

// ---------------------------------------------------------------------------
// Projection: state -> the `interests` shape dashboard.js/lens.js consume.
// ---------------------------------------------------------------------------

/** Bucket live rules into {followBroadly, alwaysTrack:{teams,athletes,tournaments}}.
 *  Kind is inferred from an entityId prefix or an explicit rule.kind if present.
 *
 *  WP-200 — `followBroadly` is DERIVED from the profile instead of being handed
 *  back as `null`. It used to be null unconditionally, so `ssIsRelevant` fell
 *  through to `cfg.followBroadlyDefault` (nine sports) and the profile could only
 *  ever ADD to the board, never shape it: someone who picked "Formel 1" in
 *  onboarding still got golf, cycling and biathlon.
 *
 *  The derivation, twinned with EffectiveInterests.merge on iOS:
 *    • a SPORT-level rule (entity type "sport", e.g. `sport-biathlon` from the
 *      Vintersport-pakken) ⇒ that sport is followed WHOLESALE;
 *    • a team / athlete / tournament / league rule ⇒ no wholesale follow; it
 *      admits events through the entity match, and its sport joins the blanket's
 *      scope (see ssLensSportScope);
 *    • EMPTY profile ⇒ `null` — absent, exactly as before, so a board with no
 *      profile behaves byte-for-byte like the pre-WP-200 catalog-wide board.
 *  The list is deduped + sorted so the projection is deterministic (and equal to
 *  the Swift side's, which sorts too). */
function ssProfileToInterests(state) {
	const teams = [], athletes = [], tournaments = [];
	const broad = new Set();
	const live = ssLiveRules(state);
	for (const rule of live) {
		const entity = { name: rule.entityName, aliases: [], sport: rule.sport || null };
		const kind = ssRuleKind(rule);
		if (kind === 'sport' && rule.sport) broad.add(String(rule.sport).toLowerCase());
		if (kind === 'team' || kind === 'league') teams.push(entity);
		else if (kind === 'tournament') tournaments.push(entity);
		else athletes.push(entity); // athlete + sport/category + unknown default (mirrors iOS)
	}
	return {
		// Absent (null) only for an EMPTY profile — the backward-compatibility
		// guarantee. A non-empty profile always speaks explicitly, even when it
		// follows no sport wholesale (`[]`, honoured as-is by the lens).
		followBroadly: live.length ? [...broad].sort() : null,
		alwaysTrack: { teams, athletes, tournaments },
	};
}

/** The bucket kind for one live rule. The stored `kind` wins EXCEPT when the id
 *  itself says "sport-…": a rule imported from iOS carries no `kind` at all, and
 *  a rule stored by an older web build recorded `athlete` for a sport id (the
 *  pre-WP-200 ssInferKind had no sport case). The id is the stable fact, so it
 *  wins for that one kind — otherwise a wholesale sport follow would silently
 *  degrade into an athlete named "Skiskyting" that matches nothing. */
function ssRuleKind(rule) {
	const inferred = ssInferKind(rule.entityId);
	return inferred === 'sport' ? 'sport' : (rule.kind || inferred);
}

function ssInferKind(entityId) {
	const id = String(entityId || '');
	if (id.startsWith('team-')) return 'team';
	if (id.startsWith('league-')) return 'league';
	if (id.startsWith('tournament-')) return 'tournament';
	if (id.startsWith('athlete-')) return 'athlete';
	// WP-200: the sport-level entities (entities.json `type: "sport"`) the iOS
	// starter packs follow — `sport-biathlon`, `sport-f1`, … They are what turns a
	// follow into a WHOLESALE sport follow (see ssProfileToInterests).
	if (id.startsWith('sport-')) return 'sport';
	return 'athlete';
}

// ---------------------------------------------------------------------------
// WP-162 — one-time re-grounding of edition-stamped rule ids.
// ---------------------------------------------------------------------------

/** Map every published `altIds` entry → its canonical entity. The server keeps a
 *  renamed competition's former ids on the entity (build-entities.js
 *  `canonicalizeEditions`), so an existing rule can be re-pointed instead of
 *  quietly dying when next season's id lands. */
function ssCanonicalIdMap(entities) {
	const map = new Map();
	for (const e of entities || []) {
		for (const alt of (e && e.altIds) || []) if (alt && alt !== e.id) map.set(alt, e);
	}
	return map;
}

/** WP-162 — re-ground the profile's rules against the CURRENT entity index.
 *  A rule whose entityId is now an `altIds` entry is moved onto the canonical id
 *  (tombstoning the old id so the move REPLICATES rather than duplicating across
 *  devices — the CRDT keys on entityId, and iOS `ProfileIdMigration` performs the
 *  byte-same move, so two devices converge on one rule instead of two).
 *
 *  Contract, deliberately conservative:
 *    • LOSSLESS  — a rule that cannot be re-grounded is left EXACTLY as it is
 *                  (it keeps working as a name-based follow); nothing is dropped.
 *    • IDEMPOTENT— a second run finds nothing to do and returns null.
 *    • MERGING   — if the canonical id is already followed, the old rule is only
 *                  tombstoned (no duplicate row), keeping the existing follow.
 *  Returns the new state, or null when nothing changed. */
function ssMigrateProfileIds(state, entities, nowIso, deviceID) {
	const canonical = ssCanonicalIdMap(entities);
	if (!canonical.size) return null;
	const live = ssLiveRules(state);
	if (!live.length) return null;
	const liveIds = new Set(live.map((r) => r.entityId));
	let changed = false;
	const next = [];
	for (const rule of live) {
		const target = canonical.get(rule.entityId);
		if (!target) { next.push(rule); continue; }
		changed = true;
		if (liveIds.has(target.id)) continue; // already followed under the canonical id → just drop the stale one
		next.push(Object.assign({}, rule, {
			entityId: target.id,
			entityName: target.name || rule.entityName,
			sport: target.sport || rule.sport,
			kind: rule.kind || target.type || ssInferKind(target.id),
		}));
		liveIds.add(target.id);
	}
	if (!changed) return null;
	const now = nowIso || ssIsoSeconds(new Date().toISOString());
	return ssUpdatingRules(state, next, now, deviceID || 'web-migration');
}

/** Load → migrate → persist, once per page load. Returns the (possibly migrated)
 *  state; a no-op migration performs no write and causes no merge churn. */
function ssProfileMigrateStored(entities, nowIso) {
	const state = ssProfileLoad();
	const migrated = ssMigrateProfileIds(state, entities, nowIso, ssDeviceId());
	return migrated ? ssProfileSave(migrated) : state;
}

// ---------------------------------------------------------------------------
// Store — localStorage-backed (ss-profile / ss-device-id).
// ---------------------------------------------------------------------------

function ssProfileLoad() {
	try {
		const raw = localStorage.getItem(SS_PROFILE_KEY);
		if (!raw) return ssEmptyState();
		const parsed = JSON.parse(raw);
		return ssDeduplicateState(parsed);
	} catch { return ssEmptyState(); }
}

function ssProfileSave(state) {
	try {
		const norm = ssNormalizeState(state);
		// Dates to second precision so the stored form is Swift-byte-compatible.
		localStorage.setItem(SS_PROFILE_KEY, ssStableStringify(ssIsoState(norm)));
		return norm;
	} catch { return state; }
}

/** Deep-map every ISO date field in a state to second precision (for export). */
function ssIsoState(s) {
	const rule = (r) => Object.assign({}, r, { modifiedAt: ssIsoSeconds(r.modifiedAt), rule: Object.assign({}, r.rule, { addedAt: ssIsoSeconds(r.rule.addedAt) }) });
	const note = (n) => Object.assign({}, n, { createdAt: ssIsoSeconds(n.createdAt), resolvedAt: n.resolvedAt ? ssIsoSeconds(n.resolvedAt) : n.resolvedAt });
	const fact = (f) => Object.assign({}, f, { updatedAt: ssIsoSeconds(f.updatedAt) });
	return { rules: (s.rules || []).map(rule), episodic: (s.episodic || []).map(note), counters: s.counters || [], facts: (s.facts || []).map(fact) };
}

function ssDeviceId() {
	try {
		let id = localStorage.getItem(SS_DEVICE_KEY);
		if (!id) {
			const rnd = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
			id = 'web-' + rnd;
			localStorage.setItem(SS_DEVICE_KEY, id);
		}
		return id;
	} catch { return 'web-ephemeral'; }
}

function ssStateIsEmpty(state) {
	return !state || (!(state.rules || []).some((r) => !r.deleted) && !(state.facts || []).some((f) => !f.deleted));
}

/** Follow an entity (add/replace a live rule) — persists + returns the new state. */
function ssProfileFollow(entity, nowIso) {
	const now = nowIso || ssIsoSeconds(new Date().toISOString());
	const state = ssProfileLoad();
	const live = ssLiveRules(state).filter((r) => r.entityId !== entity.entityId);
	live.push({
		entityId: entity.entityId,
		entityName: entity.entityName || entity.entityId,
		sport: entity.sport || '',
		scope: entity.scope || null,
		weight: entity.weight == null ? 0.5 : entity.weight,
		reason: entity.reason || 'Fulgt fra web',
		addedAt: now,
		lens: { sportAsSuch: {} },
		kind: entity.kind || ssInferKind(entity.entityId),
	});
	return ssProfileSave(ssUpdatingRules(state, live, now, ssDeviceId()));
}

/** Unfollow an entity (tombstone its rule) — persists + returns the new state. */
function ssProfileUnfollow(entityId, nowIso) {
	const now = nowIso || ssIsoSeconds(new Date().toISOString());
	const state = ssProfileLoad();
	const live = ssLiveRules(state).filter((r) => r.entityId !== entityId);
	return ssProfileSave(ssUpdatingRules(state, live, now, ssDeviceId()));
}

/** Is this entity currently followed (a live, non-tombstoned rule)? */
function ssProfileFollows(entityId) {
	return ssLiveRules(ssProfileLoad()).some((r) => r.entityId === entityId);
}

// ---------------------------------------------------------------------------
// Codec — QR / deep-link / CloudKit snapshot payload (twin of ProfileShareCodec).
// Apple `.zlib` == RAW DEFLATE → deflate-raw / inflate-raw. Async (CompressionStream).
// ---------------------------------------------------------------------------

const SS_PROFILE_SCHEME = 'sportivista';
const SS_PROFILE_VERSION = 1;

function ssBase64UrlEncode(bytes) {
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function ssBase64UrlDecode(str) {
	const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function ssDeflateRaw(bytes) {
	const cs = new CompressionStream('deflate-raw');
	const stream = new Response(new Blob([bytes]).stream().pipeThrough(cs));
	return new Uint8Array(await stream.arrayBuffer());
}
async function ssInflateRaw(bytes) {
	const ds = new DecompressionStream('deflate-raw');
	const stream = new Response(new Blob([bytes]).stream().pipeThrough(ds));
	return new Uint8Array(await stream.arrayBuffer());
}

/** state -> compact URL-safe payload string (deflate-raw(base64url(canonical JSON))). */
async function ssProfileEncode(state) {
	const json = ssStableStringify(ssIsoState(ssNormalizeState(state)));
	const compressed = await ssDeflateRaw(new TextEncoder().encode(json));
	return ssBase64UrlEncode(compressed);
}

/** payload string -> state. Throws 'malformed' on bad base64/deflate/JSON. */
async function ssProfileDecode(payload) {
	let json;
	try {
		const inflated = await ssInflateRaw(ssBase64UrlDecode(payload));
		json = new TextDecoder().decode(inflated);
	} catch { throw new Error('malformed'); }
	let state;
	try { state = JSON.parse(json); } catch { throw new Error('malformed'); }
	return ssDeduplicateState(state);
}

/** Parse a full sportivista://profile?v=1&d=… link, an https …#profile=… /?d=… link,
 *  or a bare payload — returns the payload string, else throws. */
function ssProfileParseLink(input) {
	const s = String(input || '').trim();
	if (!s) throw new Error('empty');
	// Custom scheme or https with a query/hash carrying the payload.
	const tryUrl = (u) => {
		try {
			const url = new URL(u);
			const v = url.searchParams.get('v');
			if (v && Number(v) > SS_PROFILE_VERSION) throw new Error('unsupportedVersion');
			const d = url.searchParams.get('d') || url.searchParams.get('profile');
			if (d) return d;
			const hash = (url.hash || '').replace(/^#/, '');
			const hp = new URLSearchParams(hash);
			return hp.get('profile') || hp.get('d') || null;
		} catch (e) { if (e.message === 'unsupportedVersion') throw e; return null; }
	};
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s) || s.startsWith(SS_PROFILE_SCHEME + '://')) {
		const d = tryUrl(s);
		if (d) return d;
	}
	if (s.startsWith('#') || s.includes('=')) {
		const hp = new URLSearchParams(s.replace(/^[#?]/, ''));
		const d = hp.get('profile') || hp.get('d');
		if (d) return d;
	}
	return s; // bare payload
}

/** Import a payload/link: decode → MERGE into the local profile → persist. Returns
 *  {added, removed} counts for a calm status line. Throws 'empty' on nothing to add. */
async function ssProfileImport(payloadOrLink) {
	const payload = ssProfileParseLink(payloadOrLink);
	const incoming = await ssProfileDecode(payload);
	if (ssStateIsEmpty(incoming) && !(incoming.episodic || []).length && !(incoming.counters || []).length) throw new Error('empty');
	const before = ssProfileLoad();
	const beforeLive = new Set(ssLiveRules(before).map((r) => r.entityId));
	const { merged } = ssProfileMerge(before, incoming);
	const saved = ssProfileSave(merged);
	const afterLive = new Set(ssLiveRules(saved).map((r) => r.entityId));
	let added = 0, removed = 0;
	for (const id of afterLive) if (!beforeLive.has(id)) added++;
	for (const id of beforeLive) if (!afterLive.has(id)) removed++;
	return { added, removed, state: saved };
}

// Node/vitest interop — the browser ignores this.
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		ssEmptyState, ssNormalizeState, ssDeduplicateState, ssProfileMerge, ssPushIsEmpty,
		ssPickNewerRule, ssPickNewerFact, ssReconcileNote, ssCounterMerge,
		ssRulePayloadKey, ssFactPayloadKey, ssLensToken, ssStableStringify, ssDeepEqual,
		ssUpdatingRules, ssLiveRules, ssProfileToInterests, ssInferKind, ssRuleKind,
		ssProfileLoad, ssProfileSave, ssDeviceId, ssStateIsEmpty,
		ssCanonicalIdMap, ssMigrateProfileIds, ssProfileMigrateStored,
		ssProfileFollow, ssProfileUnfollow, ssProfileFollows,
		ssProfileEncode, ssProfileDecode, ssProfileParseLink, ssProfileImport,
		ssBase64UrlEncode, ssBase64UrlDecode, ssIsoSeconds,
	};
}
