//
//  AgendaViewModel.swift
//  Sportivista
//
//  WP-14 — the agenda's data pipeline: DataStore → FeedEvent-bridge →
//  FeedCompiler.compile() → day sections, exactly the chain the WP-14 brief
//  specifies. Split, like the rest of this codebase (FeedCompiler's
//  predicates, BackgroundRefreshScheduling vs. …Scheduler), into a PURE core
//  (`buildSections`, a static function of three plain values — no disk, no
//  clock read) and a thin instance wrapper (`reloadFromCache`/`refresh`) that
//  touches DataStore/SyncClient. AgendaViewModelTests drives `buildSections`
//  directly with hand-built `[Event]`/`Interests` fixtures; nothing here
//  needs a running app to test.
//
//  `@MainActor`: this is a UI-facing view model whose `sections`/`lastSync`
//  drive SwiftUI directly, constructed and read from ContentView/AgendaView
//  (both implicitly main-actor). Under Swift 6 strict concurrency, an
//  `async` instance method on a plain, non-Sendable class can't be safely
//  called from a main-actor context (calling it would require "sending" a
//  non-Sendable `self` across an isolation boundary) — pinning the whole
//  type to `@MainActor` removes the crossing entirely, which is also simply
//  correct: this type has no business running off the main actor.
//

import Foundation
import Observation

@MainActor
@Observable
final class AgendaViewModel {
    private(set) var sections: [AgendaSection] = []
    /// Ongoing events, for the quiet "live now" line under the header
    /// (DESIGN.md §4). Empty when nothing is live — the view hides the line.
    private(set) var liveNow: [AgendaLiveRow] = []
    private(set) var lastSync: Date?
    /// WP-31 — whether the local follow-profile is empty (e.g. onboarding was
    /// skipped). Drives the agenda's empty state: an empty board with an empty
    /// profile points back at the command line ("fortell Sportivista hva du følger")
    /// rather than reading as "nothing on".
    private(set) var profileIsEmpty: Bool = true
    /// WP-203 — the distinct sports the profile's rules follow, in rule order.
    /// Feeds the season-honest empty state: an empty board where EVERYTHING
    /// followed is a known off-season sport gets «utenfor sesong — tavla fylles
    /// fra …» instead of the generic "nothing right now" (SeasonCalendar).
    private(set) var followedSports: [String] = []

    /// WP-67 — the EPHEMERAL presentation filter («vis bare golf denne uka»).
    /// nil ⇒ no filter (the board shows everything). NEVER persisted, never a
    /// profile change: it is a pure view layer over the already-compiled
    /// `sections` (`displayedSections` applies it), so the five predicates and
    /// the golden vectors are untouched. Set by the assistant's present arm via
    /// `applyFilter`, cleared by the filter line's one-tap ✕.
    private(set) var filter: AgendaFilter?

    private let dataStore: DataStore
    private let syncClient: SyncClient
    /// WP-16.4 — the SAME local profile the assistant edits. Folded into the
    /// synced interests on every recompile, so a just-confirmed "Følg X" shows
    /// up on the board immediately ("umiddelbar konsekvens"). Shared instance
    /// with AssistantViewModel via ContentView.
    private let profileStore: ProfileStore
    /// WP-121 — the post-sync freshness step (widget reload + notification
    /// reconcile). Pull-to-refresh re-synced + recompiled the board but NEVER
    /// reconciled reminders nor nudged the widget (audit 🔴/🟡); `refresh()` now
    /// runs it, so a moved event refreshes the push and the widget on a manual
    /// pull too — not only at cold start. Shared with ContentView (same planner +
    /// widget reloader instances) so every sync path behaves identically.
    private let freshness: SyncFreshness

    // MARK: - WP-60 — off-main reload plumbing

    /// The single in-flight reload. `reloadFromCache` starts one and coalesces
    /// every further request that lands while it runs into ONE trailing recompile
    /// (so a burst of N rapid profile changes never fans out into N recompiles).
    /// nil means "nothing running" — the next request starts fresh.
    private var reloadTask: Task<Void, Never>?
    /// The `now` of the most recent request that arrived while a reload was in
    /// flight. When the running reload finishes it recompiles once more against
    /// this (the latest state) rather than painting the now-stale result — "siste
    /// vinner", with only one compute ever running at a time.
    private var pendingReloadNow: Date?
    /// WP-60 — the decoded entity index, cached across reloads. `entities.json`
    /// only changes on a sync (which calls `invalidateEntityCache`), so profile
    /// toggles reuse this instead of rebuilding the by-id map + resolver substrate
    /// every time. nil = rebuild on the next reload.
    private var cachedEntityIndex: EntityIndex?
    /// WP-60 — how many times the compile pipeline has actually run. The proof
    /// that a burst of rapid `reloadFromCache` calls coalesces to ≤2 recompiles
    /// (AgendaReloadConcurrencyTests reads this). Incremented on the main actor,
    /// once per compute the running reload performs.
    private(set) var recompileCount = 0

    init(dataStore: DataStore = DataStore(), syncClient: SyncClient = SyncClient(), profileStore: ProfileStore = ProfileStore(), freshness: SyncFreshness = SyncFreshness()) {
        self.dataStore = dataStore
        self.syncClient = syncClient
        self.profileStore = profileStore
        self.freshness = freshness
    }

    /// Shows whatever is already cached immediately, then syncs and
    /// recompiles — the same "never blank while the network round-trip is in
    /// flight" shape ContentView used pre-WP-14 (WP-12), now driving the real
    /// agenda instead of a placeholder row + event count.
    func refresh(now: Date = Date()) async {
        reloadFromCache(now: now)
        // WP-121: snapshot events BEFORE the sync so a moved/added/removed event
        // can be diffed after it — pull-to-refresh must keep reminders + the
        // widget as fresh as the cold-start path does.
        let previousEvents = dataStore.loadEvents()
        // WP-176: the same before/after discipline for results — a contest that
        // finished between the two snapshots is what a fulltidsvarsel is about.
        let previousResults = dataStore.loadRecentResults()
        let result = await syncClient.sync()
        // WP-60: a sync may have rewritten entities.json — drop the cached index
        // so the post-sync reload rebuilds it from fresh data.
        invalidateEntityCache()
        reloadFromCache(now: now)
        // WP-121: reload the widget (events/entities changed) + reconcile
        // reminders (events changed), the SAME gates the cold-start path uses.
        // A 304/no-op sync decides to do neither, so a pull that finds nothing
        // new is free of both. Planning/diff semantics are unchanged.
        await freshness.run(
            result: result,
            previousEvents: previousEvents,
            newEvents: dataStore.loadEvents(),
            interests: dataStore.loadInterests() ?? Interests(),
            lastSync: dataStore.lastSync,
            now: now,
            leadTimeEnabled: NotificationLeadPreference.isLeadTimeEnabled(),
            resultInputs: resultInputs(previousResults: previousResults)
        )
        // Pull-to-refresh awaits this method — end the spinner only once the
        // recompiled board is actually applied (not merely scheduled).
        await awaitReloadsQuiescent()
    }

