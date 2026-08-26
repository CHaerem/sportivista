//
//  OnboardingTests.swift
//  SportivistaTests
//
//  WP-31 — the first-run onboarding (dossier P310's «definere»-løkke). Every
//  piece is FM-free and I/O-light, so the whole flow is proven without Apple
//  Intelligence and without a running app:
//
//    • first-run detection + flag persistence (OnboardingGate, UserDefaults)
//    • conversation → profile IN the onboarding context (the SAME
//      AssistantViewModel the shipping app uses, mock in place of FM)
//    • a quick-picks starter pack → the right rules + lenses (incl. cold start
//      with an EMPTY index — the "full value without Apple Intelligence" case)
//    • skip → empty profile → the agenda's empty state
//    • re-run is additive + idempotent (no duplicate rules)
//    • a tapped pack recompiles the board immediately (EffectiveInterests)
//

import XCTest

@MainActor
final class OnboardingTests: XCTestCase {

    private let index = AssistantTestSupport.liveIndex()

    private func makeVM(
        behavior: MockInterestAssistant.Behavior = .available,
        store: ProfileStore? = nil
    ) -> AssistantViewModel {
        AssistantViewModel(
            assistant: MockInterestAssistant(behavior: behavior),
            profileStore: store ?? AssistantTestSupport.tempProfileStore(),
            index: self.index,
            misunderstoodLog: AssistantTestSupport.tempMisunderstoodLog()
        )
    }

    private func pack(_ id: String) -> StarterPack {
        StarterPacks.all.first { $0.id == id }!
    }

    // MARK: - First-run detection + flag persistence

    func test_gate_showsOnlyWhenFreshAndEmpty() {
        XCTAssertTrue(OnboardingGate.shouldShow(completed: false, profileIsEmpty: true),
                      "a fresh install with an empty profile sees onboarding")
        XCTAssertFalse(OnboardingGate.shouldShow(completed: true, profileIsEmpty: true),
                       "a completed/skipped flag suppresses it")
        XCTAssertFalse(OnboardingGate.shouldShow(completed: false, profileIsEmpty: false),
                       "someone who already follows something is never shown it unprompted")
        XCTAssertFalse(OnboardingGate.shouldShow(completed: true, profileIsEmpty: false))
    }

    // WP-132: the entry-step flip. Quick-picks is now the first build step for
    // everyone (the welcome goes straight there), so there is no availability-
    // gated build-step decision left in the gate — the conversation is a
    // clearly-secondary entry off the quick-picks step (proven in the UI flow).

    func test_flag_persistsAcrossReads() {
        // The @AppStorage flag is a plain UserDefaults bool — prove a round-trip
        // through the SAME key the gate uses.
        let key = OnboardingGate.storageKey
        let defaults = UserDefaults.standard
        let previous = defaults.object(forKey: key)
        defer { previous == nil ? defaults.removeObject(forKey: key) : defaults.set(previous, forKey: key) }

        defaults.removeObject(forKey: key)
        XCTAssertFalse(defaults.bool(forKey: key), "absent flag reads false → first run")
        defaults.set(true, forKey: key)
        XCTAssertTrue(defaults.bool(forKey: key), "set flag survives a re-read → no re-show")
    }

    // MARK: - Conversation → profile (in the onboarding context)

    func test_conversation_buildsProfile_growingFollowingNow() async {
        let vm = makeVM()
        XCTAssertTrue(vm.profile.isEmpty)

        // "Liverpool" isn't in the index, but "Lyn" is — the canonical first
        // thing a Norwegian fan says. Say two things in a row (P310).
        vm.utterance = "Følg Lyn"
        await vm.submit()
        XCTAssertEqual(vm.pending.map(\.entity.id), ["fk-lyn-oslo"])
        vm.confirm(vm.pending[0])
        XCTAssertEqual(vm.profile.rules.count, 1, "Følger nå grew to 1")

        vm.utterance = "golf, mest de norske"
        await vm.submit()
        XCTAssertFalse(vm.pending.isEmpty)
        XCTAssertEqual(vm.pending.first?.lens, .throughNorwegians, "the norsk-fokus lens is carried")
        vm.confirmAll()
        XCTAssertEqual(vm.profile.rules.count, 2, "Følger nå grew to 2 across turns")
    }

