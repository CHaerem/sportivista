//
//  ContentView.swift
//  Sportivista
//
//  WP-10 scaffold → WP-12 sync → WP-14 agenda → WP-16.4 assistant → WP-104 the
//  Claude Design-handoff root. The screen is now: the brand header, a segmented
//  ROOT control with ORDS («Uka | Nyheter»), and — per tab — either the
//  day-grouped agenda (Uka) or the news board shell (Nyheter). The assistant's
//  ENTRY is a COMPACT floating BOTTOM-TRAILING BUTTON (`AssistantButton`: `sparkles`
//  + «Assistent», in the thumb-reachable corner — WP-144→WP-146, collapsing to the
//  bare glyph while the board scrolls); tapping it opens the conversation sheet
//  (AssistantSheetView), where writing, the example rows and the result thread all
//  live. The inline command line (WP-16.4→WP-99) is retired; so is the WP-104 bottom
//  capsule (a false search-field affordance) and WP-143's header `sparkles` toolbar
//  button (honest but unreachable one-handed) — the entry is a bottom button that
//  BOTH is reachable AND reads plainly as a button.
//
//  ContentView owns BOTH view models and hands them ONE shared ProfileStore, so
//  a follow the assistant applies is the same profile the agenda recompiles
//  against — that shared store, plus `assistant.onProfileChanged` wired to
//  `agenda.reloadFromCache`, is the "umiddelbar konsekvens" (move 4).
//
//  Deliberately keeps `init(syncClient:dataStore:)` compatible with
//  SportivistaApp.swift (which needs zero edits — the WP-14/15 rationale still holds).
//

import SwiftUI

/// WP-104 — the root's two sides, shown as ORDS in the header segmented control
/// (spec § 3a / DESIGN § Navigasjon): «Uka» (the agenda — what's happening) and
/// «Nyheter» (the news board — what's new). Both cover the whole week.
enum RootTab: String, CaseIterable, Identifiable {
    case uka
    case nyheter
    var id: String { rawValue }
    var label: String {
        switch self {
        case .uka: return "Uka"
        case .nyheter: return "Nyheter"
        }
    }
}

struct ContentView: View {
    let syncClient: SyncClient
    let dataStore: DataStore
    let notificationPlanner: NotificationPlanner
    /// WP-121 — the WidgetKit reload seam. `reloadAllTimelines()` had zero call
    /// sites before WP-121 (audit 🔴), leaving the widget up to ~24h stale; the
    /// sync hook now nudges it whenever events/entities change. Injectable
    /// (defaults to the real WidgetCenter) so the seam is uniform across paths.
    let widgetReloader: WidgetReloading
    /// WP-16.4 — the one profile store the agenda AND the assistant share.
    let profileStore: ProfileStore
    /// WP-19 — offline-first profile sync. LocalOnly by default (a no-op on the
    /// free-account/Simulator build); a paid-account build injects CloudKit.
    let profileSync: ProfileSyncCoordinator
    /// WP-176 — the shared post-sync freshness step (also handed to the agenda's
    /// pull-to-refresh). This view uses it for the WIDGET half only: the
    /// «siste resultat»-linje must be re-rendered after a cold-start sync too,
    /// while the fulltidsvarsel belongs to the background path (see
    /// `deliverResults(deliverAlerts:)`).
    let freshness: SyncFreshness

    @State private var agenda: AgendaViewModel
    @State private var assistant: AssistantViewModel
    /// WP-172 — the foreground live-score overlay (running score + match clock per
    /// event) and its poller. The poller runs ONLY while the app is foregrounded and
    /// only when a followed/board match is in-window (see `startLivePolling`); it is
    /// the app's one direct third-party (ESPN) network read.
    @State private var liveStore: LiveScoreStore
    @State private var livePoller: LiveScorePoller
    /// WP-107 — the Nyheter board's model, owned HERE (not inside NewsView) so it
    /// survives root-segment switches: the board stays built, and a switch back to
    /// Nyheter is instant instead of re-running the disk-read/decode/compile.
    @State private var news: NewsModel
    /// WP-104 — the root's two sides (Claude Design-handoff): a segmented with
    /// ORDS under the header — «Uka» (the agenda) vs «Nyheter» (the news board).
    @State private var rootTab: RootTab = .uka
    /// WP-16.4 → WP-83 → WP-104 → WP-143 → WP-144 — the assistant CONVERSATION sheet
    /// is up. Opened from the floating bottom `AssistantButton` (or raised when a
    /// follow is proposed from an event detail). Presented as a native `.sheet`
    /// (detents + grabber) over the root.
    @State private var sheetShown = false
    /// WP-132 — the sheet opens straight into diktering (field focused on appear so
    /// the keyboard's native dictation mic is up) when the onboarding assistant-intro
    /// «Prøv nå» / a tapped example raises it. WP-143: the old bottom-capsule mic that
    /// also set this is gone — diktering now lives inside the sheet only.
    @State private var sheetStartFocused = false
    /// WP-83 — the "Deg" screen is pushed (from the gearshape toolbar button).
    @State private var showDeg = false
    /// WP-83 — the memory page / share sheet, raised when the assistant's
    /// «hva vet du om meg» / «del profil» commands (or a scanned QR) ask for them.
    /// Their permanent home is now the Deg screen; these are the command shortcuts.
    @State private var memorySheetShown = false
    @State private var shareSheetShown = false
    /// WP-31 — the first-run onboarding overlay. Decided once in init (profile
    /// empty AND not yet completed); also re-raised on demand from "Hva jeg
    /// følger" (see `rerunOnboarding`).
    @State private var showOnboarding: Bool
    @AppStorage(OnboardingGate.storageKey) private var onboardingCompleted = false
    #if DEBUG
    /// WP-30 screenshot harness: the "Hva jeg vet om deg" page / a spoiler-masked
    /// detail sheet, presented deterministically under `SPORTIVISTA_DEMO` (one sheet
    /// binding — SwiftUI honours only one `.sheet` per view).
    enum DemoSheet: Identifiable {
        case memory
        case spoiler(AgendaEventRow)
        /// WP-83 — the slimmed assistant result panel (diff/answer screenshots).
        case assistantResult
        /// WP-83 — the share/import surface (now re-homed to Deg).
        case share
        /// WP-252 — the detail sheet's symmetric HANDLINGER: one subject already
        /// followed («Slutt å følge»), one not («Følg»), in the same section.
        case followSheet(AgendaEventRow)
        var id: String {
            switch self {
            case .memory: return "memory"
            case .spoiler(let row): return "spoiler-\(row.id)"
            case .assistantResult: return "assistantResult"
            case .share: return "share"
            case .followSheet(let row): return "followSheet-\(row.id)"
            }
        }
    }
    @State private var demoSheet: DemoSheet?
    #endif
    /// WP-66 — an event id the assistant's «vis <hendelse>» command resolved;
    /// handed to AgendaView to raise its detail sheet, then cleared by it.
    @State private var requestedEventID: String?
    /// WP-121 — guards the foreground-refresh path against re-entrancy: a rapid
    /// background→foreground toggle before the first refresh has updated
    /// `lastSync` could otherwise fire two overlapping `refresh()` (and two
    /// `syncClient.sync()`). Set on the main actor before the task, cleared when
    /// it finishes; the WP-60 coalescing already collapses the agenda-reload half.
    @State private var foregroundRefreshInFlight = false