    /// WP-176 — the result half of the post-sync freshness step: the profile, the
    /// entity list, the spoiler shield (from the SAME profile file the board's own
    /// shield comes from), and the per-device fulltidsvarsel opt-in. Built here
    /// because the view model already owns the profile store; `SyncFreshness`
    /// itself stays a pure orchestrator over plain values.
    private func resultInputs(previousResults: RecentResults) -> SyncFreshness.ResultInputs {
        let syncState = profileStore.loadSyncState()
        return SyncFreshness.ResultInputs(
            previousResults: previousResults,
            newResults: dataStore.loadRecentResults(),
            profile: syncState.profile,
            entities: dataStore.loadEntities(),
            shield: SpoilerShield(memory: MemoryState(from: syncState)),
            optedIn: ResultAlertPreference.optedInEntityIds(),
            alreadyDelivered: Set(ResultAlertPreference.deliveredIds())
        )
    }

    /// Recompiles from whatever DataStore currently has cached, with no network
    /// access — pull-to-refresh's completion, the initial "show cache first"
    /// step, and every `onProfileChanged` all call this.
    ///
    /// WP-60: the heavy work (cache read + JSON decode + `buildSections`) runs
    /// OFF the main actor (`computeReload` is `nonisolated async`), and we hop
    /// back to `@MainActor` only to assign the results — this is the likely fix
    /// for the hang the owner saw (disk I/O + decode + compile were running on
    /// the main actor). Requests are COALESCED: only one compute runs at a time,
    /// and a request that arrives mid-compute schedules exactly one trailing
    /// recompile against the latest state ("siste vinner"). The pure core
    /// (`buildSections`/`liveRows`) and every field it reads are unchanged, so
    /// the output — including the golden vectors — is byte-for-byte identical.
    func reloadFromCache(now: Date = Date()) {
        guard reloadTask == nil else {
            // A reload is already running — remember to recompile once more with
            // the latest state when it finishes, and return. This is what keeps a
            // burst of rapid onProfileChanged calls (the starter-pack scenario) to
            // ≤2 recompiles.
            pendingReloadNow = now
            return
        }
        startReload(now: now)
    }

    /// Invalidate the cached entity index so the next reload rebuilds it from
    /// disk. Call after a sync that may have rewritten `entities.json`.
    func invalidateEntityCache() { cachedEntityIndex = nil }

    // MARK: - WP-67 — presentation filter (a pure view layer)

    /// Apply (or clear) the EPHEMERAL presentation filter. No recompile, no
    /// disk, no profile write — just swaps the view layer `displayedSections`
    /// runs through. An empty/nil filter clears it (the «vis alt igjen» reset).
    /// `@Observable` picks up the change, so the board + the filter line update.
    func applyFilter(_ filter: AgendaFilter?) {
        self.filter = (filter?.isEmpty ?? true) ? nil : filter
    }

    /// The sections actually shown: `sections` narrowed by `filter` (identity
    /// when no filter is set). Pure post-processing over the compiled board — the
    /// five predicates / golden vectors are never touched (they produce
    /// `sections`; this only hides rows from the view).
    var displayedSections: [AgendaSection] {
        Self.applyFilter(filter, to: sections, now: Date())
    }

    /// Await any in-flight (coalesced) reload — pull-to-refresh and tests use
    /// this to wait until the board has actually been recompiled and applied.
    func awaitReloadsQuiescent() async {
        while let task = reloadTask { await task.value }
    }

    /// Drives the coalescing loop on the main actor: increment the recompile
    /// counter, run the heavy pipeline off-main, then either supersede (a newer
    /// request arrived) or apply the result. Exactly one of these loops runs at
    /// a time (guarded by `reloadTask == nil` in `reloadFromCache`).
    private func startReload(now: Date) {
        reloadTask = Task { @MainActor in
            var current = now
            while true {
                self.recompileCount &+= 1
                let cached = self.cachedEntityIndex
                let result = await Self.computeReload(
                    now: current, dataStore: self.dataStore,
                    profileStore: self.profileStore, cachedIndex: cached
                )
                // Paint EVERY finished round (eier-funn 19.07: the old
                // discard-and-recompute left «Henter data …» up until the LAST
                // queued round finished — on device that was the whole first
                // compile thrown away). "Siste vinner" still holds: a queued
                // newer round recomputes and re-applies right after.
                self.apply(result)
                if let next = self.pendingReloadNow {
                    self.pendingReloadNow = nil
                    current = next
                    continue
                }
                break
            }
            self.reloadTask = nil
        }
    }

    /// Assigns a finished reload's results — the ONLY place the published state
    /// is written, always on the main actor.
    private func apply(_ result: Reload) {
        LaunchTrace.point("agenda apply (rows=\(result.sections.reduce(0) { $0 + $1.items.count }), lastSync=\(result.lastSync != nil))")
        sections = result.sections
        liveNow = result.liveNow
        lastSync = result.lastSync
        profileIsEmpty = result.profileIsEmpty
        followedSports = result.followedSports
        cachedEntityIndex = result.index
        liveSnapshot = (result.liveEvents, result.liveInterests)
    }

    /// WP-126 — the snapshot the live line re-derives from on the display's minute
    /// tick (`currentLiveRows`). Set on every applied reload.
    private var liveSnapshot: (events: [Event], interests: Interests)?

    /// WP-126 — the live line re-derived against `now`, the display's minute tick
    /// (ContentView wraps the line in `TimelineView(.everyMinute)`). Uses the SAME
    /// pure `liveRows` the reload used, so it is bit-identical at reload time and
    /// merely stays TRUE between reloads — a finished event drops, a just-started
    /// one appears. Falls back to the last reload's `liveNow` before the first
    /// snapshot exists.
    func currentLiveRows(now: Date = Date()) -> [AgendaLiveRow] {
        guard let snap = liveSnapshot else { return liveNow }
        return Self.liveRows(events: snap.events, interests: snap.interests, now: now)
    }

