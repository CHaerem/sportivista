//
//  ProfileShapesBoardTests.swift
//  SportivistaTests
//
//  WP-200 · «Profilen former tavla» — the iOS half.
//
//  Onboarding let you choose what you care about and the board ignored the
//  answer. Two independent leaks did it:
//
//    1. `EffectiveInterests.merge` returned `base.followBroadly` untouched. On
//       device `base` is `Interests()` (WP-96 stopped publishing interests.json),
//       so followBroadly was nil and `FeedCompiler` fell back to the nine-sport
//       default — a profile could only ADD to the board, never shape it.
//    2. Rule (3), the norwegian/favorite/importance blanket, was a blank cheque:
//       ANY Norwegian / favourite / importance≥4 event passed for every sport
//       that wasn't entity-gated.
//
//  Together: someone who picked only «Formel 1» got an agenda full of golf,
//  cycling and biathlon. This file pins the fix from BOTH ends — the derivation
//  (profile → interests) and the consequence (interests → board) — plus the hard
//  backward-compatibility guarantee that an EMPTY profile reproduces the
//  pre-WP-200 board exactly.
//
//  It is the deliberate twin of tests/profile-shapes-board.test.js (the web
//  side): same scenarios, same event set, same expected ids. The cross-platform
//  freeze itself is the golden feed-vectors 15/16, replayed by FeedVectorTests.
//

import XCTest

final class ProfileShapesBoardTests: XCTestCase {

    private let index = AssistantTestSupport.liveIndex()

