//
//  FollowSymmetryDemoSeed.swift
//  Sportivista
//
//  WP-252 — DEBUG-only screenshot harness for the event detail sheet's SYMMETRIC
//  follow actions. `SPORTIVISTA_DEMO=follow-sheet` raises the real
//  `EventDetailSheet` over a fixed row whose two subjects sit on OPPOSITE sides
//  of the follow line: one the profile follows (the sheet offers «Slutt å følge
//  …»), one it doesn't («Følg …»). Both states in one frame, with no sync, no
//  entity index and no network — and tapping either one flips it in place, which
//  is exactly the undo the package ships instead of a confirmation dialog.
//
//  Never compiled into a release build (`#if DEBUG`); lives in Sportivista/Demo/
//  like the other seeds, so only the app targets pick it up.
//

#if DEBUG
import Foundation

enum FollowSymmetryDemoSeed {

    static let followedTeam = Entity(id: "fk-lyn-oslo", name: "FK Lyn Oslo", aliases: ["Lyn"],
                                     sport: "football", type: "team")
    static let unfollowedTeam = Entity(id: "stromsgodset", name: "Strømsgodset", aliases: [],
                                       sport: "football", type: "team")

    /// The profile behind the screenshot: exactly ONE of the two teams followed,
    /// so the sheet has to render both directions at once.
    static func profile(now: Date = Date()) -> InterestProfile {
        InterestProfile(rules: [
            InterestRule(entityId: followedTeam.id, entityName: followedTeam.name, sport: "football",
                         scope: nil, weight: InterestProfile.defaultWeight,
                         reason: "Du valgte å følge FK Lyn Oslo.", addedAt: now),
        ])
    }

    /// An ordinary Eliteserien row — nothing special about it except that its
    /// subjects are stamped the way `AgendaViewModel.subjects` would stamp them
    /// against the profile above.
    static func row(now: Date = Date()) -> AgendaEventRow {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let dict: [String: Any] = [
            "sport": "football", "title": "Strømsgodset – Lyn", "tournament": "Eliteserien",
            "time": iso.string(from: now.addingTimeInterval(3 * 3600)),
            "venue": "Marienlyst stadion, Drammen",
            "homeTeam": "Strømsgodset", "awayTeam": "Lyn",
            "streaming": [["platform": "TV 2 Play", "url": "https://play.tv2.no"]],
        ]
        let event = (try? JSONSerialization.data(withJSONObject: dict)).flatMap {
            try? SportivistaJSON.decoder.decode(Event.self, from: $0)
        }!
        return AgendaEventRow(
            id: "demo-follow-symmetry",
            timeLabel: AgendaFormat.timeLabel(time: event.time, endTime: nil),
            title: "Strømsgodset – Lyn",
            metaLabel: "Eliteserien",
            channelLabel: "TV 2 Play",
            isMustSee: true, mustWatch: true, isAIResearch: false,
            event: event,
            whyShown: "Fordi Lyn spiller.",
            subjects: [
                AgendaSubject(entity: unfollowedTeam, isFollowed: false),
                AgendaSubject(entity: followedTeam, isFollowed: true),
            ]
        )
    }
}
#endif