    // MARK: - Quick-picks → the right rules + lenses

    func test_starterPacks_areGroundedAndUnique() {
        XCTAssertFalse(StarterPacks.all.isEmpty)
        XCTAssertEqual(Set(StarterPacks.all.map(\.id)).count, StarterPacks.all.count, "unique ids")
        for p in StarterPacks.all {
            XCTAssertFalse(p.rules.isEmpty, "\(p.id) has rules")
            for r in p.rules {
                XCTAssertNotNil(index.entity(id: r.entityId),
                                "\(p.id) rule \(r.entityId) is a real entity in the index")
            }
        }
    }

    func test_golfPack_followsTheOpenThroughNorwegians() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("norske-golfere"))

        let ids = Set(vm.profile.rules.map(\.entityId))
        XCTAssertTrue(ids.isSuperset(of: ["viktor-hovland", "kristoffer-reitan", "the-open-championship"]))
        XCTAssertEqual(vm.profile.rule(for: "the-open-championship")?.lens, .throughNorwegians,
                       "the golf pack follows The Open THROUGH the Norwegians (WP-18)")
        XCTAssertEqual(vm.profile.rule(for: "viktor-hovland")?.lens, .sportAsSuch,
                       "an individual golfer is followed plainly")
        XCTAssertTrue(vm.isApplied(pack("norske-golfere")))
    }

    func test_cyclingPack_followsTourThroughNorwegians() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("norsk-sykkel"))
        XCTAssertEqual(vm.profile.rule(for: "tour-de-france")?.lens, .throughNorwegians)
    }

    // WP-132: the generic packs ground on broadly-meaningful, real entities.
    func test_winterPack_groundsToTheFourSportEntities() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("vintersport"))
        XCTAssertEqual(Set(vm.profile.rules.map(\.entityId)),
                       ["sport-biathlon", "sport-cross-country", "sport-alpine", "sport-ski-jumping"],
                       "the winter pack follows the four sport-level entities (WP-64/116) — off-season, so it matches nothing yet, but the follows are real")
    }

    func test_footballPack_isEliteserienAndTheNationalTeam_notTheOwnersClub() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("norsk-fotball"))
        XCTAssertEqual(vm.profile.rules.map(\.entityId), ["eliteserien", "norge"],
                       "«Norsk fotball» follows Eliteserien + the national team, not the owner's club (WP-132 de-personalisation, WP-133 grounds Eliteserien)")
    }

    func test_cs2Pack_isGeneralised_notTheOwnersTeam() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("cs2"))
        let ids = Set(vm.profile.rules.map(\.entityId))
        XCTAssertEqual(ids, ["esports-world-cup"], "CS2 grounds on the durable marquee tournament (WP-162: the discipline-scoped id vanishes off-season)")
        XCTAssertFalse(ids.contains("100-thieves"), "the owner's team is no longer a starter pack")
        XCTAssertFalse(ids.contains("havard-rain-nygaard"), "the owner's player is no longer a starter pack")
    }

    func test_togglePack_addsThenRemoves() {
        let vm = makeVM()
        let p = pack("cs2")
        vm.toggleStarterPack(p)
        XCTAssertTrue(vm.isApplied(p))
        XCTAssertEqual(Set(vm.profile.rules.map(\.entityId)), Set(p.entityIds))

        vm.toggleStarterPack(p)   // second tap toggles off
        XCTAssertFalse(vm.isApplied(p))
        XCTAssertTrue(vm.profile.isEmpty)
    }

    // MARK: - Cold start: full value with an EMPTY index (no Apple Intelligence,
    // entities.json not yet synced)

    func test_pack_appliesWithEmptyIndex_coldStart() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = AssistantViewModel(
            assistant: MockInterestAssistant(behavior: .unavailable("Apple Intelligence er ikke på her")),
            profileStore: store,
            index: EntityIndex([]),                 // nothing synced yet
            misunderstoodLog: AssistantTestSupport.tempMisunderstoodLog()
        )
        XCTAssertFalse(vm.availability.isAvailable, "no Apple Intelligence — quick-picks must still work")

        vm.toggleStarterPack(pack("norske-golfere"))
        let rule = vm.profile.rule(for: "the-open-championship")
        XCTAssertNotNil(rule, "the pack applied from its own curated data, no index needed")
        XCTAssertEqual(rule?.entityName, "The Open Championship")
        XCTAssertEqual(rule?.lens, .throughNorwegians, "the lens survives a cold-start apply too")
    }

    // MARK: - Immediate consequence: a tapped pack fills the board on recompile

    func test_tappingPack_bringsEventsOntoBoardImmediately() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = makeVM(store: store)
        var recompiles = 0
        vm.onProfileChanged = { recompiles += 1 }

        let now = AssistantTestSupport.iso("2026-07-14T09:00:00Z")
        // A golf event featuring Hovland — golf IS in defaultFollowBroadly, so use
        // an entity the DEFAULT board wouldn't already surface: a tennis match.
        let match = EventBuilder.make(
            sport: "tennis", title: "Casper Ruud – Novak Djokovic", time: "2026-07-14T18:00:00Z",
            homeTeam: "Casper Ruud", awayTeam: "Novak Djokovic", streaming: [["platform": "TV 2 Play"]]
        )
        let before = AgendaViewModel.buildSections(events: [match], interests: Interests(), now: now)
        XCTAssertTrue(titles(before).isEmpty, "an unfollowed tennis match isn't on the board")

        vm.toggleStarterPack(pack("tennis-ruud"))
        XCTAssertEqual(recompiles, 1, "onProfileChanged fired — the board recompiles on the spot")

        let effective = EffectiveInterests.merge(profile: vm.profile, into: Interests(), index: index)
        let after = AgendaViewModel.buildSections(
            events: [match], interests: effective, now: now, index: index,
            followedIds: Set(vm.profile.rules.map(\.entityId)))
        XCTAssertTrue(titles(after).contains("Casper Ruud – Novak Djokovic"),
                      "tapping the tennis pack brings Ruud's match onto the board immediately")
    }

    // MARK: - Skip → empty profile → empty agenda

    func test_skip_leavesEmptyProfile_andEmptyBoard() {
        // Skipping adds nothing; with no followed entities a tennis-only event
        // set produces no sections (the agenda's empty state then points at the
        // assistant — WP-143: the header sparkles toolbar button).
        let now = AssistantTestSupport.iso("2026-07-14T09:00:00Z")
        let match = EventBuilder.make(
            sport: "tennis", title: "Casper Ruud – Carlos Alcaraz", time: "2026-07-14T18:00:00Z",
            homeTeam: "Casper Ruud", awayTeam: "Carlos Alcaraz")
        let sections = AgendaViewModel.buildSections(events: [match], interests: Interests(), now: now)
        XCTAssertTrue(sections.isEmpty, "a skipped (empty) profile leaves an unfollowed sport off the board")
        // And the persistent flag suppresses a re-show after a skip.
        XCTAssertFalse(OnboardingGate.shouldShow(completed: true, profileIsEmpty: true))
    }

    // MARK: - Re-run from settings is additive + idempotent

    func test_rerun_isAdditiveAndIdempotent() {
        let vm = makeVM()
        vm.toggleStarterPack(pack("sjakk-carlsen"))
        XCTAssertEqual(vm.profile.rules.count, 1)

        // Re-running and re-applying the SAME pack doesn't duplicate (upsert).
        vm.toggleStarterPack(pack("sjakk-carlsen"))   // off
        vm.toggleStarterPack(pack("sjakk-carlsen"))   // on again
        XCTAssertEqual(vm.profile.rules.filter { $0.entityId == "magnus-carlsen" }.count, 1, "no duplicate rule")

        // A DIFFERENT pack adds on top of the existing profile.
        vm.toggleStarterPack(pack("friidrett"))
        XCTAssertTrue(Set(vm.profile.rules.map(\.entityId)).isSuperset(of: ["magnus-carlsen", "karsten-warholm"]))
    }

    private func titles(_ sections: [AgendaSection]) -> [String] {
        sections.flatMap(\.items).compactMap { if case .event(let r) = $0 { return r.title } else { return nil } }
    }
}
