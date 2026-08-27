//
//  ContextActionTests.swift
//  SportivistaTests
//
//  WP-16.4 — the event detail sheet's two context actions: «Følg <entitet>»
//  (a pre-filled add routed through the SAME grounded diff/confirm flow) and
//  «Hvorfor vises denne?» (the deterministic FeedCompiler.whyShown reason). The
//  first is proven at both ends — the subjects a row exposes, and the view model
//  turning a tap into a confirmable diff that, once confirmed, recompiles the
//  agenda (onProfileChanged).
//
//  WP-252 — the sheet's follow action became SYMMETRIC, so the row's subject
//  list had to stop hiding what you already follow (the old `followable` dropped
//  it, which left the sheet mute for exactly the rows you most want to weed
//  out). These tests now pin the replacement contract: every subject is
//  present, each stamped with its follow state.
//

import XCTest

@MainActor
final class ContextActionTests: XCTestCase {

    private let index = AssistantTestSupport.liveIndex()

    // MARK: - subjects (AgendaViewModel.subjects)

    func test_subjects_resolvesTeamsByName() {
        let event = EventBuilder.make(
            sport: "football", title: "Strømsgodset – Lyn", time: "2026-08-02T15:00:00Z",
            homeTeam: "Strømsgodset", awayTeam: "Lyn"
        )
        let subjects = AgendaViewModel.subjects(for: event, index: index, followedIds: [])
        XCTAssertTrue(subjects.contains { $0.id == "fk-lyn-oslo" }, "«Lyn» resolves to FK Lyn Oslo")
        XCTAssertTrue(subjects.allSatisfy { !$0.isFollowed }, "an empty profile follows none of them")
    }

    func test_subjects_keepsAlreadyFollowed_andMarksIt() {
        // Brann – Lyn, in a tournament the index also knows: three subjects, so
        // "the followed one stays AND the others are still plain «Følg»" is a
        // real claim rather than an accident of a one-entity row.
        let event = EventBuilder.make(
            sport: "football", title: "Brann – Lyn", time: "2026-08-02T15:00:00Z",
            homeTeam: "Brann", awayTeam: "Lyn", tournament: "Eliteserien"
        )
        let subjects = AgendaViewModel.subjects(for: event, index: index, followedIds: ["fk-lyn-oslo"])
        let lyn = subjects.first { $0.id == "fk-lyn-oslo" }
        XCTAssertNotNil(lyn, "a followed team STAYS a subject — that is the row you want to weed out")
        XCTAssertTrue(lyn?.isFollowed == true, "…and it is stamped followed, so the sheet offers «Slutt å følge»")
        XCTAssertTrue(subjects.contains { $0.id == "brann" && !$0.isFollowed },
                      "the other side is still offered as a plain «Følg»")
    }

    /// The same list drives LAG OG UTØVERE and HANDLINGER, so the two sections
    /// can never name different entities for one event (they used to cap at
    /// three independently, on either side of the followed-filter).
    func test_subjects_areTheSameRegardlessOfWhatIsFollowed() {
        let event = EventBuilder.make(
            sport: "football", title: "Brann – Lyn", time: "2026-08-02T15:00:00Z",
            homeTeam: "Brann", awayTeam: "Lyn", tournament: "Eliteserien"
        )
        let none = AgendaViewModel.subjects(for: event, index: index, followedIds: [])
        let some = AgendaViewModel.subjects(for: event, index: index, followedIds: ["fk-lyn-oslo", "brann"])
        XCTAssertEqual(none.map(\.id), some.map(\.id), "following something never changes WHICH subjects appear")
        XCTAssertFalse(none.isEmpty)
    }

