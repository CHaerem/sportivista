//
//  GolfField.swift
//  Sportivista
//
//  WP-250 — the Norwegians in a golf field: each one's tee time and who they
//  are out with, plus the field size.
//
//  The data has been in `events.json` (and decoded into `Event.featuredGroups`
//  / `Event.norwegianPlayers`) all along, and the WEB detail has rendered it
//  since WP-14 — but NOTHING in the app ever read `featuredGroups`. A golf row
//  said «27.–30. aug · PGA Tour · HBO Max» and stopped there, so the one fact
//  that answers "when do I turn the TV on" for a four-day tournament was
//  invisible on this flate. This file is the Swift twin of `detail.js`
//  `addGolfField`, wording for wording.
//
//  On the name: `featuredGroups` comes from PGA Tour's /tee-times page, i.e.
//  the round's real PAIRINGS — who tees off together. It is NOT a broadcaster's
//  camera-group manifest, so nothing here promises "dette vises på TV"; it says
//  the true thing («ut 17:24 · med Robert MacIntyre»), which is also the useful
//  one. DESIGN.md § Grunnlov 3: ærlig innhold, aldri lat som.
//

import Foundation
import SwiftUI

/// The pure formatting behind the detail sheet's NORSKE I FELTET section —
/// no SwiftUI, so it is unit-tested directly (`GolfFieldTests`).
enum GolfField {
    /// One Norwegian in the field: their name, and the calm one-liner under it.
    struct Line: Equatable {
        /// The player's own name — a proper noun, never uppercased or shortened.
        let name: String
        /// «ut 17:24 · med Robert MacIntyre», a verbatim status («røk cutten»),
        /// or the honest «i feltet» when we know nothing but that they are in it.
        let detail: String
    }

    /// Every Norwegian in this golf event, in the order the pipeline lists them.
    /// Empty for any other sport, and empty when the event names no Norwegians —
    /// the caller then renders no section at all (rather than an empty one).
    static func lines(for event: Event) -> [Line] {
        guard event.sport == "golf" else { return [] }
        var lines: [Line] = []
        var listed = Set<String>()

        for player in event.norwegianPlayers {
            listed.insert(player.name.lowercased())
            // WP-95: a player who is out (cut/WD) shows that status VERBATIM —
            // never a tee time and never «i feltet», both of which would read as
            // "still playing".
            if let status = player.status, !status.isEmpty {
                lines.append(Line(name: player.name, detail: status))
                continue
            }
            let group = self.group(named: player.name, in: event)
            lines.append(Line(
                name: player.name,
                detail: detail(teeTime: player.teeTime ?? group?.teeTime, group: group)
            ))
        }

        // Defensive, mirroring the web: a featured group whose Norwegian never
        // made it into `norwegianPlayers`. Only listed when it actually carries
        // something — a bare name we know nothing about is not a line.
        for group in event.featuredGroups {
            guard let player = group.player, !player.isEmpty,
                  !listed.contains(player.lowercased()) else { continue }
            let detail = detail(teeTime: group.teeTime, group: group)
            guard detail != inTheField else { continue }
            lines.append(Line(name: player, detail: detail))
        }
        return lines
    }

    /// «30 i feltet» — the size of the field, when the pipeline knows it.
    static func fieldSize(for event: Event) -> String? {
        guard event.sport == "golf", let total = event.totalPlayers, total > 0 else { return nil }
        return "\(total) i feltet"
    }

    // MARK: - Internals

    /// The honest fallback: we know they are playing, nothing more.
    private static let inTheField = "i feltet"

    private static func group(named name: String, in event: Event) -> FeaturedGroup? {
        let key = name.lowercased()
        return event.featuredGroups.first { ($0.player ?? "").lowercased() == key }
    }

    /// «ut 17:24 · med Robert MacIntyre» — the same two parts, joined by the same
    /// quiet middot, as `detail.js addGolfField`. "ut" is what the sport calls a
    /// tee-off ("Hovland går ut 17:24") and it keeps a bare clock from reading as
    /// a second start time next to the event's own multi-day window.
    private static func detail(teeTime: String?, group: FeaturedGroup?) -> String {
        var parts: [String] = []
        if let tee = teeTime, !tee.isEmpty { parts.append("ut \(tee)") }
        let mates = (group?.groupmates ?? [])
            .compactMap { $0.name }
            .filter { !$0.isEmpty }
        if !mates.isEmpty { parts.append("med \(mates.joined(separator: ", "))") }
        return parts.isEmpty ? inTheField : parts.joined(separator: " · ")
    }
}

/// One Norwegian in the field. Deliberately NOT `DetailRow`: that one uppercases
/// its label, and a person's name is a proper noun — «VIKTOR HOVLAND» is both
/// shouty and wrong (VOICE.md: egennavn står som de er). Same stacked rhythm and
/// the same two type roles otherwise, so the section sits flush with ARENA / OM.
struct GolfFieldRow: View {
    let line: GolfField.Line

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(line.name)
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label)
            Text(line.detail)
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .listRowBackground(SportivistaTokens.cell)
    }
}