    /// Everything one reload produces, computed off-main and handed to `apply`
    /// in a single main-actor hop.
    struct Reload {
        var sections: [AgendaSection]
        var liveNow: [AgendaLiveRow]
        var lastSync: Date?
        var profileIsEmpty: Bool
        /// WP-203 — distinct sports the profile follows (rule order), for the
        /// season-honest empty state.
        var followedSports: [String] = []
        /// The index the compute used (the cached one, or a freshly built one) —
        /// stored back so the next reload reuses it.
        var index: EntityIndex
        /// WP-126 — the events + interests the live line re-derives from between
        /// reloads (the display's minute tick), so a finished event drops and a
        /// just-started one appears without waiting for the next sync.
        var liveEvents: [Event]
        var liveInterests: Interests
    }

    /// The off-main entry: `nonisolated async` so awaiting it from the main actor
    /// runs the body on the cooperative pool and transfers the fresh result back.
    /// Delegates to the synchronous, DEBUG-guarded `computeReloadSync`.
    nonisolated static func computeReload(now: Date, dataStore: DataStore, profileStore: ProfileStore, cachedIndex: EntityIndex?) async -> sending Reload {
        computeReloadSync(now: now, dataStore: dataStore, profileStore: profileStore, cachedIndex: cachedIndex)
    }

    /// The agenda reload pipeline: cache read → JSON decode → `buildSections` /
    /// `liveRows`. WP-60 keeps this OFF the main actor; the `MainThreadGuard`
    /// below trips in DEBUG if a regression ever runs it on main (proven by
    /// AgendaReloadConcurrencyTests). `loadInterests()` (WP-15) returns `nil`
    /// when interests.json has never synced or is corrupt; `?? Interests()` falls
    /// back to FeedCompiler's own default `followBroadly` list so the agenda is
    /// never blank just because interests.json hasn't synced yet.
    nonisolated static func computeReloadSync(now: Date, dataStore: DataStore, profileStore: ProfileStore, cachedIndex: EntityIndex?) -> sending Reload {
        MainThreadGuard.assertOffMain("AgendaViewModel reload (cache read + JSON decode + compile)")
        // WP-63: os_signpost the WP-60 hotpath so a real on-device stall surfaces
        // in Instruments (Points of Interest, Subsystem "app.sportivista.perf") as three
        // named phases — load / index / compile — inside an outer `reload`, instead
        // of one opaque main-thread blob. Pure observation: the intervals wrap the
        // SAME work in the SAME order, so the golden vectors stay bit-identical.
        // The outer `reload` interval OVERLAPS the inner load/index/compile ones,
        // so it gets its own signpost id; the inner three never overlap each other
        // (sequential), so the default `.exclusive` id is fine for them.
        let signposter = PerfSignpost.reload
        let reloadID = signposter.makeSignpostID()
        let reloadState = signposter.beginInterval("reload", id: reloadID)
        defer { signposter.endInterval("reload", reloadState) }

        // WP-63 `load` — cache read + JSON decode. WP-60: decode the profile file
        // ONCE. The follow-profile and personal memory both live in the same
        // on-disk ProfileSyncState — reading it a single time here removes the
        // double decode (was `profileStore.load()` PLUS
        // `MemoryStore(profileStore:).load()`, each decoding the same file).
        let events: [Event]
        let baseInterests: Interests
        var syncState: ProfileSyncState
        do {
            let loadState = signposter.beginInterval("load")
            let _tl = CFAbsoluteTimeGetCurrent()
            defer { signposter.endInterval("load", loadState); LaunchTrace.mark("reload/load", since: _tl) }
            events = dataStore.loadEvents()
            baseInterests = dataStore.loadInterests() ?? Interests()
            syncState = profileStore.loadSyncState()
        }
        // WP-63 `index` — the EntityIndex build (entities.json decode + resolver
        // substrate). WP-60: reuse the cached entity index when present
        // (entities.json only changes on a sync, which invalidates the cache)
        // instead of rebuilding it on every reload/toggle — a cache hit shows here
        // as a near-zero interval.
        let index: EntityIndex
        do {
            let indexState = signposter.beginInterval("index")
            let _ti = CFAbsoluteTimeGetCurrent()
            defer { signposter.endInterval("index", indexState); LaunchTrace.mark("reload/index (cached=\(cachedIndex != nil))", since: _ti) }
            index = cachedIndex ?? EntityIndex(dataStore.loadEntities())
        }

        // WP-162 — re-ground rules still frozen on a FORMER (edition-stamped)
        // entity id onto the canonical one, once, the moment the new index
        // arrives. Idempotent and lossless: a normal reload finds nothing to do
        // and writes nothing (see ProfileIdMigration).
        if let migrated = ProfileIdMigration.migrate(syncState, index: index, now: now, deviceID: profileStore.deviceID) {
            try? profileStore.saveSyncState(migrated)
            syncState = migrated
        }
        let profile = syncState.profile

        // WP-16.4: fold the local profile in, so the board reflects what the
        // assistant just changed — this is the visible half of "Bekreft →
        // agendaen re-kompileres synlig med det samme".
        let interests = EffectiveInterests.merge(profile: profile, into: baseInterests, index: index)
        let followedIds = Set(profile.rules.map(\.entityId))
        // WP-30: the spoiler shield from personal memory (same shared profile
        // file). A pure PRESENTATION layer — it masks result/score at display
        // time and never touches the five predicates / golden vectors.
        let shield = SpoilerShield(memory: MemoryState(from: syncState))

        // WP-63 `compile` — FeedCompiler + section building + the live-now scan,
        // the CPU half of the hotpath. WP-18: the raw profile is passed ALONGSIDE
        // the merged interests because EffectiveInterests.merge folds a rule's
        // entity into the tracked buckets but drops its `lens` — and the lens is
        // exactly what the lens-rendering layer needs. So the merged `interests`
        // drive the five predicates (unchanged), and `profile` carries the per-rule
        // lens on top.
        let sections: [AgendaSection]
        let liveNow: [AgendaLiveRow]
        do {
            let compileState = signposter.beginInterval("compile")
            let _tc = CFAbsoluteTimeGetCurrent()
            defer { LaunchTrace.mark("reload/compile", since: _tc) }
            defer { signposter.endInterval("compile", compileState) }
            sections = buildSections(events: events, interests: interests, now: now, index: index, followedIds: followedIds, profile: profile, shield: shield)
            liveNow = liveRows(events: events, interests: interests, now: now)
        }
        return Reload(
            sections: sections, liveNow: liveNow, lastSync: dataStore.lastSync,
            profileIsEmpty: profile.isEmpty,
            followedSports: Self.distinctSports(profile),
            index: index,
            liveEvents: events, liveInterests: interests
        )
    }