    private func iso(_ s: String) -> Date {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: s)!
    }
    private lazy var now = iso("2026-07-13T12:00:00Z")

    // MARK: - Profiles (real entity ids, so the index resolves type + aliases)

    private func profile(_ ids: [String]) -> InterestProfile {
        var p = InterestProfile()
        for id in ids {
            guard let entity = index.entity(id: id) else {
                XCTFail("unknown entity id \(id) — the fixture index should carry it")
                continue
            }
            p = p.applying(GroundedMutation(
                kind: .add, entity: entity, scope: nil, weight: 0.5, reason: "test", previousRule: nil
            ), now: now)
        }
        return p
    }

    private func interests(_ ids: [String]) -> Interests {
        EffectiveInterests.merge(profile: profile(ids), into: Interests(), index: index)
    }

    // MARK: - A fixed, catalog-wide board (mirrors the web test's EVENTS)

    private lazy var events: [FeedEvent] = [
        FeedEvent(id: "f1-race", sport: "f1", title: "Ungarns Grand Prix – løp",
                  tournament: "Formula 1 World Championship 2026", time: iso("2026-07-19T13:00:00Z")),
        FeedEvent(id: "f1-imp5", sport: "f1", title: "Sesongfinalen i Abu Dhabi",
                  tournament: "Grand Prix-helgen", time: iso("2026-07-20T13:00:00Z"), importance: 5),
        FeedEvent(id: "rbk-molde", sport: "football", title: "Rosenborg – Molde",
                  tournament: "Eliteserien", time: iso("2026-07-19T16:00:00Z"),
                  homeTeam: "Rosenborg", awayTeam: "Molde", norwegian: true),
        FeedEvent(id: "vif-hamkam", sport: "football", title: "Vålerenga – HamKam",
                  tournament: "Eliteserien", time: iso("2026-07-18T18:00:00Z"),
                  homeTeam: "Vålerenga", awayTeam: "HamKam", norwegian: true),
        FeedEvent(id: "golf-norsk", sport: "golf", title: "Rocket Classic – runde 3",
                  tournament: "PGA Tour", time: iso("2026-07-18T15:00:00Z"),
                  norwegian: true, norwegianPlayers: [NorwegianPlayer(name: "Kristoffer Reitan")]),
        FeedEvent(id: "cycling-norsk", sport: "cycling", title: "Clásica San Sebastián",
                  tournament: "UCI WorldTour 2026", time: iso("2026-07-19T09:00:00Z"), norwegian: true),
        FeedEvent(id: "biathlon-plain", sport: "biathlon", title: "Verdenscup sprint menn",
                  tournament: "IBU World Cup", time: iso("2026-07-20T11:00:00Z")),
        FeedEvent(id: "alpine-norsk", sport: "alpine", title: "Storslalåm menn",
                  tournament: "FIS Alpine World Cup", time: iso("2026-07-21T09:00:00Z"), norwegian: true),
        FeedEvent(id: "chess-carlsen", sport: "chess", title: "Norway Chess – runde 4",
                  tournament: "Norway Chess 2026", time: iso("2026-07-19T15:00:00Z"),
                  norwegian: true, norwegianPlayers: [NorwegianPlayer(name: "Magnus Carlsen")]),
    ]

    private func board(_ interests: Interests) -> [String] {
        events.filter { FeedCompiler.isRelevant($0, interests: interests, now: now) }
            .compactMap(\.id).sorted()
    }

    // MARK: - 1. The derivation: profile → followBroadly

    func test_emptyProfile_leavesFollowBroadlyAbsent() {
        // The whole backward-compatibility guarantee rests on this: ABSENT means
        // "no profile speaks", which is what makes the lens fall back to the
        // config default AND keep the historic un-scoped blanket.
        XCTAssertNil(EffectiveInterests.merge(profile: InterestProfile(), into: Interests(), index: index).followBroadly)
    }

    func test_preciseFollow_followsNoSportWholesale() {
        XCTAssertEqual(interests(["f1-world-championship"]).followBroadly, [])
        XCTAssertEqual(interests(["rosenborg"]).followBroadly, [])
        // …and still lands in the bucket its entity type says (unchanged).
        XCTAssertTrue(interests(["f1-world-championship"]).alwaysTrack.tournaments.contains { $0.name.hasPrefix("Formula 1 World Championship") })
        XCTAssertTrue(interests(["rosenborg"]).alwaysTrack.teams.contains { $0.name == "Rosenborg" })
    }

    func test_sportLevelRule_followsThatSportWholesale() {
        // The Vintersport-pakken's sport entities (StarterPacks) — deduped + sorted.
        XCTAssertEqual(interests(["sport-biathlon", "sport-alpine"]).followBroadly, ["alpine", "biathlon"])
        // It stays in the athlete bucket as well — mirrors the web twin, so the
        // bell/accent behave exactly as before.
        XCTAssertTrue(interests(["sport-biathlon"]).alwaysTrack.athletes.contains { $0.name == "Skiskyting" })
    }

    func test_baseBroadFollows_areKept() {
        // The local layer adds to the server config, it does not fight it.
        let merged = EffectiveInterests.merge(
            profile: profile(["sport-biathlon"]), into: Interests(followBroadly: ["football"]), index: index
        )
        XCTAssertEqual(merged.followBroadly, ["biathlon", "football"])
    }

    // MARK: - 2. The consequence: the board is shaped

    func test_emptyProfile_reproducesThePreWP200Board() {
        let noProfile = board(Interests())
        XCTAssertEqual(board(EffectiveInterests.merge(profile: InterestProfile(), into: Interests(), index: index)), noProfile)
        XCTAssertEqual(noProfile, [
            "alpine-norsk", "biathlon-plain", "cycling-norsk", "f1-imp5",
            "f1-race", "golf-norsk", "rbk-molde", "vif-hamkam",
        ])
        // chess stays out either way — entity-gated (WP-92), never blanketed.
        XCTAssertFalse(noProfile.contains("chess-carlsen"))
    }

    func test_f1OnlyProfile_getsOnlyF1() {
        // The bug this package exists for.
        XCTAssertEqual(board(interests(["f1-world-championship"])), ["f1-imp5", "f1-race"])
    }

    func test_oneTeamProfile_keepsItsSport_dropsEveryOther() {
        // Football stays (incl. the un-tracked Norwegian league match — the
        // blanket is scoped to the SPORT, not gated to the entity); golf,
        // cycling and F1 go.
        XCTAssertEqual(board(interests(["rosenborg"])), ["rbk-molde", "vif-hamkam"])
    }

    func test_sportLevelFollow_isWholesale() {
        // biathlon-plain carries no Norwegian, no favourite, no importance: it is
        // on the board purely because the profile follows the sport itself.
        XCTAssertEqual(board(interests(["sport-biathlon", "sport-alpine"])), ["alpine-norsk", "biathlon-plain"])
    }

    // MARK: - 3. The un-scoped blanket survives where no profile speaks

    func test_sportScope_isNilWhenFollowBroadlyIsAbsent() {
        XCTAssertNil(FeedCompiler.sportScope(Interests()))
        XCTAssertEqual(FeedCompiler.sportScope(interests(["rosenborg"])), ["football"])
    }

    func test_absentFollowBroadly_keepsTheBlanketForEverySport() {
        // What a hand-written interests.json with no followBroadly key means —
        // pre-WP-200 semantics, still reachable.
        let noBroad = Interests()
        XCTAssertTrue(FeedCompiler.isRelevant(events.first { $0.id == "golf-norsk" }!, interests: noBroad, now: now))
        XCTAssertTrue(FeedCompiler.isRelevant(events.first { $0.id == "f1-imp5" }!, interests: noBroad, now: now))
    }
}
