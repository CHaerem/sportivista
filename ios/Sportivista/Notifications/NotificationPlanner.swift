//
//  NotificationPlanner.swift
//  Sportivista
//
//  WP-15 — local push reminders for must-watch events. Product rule this
//  whole file exists to serve: "feil tid i et push-varsel er det dyreste
//  tillitsbruddet appen kan begå" (a wrong time in a push notification is the
//  most expensive trust violation the app can commit) — so notifications
//  must be FEW, CORRECT, and CALM. Concretely that means: only events the
//  bell predicate (FeedCompiler.mustWatch) actually rings for, never an
//  event whose time hasn't cleared this client's own quality bar, and never
//  a stale claim of precision.
//
//  WP-255 — the reminder follows the ATHLETE's time, not the event's nominal
//  one, whenever the profile's lens knows one. Following an athlete means «vis
//  meg når HAN spiller» (WP-249), so the agenda routinely renders «17:24
//  Hovland teer av — TOUR Championship» for a tournament whose `time` is the
//  nominal 04:00 window start. This file used to read `event.time` and nothing
//  else, so the board said 17:24 while the push both fired at and SAID 04:00 —
//  precisely the trust breach the paragraph above exists to prevent, and one
//  DESIGN.md § Rad already promised was impossible («varselklokka står KUN på
//  rader som faktisk armerer en påminnelse»: the bell sits on the 17:24 row).
//  `EventLens` (Profile/) now resolves both surfaces' answer — the same lens,
//  the same renderer, the same staleness guard — and this planner asks it.
//
//  `plan(previousEvents:newEvents:interests:now:lastSync:)` is the pure,
//  fully unit-testable core: two event snapshots in, a list of operations
//  out — no UNUserNotificationCenter, no async, no I/O. It is keyed
//  EXCLUSIVELY on the WP-02 stable event id (the diff contract): the same id
//  reappearing with a different computed reminder is a `.reschedule`, an id
//  that no longer resolves to a plannable reminder (removed from the feed,
//  or disqualified by a gate) is a `.cancel`, and a never-before-seen
//  plannable id is a `.scheduleNew`. An event whose plannable content (fire
//  date, title, body) is UNCHANGED between the two snapshots produces no
//  operation at all — reconciling must never re-touch a correctly scheduled
//  reminder on every sync.
//
//  `reconcile(...)` is the thin, impure wrapper the app actually calls (see
//  ContentView's sync-hook): it computes the plan, requests notification
//  permission ONLY if the plan actually wants to schedule/reschedule
//  something (never at app start, never for a sync that only cancels or
//  changes nothing — the brief's "kalles ved første planlegging" rule), then
//  executes each operation against the injected `NotificationScheduling`.
//

import Foundation

struct NotificationPlanner: Sendable {
    /// Mirrors build-ics.js's `leadMinutes` fallback (interests.json
    /// `notify.leadMinutes`, default 30) — the same lead time the calendar
    /// export's VALARM uses, so the two reminder channels never disagree.
    static let defaultLeadMinutes: TimeInterval = 30

    /// "Data older than this at planning time can no longer be presented as
    /// certain" — see `isStale(lastSync:now:)` below.
    static let verificationWindow: TimeInterval = 6 * 60 * 60

    var scheduler: NotificationScheduling

    init(scheduler: NotificationScheduling = UNUserNotificationScheduler()) {
        self.scheduler = scheduler
    }

    // MARK: - Pure core (fully unit-testable, no scheduler needed)