    // MARK: - Pure core

    /// WP-203 — the distinct sports a profile's rules follow, in rule order.
    /// Pure; feeds the season-honest empty state via `followedSports`.
    nonisolated static func distinctSports(_ profile: InterestProfile) -> [String] {
        var seen = Set<String>()
        return profile.rules.map(\.sport).filter { seen.insert($0).inserted }
    }

    /// DataStore → FeedEvent-bridge → FeedCompiler.compile() → Europe/Oslo
    /// day sections. A pure function of its three inputs, per the file
    /// header above. `nonisolated` deliberately opts this (and `makeItem`
    /// below) OUT of the class's `@MainActor` isolation — it touches no
    /// instance/main-actor state at all, and AgendaViewModelTests calls it
    /// directly, synchronously, with no actor hop.
    /// WP-16.4: `index` + `followedIds` are optional (default empty) so the
    /// WP-14 unit tests that call this with just events/interests/now still
    /// compile — they simply produce empty `whyShown`/`followable`, which the
    /// agenda row itself doesn't display (those feed the detail sheet's context
    /// actions). The real app always passes them (see `reloadFromCache`).
    /// WP-18: `profile` (default empty) carries the per-rule LENS. Lens
    /// rendering is a pure post-processing layer over FeedCompiler's output —
    /// it runs AFTER relevance/must-see/must-watch/collapse (those five
    /// predicates are never touched; the golden vectors stay bit-identical) and
    /// can re-home a row to the athlete's own effective (tee) time. An empty
    /// profile, or a profile with only default (`.sportAsSuch`) lenses, leaves
    /// the output byte-for-byte identical to WP-16.4 — graceful degradation.
    nonisolated static func buildSections(events: [Event], interests: Interests, now: Date, index: EntityIndex = EntityIndex([]), followedIds: Set<String> = [], profile: InterestProfile = InterestProfile(), shield: SpoilerShield = SpoilerShield()) -> [AgendaSection] {
        let _tb = CFAbsoluteTimeGetCurrent()
        // WP-185 — the row avatar's lookup, built ONCE per compile from the entity
        // index we already have, and only over entities that carry identity
        // metadata. O(1) per row afterwards: resolving each row through
        // EntityIndex's fuzzy scorer instead would be a linear pass over ~3 700
        // entities PER ROW — the at-scale trap WP-161 already paid for once.
        let identityIndex = EntityIdentityIndex(index.entities)
        let (feedEvents, lookup) = EventBridge.bridge(events)
        LaunchTrace.mark("compile/bridge", since: _tb)
        let _tf = CFAbsoluteTimeGetCurrent()
        let feed = FeedCompiler.compile(events: feedEvents, interests: interests, now: now)
        LaunchTrace.mark("compile/feedcompiler", since: _tf)
        // WP-61: one memo per compile, shared by every row's `followableEntities`
        // so a recurring team/tournament name resolves once, not once per row.
        let nameCache = NameResolveCache()
        let todayKey = FeedCompiler.osloDayKey(now)
        let tomorrowKey = FeedCompiler.osloDayKey(now.addingTimeInterval(24 * 60 * 60))

        // A placed row: one agenda item pinned to a day key + a sort time. The
        // lens layer can emit MULTIPLE rows for one event, each re-homed to the
        // athlete's OWN effective day/time (P320: the tee time overrides sort,
        // day-grouping AND display) — hence a flat placed-list plus a re-group,
        // rather than mapping FeedCompiler's day buckets in place.
        struct Placed { let dayKey: String; let sortTime: Date?; let item: AgendaItem }
        var placed: [Placed] = []
        let _tr = CFAbsoluteTimeGetCurrent()

        for day in feed.days {
            for compiled in day.items {
                guard case .event(let feedEvent, let mustWatch, let mustSee) = compiled else {
                    // Series rows never lens (they are already the collapsed,
                    // athlete-agnostic view) — pass through on their own day.
                    if let item = makeItem(compiled, lookup: lookup, interests: interests, now: now, index: index, identityIndex: identityIndex, followedIds: followedIds, shield: shield, cache: nameCache) {
                        placed.append(Placed(dayKey: day.key, sortTime: compiled.time, item: item))
                    }
                    continue
                }
                guard let id = feedEvent.id, let event = lookup[id] else { continue }
                let mode = applicableLensMode(for: feedEvent, event: event, profile: profile, index: index)
                if let lensRows = LensRenderer.render(event: event, mode: mode, followedIds: followedIds) {
                    // Lens rows inherit the event's bell/accent (item 2 of the
                    // brief) and re-home to the athlete's effective day/time.
                    for lensRow in lensRows {
                        let (dayKey, sortTime) = place(lensRow, event: feedEvent, compiledDay: day.key, todayKey: todayKey)
                        let row = makeLensRow(lensRow, event: event, feedEvent: feedEvent, mustWatch: mustWatch, mustSee: mustSee, interests: interests, now: now, index: index, identityIndex: identityIndex, followedIds: followedIds, shield: shield, cache: nameCache)
                        placed.append(Placed(dayKey: dayKey, sortTime: sortTime, item: .event(row)))
                    }
                } else if let item = makeItem(compiled, lookup: lookup, interests: interests, now: now, index: index, identityIndex: identityIndex, followedIds: followedIds, shield: shield, cache: nameCache) {
                    // No lens applies → the ordinary WP-16.4 row, untouched.
                    placed.append(Placed(dayKey: day.key, sortTime: feedEvent.time, item: item))
                }
            }
        }

        LaunchTrace.mark("compile/rows (n=\(placed.count))", since: _tr)
        // WP-124 — cap the display window at 14 days forward, mirroring the web
        // agenda 1:1 (dashboard.js `agendaDayGroups`: `maxHorizon = now + 14 *
        // MS_PER_DAY`, `isEventInWindow(e, start, maxHorizon)`). events.json runs
        // ~42 days; the web board hard-caps at 14 d and iOS Uka never did — so a
        // long tail could bloat Uka and duplicate Nyheter-FREMOVER. Both surfaces
        // now PARTITION the horizon: Uka ≤ 14 d, Nyheter-FREMOVER owns beyond
        // (NewsBoard.forwardHorizonDays = 14; owner decision 20.07). This is a
        // pure DISPLAY window — the five predicates / FeedCompiler / golden vectors
        // are untouched (FeedVectorTests still passes bit-for-bit; it exercises the
        // predicates, not this grouping). isEventInWindow's UPPER bound depends
        // only on the start (`e.time < maxHorizon`), so a `sortTime` cut mirrors it
        // exactly: a still-running multi-day event keeps its past start time (< the
        // horizon) and stays; a future event starting past day 14 drops out here
        // and reappears under Nyheter-FREMOVER. sortTime == nil never happens for
        // relevant events (FeedCompiler requires a time) — kept, since it groups
        // under today, well inside the window.
        let maxHorizon = now.addingTimeInterval(14 * 24 * 60 * 60)
        var order: [String] = []
        var byDay: [String: [Placed]] = [:]
        for p in placed where p.dayKey >= todayKey && (p.sortTime.map { $0 < maxHorizon } ?? true) {
            if byDay[p.dayKey] == nil { order.append(p.dayKey) }
            byDay[p.dayKey, default: []].append(p)
        }
        return order.sorted().map { key in
            AgendaSection(
                id: key,
                label: AgendaFormat.dayLabel(key: key, todayKey: todayKey, tomorrowKey: tomorrowKey),
                items: (byDay[key] ?? [])
                    .sorted { ($0.sortTime ?? .distantPast) < ($1.sortTime ?? .distantPast) }
                    .map(\.item)
            )
        }
    }

