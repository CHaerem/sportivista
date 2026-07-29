//
//  EventDetailSheet.swift
//  Sportivista
//
//  WP-14 — the tap-to-expand detail sheet for a single event: venue,
//  summary, every streaming option as a real link, and — when the event
//  carries `source == "ai-research"` — the AI provenance block (confidence +
//  evidence links). "Åpenhet er en funksjon" (CLAUDE.md): the ⓘ isn't
//  decoration, it's how the app earns trust for events a human didn't
//  curate. Still the Apple-native baseline throughout (system type, amber), not
//  the system's default List chrome.
//

import SwiftUI

struct EventDetailSheet: View {
    /// WP-16.4 — the full agenda row, so the sheet has the precomputed context
    /// data (whyShown + followable) alongside the event.
    let row: AgendaEventRow
    /// WP-16.4 / WP-105 — a "Følg <entitet>" tap. The host routes it through the
    /// direct follow apply-vei (`AssistantViewModel.follow`) — the SAME
    /// ProfileStore path Deg › Legg til uses, one source of truth. 3b:
    /// "veien fra «så noe interessant» til «følger» krever aldri assistenten" —
    /// no diff round-trip, the tap IS the confirmation and the sheet closes.
    /// No-op default keeps standalone/preview use compiling.
    var onFollow: (Entity) -> Void = { _ in }
    /// WP-172 — the live-score overlay, forwarded to each entity page so an ongoing
    /// match in its KOMMENDE section shows its running score. nil ⇒ unchanged.
    var liveStore: LiveScoreStore? = nil
    @Environment(\.dismiss) private var dismiss
    /// WP-16.4 — the "Hvorfor vises denne?" context action, collapsed by default.
    @State private var whyExpanded = false
    /// WP-30 — spoiler protection: a masked result stays hidden until the user
    /// taps to reveal it ("til brukeren har «sett» det").
    @State private var resultRevealed = false

    private var event: Event { row.event }

    private var titleText: String {
        AgendaFormat.title(homeTeam: event.homeTeam, awayTeam: event.awayTeam, participants: event.participants, fallback: event.title)
    }

