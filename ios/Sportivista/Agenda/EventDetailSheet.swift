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
    /// data (whyShown + subjects) alongside the event.
    let row: AgendaEventRow
    /// WP-16.4 / WP-105 — a "Følg <entitet>" tap. The host routes it through the
    /// direct follow apply-vei (`AssistantViewModel.follow`) — the SAME
    /// ProfileStore path Deg › Legg til uses, one source of truth. 3b:
    /// "veien fra «så noe interessant» til «følger» krever aldri assistenten" —
    /// no diff round-trip, the tap IS the confirmation.
    /// No-op default keeps standalone/preview use compiling.
    var onFollow: (Entity) -> Void = { _ in }
    /// WP-252 — the mirror image: a "Slutt å følge <entitet>" tap. The host runs
    /// it through `AssistantViewModel.unfollow`, which resolves the entity's rule
    /// and hands it to the SAME `removeRule` Deg › Det du følger uses — no new
    /// write path, just a second door into the one that exists.
    ///
    /// It hands BACK what it removed (`UnfollowOutcome`), and the sheet keeps
    /// that rule until it is dismissed: undo has to RESTORE the rule, not build
    /// a new one from the entity, or a scoped/lensed follow would come back
    /// widened. The outcome also says whether that was the LAST follow — the one
    /// case where the board does the opposite of what you'd expect (it gets
    /// broader, not empty), which the receipt then says out loud.
    var onUnfollow: (Entity) -> UnfollowOutcome? = { _ in nil }
    /// WP-252 — the undo half: put a rule the sheet just removed back verbatim
    /// (`AssistantViewModel.restore`). Separate from `onFollow` on purpose —
    /// «Følg X» on a subject you never followed is a NEW follow, while a tap on
    /// the row you just flipped is an undo, and only one of the two has a rule
    /// to honour.
    var onRestore: (InterestRule) -> Void = { _ in }
    /// WP-172 — the live-score overlay, forwarded to each entity page so an ongoing
    /// match in its KOMMENDE section shows its running score. nil ⇒ unchanged.
    var liveStore: LiveScoreStore? = nil
    @Environment(\.dismiss) private var dismiss
    /// WP-16.4 — the "Hvorfor vises denne?" context action, collapsed by default.
    @State private var whyExpanded = false
    /// WP-30 — spoiler protection: a masked result stays hidden until the user
    /// taps to reveal it ("til brukeren har «sett» det").
    @State private var resultRevealed = false
    /// WP-252 — follow state the user changed WHILE this sheet was open, keyed by
    /// entity id. The profile write recompiles the agenda BEHIND the sheet, but
    /// `row` is a value copy handed over at presentation and can never learn about
    /// it — so this is the sheet's own honest memory of what it just did, and what
    /// makes the same row flip straight back to «Følg» (the undo).
    @State private var followOverride: [String: Bool] = [:]
    /// WP-252 — the RULES this sheet removed, keyed by entity id, kept until the
    /// sheet is dismissed. This is what makes the undo lossless: a follow can
    /// carry a scope («bare i Grand Slams»), a lens («gjennom norske») and a
    /// weight that the `Entity` alone knows nothing about, so tapping «Følg» to
    /// undo has to put THIS rule back rather than build a fresh default one.
    /// Scoped to the sheet on purpose — the undo is the row, so the memory dies
    /// with the surface that offered it.
    @State private var removedRules: [String: InterestRule] = [:]
    /// WP-252 — the last follow change made here, rendered as one quiet receipt
    /// line under HANDLINGER (VOICE § 5: say what happened and that it can be
    /// undone). nil until the user actually changes something.
    @State private var receipt: FollowReceipt?
    /// WP-252 — a BROAD follow (a whole sport / category) pending confirmation.
    /// Only those; a single team or athlete is undone by tapping the row again.
    @State private var confirmingStop: AgendaSubject?
    /// Bumped on each follow change for the light `.selection` haptic
    /// (DESIGN § Bevegelse: `.selection` på toggle), never under Reduce Motion.
    @State private var followHaptic = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var event: Event { row.event }

    /// One quiet receipt for the last follow change made in this sheet.
    private struct FollowReceipt: Equatable {
        let name: String
        /// The state the entity ended up in — drives which sentence is told.
        let nowFollowed: Bool
        /// WP-252 — the unfollow emptied the profile. The board then does the
        /// opposite of what «forsvinner fra det du følger» suggests: an empty
        /// profile makes `EffectiveInterests.merge` hand the base interests
        /// straight back, and the FeedCompiler falls back to its broad default,
        /// so the agenda gets WIDER, not empty. The one moment the ordinary
        /// «agendaen oppdateres» would be true but useless.
        var wasLastFollow = false
    }

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

                // WP-250 — golf: WHEN the Norwegians tee off and who they are out
                // with. Directly above HVOR SER JEG DET because for a four-day
                // tournament the tee time IS the "når", and "når · hvor" belong
                // side by side.
                golfFieldSection

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
        // DESIGN § Bevegelse & haptikk: `.selection` på toggle, never under
        // Reduce Motion (the trigger is only bumped off that path).
        .sensoryFeedback(.selection, trigger: followHaptic)
        // WP-252 — the ONE follow that still asks first: a whole sport or an
        // umbrella category. Everything narrower is undone by tapping the row
        // again, so a modal would only cost a tap each time.
        .confirmationDialog(
            confirmingStop.map { "Slutt å følge \($0.entity.name)?" } ?? "",
            isPresented: Binding(get: { confirmingStop != nil }, set: { if !$0 { confirmingStop = nil } }),
            titleVisibility: .visible,
            presenting: confirmingStop
        ) { subject in
            Button("Slutt å følge", role: .destructive) {
                apply(subject, follow: false)
                confirmingStop = nil
            }
            .accessibilityIdentifier("detail.follow.confirm")
            Button("Avbryt", role: .cancel) { confirmingStop = nil }
        } message: { subject in
            Text("Hele \(subject.entity.name) forsvinner fra tavla. Lag og utøvere du følger enkeltvis blir stående.")
        }
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

    // MARK: - Context actions (WP-16.4 → WP-252: symmetric follow)

    /// The in-context actions: a quiet, deterministic "Hvorfor vises denne?"
    /// (FeedCompiler.whyShown, no model needed) and — per subject this event is
    /// about — ONE row that goes BOTH ways: «Følg X» when you don't follow it,
    /// «Slutt å følge X» when you do.
    ///
    /// WP-252, the asymmetry this closes: adding from the board took one tap
    /// here, while REMOVING was impossible from the board at all — you had to
    /// go to Deg › Det du følger, find the row, swipe, and confirm. Four steps
    /// away from the moment you noticed you weren't interested. Worse, the old
    /// `row.followable` excluded by design everything you ALREADY followed, so
    /// this section was empty for exactly the rows you most wanted to weed out.
    /// Symmetry rule: where you can do a thing, you can undo it.
    ///
    /// The undo is the row itself. iOS has no free undo toast, and building a
    /// notification system for a two-tap reversal would be more machinery than
    /// the problem deserves — so the row simply STAYS in place and flips to the
    /// opposite action. Tap «Slutt å følge Lyn», it becomes «Følg Lyn», one tap
    /// back. A quiet receipt line under the section says so in words. No modal
    /// asks first (VOICE: undo beats confirm for something reversible); the ONE
    /// exception is a broad follow — a whole sport or category — not because it
    /// is harder to undo (it isn't: one rule, no cascade) but because of how
    /// much of the board it takes with it in a single tap.
    ///
    /// The undo is lossless. «Slutt å følge» hands back the RULE it removed and
    /// the sheet keeps it, so the tap back restores that rule — scope, lens,
    /// weight and all — instead of building a fresh default one. Anything less
    /// would make the receipt's own «Trykk Følg for å angre» a half-truth for
    /// every follow the assistant ever scoped or lensed.
    ///
    /// Neither direction closes the sheet any more. Both apply through the same
    /// direct WP-105 path ("krever aldri assistenten"); the old dismiss-on-follow
    /// was left over from when the tap raised the assistant's diff ark and had to
    /// get out of its way.
    @ViewBuilder
    private var contextActionsSection: some View {
        if !row.whyShown.isEmpty || !row.subjects.isEmpty {
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
                ForEach(row.subjects) { subject in
                    followToggleRow(subject)
                }
                receiptRow
            } header: {
                header("HANDLINGER")
            }
        }
    }

    /// One subject's follow row, in whichever direction applies right now.
    ///
    /// Following is the forward action and keeps the amber it has always had.
    /// Stopping sits in the same place but does NOT take the accent — and is not
    /// red either: `destructive` is DESIGN's token for slett/nullstill, and a
    /// sheet you opened to see where a match is shown must not greet you with
    /// warning-red rows for both teams over something a second tap undoes. It
    /// gets the plain `label` ink (a control, not a disabled read-out) with a
    /// dempet `minus.circle`. Availability is the symmetry the owner asked for;
    /// equal loudness would turn the agenda into an editing tool.
    private func followToggleRow(_ subject: AgendaSubject) -> some View {
        let followed = isFollowed(subject)
        return Button {
            toggleFollow(subject)
        } label: {
            HStack(spacing: 8) {
                Image(systemName: followed ? "minus.circle" : "plus.circle")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(followed ? SportivistaTokens.secondaryLabel : SportivistaTokens.accent)
                    .accessibilityHidden(true)
                // WP-252 gransknings-retting: the FORWARD action keeps amber AND
                // semibold; stopping keeps `label` ink at REGULAR weight. Colour
                // alone was not enough — at the density the owner actually has
                // (both teams and the tournament followed, the subject cap), three
                // stacked semibold rows became the heaviest thing in a sheet you
                // opened to see where the match is shown, pushing HVOR SER JEG DET
                // below the fold. That is the "redigeringsverktøy" this section's
                // own contract forbids; availability is the symmetry, not weight.
                Text(followed ? "Slutt å følge \(subject.entity.name)" : "Følg \(subject.entity.name)")
                    .font(.sportivista(.subheadline, weight: followed ? .regular : .semibold))
                    .foregroundStyle(followed ? SportivistaTokens.label : SportivistaTokens.accent)
                    // Names grow; never truncate them (DESIGN § Forbudsliste).
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            // WP-14.3: this IS an action — a comfortable real row height.
            .frame(minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityIdentifier("detail.follow.\(subject.id)")
        .listRowBackground(SportivistaTokens.cell)
    }

    /// The quiet receipt under the follow rows — what just happened and how to
    /// undo it, in one sentence, only after the user actually changed something.
    ///
    /// Deliberately a plain ROW rather than a `Section` footer: this sheet hides
    /// the scroll background and paints its own `cell` ground, and a footer
    /// renders on the LIST's ground instead — a black band straight across the
    /// sheet in dark mode (seen in the WP-252 screenshots). A row with the same
    /// `listRowBackground` as its neighbours is right in both themes.
    @ViewBuilder
    private var receiptRow: some View {
        if let receipt {
            // The unfollow line is the app's canonical sentence (VOICE § 5, the
            // same one Deg › Det du følger tells), with «Du kan angre» made
            // concrete — here the undo is literally the row above.
            //
            // Except when it was the LAST follow: then «agendaen oppdateres» is
            // true and useless, because the board does the opposite of what the
            // sentence implies — an empty profile hands `EffectiveInterests` the
            // base interests back and the compiler falls back to its broad
            // default, so you get MORE rows, not none. VOICE § 2 (ærlighet foran
            // selvtillit): say it, in one calm sentence, no dialog and no
            // warning — the user is still one tap from undoing it.
            Text(receiptText(receipt))
                .font(.sportivista(.footnote))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, 2)
                .listRowBackground(SportivistaTokens.cell)
                .accessibilityIdentifier("detail.follow.receipt")
        }
    }

    /// The receipt's words. Pure and `static` so the copy is testable without a
    /// view host — these three sentences are the package's promise in words.
    static func receiptText(name: String, nowFollowed: Bool, wasLastFollow: Bool) -> String {
        if nowFollowed {
            return "Du følger \(name) nå, og agendaen oppdateres."
        }
        if wasLastFollow {
            return "\(name) var det siste du fulgte, så agendaen viser bredt igjen — ikke ingenting. Trykk Følg for å angre."
        }
        return "\(name) forsvinner fra det du følger, og agendaen oppdateres. Trykk Følg for å angre."
    }

    private func receiptText(_ receipt: FollowReceipt) -> String {
        Self.receiptText(name: receipt.name, nowFollowed: receipt.nowFollowed, wasLastFollow: receipt.wasLastFollow)
    }

    // MARK: - Follow state (WP-252)

    /// This subject's follow state as the sheet knows it: what the user changed
    /// here wins over the snapshot the row was compiled with.
    private func isFollowed(_ subject: AgendaSubject) -> Bool {
        followOverride[subject.id] ?? subject.isFollowed
    }

    /// Follow or stop following, applying immediately — except for a broad
    /// follow (a whole sport / category), which asks first because of how much
    /// of the board it takes with it in one tap (see `AgendaSubject.isBroadFollow`).
    private func toggleFollow(_ subject: AgendaSubject) {
        guard isFollowed(subject) else { return apply(subject, follow: true) }
        if subject.isBroadFollow {
            confirmingStop = subject
        } else {
            apply(subject, follow: false)
        }
    }

    /// Apply one direction and narrate it.
    ///
    /// The follow direction is TWO different things wearing the same label:
    /// «Følg X» on a subject you never followed is a new follow, while the same
    /// row tapped right after «Slutt å følge X» is an UNDO — and an undo has a
    /// rule to honour. Restoring it (rather than re-following the entity) is
    /// what keeps a scoped/lensed follow from quietly coming back widened.
    private func apply(_ subject: AgendaSubject, follow: Bool) {
        followOverride[subject.id] = follow
        if !reduceMotion { followHaptic &+= 1 }

        if follow {
            if let removed = removedRules.removeValue(forKey: subject.id) {
                onRestore(removed)
            } else {
                onFollow(subject.entity)
            }
            receipt = FollowReceipt(name: subject.entity.name, nowFollowed: true)
        } else {
            let outcome = onUnfollow(subject.entity)
            if let outcome { removedRules[subject.id] = outcome.removed }
            receipt = FollowReceipt(name: subject.entity.name, nowFollowed: false,
                                    wasLastFollow: outcome?.wasLastFollow ?? false)
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
                ForEach(row.subjects) { subject in
                    let entity = subject.entity
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

    // MARK: - Golf field (WP-250)

    /// The Norwegians in a golf field: one quiet line each — «ut 17:24 · med
    /// Robert MacIntyre», a cut player's verbatim status, or the honest «i
    /// feltet» — closed by the field size. The app decoded `featuredGroups` but
    /// had never rendered them anywhere; this is the missing last metre, and the
    /// twin of the web detail's `addGolfField`.
    ///
    /// Absent entirely for every non-golf event and for a golf event that names
    /// no Norwegians, so nothing about today's rows changes elsewhere.
    @ViewBuilder
    private var golfFieldSection: some View {
        let lines = GolfField.lines(for: event)
        let size = GolfField.fieldSize(for: event)
        if !lines.isEmpty {
            Section {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    GolfFieldRow(line: line)
                }
                if let size {
                    DetailRow(label: "Felt", value: size)
                }
            } header: {
                header("NORSKE I FELTET")
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
        event: event, whyShown: "AI-research fant dette for deg"
    ))
}