    // MARK: - WP-67 presentation filter (pure view layer over compiled sections)

    /// Narrow compiled `sections` by an ephemeral `filter`. PURE — a function of
    /// its three inputs, no disk/clock/state — so it is unit-tested directly and
    /// never touches the five predicates (the golden vectors compile `sections`;
    /// this only hides rows from the view). Identity when the filter is nil/empty.
    /// A section survives when its day is in the filter's window AND it still has
    /// at least one item matching the subject (sport/entity); an emptied section
    /// is dropped whole (no blank day headers).
    nonisolated static func applyFilter(_ filter: AgendaFilter?, to sections: [AgendaSection], now: Date) -> [AgendaSection] {
        guard let filter, !filter.isEmpty else { return sections }
        return sections.compactMap { section -> AgendaSection? in
            if let window = filter.window, !window.contains(dayKey: section.id, now: now) { return nil }
            guard filter.hasSubjectConstraint else { return section }  // window-only keeps every subject
            let items = section.items.filter { itemMatchesSubject($0, filter: filter) }
            return items.isEmpty ? nil : AgendaSection(id: section.id, label: section.label, items: items)
        }
    }

    /// Whether one agenda item matches the filter's SUBJECT (sport OR entity). A
    /// series row matches when its next stage or any collapsed stage does.
    nonisolated static func itemMatchesSubject(_ item: AgendaItem, filter: AgendaFilter) -> Bool {
        switch item {
        case .event(let row):
            return eventMatchesSubject(row.event, filter: filter)
        case .series(let row):
            return eventMatchesSubject(row.nextStage, filter: filter)
                || row.stages.contains { eventMatchesSubject($0, filter: filter) }
        }
    }

    /// Whether an event matches the filter's sports (canonical tag) or entity ids
    /// (home/away team + Norwegian players). Case-insensitive on the sport tag.
    nonisolated private static func eventMatchesSubject(_ event: Event, filter: AgendaFilter) -> Bool {
        if !filter.sports.isEmpty {
            let sport = event.sport.lowercased()
            if filter.sports.contains(where: { $0.lowercased() == sport }) { return true }
        }
        if !filter.entityIds.isEmpty {
            if let h = event.homeTeamEntityId, filter.entityIds.contains(h) { return true }
            if let a = event.awayTeamEntityId, filter.entityIds.contains(a) { return true }
            if event.norwegianPlayers.contains(where: { $0.entityId.map(filter.entityIds.contains) ?? false }) { return true }
        }
        return false
    }

    // MARK: - Lens rendering (WP-18 — P320: event × deltakelse × linse)

    /// The day + sort time a lens row lands on. The athlete's effective (tee)
    /// time OVERRIDES the event's — but a STALE, past tee time must never
    /// silently drop the whole event, so it only re-homes when the tee day is
    /// today-or-later; otherwise the row keeps the event's own (already
    /// multi-day-re-homed) day and sorts on the event start. An untimed lens row
    /// (no tee time — the honest degradation) always keeps the event's day/time.
    nonisolated private static func place(_ lensRow: LensRenderer.LensRow, event feedEvent: FeedEvent, compiledDay: String, todayKey: String) -> (dayKey: String, sortTime: Date?) {
        if let eff = lensRow.effectiveTime {
            let effDay = FeedCompiler.osloDayKey(eff)
            if effDay >= todayKey { return (effDay, eff) }
        }
        return (compiledDay, feedEvent.time)
    }

    /// The LENS to render an event through: the first followed rule carrying a
    /// non-default lens whose entity actually participates in the event
    /// (`.sportAsSuch` — no lens — when there is none, the common case). Maps
    /// the Assistant `Lens` → the Feed-local `LensMode` the renderer consumes,
    /// so the renderer stays free of the Assistant module (widget-buildable).
    nonisolated static func applicableLensMode(for feedEvent: FeedEvent, event: Event, profile: InterestProfile, index: EntityIndex) -> LensMode {
        let lensed = profile.rules.filter { !$0.lens.isDefault }
        guard !lensed.isEmpty else { return .sportAsSuch }
        let hay = FeedCompiler.serverHaystack(feedEvent)
        for rule in lensed where ruleMatches(rule, event: event, hay: hay, index: index) {
            switch rule.lens {
            case .sportAsSuch:
                continue
            case .throughNorwegians:
                return .throughNorwegians
            case let .throughAthletes(athletes):
                return .throughAthletes(ids: Set(athletes.map(\.entityId)), names: athletes.map(\.name))
            }
        }
        return .sportAsSuch
    }