    /// WP-146 — the floating `AssistantButton` collapses to the bare `sparkles`
    /// glyph while the board scrolls (the iOS 26 floating-button idiom); expanded
    /// at the top / at rest. Driven by the `onScrollGeometryChange` observer below,
    /// which reads the active tab's List scroll offset. Reset to expanded on a tab
    /// switch (the new side starts at the top).
    @State private var assistantCollapsed = false

    @AppStorage(ThemeOverride.storageKey) private var themeOverrideRaw = ThemeOverride.system.rawValue
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    /// WP-146 — the live-now line reflows (never truncates) at Accessibility text
    /// sizes, mirroring the agenda rows (WP-134); DESIGN § Typografi: "Bryt aldri til
    /// trunkering når teksten vokser."
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var themeOverride: ThemeOverride {
        ThemeOverride(rawValue: themeOverrideRaw) ?? .system
    }

    init(
        syncClient: SyncClient = SyncClient(),
        dataStore: DataStore = DataStore(),
        notificationPlanner: NotificationPlanner = NotificationPlanner(),
        widgetReloader: WidgetReloading = WidgetCenterReloader(),
        profileStore: ProfileStore = ProfileStore(),
        profileSync: ProfileSyncCoordinator = ProfileSyncCoordinator(backend: ProfileSyncBackendFactory.make())
    ) {
        self.syncClient = syncClient
        self.dataStore = dataStore
        self.notificationPlanner = notificationPlanner
        self.widgetReloader = widgetReloader
        self.profileStore = profileStore
        self.profileSync = profileSync
        #if DEBUG
        // WP-70 — the XCUITest launch harness. Seed a deterministic cache +
        // reset the onboarding/theme `@AppStorage` flags BEFORE the view models
        // read from disk and BEFORE the onboarding decision below, so the whole
        // first frame is fixed. Reused via the existing `SPORTIVISTA_DEMO` env var
        // (value "uitest"); a no-op unless that value is set.
        UITestSeed.seedIfRequested(profileStore: profileStore)
        #endif
        let _t0 = CFAbsoluteTimeGetCurrent()
        // WP-121: the agenda's pull-to-refresh shares THIS view's planner +
        // widget reloader (one SyncFreshness), so every sync path — cold start,
        // background, pull — reconciles reminders + reloads the widget the same way.
        let freshness = SyncFreshness(notificationPlanner: notificationPlanner, widgetReloader: widgetReloader)
        self.freshness = freshness
        self._agenda = State(initialValue: AgendaViewModel(dataStore: dataStore, syncClient: syncClient, profileStore: profileStore, freshness: freshness))
        LaunchTrace.mark("agendaVM init", since: _t0)
        // WP-172 — the live-score store + poller. The poller loads the board OFF the
        // main actor each tick (same detached-decode pattern refresh() uses) and only
        // fetches ESPN when LiveScorePlan says a match is in-window. It is started/
        // stopped by scenePhase (foreground only), never here.
        let liveStore = LiveScoreStore()
        self._liveStore = State(initialValue: liveStore)
        let liveDataStore = dataStore
        self._livePoller = State(initialValue: LiveScorePoller(
            store: liveStore,
            loadEvents: { await Task.detached { liveDataStore.loadEvents() }.value }
        ))
        #if DEBUG
        // Screenshot harness: back the assistant with the deterministic mock
        // (so no "Apple Intelligence off" banner) when a demo mode is requested.
        if ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"] != nil {
            self._assistant = State(initialValue: AssistantViewModel(
                assistant: MockInterestAssistant(), profileStore: profileStore,
                index: EntityIndex(dataStore.loadEntities())
            ))
        } else {
            let _t1 = CFAbsoluteTimeGetCurrent()
            self._assistant = State(initialValue: AssistantViewModel(dataStore: dataStore, profileStore: profileStore))
            LaunchTrace.mark("assistantVM init", since: _t1)
        }
        #else
        self._assistant = State(initialValue: AssistantViewModel(dataStore: dataStore, profileStore: profileStore))
        #endif
        // WP-107 — the shared Nyheter model reads the SAME cache + profile store.
        let _t2 = CFAbsoluteTimeGetCurrent()
        self._news = State(initialValue: NewsModel(dataStore: dataStore, profileStore: profileStore))
        LaunchTrace.mark("newsModel init", since: _t2)

