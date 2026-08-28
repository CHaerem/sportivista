//
//  SyncFreshness.swift
//  Sportivista
//
//  WP-121 — the post-sync "delivery freshness" step shared by EVERY sync path
//  (cold-start ContentView.refresh, the background BGAppRefreshTask, and
//  pull-to-refresh): after a sync, keep the home-screen widget and the
//  scheduled push reminders as fresh as the cache the sync just wrote.
//
//  Two 🔴 findings from the WP-118 kjernefunksjonalitet-audit motivated it:
//    1. `NotificationPlanner.reconcile` had ONE call site (cold start only), so
//       a background/pull sync that MOVED an event left its push at the old time
//       — "feil tid i et push-varsel er det dyreste tillitsbruddet appen kan begå".
//    2. `WidgetCenter.reloadAllTimelines()` had ZERO call sites, so the widget
//       could sit up to ~24h behind (its own reload policy only fires at the
//       Oslo day boundary).
//
//  Pure/impure split, like the rest of the codebase: `decide(from:)` is a pure
//  function of the SyncResult (unit-tested directly), and `run(...)` performs the
//  decided actions against injected seams (a `WidgetReloading` + a
//  `NotificationPlanner`), so tests verify BOTH with a recording widget reloader
//  and a RecordingNotificationScheduler — no running app, no real WidgetKit host,
//  no OS permission prompt. The notification planning/diff semantics themselves
//  are untouched (WP-121 non-goal): `run` just calls the existing, proven
//  `reconcile` with the same quality gates the cold-start path uses.
//
//  WP-176 adds a THIRD freshness action on the same seam-and-decision shape: when
//  `recent-results.json` changed, a followed contest may have FINISHED, which
//  means (a) an opted-in entity may deserve one calm fulltidsvarsel and (b) the
//  widget's «siste resultat»-linje must be re-rendered. The decision of WHAT to
//  say stays pure (`ResultDigest`); this file only carries it out.
//

import Foundation

struct SyncFreshness: Sendable {
    /// The files whose change means the widget must rebuild: its timeline reads
    /// events (and, through the feed, entities). tracked/interests never reach
    /// the widget's timeline, so a change to only those is not a widget reload.
    static let widgetInputs: Set<String> = ["events.json", "entities.json"]
    /// The file whose change means reminders must be reconciled: reminders are
    /// keyed off events (their time/streaming/mustWatch), nothing else.
    static let notificationInputs: Set<String> = ["events.json"]
    /// WP-176 — the file whose change can mean a contest FINISHED: the
    /// fulltidsvarsel + the widget's «siste resultat»-linje both derive from
    /// `recent-results.json` and from nothing else.
    static let resultInputs: Set<String> = ["recent-results.json"]

    var notificationPlanner: NotificationPlanner
    var widgetReloader: WidgetReloading
    /// WP-176 — the OS seam the fulltidsvarsler go through. Shares the
    /// NotificationPlanner's scheduler by default so both notification kinds
    /// talk to the same UNUserNotificationCenter.
    var resultAlertScheduler: NotificationScheduling
    /// WP-176 — where the widget's pre-rendered result line is persisted.
    var snapshotWriter: WidgetResultSnapshotWriting
    /// WP-176 — how a delivered alert is recorded in the ledger. A closure (not a
    /// UserDefaults property) so this stays unambiguously `Sendable` and a test
    /// can observe the ledger writes without touching `.standard`.
    var recordDelivered: @Sendable ([String]) -> Void

    init(
        notificationPlanner: NotificationPlanner = NotificationPlanner(),
        widgetReloader: WidgetReloading = WidgetCenterReloader(),
        resultAlertScheduler: NotificationScheduling = UNUserNotificationScheduler(),
        snapshotWriter: WidgetResultSnapshotWriting = CacheWidgetResultSnapshotWriter(),
        recordDelivered: @escaping @Sendable ([String]) -> Void = { ResultAlertPreference.markDelivered($0) }
    ) {
        self.notificationPlanner = notificationPlanner
        self.widgetReloader = widgetReloader
        self.resultAlertScheduler = resultAlertScheduler
        self.snapshotWriter = snapshotWriter
        self.recordDelivered = recordDelivered
    }

    /// WP-176 — everything the result half of a sync needs, gathered by the
    /// caller (which owns the profile store + the personal memory) and passed as
    /// plain values so `run` stays a pure-ish orchestrator. `nil` ⇒ this call
    /// site does no result work at all (the default, so existing callers and
    /// tests are untouched).
    struct ResultInputs: Sendable {
        var previousResults: RecentResults
        var newResults: RecentResults
        var profile: InterestProfile
        var entities: [Entity]
        var shield: SpoilerShield
        /// Entity ids with fulltidsvarsel ON — read from ResultAlertPreference
        /// by the caller (a device preference, not part of the profile).
        var optedIn: Set<String>
        /// The already-alerted ledger (ResultAlertPreference).
        var alreadyDelivered: Set<String>

        init(
            previousResults: RecentResults,
            newResults: RecentResults,
            profile: InterestProfile,
            entities: [Entity],
            shield: SpoilerShield,
            optedIn: Set<String>,
            alreadyDelivered: Set<String> = []
        ) {
            self.previousResults = previousResults
            self.newResults = newResults
            self.profile = profile
            self.entities = entities
            self.shield = shield
            self.optedIn = optedIn
            self.alreadyDelivered = alreadyDelivered
        }
    }

    // MARK: - Pure decision (unit-testable, no seams needed)

    struct Decision: Equatable {
        var reloadWidget: Bool
        var reconcileNotifications: Bool
        /// WP-176 — recent-results.json changed, so a followed contest may have
        /// finished (fulltidsvarsel + the widget's result line).
        var refreshResults: Bool = false
    }

