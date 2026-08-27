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

        let outcome = vm.unfollow(lyn)

        XCTAssertEqual(outcome?.removed.entityId, "fk-lyn-oslo", "it hands back what it removed")
        XCTAssertFalse(vm.isFollowing("fk-lyn-oslo"), "«Slutt å følge» drops the rule")
        XCTAssertEqual(recompiled, 1, "unfollowing recompiles the agenda immediately")
        XCTAssertNil(store.load().rule(for: "fk-lyn-oslo"), "the removal is persisted through the same store")
    }

    /// The undo has to be LOSSLESS, because the receipt promises it in words
    /// («Trykk Følg for å angre»). A follow can carry a scope («bare i Grand
    /// Slams»), a lens («gjennom norske») and a weight — all three USER-VISIBLE
    /// in Det du følger — and none of them can be reconstructed from the
    /// `Entity` the sheet holds. So the whole RULE goes back, not just the id:
    /// comparing entity ids only (what this test used to do) would pass happily
    /// while the user silently lost their scope.
    func test_unfollowThenUndo_restoresTheWholeRule_notJustTheID() {
        let store = AssistantTestSupport.tempProfileStore()
        let vm = makeVM(store: store)
        let ruud = index.entity(id: "casper-ruud")!

        // A rule as the assistant would confirm one: scoped, lensed, weighted.
        vm.profile = vm.profile.applying(GroundedMutation(
            kind: .add, entity: ruud, scope: "bare i Grand Slams", weight: 0.8,
            reason: "Du ba om å følge Casper Ruud (bare i Grand Slams).",
            previousRule: nil, lens: .throughNorwegians
        ))
        let original = vm.profile.rule(for: ruud.id)!

        let outcome = vm.unfollow(ruud)
        XCTAssertTrue(vm.profile.isEmpty)
        XCTAssertEqual(outcome?.removed, original, "the removed rule comes back to the caller intact")

        vm.restore(outcome!.removed)

        let restored = vm.profile.rule(for: ruud.id)
        XCTAssertEqual(restored, original, "undo restores the rule VALUE, not a fresh default")
        XCTAssertEqual(restored?.scope, "bare i Grand Slams", "the scope survives the undo")
        XCTAssertEqual(restored?.lens, .throughNorwegians, "the lens survives the undo")
        XCTAssertEqual(restored?.weight, 0.8, "the weight survives the undo")
        XCTAssertEqual(restored?.addedAt, original.addedAt, "an undo leaves no trace, not even a new timestamp")
        // Persisted too — compared field-wise: the store's date encoding is
        // whole-second, so a round-tripped `addedAt` can never == the in-memory
        // one. The exact-value guarantee is the assertion above; this one proves
        // the restored rule reached disk with its fields intact.
        let persisted = store.load().rule(for: ruud.id)
        XCTAssertEqual(persisted?.scope, original.scope, "the scope is persisted, not just in memory")
        XCTAssertEqual(persisted?.lens, original.lens)
        XCTAssertEqual(persisted?.weight, original.weight)
        XCTAssertEqual(persisted?.reason, original.reason)
        XCTAssertEqual(persisted?.addedAt.timeIntervalSince1970 ?? 0,
                       original.addedAt.timeIntervalSince1970, accuracy: 1.0)
    }

    /// What the OLD undo did, kept as the guard against regressing to it:
    /// re-following the entity builds a fresh default rule and silently widens
    /// a scoped follow. This is why `restore` exists.
    func test_reFollowingTheEntity_doesNotPreserveScope_soUndoMustNotUseIt() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        let ruud = index.entity(id: "casper-ruud")!
        vm.profile = vm.profile.applying(GroundedMutation(
            kind: .add, entity: ruud, scope: "bare i Grand Slams", weight: 0.8,
            reason: "…", previousRule: nil, lens: .throughNorwegians
        ))
        vm.unfollow(ruud)

        vm.follow(ruud)

        XCTAssertNil(vm.profile.rule(for: ruud.id)?.scope,
                     "a plain re-follow is a NEW follow with no scope — never the undo path")
        XCTAssertEqual(vm.profile.rule(for: ruud.id)?.lens, .sportAsSuch)
    }

    /// The undo must not depend on resolving the entity at all. A WP-164
    /// soft-follow has a `soft-…` id no entity carries anywhere; restoring works
    /// from the rule itself, so no surface has to have an index (or a loaded
    /// presenter snapshot) in hand for «Angre» to mean something.
    func test_restore_worksForASoftFollowTheIndexCannotResolve() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        vm.softFollow(name: "Ukjent Utøver", sport: "biathlon")
        let rule = vm.profile.rules.first!
        XCTAssertNil(index.entity(id: rule.entityId), "nothing in the index answers to a soft id")

        let outcome = vm.unfollow(Entity(id: rule.entityId, name: rule.entityName, aliases: [],
                                         sport: rule.sport, type: ""))
        XCTAssertNotNil(outcome)
        vm.restore(outcome!.removed)

        XCTAssertEqual(vm.profile.rules.first, rule, "the soft follow comes back whole")
    }

    /// The one moment the board does the OPPOSITE of what «forsvinner fra det du
    /// følger» suggests: an empty profile makes EffectiveInterests hand the base
    /// interests straight back, so the agenda gets BROADER. The surface can only
    /// say so if the outcome tells it.
    func test_unfollow_reportsWhenItWasTheLastFollow() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        let lyn = index.entity(id: "fk-lyn-oslo")!
        let brann = index.entity(id: "brann")!
        vm.follow(lyn)
        vm.follow(brann)

        XCTAssertEqual(vm.unfollow(brann)?.wasLastFollow, false, "one follow still stands")
        XCTAssertEqual(vm.unfollow(lyn)?.wasLastFollow, true, "that was the last one")
    }

    /// And the receipt says it — the sentence is the promise, so it is pinned.
    func test_receiptCopy_saysTheBoardWidensOnTheLastUnfollow() {
        XCTAssertEqual(
            EventDetailSheet.receiptText(name: "Lyn", nowFollowed: false, wasLastFollow: false),
            "Lyn forsvinner fra det du følger, og agendaen oppdateres. Trykk Følg for å angre.")
        XCTAssertEqual(
            EventDetailSheet.receiptText(name: "Lyn", nowFollowed: false, wasLastFollow: true),
            "Lyn var det siste du fulgte, så agendaen viser bredt igjen — ikke ingenting. Trykk Følg for å angre.")
        XCTAssertEqual(
            EventDetailSheet.receiptText(name: "Lyn", nowFollowed: true, wasLastFollow: false),
            "Du følger Lyn nå, og agendaen oppdateres.")
    }

    func test_unfollow_isANoOpForSomethingNotFollowed() {
        let vm = makeVM(store: AssistantTestSupport.tempProfileStore())
        var recompiled = 0
        vm.onProfileChanged = { recompiled += 1 }

        XCTAssertNil(vm.unfollow(index.entity(id: "fk-lyn-oslo")!), "nothing to remove")
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
