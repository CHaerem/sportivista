//
//  StreamingLinkContractTests.swift
//  SportivistaTests
//
//  WP-247 — «Lenkeløftet» on iOS. DESIGN.md § Radens anatomi (Kanal) makes the
//  channel NAME always true and always visible, but lets only a URL that points
//  at the broadcast itself (`urlKind: "deep"`) look like a link. A front page
//  (`urlKind: "landing"`) is shown as plain text — no underline, no tap, no
//  warning icon — because a front page posing as the answer to «hvor ser jeg
//  det» breaks Grunnlov 3 ("Ærlig innhold — aldri lat som").
//
//  These pin the whole contract at its single choke point
//  (`StreamingChannel.linkURL`, the Swift twin of dashboard.js `streamLink`),
//  plus the decoding half (the field is OPTIONAL — older cached events without
//  it must still decode) and the name-only channel column the row and the widget
//  render.
//

import XCTest

final class StreamingLinkContractTests: XCTestCase {

    // MARK: - linkURL: only "deep" is a link

    func testDeepURL_isTappable() {
        let channel = StreamingChannel(platform: "TV 2 Play", url: "https://play.tv2.no/kamp/lyn-sogndal", tentative: nil, urlKind: "deep")
        XCTAssertEqual(channel.linkURL?.absoluteString, "https://play.tv2.no/kamp/lyn-sogndal")
        XCTAssertFalse(channel.hasUnlinkableURL, "a linked channel has nothing to explain")
    }

    func testLandingURL_isNotTappable() {
        // The rights map's fallback: TV 2 Play's sport section, not this match.
        let channel = StreamingChannel(platform: "TV 2 Play", url: "https://play.tv2.no/sport", tentative: nil, urlKind: "landing")
        XCTAssertNil(channel.linkURL, "a front page must never look like a link to the broadcast")
        XCTAssertTrue(channel.hasUnlinkableURL, "the sheet explains this one with «(ingen direkte lenke)»")
    }

    /// The conservative half of the contract, and the deliberate divergence from
    /// web: iOS caches events on device, so a MISSING `urlKind` means "cached
    /// before the pipeline stamped it", not "this URL is fine". We don't pretend.
    func testMissingURLKind_behavesAsLanding() {
        let channel = StreamingChannel(platform: "Viaplay", url: "https://viaplay.no/no-no/sport", tentative: nil, urlKind: nil)
        XCTAssertNil(channel.linkURL, "no urlKind ⇒ we don't know it's the broadcast ⇒ not a link")
        XCTAssertTrue(channel.hasUnlinkableURL)
    }

    /// Forward compatibility: if the schema ever grows a third kind, an app that
    /// predates it must not start linking it. The rule is an allowlist.
    func testUnknownFutureURLKind_isNotTappable() {
        let channel = StreamingChannel(platform: "NRK", url: "https://tv.nrk.no/serie/xyz", tentative: nil, urlKind: "someFutureKind")
        XCTAssertNil(channel.linkURL)
    }

    // MARK: - linkURL: nothing to link

    func testNoURL_isNotTappableAndExplainsNothing() {
        let channel = StreamingChannel(platform: "Lichess", url: nil, tentative: nil, urlKind: nil)
        XCTAssertNil(channel.linkURL)
        XCTAssertFalse(channel.hasUnlinkableURL, "no URL at all ⇒ nothing to admit; the name stands alone")
    }

    func testEmptyURLString_isNotTappableAndExplainsNothing() {
        let channel = StreamingChannel(platform: "Lichess", url: "", tentative: nil, urlKind: "deep")
        XCTAssertNil(channel.linkURL)
        XCTAssertFalse(channel.hasUnlinkableURL)
    }

    /// `URL(string:)` is lenient — on current Foundation it happily builds a
    /// scheme-less URL out of prose. Only an http(s) address is a web address we
    /// can honestly offer to open.
    func testNonWebURL_isNotTappable() {
        for raw in ["ikke en url", "play.tv2.no/kamp/x", "javascript:alert(1)", "tel:12345678"] {
            let channel = StreamingChannel(platform: "TV 2 Play", url: raw, tentative: nil, urlKind: "deep")
            XCTAssertNil(channel.linkURL, "\(raw) is not an http(s) address")
        }
    }

    // MARK: - linkURL: a tentative (shared-rights) entry

    /// "NRK / TV 2" before verify resolves it: we don't know WHICH broadcaster
    /// carries this match, so only the neutral match guide is honest to link.
    func testTentativeDeepURL_linksOnlyTheMatchGuide() {
        let guide = StreamingChannel(platform: "NRK / TV 2", url: "https://tvkampen.com/kamp/lyn-sogndal", tentative: true, urlKind: "deep")
        XCTAssertEqual(guide.linkURL?.absoluteString, "https://tvkampen.com/kamp/lyn-sogndal")

        let subdomain = StreamingChannel(platform: "NRK / TV 2", url: "https://www.tvkampen.com/kamp/lyn-sogndal", tentative: true, urlKind: "deep")
        XCTAssertEqual(subdomain.linkURL?.absoluteString, "https://www.tvkampen.com/kamp/lyn-sogndal")
    }