    /// Whether `rule`'s followed entity participates in `event`: an authoritative
    /// entity-id match on the event's players/teams, else the SAME sport-scoped
    /// name/alias word-boundary test `whyShown`/`mustWatch` use (so a golf
    /// tournament rule matches that tournament's events, a football club rule
    /// its club's matches). Falls back to the rule's cached name/sport when the
    /// entity isn't in the (maybe unsynced) index.
    nonisolated private static func ruleMatches(_ rule: InterestRule, event: Event, hay: String, index: EntityIndex) -> Bool {
        if event.norwegianPlayers.contains(where: { $0.entityId == rule.entityId }) { return true }
        if event.homeTeamEntityId == rule.entityId || event.awayTeamEntityId == rule.entityId { return true }
        let entity = index.entity(id: rule.entityId)
        let sport = entity?.sport ?? rule.sport
        if !sport.isEmpty, TextMatch.normalize(sport) != TextMatch.normalize(event.sport) { return false }
        let terms = entity.map { [$0.name] + $0.aliases } ?? [rule.entityName]
        return terms.contains { !$0.isEmpty && TextMatch.containsName(hay, $0) }
    }

    /// Build the view-ready `AgendaEventRow` for one lens row. The time column
    /// shows the athlete's effective time when present (else the event's own
    /// label — a window for a multi-day tournament); the meta line is the lens's
    /// (status verbatim / names), falling back to the event's tournament only
    /// when the lens carries none. Everything else — channel, bell, accent, AI
    /// provenance, the FULL event for the detail sheet — comes straight from the
    /// event, so the detail sheet still shows the whole event unchanged.
    nonisolated private static func makeLensRow(
        _ lensRow: LensRenderer.LensRow,
        event: Event,
        feedEvent: FeedEvent,
        mustWatch: Bool,
        mustSee: Bool,
        interests: Interests,
        now: Date,
        index: EntityIndex,
        identityIndex: EntityIdentityIndex = EntityIdentityIndex([]),
        followedIds: Set<String>,
        shield: SpoilerShield,
        cache: NameResolveCache? = nil
    ) -> AgendaEventRow {
        let timeLabel = lensRow.effectiveTime.map { AgendaFormat.timeLabel(time: $0, endTime: nil) }
            ?? AgendaFormat.timeLabel(time: feedEvent.time, endTime: feedEvent.endTime)
        let spoilerSafe = shield.spoilerSafe(event: event)
        // WP-30: the lens meta detail is the athlete's status VERBATIM (score /
        // placement) — a spoiler for someone avoiding results. When not safe,
        // fall back to the neutral tournament meta so no outcome leaks into the
        // agenda row (the detail sheet handles the fuller masking + reveal).
        let neutralMeta = AgendaFormat.metaLabel(tournament: event.tournament, title: lensRow.title)
        // WP-147: reshape a golf player-status meta ("R2 · −4 · T8") into calm copy
        // ("Runde 2 · −4") for the row — round written out, leaderboard placement
        // dropped. Non-golf metas and the followed-NAMES degradation pass through
        // unchanged; nil (a bare placement) falls back to the neutral tournament meta.
        let lensMeta = lensRow.metaDetail.flatMap { AgendaFormat.humanizeGolfMeta($0, sport: event.sport) }
        let meta = spoilerSafe ? (lensMeta ?? neutralMeta) : neutralMeta
        return AgendaEventRow(
            id: EventBridge.stableId(for: event) + "|" + lensRow.idSuffix,
            timeLabel: timeLabel,
            title: lensRow.title,
            metaLabel: meta,
            channelLabel: AgendaFormat.channelLabel(event.streaming),
            isMustSee: mustSee,
            mustWatch: mustWatch,
            isAIResearch: event.source == "ai-research",
            event: event,
            whyShown: FeedCompiler.whyShown(feedEvent, interests: interests),
            followable: followableEntities(for: event, index: index, followedIds: followedIds, cache: cache),
            spoilerSafe: spoilerSafe,
            identity: identityIndex.identity(for: event),
            // WP-170: the SAME resolution with nothing filtered out — the entity
            // page must be reachable for a team you already follow too.
            subjects: followableEntities(for: event, index: index, followedIds: [], cache: cache)
        )
    }

    // MARK: - Followable entities (WP-16.4 — the detail sheet's «Følg X»)

    /// The entities this event is ABOUT that the user doesn't already follow —
    /// what a "Følg X" context action can offer. Sources, in order: the event's
    /// own stable entity ids (home/away team, Norwegian players — authoritative
    /// when present), then the home/away team & tournament NAMES resolved
    /// confidently through the index (so "Lyn" offers FK Lyn Oslo even without
    /// an id). De-duplicated, already-followed dropped, capped at three so the
    /// sheet stays calm. Empty when the index hasn't synced. Pure — testable
    /// with a hand-built index.
    /// WP-61: `cache` (default nil) memoizes the name→served resolutions WITHIN
    /// one `buildSections` pass. The same team/tournament names recur across many
    /// rows, so a shared cache collapses them to a single lookup; nil (the unit
    /// tests' path) simply resolves each name directly — identical result, just
    /// no memoization.
    nonisolated static func followableEntities(for event: Event, index: EntityIndex, followedIds: Set<String>, cache: NameResolveCache? = nil) -> [Entity] {
        guard !index.isEmpty else { return [] }
        var ids: [String] = []
        func add(_ id: String?) { if let id, !id.isEmpty { ids.append(id) } }
        add(event.homeTeamEntityId)
        add(event.awayTeamEntityId)
        for player in event.norwegianPlayers { add(player.entityId) }
        for name in [event.homeTeam, event.awayTeam, event.tournament].compactMap({ $0 }) {
            let served = cache.map { $0.servedEntity(for: name, in: index) } ?? index.servedEntity(for: name)
            if let served { ids.append(served.id) }
        }
        var seen = Set<String>()
        var out: [Entity] = []
        for id in ids where !followedIds.contains(id) && seen.insert(id).inserted {
            if let entity = index.entity(id: id) { out.append(entity) }
        }
        return Array(out.prefix(3))
    }

    // MARK: - Live now (DESIGN.md §4)

