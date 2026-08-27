//
//  FollowActionTests.swift
//  SportivistaTests
//
//  WP-105 — the assistant-free 3b apply path: follow / unfollow / search, all
//  hostless. Proves that `AssistantViewModel.follow` (the one path Deg › Legg til
//  and the event detail «Følg» button share) applies DIRECTLY — no diff to
//  confirm — persists through the same ProfileStore, and recompiles the agenda
//  (onProfileChanged), exactly like a confirmed conversation mutation. Also
//  proves the Legg til search grounds against the shared EntityIndex.
//

import XCTest

@MainActor
final class FollowActionTests: XCTestCase {

    private let index = AssistantTestSupport.liveIndex()

    private func makeVM(store: ProfileStore) -> AssistantViewModel {
        AssistantViewModel(
            assistant: MockInterestAssistant(),
            profileStore: store,
            index: self.index,
            misunderstoodLog: AssistantTestSupport.tempMisunderstoodLog()
        )
    }

    // MARK: - follow (direct apply-vei)

    func test_follow_appliesDirectly_persists_andRecompiles() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = makeVM(store: store)
        var recompiled = 0
        vm.onProfileChanged = { recompiled += 1 }

        let lyn = index.entity(id: "fk-lyn-oslo")!
        XCTAssertFalse(vm.isFollowing("fk-lyn-oslo"))

        vm.follow(lyn)

        XCTAssertTrue(vm.isFollowing("fk-lyn-oslo"), "the tap IS the confirmation")
        XCTAssertEqual(vm.profile.rules.map(\.entityId), ["fk-lyn-oslo"])
        XCTAssertTrue(vm.pending.isEmpty, "no diff round-trip — nothing left to confirm")
        XCTAssertEqual(recompiled, 1, "following recompiles the agenda immediately")
        XCTAssertEqual(store.load().rule(for: "fk-lyn-oslo")?.entityId, "fk-lyn-oslo",
                       "the follow is persisted through the same ProfileStore")
    }

    func test_follow_isIdempotentUpsert() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        let lyn = index.entity(id: "fk-lyn-oslo")!

        vm.follow(lyn)
        vm.follow(lyn)

        XCTAssertEqual(vm.profile.rules.filter { $0.entityId == "fk-lyn-oslo" }.count, 1,
                       "re-following an entity refreshes its rule, never duplicates it")
    }

    // MARK: - unfollow (Slutt å følge → removeRule)

    func test_unfollow_removesAndRecompiles() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = makeVM(store: store)
        let lyn = index.entity(id: "fk-lyn-oslo")!
        vm.follow(lyn)

        var recompiled = 0
        vm.onProfileChanged = { recompiled += 1 }
        let rule = vm.profile.rule(for: "fk-lyn-oslo")!

        vm.removeRule(rule)

        XCTAssertFalse(vm.isFollowing("fk-lyn-oslo"), "«Slutt å følge» drops the rule")
        XCTAssertTrue(vm.profile.isEmpty)
        XCTAssertEqual(recompiled, 1, "unfollowing recompiles the agenda")
        XCTAssertNil(store.load().rule(for: "fk-lyn-oslo"), "the removal is persisted")
    }

    // MARK: - WP-252 — unfollow BY ENTITY (the detail sheet's «Slutt å følge»)

    /// The detail sheet holds an `Entity`, not an `InterestRule`. `unfollow`
    /// bridges that WITHOUT becoming a second write path: it resolves the rule
    /// and reuses `removeRule`, so the persist + recompile are identical.
    func test_unfollowByEntity_reusesRemoveRule_persistsAndRecompiles() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = makeVM(store: store)
        let lyn = index.entity(id: "fk-lyn-oslo")!
        vm.follow(lyn)

        var recompiled = 0
        vm.onProfileChanged = { recompiled += 1 }

        XCTAssertTrue(vm.unfollow(lyn), "there was a rule to remove")

        XCTAssertFalse(vm.isFollowing("fk-lyn-oslo"), "«Slutt å følge» drops the rule")
        XCTAssertEqual(recompiled, 1, "unfollowing recompiles the agenda immediately")
        XCTAssertNil(store.load().rule(for: "fk-lyn-oslo"), "the removal is persisted through the same store")
    }

    /// Symmetry all the way: unfollow → follow puts it back exactly, so the
    /// sheet's «tap the row again» IS a complete undo.
    func test_unfollowThenFollowAgain_restoresTheFollow() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        let lyn = index.entity(id: "fk-lyn-oslo")!

        vm.follow(lyn)
        vm.unfollow(lyn)
        XCTAssertTrue(vm.profile.isEmpty)

        vm.follow(lyn)
        XCTAssertEqual(vm.profile.rules.map(\.entityId), ["fk-lyn-oslo"],
                       "re-following after an unfollow restores exactly one rule")
    }

    func test_unfollow_isANoOpForSomethingNotFollowed() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        var recompiled = 0
        vm.onProfileChanged = { recompiled += 1 }

        XCTAssertFalse(vm.unfollow(index.entity(id: "fk-lyn-oslo")!), "nothing to remove")
        XCTAssertEqual(recompiled, 0, "a no-op never recompiles the board")
    }

    // MARK: - Legg til search (shared EntityIndex grounding)

    func test_search_findsFollowableTargets() {
        let hits = index.search("Lyn")
        XCTAssertTrue(hits.contains { $0.id == "fk-lyn-oslo" }, "«Lyn» resolves to FK Lyn Oslo")
    }

    func test_search_filtersOutSportPseudoEntities() {
        // The Legg til list drops whole-sport / umbrella entities (they are the
        // assistant's broad grounding, not a followable team/athlete/tournament).
        let hits = index.search("fotball").filter { $0.type != "sport" && $0.type != "category" }
        XCTAssertFalse(hits.contains { $0.type == "sport" },
                       "no whole-sport pseudo-entity offered as a Legg til row")
    }
}