    func testTentativeDeepURL_onOneBroadcaster_isNotTappable() {
        // Linking NRK would mislead whenever it turns out to be TV 2.
        let channel = StreamingChannel(platform: "NRK / TV 2", url: "https://tv.nrk.no/serie/fotball/kamp", tentative: true, urlKind: "deep")
        XCTAssertNil(channel.linkURL)
        XCTAssertTrue(channel.hasUnlinkableURL)
    }

    func testTentativeLandingURL_isNotTappable() {
        let channel = StreamingChannel(platform: "NRK / TV 2", url: "https://tv.nrk.no/direkte", tentative: true, urlKind: "landing")
        XCTAssertNil(channel.linkURL)
    }

    /// A tvkampen guide still has to be a DEEP url — tvkampen's own front page is
    /// no more an answer than a broadcaster's.
    func testTentativeMatchGuideLandingURL_isNotTappable() {
        let channel = StreamingChannel(platform: "NRK / TV 2", url: "https://tvkampen.com", tentative: true, urlKind: "landing")
        XCTAssertNil(channel.linkURL)
    }

    // MARK: - Decoding: the field is optional, and unknown values must not throw

    func testURLKindDecodesFromEventJSON() throws {
        let event = EventBuilder.make(
            sport: "football", title: "Lyn – Sogndal", time: "2026-08-02T15:00:00Z",
            streaming: [
                ["platform": "TV 2 Play", "url": "https://play.tv2.no/kamp/lyn-sogndal", "urlKind": "deep"],
                ["platform": "Viaplay", "url": "https://viaplay.no/no-no/sport", "urlKind": "landing"],
            ]
        )
        XCTAssertEqual(event.streaming.count, 2)
        XCTAssertEqual(event.streaming.first?.urlKind, "deep")
        XCTAssertNotNil(event.streaming.first?.linkURL)
        XCTAssertEqual(event.streaming.last?.urlKind, "landing")
        XCTAssertNil(event.streaming.last?.linkURL)
    }

    /// The compatibility case that actually ships: an event cached before WP-246
    /// (or one whose URL the pipeline couldn't classify) has no `urlKind` key at
    /// all. It must decode — the app just declines to link it.
    func testStreamingWithoutURLKindStillDecodes() throws {
        let json = """
        {
            "sport": "football",
            "title": "Gammel cachet kamp",
            "time": "2026-08-02T15:00:00Z",
            "streaming": [{ "platform": "TV 2 Play", "url": "https://play.tv2.no/sport" }]
        }
        """.data(using: .utf8)!

        let event = try SportivistaJSON.decoder.decode(Event.self, from: json)
        XCTAssertEqual(event.streaming.count, 1)
        XCTAssertEqual(event.streaming.first?.platform, "TV 2 Play")
        XCTAssertNil(event.streaming.first?.urlKind)
        XCTAssertNil(event.streaming.first?.linkURL)
    }

    func testUnknownURLKindValueDecodesRatherThanThrows() throws {
        let json = #"[{ "platform": "NRK", "url": "https://tv.nrk.no/x", "urlKind": "sometimeLater" }]"#.data(using: .utf8)!
        let channels = try SportivistaJSON.decoder.decode([StreamingChannel].self, from: json)
        XCTAssertEqual(channels.first?.urlKind, "sometimeLater")
        XCTAssertNil(channels.first?.linkURL)
    }

    // MARK: - The channel COLUMN (row + widget) is name-only, never a link

    /// The agenda row and the widget render the channel through
    /// `AgendaFormat.channelLabel`, which yields a String and nothing else — so
    /// neither surface can present a landing URL as a tappable match link. Pinned
    /// so a future "make the row channel tappable" change has to face this test.
    func testChannelLabel_isTheNameOnly_regardlessOfURLKind() {
        let deep = [StreamingChannel(platform: "TV 2 Play", url: "https://play.tv2.no/kamp/x", tentative: nil, urlKind: "deep")]
        let landing = [StreamingChannel(platform: "TV 2 Play", url: "https://play.tv2.no/sport", tentative: nil, urlKind: "landing")]
        XCTAssertEqual(AgendaFormat.channelLabel(deep), "TV 2 Play")
        XCTAssertEqual(AgendaFormat.channelLabel(landing), "TV 2 Play",
                       "the channel NAME is true either way — only the LINK depends on urlKind")
    }

    func testWidgetEntry_landingChannel_stillShowsTheChannelName() throws {
        let now = ISO8601DateFormatter().date(from: "2026-07-13T08:00:00Z")!
        let event = EventBuilder.make(
            sport: "golf", title: "The Open", time: "2026-07-13T10:00:00Z",
            streaming: [["platform": "Viaplay", "url": "https://viaplay.no/no-no/sport", "urlKind": "landing"]]
        )
        let entries = WidgetTimelineBuilder.buildEntries(events: [event], interests: Interests(followBroadly: ["golf"]), now: now)

        let first = try XCTUnwrap(entries.first)
        XCTAssertEqual(first.channelLabel, "Viaplay")
        XCTAssertNil(event.streaming.first?.linkURL, "…and the widget has no link to give it anyway")
    }
}