    /// Diffs `previousEvents` against `newEvents` and returns the operations
    /// needed to bring locally-scheduled reminders in line with the new
    /// snapshot. Order is by event id (deterministic; not meaningful beyond
    /// making the plan reproducible for tests).
    static func plan(
        previousEvents: [Event],
        newEvents: [Event],
        interests: Interests,
        now: Date,
        lastSync: Date?,
        // WP-66 — the assistant's `setNotificationLeadTime` command's control
        // surface (persisted per-device in NotificationLeadPreference). ON (the
        // default) fires reminders AHEAD of the event (the interests lead); OFF
        // fires them AT start (no lead). Defaulted so every existing caller/test
        // is unaffected.
        leadTimeEnabled: Bool = true,
        // WP-255 — the per-profile lens, and the entity index that types a
        // followed entity as an athlete. Defaulted to EMPTY, which is the
        // degradation contract in the signature itself: no profile ⇒ no lens ⇒
        // every reminder follows the event's own time, exactly as before.
        profile: InterestProfile = InterestProfile(),
        index: EntityIndex = EntityIndex([])
    ) -> [NotificationOperation] {
        let previousByID = byID(previousEvents)
        let newByID = byID(newEvents)
        let stale = isStale(lastSync: lastSync, now: now)
        let leadSeconds = leadTimeEnabled ? leadTime(interests) * 60 : 0
        let followedIds = Set(profile.rules.map(\.entityId))

        func plannedRequest(for event: Event) -> NotificationRequest? {
            guard let id = event.id else { return nil }               // WP-02 contract: no id, not trackable
            guard passesConfidenceGate(event) else { return nil }      // (a) low+unconfirmed never planned
            let feedEvent = FeedEvent(from: event)
            guard FeedCompiler.mustWatch(feedEvent, interests: interests) else { return nil } // (2) the bell, and only the bell

            // WP-255 — the time this reminder is ABOUT. The athlete's own moment
            // when the profile's lens knows one (and only when EventLens will
            // stand behind it: today-or-later, still ahead of us), else the
            // event's own start. `nil` from EventLens is the whole pre-WP-255
            // behaviour, unchanged.
            let lens = EventLens.reminder(
                for: event, feedEvent: feedEvent, profile: profile,
                index: index, followedIds: followedIds, now: now
            )
            let start = lens?.time ?? event.time
            guard start > now else { return nil }                      // (c) never for in-progress/passed events

            // The lead time is when we'd IDEALLY fire; if that instant has
            // already passed (event is close but hasn't started — a
            // perfectly normal case, not the "already passed" gate above),
            // clamp to "fire promptly" instead of silently dropping a
            // genuinely relevant, still-upcoming event.
            let fireDate = max(start.addingTimeInterval(-leadSeconds), now)
            // The lens's own title («Hovland teer av — TOUR Championship») when
            // the time is his: a clock is only unambiguous next to whose it is.
            return NotificationRequest(id: id, title: lens?.title ?? event.title, body: body(for: event, at: start, stale: stale), fireDate: fireDate)
        }

        var operations: [NotificationOperation] = []
        for id in Set(previousByID.keys).union(newByID.keys).sorted() {
            let previousRequest = previousByID[id].flatMap(plannedRequest(for:))
            let newRequest = newByID[id].flatMap(plannedRequest(for:))

            switch (previousRequest, newRequest) {
            case (nil, .some(let new)):
                operations.append(.scheduleNew(new))
            case (.some(let old), .some(let new)):
                if old != new { operations.append(.reschedule(new)) }
            case (.some, nil):
                operations.append(.cancel(id: id))
            case (nil, nil):
                break // never plannable, either snapshot — nothing to do
            }
        }
        return operations
    }

    private static func byID(_ events: [Event]) -> [String: Event] {
        Dictionary(uniqueKeysWithValues: events.compactMap { event in event.id.map { ($0, event) } })
    }

    // MARK: - (a) Quality gate: low confidence without confirmation

    /// "confidence: low" without an explicit "verificationStatus: confirmed"
    /// re-check is never trustworthy enough for a push (silent web-dashboard
    /// display is fine; a proactive alert is not). Any other confidence
    /// value (medium/high/absent — non-ai-research events carry no
    /// confidence at all) passes this gate untouched.
    private static func passesConfidenceGate(_ event: Event) -> Bool {
        !(event.confidence == "low" && event.verificationStatus != "confirmed")
    }

    // MARK: - (b) Verification window: hedge stale data instead of asserting precision

    private static func isStale(lastSync: Date?, now: Date) -> Bool {
        guard let lastSync else { return true } // never synced ⇒ nothing to trust yet
        return now.timeIntervalSince(lastSync) > verificationWindow
    }

    private static func leadTime(_ interests: Interests) -> TimeInterval {
        guard let minutes = interests.notify?.leadMinutes, minutes > 0 else { return defaultLeadMinutes }
        return TimeInterval(minutes)
    }

