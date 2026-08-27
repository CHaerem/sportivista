//
//  SeasonCalendarTests.swift
//  SportivistaTests
//
//  WP-203 — sesongærligheten som ren logikk: sesongtabellen, den stille
//  pakke-linjen («Sesongstart i november — tavla fylles da.») og tomtilstands-
//  forklaringen. Pluss WP-202s RitualPriming (hva et varsel-svar BETYR),
//  testet mot en injisert UserDefaults — ingen UNUserNotificationCenter.
//

import XCTest

final class SeasonCalendarTests: XCTestCase {

    // MARK: - isInSeason / nextSeasonStartMonth

    func test_winterSports_areOffSeasonInAugust_inSeasonInJanuary() {
        for sport in ["biathlon", "cross-country", "alpine", "ski jumping"] {
            XCTAssertFalse(SeasonCalendar.isInSeason(sport, month: 8), "\(sport) skal være utenfor sesong i august")
            XCTAssertTrue(SeasonCalendar.isInSeason(sport, month: 1), "\(sport) skal være i sesong i januar")
        }
    }

    func test_unknownSports_areAlwaysInSeason_theHonestDefault() {
        XCTAssertTrue(SeasonCalendar.isInSeason("football", month: 8))
        XCTAssertTrue(SeasonCalendar.isInSeason("chess", month: 6))
        XCTAssertNil(SeasonCalendar.nextSeasonStartMonth("football", month: 6))
    }

    func test_nextSeasonStart_wrapsTheCalendar() {
        // August → biathlon starter i november (11); mai → alpint i oktober (10).
        XCTAssertEqual(SeasonCalendar.nextSeasonStartMonth("biathlon", month: 8), 11)
        XCTAssertEqual(SeasonCalendar.nextSeasonStartMonth("alpine", month: 5), 10)
        XCTAssertEqual(SeasonCalendar.seasonStartName("biathlon", month: 8), "november")
        // I sesong ⇒ nil (ingen «neste start» å love).
        XCTAssertNil(SeasonCalendar.nextSeasonStartMonth("biathlon", month: 12))
    }

    // MARK: - offSeasonNote (startpakke-linjen)

    func test_winterPack_getsSeasonNoteInAugust_notInJanuary() {
        let sports = ["biathlon", "cross-country", "alpine", "ski jumping"]
        let note = SeasonCalendar.offSeasonNote(sports: sports, month: 8)
        XCTAssertEqual(note, "Sesongstart i november — tavla fylles da.")
        XCTAssertNil(SeasonCalendar.offSeasonNote(sports: sports, month: 1), "i sesong ⇒ ingen linje")
    }

    func test_oneInSeasonOrUnknownSport_mutesTheWholeNote() {
        // Én sport uten kjent dødsesong (football) i settet ⇒ pakken gir verdi i
        // dag, så hele sesonglinjen dempes — vi demper aldri på gjetning.
        XCTAssertNil(SeasonCalendar.offSeasonNote(sports: ["biathlon", "football"], month: 8),
                     "en helårs-sport i pakken betyr at pakken gir verdi i dag")
        XCTAssertNil(SeasonCalendar.offSeasonNote(sports: [], month: 8))
    }

    func test_theActualWinterPack_isCoveredByTheTable() {
        // Vernet mot drift: alle sportene i den shippede Vintersport-pakken må stå i
        // sesongtabellen, ellers mister pakken sesonglinjen stille.
        let pack = StarterPacks.all.first { $0.id == "vintersport" }!
        for rule in pack.rules {
            XCTAssertNotNil(SeasonCalendar.seasons[rule.sport.lowercased()],
                            "\(rule.sport) mangler i SeasonCalendar.seasons")
        }
        XCTAssertNotNil(SeasonCalendar.offSeasonNote(sports: pack.rules.map(\.sport), month: 8))
    }

    // MARK: - emptyBoardExplanation (tomtilstanden)

    func test_emptyBoard_explainedWhenEverythingFollowedIsOffSeason() {
        let note = SeasonCalendar.emptyBoardExplanation(followedSports: ["biathlon", "cross-country"], month: 8)
        XCTAssertEqual(note, "skiskyting og langrenn er utenfor sesong. Sesongstart i november — tavla fylles da.")
    }

    func test_emptyBoard_singleSportReadsNaturally() {
        XCTAssertEqual(
            SeasonCalendar.emptyBoardExplanation(followedSports: ["biathlon"], month: 8),
            "skiskyting er utenfor sesong. Sesongstart i november — tavla fylles da."
        )
    }

    func test_emptyBoard_neverExplainedAwayForYearRoundSports() {
        // Et tomt brett for en helårs-sport er et dekningshull, ikke en sesong.
        XCTAssertNil(SeasonCalendar.emptyBoardExplanation(followedSports: ["football"], month: 8))
        XCTAssertNil(SeasonCalendar.emptyBoardExplanation(followedSports: ["biathlon", "football"], month: 8))
        XCTAssertNil(SeasonCalendar.emptyBoardExplanation(followedSports: [], month: 8))
        // I sesong ⇒ ingen bortforklaring heller.
        XCTAssertNil(SeasonCalendar.emptyBoardExplanation(followedSports: ["biathlon"], month: 1))
    }

    // MARK: - RitualPriming (WP-202 — hva varsel-svaret betyr)

    func test_ritualGrant_optsTheBriefPingIn_andSaysSo() {
        let defaults = UserDefaults(suiteName: "wp202-\(UUID().uuidString)")!
        XCTAssertFalse(BriefAlertPreference.isEnabled(defaults), "opt-in: av før valget")
        let line = RitualPriming.apply(granted: true, defaults: defaults)
        XCTAssertTrue(BriefAlertPreference.isEnabled(defaults), "et JA fra varsel-skjermen ER brukerens opt-in")
        XCTAssertTrue(line.contains("Varsler er på"))
    }

    func test_ritualDenial_writesNothing_andPointsAtSettings() {
        let defaults = UserDefaults(suiteName: "wp202-\(UUID().uuidString)")!
        let line = RitualPriming.apply(granted: false, defaults: defaults)
        XCTAssertFalse(BriefAlertPreference.isEnabled(defaults), "et nei skrur ALDRI noe på")
        XCTAssertTrue(line.contains("Innstillinger"), "ærlig: system-prompten er brukt — veien videre er Innstillinger")
    }
}
