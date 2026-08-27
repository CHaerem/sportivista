//
//  GolfFieldTests.swift
//  SportivistaTests
//
//  WP-250 — the app decoded `Event.featuredGroups` and rendered them NOWHERE.
//  These pin the pure formatting behind the detail sheet's NORSKE I FELTET
//  section, case for case against its web twin (`docs/js/detail.js`
//  `addGolfField`, pinned in tests/dashboard-cards.test.js): the same "ut
//  17:24 · med X" wording, the same verbatim cut status (WP-95), the same
//  honest «i feltet» fallback.
//
//  Events are built from JSON literals rather than through EventBuilder because
//  `Event`'s hand-written `init(from:)` suppresses the memberwise initializer
//  and the shared builder models neither featuredGroups nor totalPlayers.
//

import XCTest

final class GolfFieldTests: XCTestCase {

    private func event(_ body: String) throws -> Event {
        let json = "{\"sport\":\"golf\",\"title\":\"TOUR Championship\",\"time\":\"2026-08-27T04:00:00.000Z\",\(body)}"
        return try SportivistaJSON.decoder.decode(Event.self, from: Data(json.utf8))
    }

    // MARK: - Tee time + who they are out with

    func testListsEachNorwegianWithTeeTimeAndGroupmates() throws {
        let event = try event("""
        "norwegianPlayers":[{"name":"Viktor Hovland","teeTime":"17:24"},{"name":"Kristoffer Reitan","teeTime":"18:06"}],
        "featuredGroups":[
          {"player":"Viktor Hovland","teeTime":"17:24","groupmates":[{"name":"Robert MacIntyre"}]},
          {"player":"Kristoffer Reitan","teeTime":"18:06","groupmates":[{"name":"Patrick Cantlay"}]}
        ]
        """)

        let lines = GolfField.lines(for: event)
        XCTAssertEqual(lines, [
            GolfField.Line(name: "Viktor Hovland", detail: "ut 17:24 · med Robert MacIntyre"),
            GolfField.Line(name: "Kristoffer Reitan", detail: "ut 18:06 · med Patrick Cantlay"),
        ])
    }

    func testJoinsSeveralGroupmatesWithCommas() throws {
        let event = try event("""
        "norwegianPlayers":[{"name":"Viktor Hovland","teeTime":"09:39"}],
        "featuredGroups":[{"player":"Viktor Hovland","teeTime":"09:39",
          "groupmates":[{"name":"Wyndham Clark"},{"name":"Eugenio Chacarra"}]}]
        """)

        XCTAssertEqual(GolfField.lines(for: event).first?.detail,
                       "ut 09:39 · med Wyndham Clark, Eugenio Chacarra")
    }

    /// The featured group carries the tee time even when the player entry has none.
    func testFallsBackToTheGroupsTeeTime() throws {
        let event = try event("""
        "norwegianPlayers":[{"name":"Viktor Hovland"}],
        "featuredGroups":[{"player":"Viktor Hovland","teeTime":"17:24","groupmates":[{"name":"Robert MacIntyre"}]}]
        """)

        XCTAssertEqual(GolfField.lines(for: event).first?.detail, "ut 17:24 · med Robert MacIntyre")
    }

    // MARK: - Honesty

    func testAPlayerWeKnowNothingElseAboutIsSimplyInTheField() throws {
        let event = try event("\"norwegianPlayers\":[{\"name\":\"Kristoffer Ventura\"}]")
        XCTAssertEqual(GolfField.lines(for: event), [
            GolfField.Line(name: "Kristoffer Ventura", detail: "i feltet"),
        ])
    }

    /// WP-95: a player who is out shows that status VERBATIM — never a tee time,
    /// never «i feltet», both of which would read as "still playing".
    func testACutPlayerShowsTheStatusVerbatim() throws {
        let event = try event("""
        "norwegianPlayers":[
          {"name":"Viktor Hovland","teeTime":null,"status":"røk cutten"},
          {"name":"Kristoffer Reitan","teeTime":"15:50"}
        ],
        "featuredGroups":[{"player":"Kristoffer Reitan","teeTime":"15:50","groupmates":[{"name":"Shane Lowry"}]}]
        """)

        XCTAssertEqual(GolfField.lines(for: event), [
            GolfField.Line(name: "Viktor Hovland", detail: "røk cutten"),
            GolfField.Line(name: "Kristoffer Reitan", detail: "ut 15:50 · med Shane Lowry"),
        ])
    }

    /// Defensive, mirroring the web: a featured group whose Norwegian never made
    /// it into `norwegianPlayers` is still listed — once, not twice.
    func testListsAFeaturedGroupWhosePlayerIsMissingFromTheField() throws {
        let event = try event("""
        "norwegianPlayers":[{"name":"Kristoffer Reitan","teeTime":"18:06"}],
        "featuredGroups":[
          {"player":"kristoffer reitan","teeTime":"18:06","groupmates":[{"name":"Patrick Cantlay"}]},
          {"player":"Viktor Hovland","teeTime":"17:24","groupmates":[{"name":"Robert MacIntyre"}]}
        ]
        """)

        XCTAssertEqual(GolfField.lines(for: event), [
            // Matched case-insensitively, so Reitan appears once, with his group.
            GolfField.Line(name: "Kristoffer Reitan", detail: "ut 18:06 · med Patrick Cantlay"),
            GolfField.Line(name: "Viktor Hovland", detail: "ut 17:24 · med Robert MacIntyre"),
        ])
    }

    // MARK: - The section stays absent where it has nothing to say

    func testNoLinesForANonGolfEvent() throws {
        let json = """
        {"sport":"football","title":"Lyn – Sogndal","time":"2026-08-27T17:00:00.000Z",
         "norwegianPlayers":[{"name":"Viktor Hovland","teeTime":"17:24"}],"totalPlayers":30}
        """
        let event = try SportivistaJSON.decoder.decode(Event.self, from: Data(json.utf8))
        XCTAssertTrue(GolfField.lines(for: event).isEmpty)
        XCTAssertNil(GolfField.fieldSize(for: event))
    }

    func testNoLinesForAGolfEventWithNoNorwegians() throws {
        let event = try event("\"totalPlayers\":156")
        XCTAssertTrue(GolfField.lines(for: event).isEmpty)
    }

    // MARK: - Field size

    func testFieldSize() throws {
        XCTAssertEqual(GolfField.fieldSize(for: try event("\"totalPlayers\":30")), "30 i feltet")
        XCTAssertNil(GolfField.fieldSize(for: try event("\"norwegian\":true")))
        XCTAssertNil(GolfField.fieldSize(for: try event("\"totalPlayers\":0")))
    }
}