    /// The events ongoing at `now`, for the quiet "live now" line under the
    /// header — capped at two, must-see first (the amber-dot events lead, same
    /// spirit as the widget's highlight), then earliest-started. An event is
    /// "live" when its own source status says so, or — the honest fallback for
    /// the cache, which carries no live ESPN poll — when `now` sits inside its
    /// `[time, endTime]` window (so an in-progress golf major or stage still
    /// reads as live, while a single kickoff with no end time doesn't
    /// masquerade as live for hours). Only followed (relevant) events qualify.
    nonisolated static func liveRows(events: [Event], interests: Interests, now: Date) -> [AgendaLiveRow] {
        let (feedEvents, lookup) = EventBridge.bridge(events)
        let live = feedEvents.filter { fe in
            guard FeedCompiler.isRelevant(fe, interests: interests, now: now) else { return false }
            return liveState(fe, event: fe.id.flatMap { lookup[$0] }, now: now) == .direkte
        }
        .sorted { lhs, rhs in
            let lSee = FeedCompiler.isMustSee(lhs, interests: interests)
            let rSee = FeedCompiler.isMustSee(rhs, interests: interests)
            if lSee != rSee { return lSee }               // must-see first
            return (lhs.time ?? .distantFuture) < (rhs.time ?? .distantFuture)
        }
        return live.prefix(2).compactMap { fe -> AgendaLiveRow? in
            guard let id = fe.id, let event = lookup[id] else { return nil }
            return AgendaLiveRow(
                id: id,
                title: AgendaFormat.title(homeTeam: fe.homeTeam, awayTeam: fe.awayTeam, participants: fe.participants, fallback: fe.title),
                channelLabel: AgendaFormat.channelLabel(event.streaming)
            )
        }
    }

    // MARK: - WP-126: the ONE shared live definition

    /// The live state of an event at `now` — mirrored 1:1 with `ssLiveState` in
    /// docs/js/shared-constants.js (read that file's block comment for the full
    /// heuristic + the sport-default table). `.direkte` = now inside a plausible
    /// ACTIVE session (the ▌ LIVE line); `.pagaar` = a multi-day tournament that's
    /// underway but outside today's plausible daily window (never the live line);
    /// nil = not started / finished. Conservative by design — we would rather say
    /// `.pagaar` than a false `.direkte`.
    enum LiveState { case direkte, pagaar }

    /// ~24h: an endTime further than this past the start marks a multi-day
    /// tournament (golf week, multi-day chess), which uses the daily-window rule.
    nonisolated static let liveMultiDay: TimeInterval = 24 * 60 * 60

    nonisolated static func liveState(_ fe: FeedEvent, event: Event?, now: Date) -> LiveState? {
        // 1. an authoritative in-progress source status wins outright (same
        //    substrings as the JS mirror).
        if let status = event?.status?.lowercased(),
           status == "in" || status.contains("in_progress") || status.contains("in-progress")
            || status.contains("live") || status.contains("halftime") {
            return .direkte
        }
        // 2. need a start, and it must have arrived.
        guard let start = fe.time, now >= start else { return nil }
        let rawEnd = fe.endTime
        // 3. multi-day tournament → conservative Oslo daily window [08:00, 22:00).
        if let end = rawEnd, end.timeIntervalSince(start) > liveMultiDay {
            if now > end { return nil }
            return isWithinDailyWindow(now) ? .direkte : .pagaar
        }
        // 4. single session: trust a plausible endTime, else the sport default.
        let effectiveEnd: Date
        if let end = rawEnd, end > start {
            effectiveEnd = end
        } else {
            effectiveEnd = start.addingTimeInterval(sportDefaultDuration(fe.sport))
        }
        return now <= effectiveEnd ? .direkte : nil
    }

    /// Sport-typed default session duration (WP-126) — the fallback when an event
    /// carries no endTime. Kept identical to JS `ssSportDefaultMs`.
    nonisolated static func sportDefaultDuration(_ sport: String) -> TimeInterval {
        switch sport.lowercased() {
        case "football": return 135 * 60      // ~2h15 incl. stoppage + half-time
        case "f1", "formula1": return 120 * 60 // a race/quali/practice session
        case "cycling": return 330 * 60       // a road stage (~5h30)
        case "chess": return 300 * 60         // a classical round (~5h)
        case "cs2", "esports": return 150 * 60 // a best-of match (~2h30)
        case "tennis": return 210 * 60        // a best-of match (~3h30)
        case "golf": return 600 * 60          // a day's play fallback (~10h; golf is normally multi-day)
        default: return 180 * 60              // conservative generic session (~3h)
        }
    }

    /// Whether the Oslo-local hour sits inside the plausible daily playing window
    /// [08:00, 22:00) — the multi-day daily-window check (mirrors JS `ssOsloHour`).
    nonisolated static func isWithinDailyWindow(_ now: Date) -> Bool {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Europe/Oslo") ?? .current
        let h = cal.component(.hour, from: now)
        return h >= 8 && h < 22
    }