    /// A single team is undone by tapping the row again; only a whole sport /
    /// umbrella category is broad enough to still deserve a confirmation.
    func test_isBroadFollow_onlyForWholeSportsAndCategories() {
        func subject(type: String) -> AgendaSubject {
            AgendaSubject(entity: Entity(id: "x", name: "X", aliases: [], sport: "football", type: type),
                          isFollowed: true)
        }
        XCTAssertFalse(subject(type: "team").isBroadFollow)
        XCTAssertFalse(subject(type: "athlete").isBroadFollow)
        XCTAssertFalse(subject(type: "tournament").isBroadFollow)
        XCTAssertFalse(subject(type: "league").isBroadFollow)
        XCTAssertTrue(subject(type: "sport").isBroadFollow)
        XCTAssertTrue(subject(type: "category").isBroadFollow)
    }

    // MARK: - proposeFollow → diff → confirm → recompile

    func test_proposeFollow_createsAConfirmableDiff_thenApplies() {
        var recompiled = 0
        let vm = AssistantViewModel(
            assistant: MockInterestAssistant(),
            profileStore: AssistantTestSupport.tempProfileStore(),
            index: self.index,
            misunderstoodLog: AssistantTestSupport.tempMisunderstoodLog()
        )
        vm.onProfileChanged = { recompiled += 1 }

        let lyn = index.entity(id: "fk-lyn-oslo")!
        vm.proposeFollow(lyn)
        XCTAssertEqual(vm.pending.map(\.entity.id), ["fk-lyn-oslo"], "a tap pre-fills a confirmable add")
        XCTAssertTrue(vm.profile.isEmpty, "nothing applied until Bekreft")

        vm.confirm(vm.pending[0])
        XCTAssertEqual(vm.profile.rules.map(\.entityId), ["fk-lyn-oslo"])
        XCTAssertEqual(recompiled, 1, "confirming a follow recompiles the agenda immediately")
    }

    // MARK: - whyShown (FeedCompiler)

    func test_whyShown_trackedTeam() {
        let fe = FeedEvent(sport: "football", title: "Strømsgodset – Lyn", homeTeam: "Strømsgodset", awayTeam: "Lyn")
        let interests = Interests(alwaysTrack: Interests.AlwaysTrack(
            teams: [Interests.Entity(name: "Lyn", sport: "football")]
        ))
        XCTAssertTrue(FeedCompiler.whyShown(fe, interests: interests).hasPrefix("Fordi Lyn spiller"))
    }

    func test_whyShown_followedSport() {
        let fe = FeedEvent(sport: "football", title: "Bodø/Glimt – Molde")
        let why = FeedCompiler.whyShown(fe, interests: Interests(followBroadly: ["football"]))
        XCTAssertEqual(why, "Du følger fotball")
    }

    func test_whyShown_aiResearch() {
        let fe = FeedEvent(sport: "chess", title: "Sjakk-NM", source: "ai-research")
        XCTAssertEqual(FeedCompiler.whyShown(fe, interests: Interests()), "AI-research fant dette for deg")
    }

    func test_whyShown_trackedTournamentAndEnduranceVerb() {
        // A tracked tournament reads "Del av …".
        let stage = FeedEvent(sport: "cycling", title: "Etappe 3", tournament: "Tour de France 2026")
        let tournInterests = Interests(alwaysTrack: Interests.AlwaysTrack(
            tournaments: [Interests.Entity(name: "Tour de France", sport: "cycling", notify: true)]
        ))
        XCTAssertTrue(FeedCompiler.whyShown(stage, interests: tournInterests).hasPrefix("Del av Tour de France"))

        // A tracked rider in an endurance sport uses "er med", not "spiller"
        // (the rider name is matched in the haystack via the title).
        let riderEvent = FeedEvent(sport: "cycling", title: "Etappe 3 – Jonas Abrahamsen i brudd")
        let riderInterests = Interests(alwaysTrack: Interests.AlwaysTrack(
            athletes: [Interests.Entity(name: "Jonas Abrahamsen", sport: "cycling")]
        ))
        XCTAssertTrue(FeedCompiler.whyShown(riderEvent, interests: riderInterests).hasPrefix("Fordi Jonas Abrahamsen er med"))
    }
}