    /// What a completed sync should trigger, from the files it actually wrote.
    /// A 304 (`upToDate`) or a manifest `failure` wrote nothing → no work. This
    /// is the SAME signal ContentView.refresh already keys off (`SyncResult`),
    /// so the three sync paths agree on when freshness work is needed.
    static func decide(from result: SyncResult) -> Decision {
        let changed: Set<String>
        switch result {
        case .changedFiles(let files): changed = Set(files)
        case .upToDate, .failure: changed = []
        }
        return Decision(
            // WP-176: the widget now also carries a «siste resultat»-linje, so a
            // change to recent-results.json is a widget reload too.
            reloadWidget: !changed.isDisjoint(with: widgetInputs.union(resultInputs)),
            reconcileNotifications: !changed.isDisjoint(with: notificationInputs),
            refreshResults: !changed.isDisjoint(with: resultInputs)
        )
    }

    // MARK: - Execution (impure — the only part that touches the seams)

    /// Perform the freshness actions a completed sync calls for: reload the
    /// widget when its inputs changed, then reconcile reminders when events
    /// changed (using the before/after snapshots the caller took around the
    /// sync). Returns the notification operations for tests. `plain` values
    /// (not autoclosures) keep this unambiguously `Sendable` across the
    /// main-actor → nonisolated hop the pull/background callers make.
    @discardableResult
    func run(
        result: SyncResult,
        previousEvents: [Event],
        newEvents: [Event],
        interests: Interests,
        lastSync: Date?,
        now: Date = Date(),
        leadTimeEnabled: Bool,
        resultInputs: ResultInputs? = nil,
        // WP-255 — the per-profile lens the reminder's time follows, forwarded
        // untouched to the planner. Defaulted to EMPTY so existing callers/tests
        // keep the pre-WP-255 behaviour (every reminder on the event's own time).
        profile: InterestProfile = InterestProfile(),
        index: EntityIndex = EntityIndex([])
    ) async -> [NotificationOperation] {
        let decision = Self.decide(from: result)
        // WP-176: the result work runs BEFORE the widget reload, so the timeline
        // WidgetKit rebuilds already sees the freshly written result line.
        if decision.refreshResults, let inputs = resultInputs {
            await deliverResults(inputs, now: now)
        }
        if decision.reloadWidget {
            widgetReloader.reloadAllTimelines()
        }
        guard decision.reconcileNotifications else { return [] }
        return await notificationPlanner.reconcile(
            previousEvents: previousEvents,
            newEvents: newEvents,
            interests: interests,
            now: now,
            lastSync: lastSync,
            leadTimeEnabled: leadTimeEnabled,
            profile: profile,
            index: index
        )
    }

    /// WP-176 — the impure half of the result work: plan (pure, ResultDigest),
    /// persist the widget's line, then deliver the fulltidsvarsler. Permission is
    /// requested ONLY when there is actually an alert to show (the same lazy rule
    /// NotificationPlanner.reconcile follows) — a user who never opted an entity
    /// in is never prompted by this path at all. Returns the delivered ids so the
    /// caller can record them in the ledger.
    /// - Parameter deliverAlerts: false ⇒ only re-render the widget's result line
    ///   and leave the ledger untouched. The FOREGROUND cold-start path passes
    ///   false: the user is looking at the app, where the result is already on the
    ///   board — buzzing them about what is on screen would be noise, and consuming
    ///   the ledger entry would silently swallow the background alert they might
    ///   still want later.
    @discardableResult
    func deliverResults(_ inputs: ResultInputs, now: Date = Date(), deliverAlerts: Bool = true) async -> [String] {
        let output = ResultDigest.plan(
            previousResults: inputs.previousResults,
            newResults: inputs.newResults,
            profile: inputs.profile,
            entities: inputs.entities,
            shield: inputs.shield,
            optedIn: inputs.optedIn,
            alreadyDelivered: inputs.alreadyDelivered,
            now: now
        )
        snapshotWriter.write(output.snapshot)
        guard deliverAlerts, !output.alerts.isEmpty else { return [] }
        guard await resultAlertScheduler.requestAuthorizationIfNeeded() else { return [] }
        for alert in output.alerts {
            await resultAlertScheduler.schedule(alert)
        }
        let ids = output.alerts.map(\.id)
        recordDelivered(ids)
        return ids
    }
}

/// WP-121 — the pure gate for foreground data-refresh. When the app becomes
/// active (`scenePhase == .active`) the audit's third finding wants a full
/// refresh if the cache has gone stale — but only then, so a quick app-switch
/// doesn't hammer the network (the cold-start `.task` and the BGAppRefreshTask
/// cover the rest). Split out as a pure function so it is testable with an
/// injected clock (no scenePhase, no real time).
enum ForegroundSyncGate {
    /// How stale the cache may get before becoming active re-syncs it. Chosen
    /// well under the research agent's 4h cadence so the board is never more
    /// than a few minutes behind when the user actually opens the app, without
    /// re-fetching on every glance.
    static let staleness: TimeInterval = 15 * 60

    /// Whether becoming active should trigger a full refresh: only when we have
    /// synced before AND it was at least `staleness` ago. A never-synced cache
    /// (`nil`) is left to the cold-start `.task` refresh — returning `false`
    /// here avoids double-syncing at launch, where scenePhase also flips to
    /// `.active` right as `.task` is already fetching.
    static func shouldRefresh(lastSync: Date?, now: Date, staleness: TimeInterval = staleness) -> Bool {
        guard let lastSync else { return false }
        return now.timeIntervalSince(lastSync) >= staleness
    }
}