    // MARK: - Notification text (Norwegian, calm — see the WP-15 brief)

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "nb_NO")
        formatter.dateFormat = "HH:mm"
        formatter.timeZone = FeedCompiler.osloTimeZone
        return formatter
    }()

    /// "Kl. HH:mm · kanal" normally; an honest "Kanal ukjent" when streaming
    /// is empty — never invent a channel. When the last successful sync is
    /// older than the verification window, the claim is hedged
    /// ("Etter planen: …") instead of stated as settled fact.
    /// WP-255: `start` is the time this reminder is actually about — the
    /// athlete's own when a lens gave us one, the event's otherwise. Passed in
    /// rather than read off `event.time` here, so the clock the body STATES is
    /// by construction the clock the notification FIRES on.
    private static func body(for event: Event, at start: Date, stale: Bool) -> String {
        let time = timeFormatter.string(from: start)
        let channel = event.streaming.first?.platform.flatMap { $0.isEmpty ? nil : $0 } ?? "Kanal ukjent"
        return stale ? "Etter planen: kl. \(time) · \(channel)" : "Kl. \(time) · \(channel)"
    }

    // MARK: - Execution (impure — the only part that talks to the OS)

    /// Computes the plan and carries it out against `scheduler`. Requests
    /// notification permission only when the plan actually wants to
    /// schedule or reschedule something — a sync that only cancels (or
    /// changes nothing) never prompts the user, and neither does app start
    /// (see ContentView, which calls this only after a sync completes).
    @discardableResult
    func reconcile(
        previousEvents: [Event],
        newEvents: [Event],
        interests: Interests,
        now: Date = Date(),
        lastSync: Date?,
        leadTimeEnabled: Bool = true,
        profile: InterestProfile = InterestProfile(),
        index: EntityIndex = EntityIndex([])
    ) async -> [NotificationOperation] {
        let operations = Self.plan(previousEvents: previousEvents, newEvents: newEvents, interests: interests, now: now, lastSync: lastSync, leadTimeEnabled: leadTimeEnabled, profile: profile, index: index)
        guard !operations.isEmpty else { return operations }

        let wantsToScheduleSomething = operations.contains {
            if case .cancel = $0 { return false } else { return true }
        }
        if wantsToScheduleSomething {
            _ = await scheduler.requestAuthorizationIfNeeded()
        }

        for operation in operations {
            switch operation {
            case .scheduleNew(let request), .reschedule(let request):
                await scheduler.schedule(request)
            case .cancel(let id):
                await scheduler.cancel(id: id)
            }
        }
        return operations
    }
}

/// WP-255 — everything a reminder plan needs from THIS device, gathered in one
/// place so the three sync paths (cold start, background, pull-to-refresh) can
/// never gather it differently.
///
/// It also closes a hole that predates the lens entirely. The three call sites
/// passed `dataStore.loadInterests() ?? Interests()` — but WP-96 stopped
/// PUBLISHING `interests.json` and WP-106 dropped it from `SyncClient`'s
/// `filesOfInterest`, so on a real device that load returns `nil` and the
/// planner was gated on EMPTY interests: `notifyEntities` empty ⇒
/// `FeedCompiler.mustWatch` false for every event ⇒ **no reminder was ever
/// scheduled at all**, while the board — which compiles against
/// `EffectiveInterests.merge(profile:into:index:)` — kept drawing the bell that
/// promises one (DESIGN.md § Rad). The bell and the reminder must be the same
/// predicate over the same interests, so this folds the local profile in
/// exactly as `AgendaViewModel.computeReloadSync` does.
extension NotificationPlanner {
    struct Inputs: Sendable {
        /// The EFFECTIVE interests — the synced base with the local profile
        /// folded in. What the bell (`mustWatch`) is judged against, same as the
        /// board.
        var interests: Interests
        /// The raw profile, which carries the per-rule LENS `EffectiveInterests`
        /// deliberately drops (see `AgendaViewModel.computeReloadSync`).
        var profile: InterestProfile
        /// The entity index — the authority on whether a followed entity is an
        /// athlete (`EventLens.derivedAthleteLens`'s first guard).
        var index: EntityIndex

        /// Reads the three from disk. Touches the file system (a profile decode
        /// plus, without a `reusing:` index, an `entities.json` decode), so call
        /// it off the main actor — every caller does.
        /// - Parameter reusing: an already-built index (the agenda caches one per
        ///   sync — WP-60), to avoid rebuilding the ~3 700-entity substrate.
        static func load(dataStore: DataStore, profileStore: ProfileStore, reusing index: EntityIndex? = nil) -> Inputs {
            let profile = profileStore.loadSyncState().profile
            let index = index ?? EntityIndex(dataStore.loadEntities())
            return Inputs(
                interests: EffectiveInterests.merge(profile: profile, into: dataStore.loadInterests() ?? Interests(), index: index),
                profile: profile,
                index: index
            )
        }
    }
}