    var body: some View {
        NavigationStack {
            List {
                if let venue = event.venue, !venue.isEmpty, venue != "TBD" {
                    DetailRow(label: "Arena", value: venue)
                }
                aboutSection

                contextActionsSection

                // WP-170 — ONE tap from an event to «hva skjer med X?»: the
                // entity page for each side this event is about. Placed high,
                // right under HANDLINGER, because "who is this about" is the
                // question a tapped row raises before "where do I watch it".
                entityPagesSection

                Section {
                    if event.streaming.isEmpty {
                        Text("Kanal ukjent")
                            .font(.sportivista(.subheadline))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                            .listRowBackground(SportivistaTokens.cell)
                    } else {
                        ForEach(Array(event.streaming.enumerated()), id: \.offset) { _, channel in
                            StreamingLinkRow(channel: channel)
                        }
                    }
                } header: {
                    header("HVOR SER JEG DET")
                }

                if event.source == "ai-research" {
                    Section {
                        ProvenanceRows(event: event)
                    } header: {
                        header("ⓘ FUNNET AV AI")
                    }
                }

                // The reminder ("varsel") state lives HERE, quietly, not in
                // the agenda row (DESIGN.md "Radens anatomi": "Varslings-
                // tilstand vises IKKE i raden … bor i detaljarket"). It is an
                // honest read-out of whether this event arms a reminder (the
                // must-watch rule, keyed off interests.json), not a fake
                // control — a user-set per-event override would be a new
                // feature, out of WP-14.1 scope.
                Section {
                    // WP-131: read the reminder state from the RECOMPUTED row flag
                    // (AgendaViewModel derives it via FeedCompiler.mustWatch against
                    // THIS device's effective interests), not the server event field.
                    // The published events.json is user-neutral and no longer carries
                    // a mustWatch stamp, so `event.mustWatch` would be false for
                    // everyone; `row.mustWatch` is this user's own bell state.
                    NotifyStatusRow(on: row.mustWatch)
                } header: {
                    header("VARSEL")
                }

                // RESULTAT sist (WP-127) — DESIGN § Event-detalj orders the sheet
                // Arena · Om · Hvor ser jeg det · Funnet av AI · Varsel · Resultat.
                // The result (spoiler-masked when needed) is the LAST section, so a
                // glance at the sheet never lands on the outcome first.
                resultSection

                // WP-171: TABELL last — the league table / golf leaderboard /
                // F1 championship for this event (web has had it in the detail
                // sheet since WP-14). One call site; everything it needs lives
                // in EventStandingsSection, including the spoiler masking.
                EventStandingsSection(row: row)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(SportivistaTokens.cell)
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Lukk") { dismiss() }
                        .foregroundStyle(SportivistaTokens.accent)
                        .sportivistaTapTarget()
                }
                // WP-182 — share this event as the branded delekort (rendered
                // locally by Share/ShareCard.swift; nothing is fetched).
                ToolbarItem(placement: .primaryAction) {
                    ShareLink(
                        item: ShareCardItem(spec: ShareCardSpec.event(row: row, dayLine: ShareCardSpec.dayLine(for: event.time))),
                        preview: SharePreview(titleText)
                    ) {
                        Label("Del", systemImage: "square.and.arrow.up")
                    }
                    .foregroundStyle(SportivistaTokens.accent)
                    .sportivistaTapTarget()
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    // WP-147: section headers are DEMPET grey (`secondaryLabel`), never amber.
    // Amber is the app's ONE accent, reserved for action/state (DESIGN § Farge:
    // "Aldri brødtekst, aldri to i samme rad"). The amber headers made
    // "HANDLINGER"/"HVOR SER JEG DET"/… collide with the grey "ARENA"/"OM"
    // DetailRow labels — two colours for the SAME role in one sheet — and read as
    // matt mustard/brown in light mode (the dated Tekst-TV look). Grey matches the
    // DetailRow/AboutRow labels + the agenda/Nyheter section headers. Amber stays
    // ONLY on in-sheet action/state: «På», the streaming link + ↗, «Skjult»-reveal.
    private func header(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.caption2, weight: .semibold))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
            .tracking(0.5)
    }

    // MARK: - "Om" (WP-127 — paragraphs, not a wall)

    /// The "Om" block: the summary split into calm paragraphs (with a soft
    /// length cap + "Mer" for extremely long texts) plus the quiet key-fact
    /// lines — Runde / Underlag / Format — where those fields exist. Mirrors the
    /// web detail's structure (detail.js `aboutParagraphs` + the key-fact rows);
    /// the wall-of-text single `Text` it replaces was 600–786 chars in live data.
    @ViewBuilder
    private var aboutSection: some View {
        let paragraphs = AgendaFormat.aboutParagraphs(event.summary)
        if !paragraphs.isEmpty {
            AboutRow(paragraphs: paragraphs)
        }
        if let round = event.round, !round.isEmpty {
            DetailRow(label: "Runde", value: round)
        }
        if let surface = event.surface, !surface.isEmpty {
            DetailRow(label: "Underlag", value: surface)
        }
        if let format = event.format, !format.isEmpty {
            DetailRow(label: "Format", value: format)
        }
    }

    // MARK: - Context actions (WP-16.4)

    /// The two in-context actions: a quiet, deterministic "Hvorfor vises denne?"
    /// (FeedCompiler.whyShown, no model needed) and a quiet "Følg <entitet>" per
    /// followable subject. WP-105: the follow tap goes through the direct apply-
    /// vei (host's `onFollow` → `AssistantViewModel.follow`), applying immediately
    /// and closing the sheet — no assistant diff to confirm ("krever aldri
    /// assistenten"). `row.followable` already excludes anything followed, so the
    /// button only appears for a not-yet-followed subject.
    @ViewBuilder
    private var contextActionsSection: some View {
        if !row.whyShown.isEmpty || !row.followable.isEmpty {
            Section {
                if !row.whyShown.isEmpty {
                    DisclosureGroup(isExpanded: $whyExpanded) {
                        Text(row.whyShown)
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.label.opacity(0.85))
                            .padding(.vertical, 4)
                    } label: {
                        Text("Hvorfor vises denne?")
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.label)
                            // WP-14.3: the disclosure header is the tap
                            // target for the whole row — guarantee ≥44pt
                            // even though the label text itself is small.
                            .frame(minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                    }
                    .tint(SportivistaTokens.secondaryLabel)
                    .listRowBackground(SportivistaTokens.cell)
                }
                ForEach(row.followable, id: \.id) { entity in
                    Button {
                        // Hand off to the command-line assistant's diff flow,
                        // then close the sheet so the diff ark is unobscured.
                        onFollow(entity)
                        dismiss()
                    } label: {
                        HStack(spacing: 8) {
                            Text("» Følg \(entity.name)")
                                .font(.sportivista(.subheadline, weight: .semibold))
                                .foregroundStyle(SportivistaTokens.accent)
                            Spacer()
                        }
                        // WP-14.3: this IS an action (Følg …) — a comfortable
                        // real row height, not a glyph-small tap.
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(SportivistaTokens.cell)
                }
            } header: {
                header("HANDLINGER")
            }
        }
    }

    // MARK: - Entity pages (WP-170)

    /// One row per side this event is about, each pushing that entity's page
    /// (next event · last result · table · news). Absent entirely when the
    /// entity index hasn't synced or resolved nothing — the honest degradation
    /// is no section, never an empty list of names we can't stand behind.
    @ViewBuilder
    private var entityPagesSection: some View {
        if !row.subjects.isEmpty {
            Section {
                ForEach(row.subjects, id: \.id) { entity in
                    NavigationLink {
                        EntityPageView(entity: entity, liveStore: liveStore)
                    } label: {
                        HStack(spacing: 10) {
                            EntityAvatarView(identity: EntityIdentityResolver.identity(for: entity), sport: entity.sport)
                            Text(entity.name)
                                .font(.sportivista(.subheadline))
                                .foregroundStyle(SportivistaTokens.label)
                            Spacer(minLength: 4)
                        }
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .accessibilityIdentifier("detail.entity.\(entity.id)")
                    .listRowBackground(SportivistaTokens.cell)
                }
            } header: {
                header("LAG OG UTØVERE")
            }
        }
    }

    // MARK: - Result (WP-30 — spoiler protection)

    /// The event's result/score. When the user has a spoiler policy on this
    /// event's sport/entity (`row.spoilerSafe == false`), the outcome is MASKED
    /// behind a calm tap-to-reveal, so a glance at the sheet never spoils a game
    /// they're watching on delay. When safe, it shows plainly. Absent otherwise.
    @ViewBuilder
    private var resultSection: some View {
        if let result = event.result, !result.isEmpty {
            Section {
                if row.spoilerSafe || resultRevealed {
                    Text(result)
                        .font(.sportivista(.subheadline))
                        .foregroundStyle(SportivistaTokens.label)
                        .listRowBackground(SportivistaTokens.cell)
                } else {
                    Button {
                        resultRevealed = true
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Skjult — spoilervern på")
                                .font(.sportivista(.subheadline, weight: .semibold))
                                .foregroundStyle(SportivistaTokens.accent)
                            Text("Trykk for å vise resultatet")
                                .font(.sportivista(.caption))
                                .foregroundStyle(SportivistaTokens.secondaryLabel)
                        }
                        // WP-14.3: a real, comfortable tap target.
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .listRowBackground(SportivistaTokens.cell)
                }
            } header: {
                header("RESULTAT")
            }
        }
    }
}

/// The "Om" summary as calm paragraphs (WP-127). `AgendaFormat.aboutParagraphs`
/// has already split the text; this renders each as its own `Text` under a quiet
/// "OM" label, with a soft length cap: an extremely long summary shows its
/// leading paragraph(s) up to the cap plus a "Mer" reveal, so the sheet opens
/// calm rather than as one wall. Dynamic-Type throughout (no fixed point sizes).
private struct AboutRow: View {
    let paragraphs: [String]
    @State private var expanded = false

    /// Soft cap in characters. At/under it the whole text shows; over it, the
    /// leading paragraph(s) that reach the cap show, with a "Mer" for the rest.
    private let softCap = 320

    private var totalLength: Int { paragraphs.reduce(0) { $0 + $1.count } }
    private var isLong: Bool { totalLength > softCap }

    private var visible: [String] {
        guard isLong, !expanded else { return paragraphs }
        var shown: [String] = []
        var total = 0
        for p in paragraphs {
            shown.append(p)
            total += p.count
            if total >= softCap { break }
        }
        return shown
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("OM")
                .font(.sportivista(.caption2, weight: .semibold))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
            ForEach(Array(visible.enumerated()), id: \.offset) { _, para in
                Text(para)
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isLong && !expanded && visible.count < paragraphs.count {
                Button {
                    expanded = true
                } label: {
                    Text("Mer")
                        .font(.sportivista(.footnote, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.accent)
                        // A comfortable tap target even though the label is small.
                        .frame(minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(SportivistaTokens.cell)
    }
}

/// A label/value pair, e.g. "ARENA" / "Bislett stadion, Oslo".
struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label.uppercased())
                .font(.sportivista(.caption2, weight: .semibold))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
            Text(value)
                .font(.sportivista(.subheadline))
                .foregroundStyle(SportivistaTokens.label)
        }
        .padding(.vertical, 4)
        .listRowBackground(SportivistaTokens.cell)
    }
}

/// The quiet reminder read-out (DESIGN.md "Detaljark"): amber "På" when the
/// event arms a reminder, dempet "Av" otherwise — a matter-of-fact status, no
/// exclamation, no fake control.
private struct NotifyStatusRow: View {
    let on: Bool

    var body: some View {
        HStack(spacing: 8) {
            Text(on ? "På" : "Av")
                .font(.sportivista(.subheadline, weight: .semibold))
                .foregroundStyle(on ? SportivistaTokens.accent : SportivistaTokens.secondaryLabel)
            Text(on ? "minner deg før start" : "ingen påminnelse")
                .font(.sportivista(.caption))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
        }
        .padding(.vertical, 2)
        .listRowBackground(SportivistaTokens.cell)
    }
}

/// One streaming option: a real tappable Link only when the URL points at the
/// BROADCAST, plain text otherwise (`StreamingChannel.linkURL` — the Swift twin
/// of dashboard.js's `streamLink`; never fake a link).
///
/// WP-247/WP-246: a `landing` URL drops you on TV 2 Play / Viaplay's front page,
/// not on this match, so we name the channel — which is true and useful — and
/// admit the missing link instead of dressing the rights map up as an answer.
/// The sheet has room to say WHY, so it does, quietly, in the same muted voice
/// as «(bekreftes)». No warning icon: DESIGN.md § Grunnlov 3 ("Ærlig innhold")
/// and § Stemme ("Kanal ukjent", ikke "Ingen streaming!").
private struct StreamingLinkRow: View {
    let channel: StreamingChannel

    var body: some View {
        Group {
            if let url = channel.linkURL {
                Link(destination: url) {
                    row(linked: true)
                }
            } else {
                row(linked: false)
            }
        }
        .listRowBackground(SportivistaTokens.cell)
    }

    /// The quiet aside after the channel name. A tentative entry's «(bekreftes)»
    /// wins — it is the more specific truth, and two asides on one row would be
    /// noise (mirrors detail.js, which picks exactly one).
    private var note: String? {
        if channel.tentative == true { return "(bekreftes)" }
        if channel.hasUnlinkableURL { return "(ingen direkte lenke)" }
        return nil
    }

    private func row(linked: Bool) -> some View {
        HStack {
            Text(channel.platform?.isEmpty == false ? channel.platform! : "Ukjent kanal")
                .font(.sportivista(.subheadline))
                .foregroundStyle(linked ? SportivistaTokens.accent : SportivistaTokens.label)
            if let note {
                Text(note)
                    .font(.sportivista(.caption2))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
            }
            Spacer()
            if linked {
                Text("↗")
                    .font(.sportivista(.caption))
                    .foregroundStyle(SportivistaTokens.accent)
            }
        }
    }
}

/// Confidence + every evidence URL as its own link — the "ⓘ-proveniens" the
/// WP-14 brief asks for. Norwegian, matter-of-fact.
private struct ProvenanceRows: View {
    let event: Event

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sikkerhet: \(confidenceLabel)")
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.label)
            if event.evidence.isEmpty {
                Text("Ingen kildelenker oppgitt.")
                    .font(.sportivista(.caption))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
            } else {
                ForEach(Array(event.evidence.enumerated()), id: \.offset) { index, urlString in
                    if let url = URL(string: urlString) {
                        Link("Kilde \(index + 1)", destination: url)
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.accent)
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .listRowBackground(SportivistaTokens.cell)
    }

    private var confidenceLabel: String {
        switch event.confidence {
        case "high": return "høy"
        case "medium": return "middels"
        case "low": return "lav"
        default: return "ukjent"
        }
    }
}

#Preview {
    let event = try! SportivistaJSON.decoder.decode(Event.self, from: Data("""
    {"sport":"chess","title":"Sjakk-NM 2026","time":"2026-07-03T16:00:00Z","venue":"Normoria, Kristiansund",
     "summary":"Landsturneringen 2026.","streaming":[{"platform":"Lichess","url":"https://lichess.org"}],
     "source":"ai-research","confidence":"high","evidence":["https://sjakknm2026.no/"]}
    """.utf8))
    return EventDetailSheet(row: AgendaEventRow(
        id: "preview", timeLabel: "18:00", title: "Sjakk-NM 2026", metaLabel: nil,
        channelLabel: "Lichess", isMustSee: false, mustWatch: false, isAIResearch: true,
        event: event, whyShown: "AI-research fant dette for deg", followable: []
    ))
}