    nonisolated private static func makeItem(
        _ item: FeedCompiler.CompiledFeed.Item,
        lookup: [String: Event],
        interests: Interests,
        now: Date,
        index: EntityIndex,
        identityIndex: EntityIdentityIndex = EntityIdentityIndex([]),
        followedIds: Set<String>,
        shield: SpoilerShield,
        cache: NameResolveCache? = nil
    ) -> AgendaItem? {
        switch item {
        case .event(let feedEvent, let mustWatch, let mustSee):
            // EventBridge stamps every FeedEvent.id with a non-optional
            // stableId, so this lookup should always hit; a miss (can only
            // happen if a caller hand-built a FeedEvent bypassing
            // EventBridge) safely drops the row rather than crashing.
            guard let id = feedEvent.id, let event = lookup[id] else { return nil }
            let title = AgendaFormat.title(homeTeam: feedEvent.homeTeam, awayTeam: feedEvent.awayTeam, participants: feedEvent.participants, fallback: feedEvent.title)
            // WP-112: when a head-to-head matchup from `participants` was promoted
            // to the title (a generic "VM-finalen 2026" → "Spania – Argentina"),
            // keep the ORIGINAL title as the dempet context line so the competition
            // isn't lost — otherwise the usual tournament meta. A home/away rename
            // keeps the tournament meta (teams present → the title still changed,
            // but that path already carries its tournament), so the promotion is
            // detected by "no teams AND the title changed".
            let hasTeams = !(feedEvent.homeTeam ?? "").isEmpty && !(feedEvent.awayTeam ?? "").isEmpty
            let metaTournament = (!hasTeams && title != feedEvent.title) ? feedEvent.title : event.tournament
            return .event(AgendaEventRow(
                id: id,
                timeLabel: AgendaFormat.timeLabel(time: feedEvent.time, endTime: feedEvent.endTime),
                title: title,
                metaLabel: AgendaFormat.metaLabel(tournament: metaTournament, title: title),
                channelLabel: AgendaFormat.channelLabel(event.streaming),
                isMustSee: mustSee,
                mustWatch: mustWatch,
                isAIResearch: event.source == "ai-research",
                event: event,
                whyShown: FeedCompiler.whyShown(feedEvent, interests: interests),
                followable: followableEntities(for: event, index: index, followedIds: followedIds, cache: cache),
                spoilerSafe: shield.spoilerSafe(event: event),
                identity: identityIndex.identity(for: event),
                subjects: followableEntities(for: event, index: index, followedIds: [], cache: cache)
            ))

        case .series(let series):
            let stages = series.stages
                .compactMap { $0.id.flatMap { lookup[$0] } }
                .sorted { $0.time < $1.time }
            guard let nextStageId = series.nextStage.id, let nextStage = lookup[nextStageId], !stages.isEmpty else {
                return nil
            }
            let tournamentName = series.tournament ?? series.title
            return .series(AgendaSeriesRow(
                id: series.id,
                timeLabel: AgendaFormat.timeLabel(time: series.time, endTime: nil),
                summaryLabel: AgendaFormat.seriesSummary(
                    tournament: tournamentName,
                    stageCount: stages.count,
                    lastStageEnd: stages.last?.endTime ?? stages.last?.time,
                    now: now
                ),
                channelLabel: AgendaFormat.channelLabel(nextStage.streaming),
                mustWatch: series.stages.contains { FeedCompiler.mustWatch($0, interests: interests) },
                isAIResearch: nextStage.source == "ai-research",
                tournament: tournamentName,
                stages: stages,
                nextStage: nextStage,
                identity: identityIndex.identity(for: nextStage)
            ))
        }
    }
}

/// WP-60 — a loud DEBUG guard that the agenda reload pipeline (disk read + JSON
/// decode + compile) never runs on the main thread. A regression that moves that
/// work back onto the main actor — the likely cause of the hang WP-60 fixes —
/// trips `assertionFailure` in a debug build, so it fails loudly the moment it
/// happens rather than silently janking in production.
///
/// It is testable WITHOUT a death test: `recordViolationsForTesting` swaps the
/// trap for a recorder, so a test can drive the pipeline on the main thread and
/// assert the guard fired (see AgendaReloadConcurrencyTests). Compiled to a
/// no-op in release.
///
/// The recorder is installed **per thread**, not process-globally. A violation
/// can only be observed on the thread that is violating (the guard early-returns
/// off-main), so thread scope is exactly the right scope — and it makes the two
/// recording tests (AgendaReloadConcurrencyTests + NewsModelTests) incapable of
/// clobbering each other's recorded state or of flipping each other back into
/// trapping mode, whatever else is in flight on other threads. The earlier
/// design used two process-global `nonisolated(unsafe) static var`s (a shared
/// `violations` array + a shared trap/record mode flag), which any concurrently
/// running recorder could reset out from under the one being asserted on.
enum MainThreadGuard {
    #if DEBUG
    /// The violations recorded by ONE `recordViolationsForTesting` call. A
    /// reference type so the installed recorder and the caller see the same box.
    /// Only ever touched from the thread it is installed on.
    final class Recorder {
        fileprivate(set) var violations: [String] = []
    }

    /// `threadDictionary` key for the recorder currently installed on this
    /// thread. Absent (the normal case, and always in the app) ⇒ violations trap.
    private static let recorderKey = "app.sportivista.MainThreadGuard.recorder"

    /// The recorder installed on the CURRENT thread, if any.
    private static var currentRecorder: Recorder? {
        Thread.current.threadDictionary[recorderKey] as? Recorder
    }
    #endif

    /// Trip if called on the main thread. `label` is an autoclosure so building
    /// the message costs nothing on the (overwhelmingly common) off-main path.
    static func assertOffMain(_ label: @autoclosure () -> String) {
        #if DEBUG
        guard Thread.isMainThread else { return }
        let message = "WP-60: \(label()) ran on the main thread — decode/compile must stay off the main actor"
        if let recorder = currentRecorder {
            recorder.violations.append(message)
        } else {
            assertionFailure(message)
        }
        #endif
    }

    #if DEBUG
    /// Run `body` with the guard recording (not trapping) ON THIS THREAD and
    /// return what it recorded, restoring any previously installed recorder
    /// afterwards (so nesting works). For tests only.
    ///
    /// `body` must run its violating work synchronously on the calling thread —
    /// which is the whole point: the returned violations are the ones THIS body
    /// caused, never a neighbouring test's.
    static func recordViolationsForTesting(_ body: () -> Void) -> [String] {
        let recorder = Recorder()
        let previous = Thread.current.threadDictionary[recorderKey]
        Thread.current.threadDictionary[recorderKey] = recorder
        defer { Thread.current.threadDictionary[recorderKey] = previous }
        body()
        return recorder.violations
    }
    #endif
}

/// WP-61 — a per-`buildSections` memo for `followableEntities`' name→served
/// resolutions. One compile resolves the same home/away/tournament NAMES over
/// and over (once per row that carries them); this collapses each distinct name
/// to a SINGLE `EntityIndex.servedEntity` call. A reference type so one instance
/// threads through the (value-passing) compile without `inout` churn. It is
/// created fresh inside `buildSections`, used only within that one synchronous
/// call, and never escapes — so despite being non-`Sendable` it never crosses an
/// isolation boundary. The stored `Entity?` value distinguishes a cached "no
/// served entity" (a legitimate miss) from "not yet resolved".
final class NameResolveCache {
    private var served: [String: Entity?] = [:]

    /// The served entity for `name`, resolved once and reused. Keyed on the raw
    /// name string the caller holds (identical string ⇒ identical result), so no
    /// normalization needs to happen before the cache is consulted.
    func servedEntity(for name: String, in index: EntityIndex) -> Entity? {
        if let cached = served[name] { return cached }
        let resolved = index.servedEntity(for: name)
        served[name] = resolved
        return resolved
    }
}