        // WP-31 — first-run decision, made before the first frame so there's no
        // flash of the agenda before the overlay. A SPORTIVISTA_DEMO launch never auto-
        // shows onboarding (the `.task` harness raises the requested state instead,
        // so the other demo modes aren't covered by the overlay).
        #if DEBUG
        // WP-70: the "uitest" harness is deliberately NOT treated as a
        // screenshot-demo (which suppresses the overlay) — it drives the REAL
        // onboarding gate, so its "onboarding" launch state shows the first-run
        // overlay exactly as a cold install would.
        let demoValue = ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"]
        let isDemo = demoValue != nil && demoValue != UITestSeed.demoMode
        #else
        let isDemo = false
        #endif
        let completed = UserDefaults.standard.bool(forKey: OnboardingGate.storageKey)
        self._showOnboarding = State(initialValue: !isDemo && OnboardingGate.shouldShow(
            completed: completed, profileIsEmpty: profileStore.load().isEmpty))
    }

    /// DEBUG screenshot harness: which onboarding step a `SPORTIVISTA_DEMO=onboarding-*`
    /// launch jumps to. Always defined (nil in the shipping flow).
    private var onboardingInitialStep: OnboardingStep? {
        #if DEBUG
        switch ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"] {
        case "onboarding-welcome": return .welcome
        case "onboarding-quickpicks": return .quickPicks
        case "onboarding-converse": return .converse
        // WP-202: the ritual step (brief + varsel-priming + widget).
        case "onboarding-ritual": return .ritual
        // WP-132: the assistant-intro step is the calm finish (was «landing»).
        case "onboarding-assistantintro", "onboarding-landing": return .assistantIntro
        default: return nil
        }
        #else
        return nil
        #endif
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "nb_NO")
        f.timeZone = FeedCompiler.osloTimeZone
        f.dateFormat = "EEEE d. MMMM"
        return f
    }()

    // WP-62 — the date is read from `Date()` at render time (not a per-second
    // `@State`): the ticking clock now lives in its own leaf (`TekstTVClock`)
    // that owns its timer, so ContentView's body is no longer invalidated every
    // second. The date string only changes at midnight and is fresh on any
    // re-render (agenda reload, foreground, panel toggle).
    private var dateLabel: String { Self.dateFormatter.string(from: Date()).uppercased() }

    var body: some View {
        ZStack {
        NavigationStack {
            VStack(alignment: .leading, spacing: 0) {
                header
                Rectangle()
                    .fill(SportivistaTokens.separator)
                    .frame(height: 1)
                rootTabPicker
                // WP-104: the root's two sides. «Uka» is the agenda (unchanged);
                // «Nyheter» is the (WP-106) news board, shipped here as a shell.
                switch rootTab {
                case .uka:
                    liveNowLine
                    filterLine
                    AgendaView(viewModel: agenda, liveStore: liveStore, onFollow: follow,
                               onUnfollow: unfollow, onRestore: restore,
                               onOpen: { assistant.recordOpened($0) },
                               openEventID: $requestedEventID)
                case .nyheter:
                    NewsView(news: news, assistant: assistant)
                }
            }
            // WP-144→WP-146: the assistant's ENTRY is a COMPACT floating button
            // pinned to the BOTTOM (the thumb-reachable zone) via
            // `safeAreaInset(.bottom)` — a pill that HUGS its content and reads
            // unmistakably as a BUTTON (not the false search-field affordance the
            // WP-104 capsule had). WP-146 (variant D) moves it to the bottom-TRAILING
            // corner (≈16 pt inset): even more thumb-reachable AND it clears the
            // reading column so it never occludes the last agenda/Nyheter row. It
            // COLLAPSES to the bare glyph while scrolling (`assistantCollapsed`).
            .safeAreaInset(edge: .bottom) {
                AssistantButton(onOpen: openAssistant, collapsed: assistantCollapsed)
                    .frame(maxWidth: .infinity, alignment: .trailing)
                    .padding(.trailing, 16)
            }
            // WP-146: collapse the floating button while the active tab's List
            // scrolls, re-expand at the top (jf. Foto/Musikk). `onScrollGeometryChange`
            // observes the scroll view WITHIN this subtree — the Uka List or the
            // Nyheter List, whichever tab is shown — so no child view needs to report
            // up. The derived Bool flips once, ~40 pt below the top (a small
            // dead-zone so a resting board stays expanded). The parent owns the
            // animation, honouring Reduce Motion (no animation then).
            .onScrollGeometryChange(for: Bool.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top > 40
            } action: { _, collapsed in
                guard collapsed != assistantCollapsed else { return }
                if reduceMotion {
                    assistantCollapsed = collapsed
                } else {
                    withAnimation(.easeInOut(duration: 0.22)) { assistantCollapsed = collapsed }
                }
            }
            // A tab switch shows a fresh List at the top — expand the button so it
            // never lands on the new side already collapsed.
            .onChange(of: rootTab) { _, _ in
                if assistantCollapsed { assistantCollapsed = false }
            }
            .background(SportivistaTokens.background.ignoresSafeArea())
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // WP-144 removed the WP-143 `sparkles` toolbar item; the assistant
                // now enters from the bottom button above. The gearshape stays the
                // sole header toolbar button (settings → Deg, conventionally furthest
                // to the trailing edge).
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showDeg = true } label: {
                        Image(systemName: "gearshape")
                    }
                    .tint(SportivistaTokens.accent)
                    .accessibilityLabel("Innstillinger")
                    .accessibilityIdentifier("nav.settings")
                }
            }
            .navigationDestination(isPresented: $showDeg) {
                DegView(
                    viewModel: assistant,
                    onRerunOnboarding: rerunOnboarding,
                    onReset: performReset,
                    syncEnabled: profileSync.backend.isEnabled,
                    publishedAppVersion: dataStore.loadAppVersion()
                )
            }
            // WP-104 → WP-143 → WP-144 — the assistant conversation sheet (detents +
            // grabber), raised over the root from the floating bottom button. Reset
            // the dictation flag when the sheet closes, so a plain button tap next
            // time opens it un-focused.
            .sheet(isPresented: $sheetShown, onDismiss: { sheetStartFocused = false }) {
                AssistantSheetView(viewModel: assistant, dismiss: closeSheet, startFocused: sheetStartFocused)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
            // WP-83 — the «hva vet du om meg» / «del profil» commands (and a
            // scanned QR) reach the memory / share surfaces that now live in Deg.
            .sheet(isPresented: $memorySheetShown) {
                WhatIKnowView(viewModel: assistant)
            }
            .sheet(isPresented: $shareSheetShown) {
                ProfileShareSheet(viewModel: assistant)
            }
        }
        #if DEBUG
        demoOverlay
        #endif
        // WP-31 — the first-run onboarding, above everything (its own command-line
        // idiom + diff), fading away into an agenda that already reflects the
        // choices (every confirm/tap recompiled it behind the overlay).
        if showOnboarding {
            OnboardingView(
                assistant: assistant,
                onFinish: finishOnboarding,
                onSkip: finishOnboarding,
                onTryAssistant: finishThenOpenAssistant,
                initialStep: onboardingInitialStep
            )
            .transition(.opacity)
            .zIndex(10)
        }
        }
        .background(SportivistaTokens.background.ignoresSafeArea())
        .foregroundStyle(SportivistaTokens.label)
        .preferredColorScheme(themeOverride.colorScheme)
        .task {
            // Recompile the agenda the instant the assistant applies a change
            // (move 4). Set here (not in init) so it can capture `agenda`.
            // WP-107: the Nyheter board re-lenses on the SAME change (off-main),
            // so a just-added follow is reflected even while Nyheter is off-screen
            // — the board is ready the next time the user switches to it.
            assistant.onProfileChanged = {
                agenda.reloadFromCache(now: Date())
                news.rebuild()
            }
            // WP-66 — the assistant's command arm's HOST-owned side effects
            // (theme override, re-onboarding, the confirmed reset, opening an
            // event's detail). VM-owned effects run inside the view model.
            assistant.onCommand = { performCommand($0) }
            // WP-67 — the present arm applies an EPHEMERAL filter to the agenda
            // («vis bare golf denne uka»). A pure view layer — never the profile.
            assistant.onPresent = { agenda.applyFilter($0) }
            #if DEBUG
            if let mode = ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"] {
                // WP-18: seed a deterministic lensed golf agenda + the profile
                // rule BEFORE the first reload, so the screenshot shows the lens
                // with no network round-trip.
                if mode == "lens" {
                    LensDemoSeed.seed(profileStore: profileStore)
                    agenda.reloadFromCache(now: Date())
                }
                // WP-67: the presentation-filter screenshot — reuse the lens
                // demo's golf+football board, then apply a golf-only view filter
                // so the quiet «VISER: GOLF» line shows over the filtered agenda.
                if mode == "filter" {
                    LensDemoSeed.seed(profileStore: profileStore)
                    agenda.reloadFromCache(now: Date())
                    agenda.applyFilter(AgendaFilter(sports: ["golf"]))
                }
                // WP-135: the agenda ROW-WIDTH bug class — a wide matchup title
                // ("100 Thieves – Ninjas in Pyjamas") that pushed the fixed-size
                // time column off the left edge. Seeds a wide-title clock row +
                // a short-title control + a multi-day WINDOW row so the fix can
                // be verified (time whole, title wrapped, window intact) offline.
                if mode == "agenda-width" {
                    AgendaWidthDemoSeed.seed(profileStore: profileStore)
                    agenda.reloadFromCache(now: Date())
                }
                // WP-185: the entity-avatar ladder — a white-kitted club (black
                // computed ink), a contrasting club, an athlete + a landslag flag,
                // and a row we know nothing about (sport glyph). One board, all
                // three rungs, offline and deterministic in either appearance.
                if mode == "identity" {
                    EntityIdentityDemoSeed.seed(profileStore: profileStore)
                    agenda.reloadFromCache(now: Date())
                }
                // WP-19/WP-83: seed a small profile so the share panel shows a
                // real QR + link (the export needs a non-empty profile). Rendered
                // full-screen via demoOverlay (a `.sheet` is a no-op in the launch
                // `.task`) — the share surface now lives in Deg (ProfileShareSheet).
                if mode == "share" {
                    let now = Date()
                    try? profileStore.save(InterestProfile(rules: [
                        InterestRule(entityId: "casper-ruud", entityName: "Casper Ruud", sport: "tennis",
                                     scope: "bare i Grand Slams", weight: 0.8, reason: "Norsk tennisstjerne.",
                                     addedAt: now, lens: .throughNorwegians),
                        InterestRule(entityId: "viktor-hovland", entityName: "Viktor Hovland", sport: "golf",
                                     scope: nil, weight: 0.6, reason: "Følger norsk golf.", addedAt: now),
                    ]), now: now)
                    assistant.reloadProfile()
                    demoSheet = .share
                }
                // WP-83: the Deg screen screenshot — seed a profile + memory so the
                // counts read real, then push Deg (navigation works from `.task`).
                if mode == "deg" {
                    let now = Date()
                    try? profileStore.save(InterestProfile(rules: [
                        InterestRule(entityId: "casper-ruud", entityName: "Casper Ruud", sport: "tennis",
                                     scope: nil, weight: 0.8, reason: "Norsk tennisstjerne.", addedAt: now),
                        InterestRule(entityId: "viktor-hovland", entityName: "Viktor Hovland", sport: "golf",
                                     scope: nil, weight: 0.6, reason: "Følger norsk golf.", addedAt: now),
                    ]), now: now)
                    MemoryDemoSeed.seedMemory(into: MemoryStore(profileStore: profileStore))
                    assistant.reloadProfile()
                    assistant.refreshMemory()
                    showDeg = true
                }
                // WP-30: memory page + spoiler-masked detail sheet, shown as a
                // full-screen demo overlay (a sheet raised during the launch
                // `.task` is a SwiftUI no-op; the overlay renders the SAME real
                // WhatIKnowView / EventDetailSheet content).
                if mode == "memory" {
                    MemoryDemoSeed.seedMemory(into: MemoryStore(profileStore: profileStore))
                    assistant.refreshMemory()
                    demoSheet = .memory
                }
                if mode == "spoiler" {
                    demoSheet = .spoiler(MemoryDemoSeed.spoilerRow())
                }
                // WP-252: the symmetric HANDLINGER section — one subject you
                // follow (renders «Slutt å følge»), one you don't («Følg»), in
                // one deterministic sheet, offline. Tapping either flips it in
                // place: the sheet IS the undo.
                // `follow-sheet-tett` is the SAME sheet in its densest honest
                // state: both teams AND the tournament followed, so HANDLINGER
                // carries three «Slutt å følge» rows (the subject cap is three).
                // `follow-sheet-forste` (WP-254) is the same sheet over an EMPTY
                // profile: both subjects read «Følg …», so the first tap IS the
                // profile's first rule — the moment the board stops being broad.
                if mode == "follow-sheet" || mode == "follow-sheet-tett" || mode == "follow-sheet-forste" {
                    let dense = mode == "follow-sheet-tett"
                    let first = mode == "follow-sheet-forste"
                    let row = FollowSymmetryDemoSeed.row(dense: dense, noneFollowed: first)
                    let seeded: InterestProfile
                    if first { seeded = FollowSymmetryDemoSeed.emptyProfile() }
                    else if dense { seeded = FollowSymmetryDemoSeed.denseProfile() }
                    else { seeded = FollowSymmetryDemoSeed.profile() }
                    try? profileStore.save(seeded)
                    assistant.reloadProfile()
                    demoSheet = .followSheet(row)
                }
                // WP-31 onboarding screenshots — the mock-backed assistant reads
                // "available", so the conversation step renders. Seed per sub-mode
                // and raise the overlay (initialStep jumps to the right step).
                if mode.hasPrefix("onboarding") {
                    switch mode {
                    case "onboarding-converse":
                        // One already-followed rule (so "Følger nå" shows) + a
                        // pending diff (the FORSLAG block).
                        try? profileStore.save(InterestProfile(rules: [
                            InterestRule(entityId: "fk-lyn-oslo", entityName: "FK Lyn Oslo", sport: "football",
                                         scope: nil, weight: 0.5, reason: "Du ba om å følge FK Lyn Oslo.", addedAt: Date()),
                        ]))
                        assistant.reloadProfile()
                        assistant.demoSeed("diff")
                    case "onboarding-quickpicks":
                        if let golf = StarterPacks.all.first(where: { $0.id == "norske-golfere" }) {
                            assistant.toggleStarterPack(golf)
                        }
                    case "onboarding-assistantintro", "onboarding-landing", "onboarding-landed":
                        // WP-99: seed a deterministic golf board (two multi-day
                        // tournaments spanning today) so the post-onboarding
                        // agenda renders OFFLINE — the multi-day WINDOW rows this
                        // catalog screen is meant to show can't come from the live
                        // board in a network-free screenshot run.
                        GolfBoardDemoSeed.seed(profileStore: profileStore)
                        assistant.reloadProfile()
                        if let golf = StarterPacks.all.first(where: { $0.id == "norske-golfere" }) {
                            assistant.toggleStarterPack(golf)
                        }
                    default:
                        break
                    }
                    // "onboarding-landed" shows the FILLED agenda (overlay off);
                    // every other onboarding-* mode raises the overlay.
                    if mode != "onboarding-landed" { showOnboarding = true }
                    agenda.reloadFromCache(now: Date())
                }
                // WP-32/WP-83 — the reset UI now lives in Deg › Nullstill.
                // reset-entry/-confirm push Deg (navigation works from `.task`);
                // reset-onboarding runs the REAL `performReset` path so the
                // onboarding overlay that follows is the exact state a user sees.
                if mode.hasPrefix("reset") {
                    try? profileStore.save(InterestProfile(rules: [
                        InterestRule(entityId: "fk-lyn-oslo", entityName: "FK Lyn Oslo", sport: "football",
                                     scope: nil, weight: 0.5, reason: "Du ba om å følge FK Lyn Oslo.", addedAt: Date()),
                    ]))
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                    switch mode {
                    case "reset-entry", "reset-confirm":
                        showDeg = true
                    case "reset-onboarding":
                        performReset(.followedOnly)
                    default:
                        break
                    }
                }
                // WP-104: the OPENED conversation sheet (tilstand 1) — the one
                // hjelpesetning + the three tappable example rows. Renders the
                // real AssistantSheetView full-screen via demoOverlay with an
                // EMPTY view model (no seeded result), so its opened state shows.
                // (Replaces the WP-99 "command-focused" mode — the inline command
                // line is gone.)
                if mode == "assistant-sheet" {
                    GolfBoardDemoSeed.seed(profileStore: profileStore)
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                    demoSheet = .assistantResult
                }
                // WP-106: the Nyheter board (four sections) — seed a deterministic
                // news/featured/results/events cache + a matching follow-profile,
                // then switch the root to the Nyheter side so the screenshot
                // captures the board (not the agenda).
                if mode == "news" {
                    NewsDemoSeed.seed(profileStore: profileStore)
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                    rootTab = .nyheter
                }
                // WP-152 (normativ — eier-godkjent 21.07): the masthead colon LIVE signal. Seed a
                // deterministically-live event so `agenda.liveNow` (the SAME
                // signal the ▌ LIVE line uses) is non-empty and the header «:»
                // pulses — deterministic, offline, reproducible for the feel-test
                // + screenshots. `masthead-live` shows the pulse; `masthead-calm`
                // seeds the SAME board without the live row (colon static) as the
                // neutral control.
                if mode == "masthead-live" {
                    MastheadLiveDemoSeed.seed(profileStore: profileStore)
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                }
                if mode == "masthead-calm" {
                    MastheadLiveDemoSeed.seed(profileStore: profileStore, live: false)
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                }
                // WP-172: the live-score row. Seeds a live Lyn match + its score in
                // the store (no ESPN call — the poller stays OFF in a demo run) so the
                // agenda row shows "2–1 · 67'" in its meta line, deterministically.
                if mode == "live" {
                    LiveScoreDemoSeed.seed(profileStore: profileStore, liveStore: liveStore)
                    assistant.reloadProfile()
                    agenda.reloadFromCache(now: Date())
                }
                assistant.demoSeed(mode)
                // WP-83: a diff/answer screenshot renders the (slimmed) result
                // panel full-screen via demoOverlay (a `.sheet` is a no-op in the
                // launch `.task`; in the live app the result IS a native sheet).
                if mode == "diff" || mode == "answer" { demoSheet = .assistantResult }
            }
            #endif
            await refresh()
            // WP-19 — one profile sync round at launch (no-op on LocalOnly).
            await assistant.runBackgroundSync(using: profileSync)
            // WP-172 — begin foreground live-score polling (a no-op in a demo run, so
            // the seeded demo score is never clobbered by a real ESPN fetch).
            startLivePolling()
        }
        // A fresh assistant result raises the result sheet.
        // WP-31: while onboarding is up it renders its OWN diff/answer inline, so
        // don't also raise the sheet behind the overlay.
        .onChange(of: assistant.presentToken) { _, _ in
            guard !showOnboarding else { return }
            sheetShown = true
        }
        // WP-83 — the «hva vet du om meg» / «del profil» commands reach the
        // memory / share surfaces (their permanent home is Deg; these are the
        // command shortcuts). The view model bumps a token per command.
        .onChange(of: assistant.memoryRequestToken) { _, _ in memorySheetShown = true }
        .onChange(of: assistant.shareRequestToken) { _, _ in shareSheetShown = true }
        // WP-19 — a scanned QR / opened share link imports on the spot, MERGING
        // into this device's profile (never overwriting); the agenda recompiles
        // via `onProfileChanged`, and the confirmation shows in the share sheet.
        .onOpenURL { url in
            assistant.importSharedProfile(from: url)
            shareSheetShown = true
        }
        // WP-19 — offline-first pull → merge → push on foreground (a no-op on the
        // LocalOnly backend; the real round-trip only happens on a CloudKit build).
        // Runs on EVERY becoming-active, unchanged.
        // WP-121 — data-freshness on foreground: a genuine return FROM background
        // to a STALE cache (≥15 min since the last data sync) runs a FULL refresh
        // (sync + agenda reload + widget reload + notification reconcile). Before
        // WP-121 foreground ran ONLY the profile CloudKit round (audit 🟡), so an
        // app left open for hours showed a stale board until the next background
        // task. Gating on `oldPhase == .background` keeps the launch inactive→active
        // (the cold-start `.task` owns that) and a transient control-center peek
        // (active→inactive→active) from re-syncing; the staleness gate skips a quick
        // return (< 15 min); the in-flight flag + WP-60 coalescing keep a rapid
        // toggle from double-syncing.
        .onChange(of: scenePhase) { oldPhase, phase in
            // WP-172 — live polling follows the FOREGROUND: resume on active, stop the
            // moment we leave it (no background polling — a binding non-goal). iOS
            // suspends the timer anyway; the explicit stop makes the contract exact.
            if phase == .active { startLivePolling() } else { livePoller.stop() }
            guard phase == .active else { return }
            Task { await assistant.runBackgroundSync(using: profileSync) }
            guard oldPhase == .background else { return }
            // WP-136: re-evaluate the DAY-GATED Nyheter brief with a fresh `now` on
            // EVERY return from background — independent of the 15-min data-freshness
            // gate below and of whether the sync changes anything. A brief that was
            // «i dag» when the app was backgrounded must disappear once the Oslo day
            // has rolled (overnight reopen), WITHOUT waiting for a new download. This
            // reuses the WP-107 off-main coalescing build (NewsModel.rebuild →
            // nonisolated computeBoard, lazy EntityIndex), so foreground stays
            // instant — the board just re-lenses a moment later off the main thread;
            // no decode/matching on main, no timer.
            news.rebuild()
            if !foregroundRefreshInFlight,
               ForegroundSyncGate.shouldRefresh(lastSync: dataStore.lastSync, now: Date()) {
                foregroundRefreshInFlight = true
                // @MainActor so the post-await flag reset stays on the main actor
                // (refresh() is itself @MainActor; the flag is @State on this View).
                Task { @MainActor in
                    await refresh()
                    foregroundRefreshInFlight = false
                }
            }
        }
    }

    #if DEBUG
    /// Full-screen demo overlay for the WP-30 screenshots — renders the real
    /// memory page / spoiler-masked detail sheet content over an opaque backdrop
    /// (a `.sheet` won't present when raised during the launch `.task`).
    @ViewBuilder
    private var demoOverlay: some View {
        if let demoSheet {
            SportivistaTokens.background.ignoresSafeArea()
            switch demoSheet {
            case .memory: WhatIKnowView(viewModel: assistant)
            case .spoiler(let row): EventDetailSheet(row: row)
            case .followSheet(let row):
                EventDetailSheet(row: row, onFollow: follow, onUnfollow: unfollow, onRestore: restore)
            case .assistantResult: AssistantSheetView(viewModel: assistant, dismiss: closeSheet)
            case .share: ProfileShareSheet(viewModel: assistant)
            }
        }
    }
    #endif

    // MARK: - Actions

    /// A "Følg <entitet>" tapped in the event detail sheet — apply it directly
    /// via the WP-105 assistant-free follow path (a tap IS the confirmation; §3b
    /// "snarvei, aldri eneste vei"). It persists + recompiles the agenda via
    /// `onProfileChanged`; no assistant diff sheet.
    ///
    /// WP-254 — it hands the outcome back to the sheet, whose receipt has to say
    /// so when this was the profile's FIRST rule (the tap that narrows a broad
    /// board). Optional only to match the sheet's closure type; the view model's
    /// answer is never nil.
    private func follow(_ entity: Entity) -> FollowOutcome? {
        assistant.follow(entity)
    }

    /// WP-252 — «Slutt å følge <entitet>» tapped in the same detail sheet. The
    /// mirror of `follow` all the way down: `AssistantViewModel.unfollow` resolves
    /// the rule and reuses `removeRule`, so this persists + recompiles the agenda
    /// through exactly the path Deg › Det du følger uses. It hands the removed
    /// rule back to the sheet, which is what makes the undo a restore.
    private func unfollow(_ entity: Entity) -> UnfollowOutcome? {
        assistant.unfollow(entity)
    }

    /// WP-252 — the undo: put a rule the sheet just removed back verbatim, with
    /// its scope, lens and weight intact. Same store, same recompile.
    private func restore(_ rule: InterestRule) {
        assistant.restore(rule)
    }

    /// WP-66 — the HOST-owned side of an assistant command. Theme, re-onboarding,
    /// the confirmed reset, and opening an event's detail live here (they own
    /// @AppStorage / the onboarding overlay / the agenda's detail sheet); the
    /// share/memory/forget/notification commands are performed inside the view
    /// model and never reach this closure. When `.openEvent` arrives here its
    /// associated value is the RESOLVED event id (see AssistantViewModel).
    private func performCommand(_ command: AssistantCommand) {
        switch command {
        case let .setTheme(theme):
            themeOverrideRaw = theme.rawValue
        case .rerunOnboarding:
            rerunOnboarding()
        case let .resetProfile(level):
            performReset(level)
        case let .openEvent(id):
            requestedEventID = id
        case .shareProfile, .showMemory, .forgetMemory, .setNotificationLeadTime:
            break
        }
    }

    // MARK: - WP-31 — onboarding

    /// Finish or skip onboarding: mark it done (persistent flag) and fade the
    /// overlay away. The agenda underneath already reflects every confirm/tap
    /// (onProfileChanged recompiled it live), so there's nothing more to do.
    private func finishOnboarding() {
        onboardingCompleted = true
        withAnimation(.easeOut(duration: 0.15)) { showOnboarding = false }
        agenda.reloadFromCache(now: Date())
    }

    /// Re-run onboarding on demand from Deg › Sett opp på nytt — pops the Deg
    /// screen / closes any assistant sheet and raises the overlay fresh (it
    /// re-enters at `.welcome`).
    private func rerunOnboarding() {
        sheetShown = false
        showDeg = false
        withAnimation(.easeOut(duration: 0.15)) { showOnboarding = true }
    }

    /// WP-32 — the confirmed "Nullstill" action: reset the profile (and, at
    /// the GDPR level, all personal memory + the misunderstood log) on THIS
    /// device, then raise the onboarding overlay immediately — the owner's
    /// ask, verbatim: never having to reinstall the app to re-onboard. Pops the
    /// Deg screen (reset is reached from Deg › Nullstill) so the overlay is clean.
    private func performReset(_ level: ResetLevel) {
        assistant.resetProfile(level)
        onboardingCompleted = false
        agenda.reloadFromCache(now: Date())
        sheetShown = false
        showDeg = false
        if reduceMotion {
            showOnboarding = true
        } else {
            withAnimation(.easeOut(duration: 0.15)) { showOnboarding = true }
        }
    }

    /// WP-132 — «Prøv nå» / a tapped example from the onboarding assistant-intro
    /// step: finish onboarding, then open the assistant sheet (focused, so the
    /// keyboard is ready) — optionally pre-filling the field with `prefill` so
    /// the user sees exactly how the phrase is said. The confirmed follow lands
    /// on the SAME profile the packs did.
    private func finishThenOpenAssistant(_ prefill: String?) {
        if let prefill { assistant.utterance = prefill }
        finishOnboarding()
        sheetStartFocused = true
        sheetShown = true
    }

    /// WP-144 — the floating bottom `AssistantButton` — open the conversation sheet
    /// (un-focused; diktering is a tap on the sheet field's keyboard mic). Onboarding
    /// still opens it focused via `finishThenOpenAssistant` (`sheetStartFocused`).
    private func openAssistant() {
        sheetStartFocused = false
        sheetShown = true
    }

    private func closeSheet() {
        withAnimation(.easeOut(duration: 0.15)) { sheetShown = false }
    }

    /// WP-172 — start the foreground live-score poller, UNLESS this is a demo run
    /// (a demo seeds the store directly and must not be clobbered by a real ESPN
    /// fetch, exactly like the lens/masthead demos skip the live sync). Idempotent.
    private func startLivePolling() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"] != nil { return }
        #endif
        livePoller.start()
    }

    private func refresh() async {
        LaunchTrace.point("refresh start")
        agenda.reloadFromCache(now: Date())
        #if DEBUG
        // WP-18/WP-70: the lens screenshot demo and the XCUITest harness both run
        // entirely off their seeded cache — a live sync would clobber it (and make
        // the flows non-deterministic), so don't fetch (and don't schedule
        // notifications) in those modes. WP-152: the masthead colon demos likewise
        // depend on the seeded (deterministically-live) board surviving.
        let demoMode = ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"]
        if demoMode == "lens" || demoMode == "filter" || demoMode == UITestSeed.demoMode
            || demoMode == "masthead-live" || demoMode == "masthead-calm" || demoMode == "live" { return }
        #endif
        // WP-107: decode the pre-sync events OFF the main actor. This was a
        // synchronous full-events.json decode ON the main thread, fired right
        // after the first cache paint was scheduled — it stole the main thread
        // exactly when the off-main agenda reload wanted to hop back and apply,
        // so "Henter data …" lingered longer than it needed to at every launch.
        let dataStore = self.dataStore
        // WP-255: bound locally for the same reason `dataStore` is — the reminder
        // inputs are gathered inside a detached task below.
        let profileStore = self.profileStore
        let _tp = CFAbsoluteTimeGetCurrent()
        let previousEvents = await Task.detached { dataStore.loadEvents() }.value
        LaunchTrace.mark("pre-sync events decode", since: _tp)
        let _ts = CFAbsoluteTimeGetCurrent()
        let syncResult = await syncClient.sync()
        LaunchTrace.mark("network sync", since: _ts)
        // Eier-funn 19.07: the old path unconditionally invalidated the entity
        // index and forced a SECOND full reload+compile on every launch — even
        // when the sync came back 304/upToDate (the common case within the
        // hour). SyncResult already knows exactly which files changed; only do
        // the work those files actually invalidate.
        let changedFiles: Set<String>
        switch syncResult {
        case .changedFiles(let files): changedFiles = Set(files)
        case .upToDate, .failure: changedFiles = []
        }
        let agendaInputs: Set<String> = ["events.json", "entities.json", "tracked.json"]
        if changedFiles.contains("entities.json") { agenda.invalidateEntityCache() }
        if !changedFiles.isDisjoint(with: agendaInputs) {
            agenda.reloadFromCache(now: Date())
        }
        // WP-121: the home-screen widget reads events (+ entities via the feed);
        // nudge WidgetKit to rebuild its timeline whenever either changed, so it
        // never sits behind the app's own board (its own reload policy only fires
        // at the Oslo day boundary — the audit's ~24h-stale 🔴). A 304/no-op sync
        // changes neither, so a quiet launch skips it.
        // WP-176: recent-results.json feeds the widget's «siste resultat»-linje,
        // so re-render that line (spoiler-filtered, in the app where the profile
        // lives) BEFORE nudging WidgetKit — and only then reload.
        if changedFiles.contains("recent-results.json") {
            let syncState = profileStore.loadSyncState()
            await freshness.deliverResults(
                SyncFreshness.ResultInputs(
                    previousResults: RecentResults(),
                    newResults: dataStore.loadRecentResults(),
                    profile: syncState.profile,
                    entities: dataStore.loadEntities(),
                    shield: SpoilerShield(memory: MemoryState(from: syncState)),
                    optedIn: []
                ),
                deliverAlerts: false
            )
        }
        if !changedFiles.isDisjoint(with: SyncFreshness.widgetInputs.union(SyncFreshness.resultInputs)) {
            widgetReloader.reloadAllTimelines()
        }
        #if DEBUG
        // The screenshot harness must not trip the first-launch notification
        // permission alert over the design it's capturing (and must keep the
        // seeded Nyheter board — so no post-sync news rebuild in a demo run).
        if ProcessInfo.processInfo.environment["SPORTIVISTA_DEMO"] != nil { return }
        #endif
        // WP-107: the sync may have rewritten news/featured/results/events — rebuild
        // the Nyheter board (off-main) so it is fresh and ready before the user ever
        // switches to it. Skipped when none of its inputs changed.
        let newsInputs: Set<String> = ["news.json", "featured.json", "recent-results.json", "events.json", "entities.json"]
        if !changedFiles.isDisjoint(with: newsInputs) {
            news.rebuild()
        }
        // Notification reconcile needs the post-sync board only when events
        // actually changed (or we have never reconciled after a first-ever sync);
        // on an unchanged launch previous==new and there is nothing to re-plan.
        guard changedFiles.contains("events.json") else { return }
        // WP-107: decode the post-sync events off the main actor too (was a second
        // synchronous full-decode on main).
        // WP-255: the reminder inputs (effective interests + the profile's lens)
        // ride along in the SAME detached hop — `Inputs.load` decodes the profile
        // and, here, entities.json, which has no business running on main.
        let (newEvents, reminders) = await Task.detached {
            (dataStore.loadEvents(), NotificationPlanner.Inputs.load(dataStore: dataStore, profileStore: profileStore))
        }.value
        await notificationPlanner.reconcile(
            previousEvents: previousEvents,
            newEvents: newEvents,
            interests: reminders.interests,
            lastSync: dataStore.lastSync,
            // WP-66 — honour the assistant-set notification lead-time preference.
            leadTimeEnabled: NotificationLeadPreference.isLeadTimeEnabled(),
            profile: reminders.profile,
            index: reminders.index
        )
    }

    // MARK: - Header

    // WP-83 → WP-143 → WP-144 — the brand header, stripped of the v2 header glyphs:
    // the theme toggle (`◐`) moved to Deg › Utseende, and the `»_` assistant shortcut
    // gave way first to the bottom command line, then (WP-143) to a header `sparkles`
    // toolbar button, and now (WP-144) to the floating bottom `AssistantButton` — the
    // assistant's honest, reachable entry (see `safeAreaInset(.bottom)`). The
    // amber-ticking clock is dropped too (DESIGN § Bevegelse: "Tid bor i raden +
    // systemets statusbar"). Settings live behind the nav bar's gearshape. Just the
    // wordmark and the date remain — one quiet masthead.
    private var header: some View {
        VStack(alignment: .leading, spacing: 5) {
            // The brand lock (designprofil rev 2, kandidat A «Kolonet»):
            // wordmark in label colour + the amber colon — the ":" from every
            // time on the board, the app's core answer («når») as the mark.
            // Amber stays accent-only; no separate image mark (ensō retired).
            //
            // WP-152 (normativ — eier-godkjent 21.07): that colon becomes the app's
            // LIVE signature. It reads liveness from the EXISTING signal — the same
            // `agenda.currentLiveRows` the ▌ LIVE line uses (`liveNowLine`) — so the
            // colon and the line can NEVER disagree. A minute tick (TimelineView,
            // matching the live line) keeps them in step between reloads. When
            // something followed is live NOW the colon pulses calmly (see
            // `MastheadColon`); otherwise it is the static amber accent it is today.
            // Amber stays accent-only — the pulse only breathes the same amber.
            TimelineView(.everyMinute) { context in
                let liveRows = agenda.currentLiveRows(now: context.date)
                HStack(alignment: .center, spacing: 0) {
                    Text("SPORTIVISTA")
                        // WP-183: the display face — one of its exactly three
                        // surfaces. The colon stays ONE step heavier (BRAND.md
                        // rule 2), now 600 vs 700 within the display family.
                        .font(.sportivistaDisplay(.title, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.label)
                        .tracking(2)
                    MastheadColon(isLive: !liveRows.isEmpty)
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Self.mastheadLabel(liveCount: liveRows.count))
            }
            Text(dateLabel)
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// WP-152 — the masthead's accessibility label. When something followed is
    /// live the label SAYS so (a11y parity with the visible pulse), with the count
    /// when more than one is on; otherwise the plain wordmark.
    private static func mastheadLabel(liveCount: Int) -> String {
        switch liveCount {
        case 0: return "Sportivista"
        case 1: return "Sportivista — sender nå"
        default: return "Sportivista — sender nå, \(liveCount) direkte"
        }
    }

    // MARK: - Root segmented (WP-104 — «Uka | Nyheter»)

    /// The root's two sides as ORDS in a native segmented Picker (spec § 3a:
    /// "Ord foran ikoner"). Both sides cover the whole week; the split is what's
    /// HAPPENING (Uka) vs what's NEW (Nyheter).
    private var rootTabPicker: some View {
        Picker("Visning", selection: $rootTab) {
            ForEach(RootTab.allCases) { tab in
                Text(tab.label).tag(tab)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .accessibilityIdentifier("root.tabs")
    }

    @ViewBuilder
    private var liveNowLine: some View {
        // WP-126: a light minute tick so the line stays TRUE between reloads — a
        // finished event drops and a just-started one appears without waiting for
        // the next sync. `TimelineView(.everyMinute)` is a data refresh, not an
        // animation (Reduce-Motion-friendly; never per-second). `currentLiveRows`
        // re-derives from the reload snapshot through the SAME shared live
        // definition (`liveState`) the compile used.
        TimelineView(.everyMinute) { context in
            let rows = agenda.currentLiveRows(now: context.date)
            if !rows.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(rows) { row in
                        if dynamicTypeSize.isAccessibilitySize {
                            // WP-146: at Accessibility text sizes the one-line HStack
                            // truncated («The Open» → «The O…», «TV 2 Play» → «TV 2…»).
                            // DESIGN § Typografi: "Bryt aldri til trunkering når teksten
                            // vokser — omform kilden." Reflow like the agenda rows
                            // (WP-134): the LIVE badge + title, then the channel on its
                            // own line, all wrapping/un-truncated (the «·» separator is
                            // dropped — it only reads on one line).
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(alignment: .firstTextBaseline, spacing: 8) {
                                    Text("▌ LIVE")
                                        .font(.sportivista(.caption, weight: .semibold))
                                        .foregroundStyle(SportivistaTokens.live)
                                    Text(row.title)
                                        .font(.sportivista(.subheadline))
                                        .foregroundStyle(SportivistaTokens.label)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Text(row.channelLabel)
                                    .font(.sportivista(.subheadline))
                                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        } else {
                            HStack(spacing: 8) {
                                Text("▌ LIVE")
                                    .font(.sportivista(.caption, weight: .semibold))
                                    .foregroundStyle(SportivistaTokens.live)
                                Text(row.title)
                                    .font(.sportivista(.subheadline))
                                    .foregroundStyle(SportivistaTokens.label)
                                    .lineLimit(1)
                                Text("·")
                                    .font(.sportivista(.subheadline))
                                    .foregroundStyle(SportivistaTokens.secondaryLabel.opacity(0.6))
                                Text(row.channelLabel)
                                    .font(.sportivista(.subheadline))
                                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
                Rectangle()
                    .fill(SportivistaTokens.separator)
                    .frame(height: 1)
            }
        }
    }

    /// WP-67 — the quiet filter line over the agenda when a presentation filter
    /// is active («VISER: GOLF · DENNE UKA ✕»). Calm to the core:
    /// dempet «VISER:», the amber subject, and a one-tap ✕ that resets. Hidden
    /// when no filter is set — the calm default is an unfiltered board.
    @ViewBuilder
    private var filterLine: some View {
        if let filter = agenda.filter, !filter.isEmpty {
            VStack(spacing: 0) {
                HStack(spacing: 8) {
                    Text("VISER:")
                        .font(.sportivista(.caption, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                    Text(filter.subjectLabel)
                        .font(.sportivista(.caption, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(SportivistaTokens.accent)
                        .lineLimit(1)
                        .accessibilityIdentifier("agenda.filter.label")
                    Spacer(minLength: 8)
                    Button {
                        withAnimation(.easeOut(duration: 0.15)) { agenda.applyFilter(nil) }
                    } label: {
                        Text("✕")
                            .font(.sportivista(.subheadline, weight: .semibold))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                    }
                    .accessibilityLabel("Fjern filter")
                    .accessibilityIdentifier("agenda.filter.reset")
                    .sportivistaTapTarget()
                }
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.horizontal, 20)
                .padding(.vertical, 10)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("agenda.filterBar")
            Rectangle()
                .fill(SportivistaTokens.separator)
                .frame(height: 1)
        }
    }
}

/// WP-152 (normativ — eier-godkjent 21.07) — the masthead's amber «:» as the app's
/// LIVE signature. Driven by the EXISTING live signal (ContentView passes
/// `isLive = !agenda.currentLiveRows.isEmpty`, the same source as the ▌ LIVE
/// line), so colon and line never disagree.
///
/// The pulse is a CALM heartbeat, not an alarm: a slow (~1.6 s) ease-in-out,
/// autoreversing breath of opacity (1.0 ↔ 0.5) plus a soft amber glow that
/// breathes with it. NO layout shift — only opacity/shadow animate, so the
/// colon's frame stays put and «SPORTIVISTA» never nudges. No colour change
/// beyond the one amber accent.
///
/// Accessibility & low-power:
///  • Reduce Motion (BINDING): no motion at all — instead a STATIC "on" tell
///    (a steady soft amber glow) so live is still readable without animation.
///  • The a11y label is set by the parent masthead («… sender nå»).
/// It degrades gracefully: not live ⇒ exactly the static amber colon it was
/// before this signal (glow clear, full opacity), one weight step heavier
/// than the wordmark (WP-183: the display face's `.bold` against its `.semibold`).
private struct MastheadColon: View {
    /// Whether something the user follows is live NOW — the ONE input.
    let isLive: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The breathing phase. Held at `pulses` (true while a live pulse should run),
    /// toggled under a repeatForever autoreversing animation so the presentation
    /// oscillates between the bright (1.0) and dim (0.5) states.
    @State private var breathing = false

    /// The calm pulse runs only when live AND motion is allowed. With Reduce
    /// Motion on we never animate — a steady glow carries the signal instead.
    private var pulses: Bool { isLive && !reduceMotion }

    var body: some View {
        Text(":")
            // WP-183 — display face, one step heavier than the wordmark's 600.
            // The pulse below is untouched: only opacity/glow animate, so the
            // font swap changes the glyph, never the live signature's geometry.
            .font(.sportivistaDisplay(.title, weight: .bold))
            .foregroundStyle(SportivistaTokens.accent)
            // Opacity breath: ~1.0 ↔ ~0.5. Only ever moves while pulsing (breathing
            // is pinned false otherwise), so the resting/Reduce-Motion colon is solid.
            .opacity(breathing ? 0.5 : 1.0)
            // A soft amber glow — the STATIC "on" tell under Reduce Motion, and a
            // gentle warmth that breathes with the pulse otherwise. Clear when not
            // live, so nothing changes for the ordinary colon.
            .shadow(color: glowColor, radius: glowRadius)
            // The pulse animation when active; a short settle otherwise (so the
            // colon eases back to rest, never snapping, when live ends).
            .animation(pulses ? Self.pulse : .easeInOut(duration: 0.3), value: breathing)
            .onAppear { breathing = pulses }
            .onChange(of: pulses) { _, now in breathing = now }
    }

    /// The calm heartbeat: slow, ease-in-out, autoreversing, forever.
    private static let pulse: Animation =
        .easeInOut(duration: 1.6).repeatForever(autoreverses: true)

    /// Amber glow colour. Clear when not live (the ordinary colon). Under Reduce
    /// Motion it is a steady, slightly stronger glow (the static "on" state);
    /// otherwise it breathes between faint and soft in sync with the opacity.
    private var glowColor: Color {
        guard isLive else { return .clear }
        if reduceMotion { return SportivistaTokens.accent.opacity(0.6) }
        return SportivistaTokens.accent.opacity(breathing ? 0.15 : 0.55)
    }

    /// Glow radius, matched to `glowColor`. Zero (no glow) when not live.
    private var glowRadius: CGFloat {
        guard isLive else { return 0 }
        if reduceMotion { return 4 }
        return breathing ? 1 : 5
    }
}

#Preview {
    ContentView()
}
