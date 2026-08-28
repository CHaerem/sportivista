//
//  BackgroundRefreshScheduler.swift
//  Sportivista
//
//  WP-12: thin BGTaskScheduler wrapper — registers and (re)submits the
//  `app.sportivista.refresh` BGAppRefreshTask and delegates the actual work to
//  SyncClient. This is intentionally a separate, minimal layer: everything
//  with real logic to test lives in BackgroundRefreshScheduling.swift (a
//  pure function) instead of here. Not unit-tested itself — BGTaskScheduler
//  needs a running app + the real OS scheduler, which a test target doesn't
//  provide.
//
//  Requires `app.sportivista.refresh` in Info.plist's
//  BGTaskSchedulerPermittedIdentifiers (project.yml) and the Background
//  Modes "fetch" capability (UIBackgroundModes) — both wired in project.yml.
//
//  `@preconcurrency import`: BGTask/BGAppRefreshTask predate Swift
//  Concurrency and aren't annotated Sendable, but `handle(task:...)` below
//  legitimately needs to touch the same task instance both to hand off to
//  SyncClient's async `sync()` and to wire its `expirationHandler` — this is
//  Apple's own documented escape hatch for a not-yet-audited system
//  framework under the Swift 6 language mode (this project's SWIFT_VERSION).
//

@preconcurrency import BackgroundTasks
import Foundation

enum BackgroundRefreshScheduler {
    static let taskIdentifier = "app.sportivista.refresh"

    /// Registers the handler. Must be called before the app finishes
    /// launching (Apple's own requirement for BGTaskScheduler) — with no
    /// AppDelegate in this pure-SwiftUI app, that means SportivistaApp's `init()`,
    /// not a view's `.task` or `.onAppear`.
    static func register(syncClient: SyncClient, dataStore: DataStore, profileStore: ProfileStore = ProfileStore()) {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: taskIdentifier, using: nil) { task in
            guard let refreshTask = task as? BGAppRefreshTask else { return }
            handle(task: refreshTask, syncClient: syncClient, dataStore: dataStore, profileStore: profileStore)
        }
    }

    /// Submits (or re-submits) the next refresh request. Safe to call
    /// repeatedly — a new submission simply replaces any pending one.
    /// Submission errors are ignored: the Simulator and hosts without the
    /// Background Modes capability provisioned throw here, and background
    /// refresh is best-effort by nature — a failed submit just means no
    /// background refresh happens until the app is opened again, which
    /// still triggers a foreground sync (see ContentView).
    static func scheduleNextRefresh(dataStore: DataStore) {
        let request = BGAppRefreshTaskRequest(identifier: taskIdentifier)
        request.earliestBeginDate = BackgroundRefreshScheduling.earliestBeginDate(lastSync: dataStore.lastSync)
        try? BGTaskScheduler.shared.submit(request)
    }

    private static func handle(task: BGAppRefreshTask, syncClient: SyncClient, dataStore: DataStore, profileStore: ProfileStore) {
        scheduleNextRefresh(dataStore: dataStore) // line up the next one first, per Apple's guidance

        let syncTask = Task {
            await syncAndFreshen(syncClient: syncClient, dataStore: dataStore, profileStore: profileStore)
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = {
            syncTask.cancel()
        }
    }

    /// WP-121 — the background refresh's WORK, split out of `handle` so it runs
    /// without a real BGAppRefreshTask (the wrapper above still isn't unit-tested;
    /// this delegates to `SyncFreshness`, which IS). Before WP-121 the background
    /// sync called `syncClient.sync()` and NOTHING else — a server-side event move
    /// left the already-scheduled push at its old time (audit 🔴) and the widget
    /// untouched. Now it snapshots events around the sync and, on change,
    /// reconciles reminders + reloads the widget with the SAME quality gates the
    /// cold-start path uses. The `SyncFreshness` seam defaults to production but is
    /// injectable so a test can drive it with a RecordingNotificationScheduler +
    /// a recording widget reloader.
    static func syncAndFreshen(
        syncClient: SyncClient,
        dataStore: DataStore,
        profileStore: ProfileStore = ProfileStore(),
        freshness: SyncFreshness = SyncFreshness(),
        now: Date = Date()
    ) async {
        let previousEvents = dataStore.loadEvents()
        // WP-176: the background wake-up is THE moment a finished match is
        // discovered (this app has no server push — see README § Det vi ikke
        // gjør), so snapshot results around the sync too.
        let previousResults = dataStore.loadRecentResults()
        let result = await syncClient.sync()
        let syncState = profileStore.loadSyncState()
        // WP-255 — the reminder inputs: the EFFECTIVE interests (the profile
        // folded in, the same pair the board compiles from) plus the profile's
        // own lens, so a background sync plans the athlete's tee time exactly
        // like the foreground paths.
        let reminders = NotificationPlanner.Inputs.load(dataStore: dataStore, profileStore: profileStore)
        await freshness.run(
            result: result,
            previousEvents: previousEvents,
            newEvents: dataStore.loadEvents(),
            interests: reminders.interests,
            lastSync: dataStore.lastSync,
            now: now,
            leadTimeEnabled: NotificationLeadPreference.isLeadTimeEnabled(),
            resultInputs: SyncFreshness.ResultInputs(
                previousResults: previousResults,
                newResults: dataStore.loadRecentResults(),
                profile: syncState.profile,
                entities: dataStore.loadEntities(),
                shield: SpoilerShield(memory: MemoryState(from: syncState)),
                optedIn: ResultAlertPreference.optedInEntityIds(),
                alreadyDelivered: Set(ResultAlertPreference.deliveredIds())
            ),
            profile: reminders.profile,
            index: reminders.index
        )
    }
}
