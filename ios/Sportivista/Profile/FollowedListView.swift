//
//  FollowedListView.swift
//  Sportivista
//
//  WP-105 → WP-120 — "Det du følger" (DESIGN § Deg-skjermen). WP-105 shipped a
//  plain one-section name list whose subtitle read identically on every row
//  («sport · varsler på»); the owner (20.07) called that out as dead information
//  — the surface must answer «what does following this GIVE me?».
//
//  WP-120 makes each row carry value and groups by rule TYPE:
//    • Sections per rule type (UTØVERE / LAG / TURNERINGER / LIGAER / SPORTER /
//      KATEGORIER), so the list reads as what you follow, not one flat blur.
//    • Row = canonical sport symbol (SportSymbol, WP-108) + name + the PER-ENTITY
//      next event as the subtitle («Neste: lør 25. · Strømsgodset – Lyn · TV 2»)
//      or an honest quiet-state line («Fulgt — …», see FollowPresenter WP-164).
//    • Safe handling: a `.swipeActions` «Slutt å følge» + a calm undo snackbar
//      after a removal.
//
//  WP-252 removed the confirmation dialog that sat in FRONT of that snackbar.
//  Asking «Slutt å følge X?» and THEN offering «Angre» guards the same tap
//  twice: the modal cost a tap every single time and protected against almost
//  nothing, since undo is one tap away. Undo afterwards is calmer and more
//  forgiving than asking first. The ONE case that still asks is a BROAD sweep —
//  a whole sport or an umbrella category (`FollowGroup.isBroadSweep`) — and the
//  reason is its SIZE, not its permanence: a sport rule is the only kind that
//  admits events wholesale, so one tap can empty most of the board.
//
//  «Angre» RESTORES the removed rule (`AssistantViewModel.restore`) rather than
//  re-following a resolved entity, so a follow's scope, lens and weight survive
//  it — a re-follow rebuilds the rule from scratch and drops all three, and two
//  of them are shown to the user on the follow's own detail («Avgrensning»,
//  «Perspektiv»). It also needs no snapshot to work (see UndoState).
//  The next-event / news / grouping is the pure `FollowPresenter` (reusing the
//  lens's own matching — no new fuzzy); writes still go through the one apply
//  path (`AssistantViewModel.follow` / `.removeRule`).
//
//  A «+» toolbar entry opens the Legg til-søk. Interests without the assistant
//  (3b): every follow/unfollow here runs through the SAME ProfileStore apply path
//  the assistant's confirmed diff uses (one source of truth).
//

import SwiftUI

struct FollowedListView: View {
    var viewModel: AssistantViewModel
    @State private var addShown = false
    /// The read snapshot (relevance-filtered agenda + news + index), rebuilt when
    /// the rule set changes so a just-added follow's next event shows at once.
    @State private var snapshot: AssistantViewModel.FollowSnapshot?
    /// Precomputed row subtitles (entityId → «Neste: …» / «Fulgt — …»),
    /// so scrolling never re-runs the per-rule event scan.
    @State private var subtitles: [String: String] = [:]
    /// WP-252 — the rule a swipe is confirming a stop for, and the ONLY thing
    /// that still raises a dialog: a BROAD follow (a whole sport / category).
    /// Every narrow follow removes on the spot and offers «Angre» instead.
    @State private var confirmingStop: InterestRule?
    /// The just-removed follow, shown as a calm undo snackbar for a few seconds.
    @State private var undo: UndoState?
    /// WP-134: the leading sport-symbol column scales WITH its `.body` font — a
    /// fixed 24 pt frame stayed put while the glyph grew at Accessibility sizes.
    @ScaledMetric(relativeTo: .body) private var symbolWidth = 24

    private var rules: [InterestRule] { viewModel.profile.rules }

    /// WP-252 — the removed follow, held for the «Angre» snackbar. It carries the
    /// RULE and nothing else: undo restores that rule verbatim
    /// (`AssistantViewModel.restore`) instead of re-following a resolved entity.
    ///
    /// The old shape also carried an `Entity?` resolved from the presenter
    /// snapshot, and «Angre» silently did NOTHING when that was nil — reachable
    /// from `FollowDetailView`, whose «Slutt å følge» button is live before its
    /// `.task` has built a snapshot. A rule knows its own name, sport, scope,
    /// lens and weight, so it needs no lookup to come back.
    private struct UndoState: Identifiable {
        let id = UUID()
        let rule: InterestRule
    }

    var body: some View {
        List {
            if rules.isEmpty {
                Section {
                    // WP-254 — the middle sentence. The list was honest about
                    // ITSELF and silent about the board: an empty profile leaves
                    // `EffectiveInterests` handing the base interests back, so
                    // the agenda is on its broad default the whole time this
                    // screen says «ingenting». Same truth the detail sheet's
                    // receipt tells at both ends of the list, told here as a
                    // standing state rather than a receipt — this screen has no
                    // receipt line, and the «Angre»-snackbar is a one-line bar
                    // that would truncate the sentence rather than carry it.
                    // VOICE § 4: a tomhet says what happened AND what you can do.
                    Text("Ingenting ennå. Agendaen viser bredt så lenge lista er tom. Trykk + for å søke opp et lag, en utøver eller en turnering å følge.")
                        .font(.sportivista(.subheadline))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .accessibilityIdentifier("followed.empty")
                }
                .listRowBackground(SportivistaTokens.cell)
            } else if let snap = snapshot {
                ForEach(snap.presenter.sections(for: rules, affinity: Affinity(behavior: viewModel.memory.behavior))) { section in
                    Section {
                        ForEach(section.rules) { rule in
                            NavigationLink {
                                FollowDetailView(viewModel: viewModel, rule: rule,
                                                 onStopped: { stopped in
                                                     withAnimation { undo = UndoState(rule: stopped) }
                                                 })
                            } label: {
                                followRow(rule)
                            }
                            .accessibilityIdentifier("followed.row.\(rule.entityId)")
                            .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                Button(role: .destructive) {
                                    requestStop(rule)
                                } label: {
                                    Label("Slutt å følge", systemImage: "xmark.circle")
                                }
                                .accessibilityIdentifier("followed.swipe.\(rule.entityId)")
                            }
                        }
                    } header: {
                        groupHeader(section.group.header)
                    }
                    .listRowBackground(SportivistaTokens.cell)
                }
            } else {
                // Snapshot still building — show names immediately (no dead subtitle),
                // the grouped list + subtitles fill in on the next frame.
                Section {
                    ForEach(rules) { rule in
                        NavigationLink {
                            FollowDetailView(viewModel: viewModel, rule: rule,
                                             onStopped: { stopped in
                                                 withAnimation { undo = UndoState(rule: stopped) }
                                             })
                        } label: {
                            followRow(rule)
                        }
                    }
                }
                .listRowBackground(SportivistaTokens.cell)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(SportivistaTokens.background)
        .foregroundStyle(SportivistaTokens.label)
        .navigationTitle("Det du følger")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    addShown = true
                } label: {
                    Image(systemName: "plus")
                }
                .tint(SportivistaTokens.accent)
                .accessibilityLabel("Legg til")
                .accessibilityIdentifier("followed.add")
            }
        }
        .sheet(isPresented: $addShown) {
            AddFollowSearchView(viewModel: viewModel)
        }
        .task(id: rules) { rebuildSnapshot() }
        .overlay(alignment: .bottom) { undoSnackbar }
        .confirmationDialog(
            confirmingStop.map { "Slutt å følge \($0.entityName)?" } ?? "",
            isPresented: Binding(get: { confirmingStop != nil }, set: { if !$0 { confirmingStop = nil } }),
            titleVisibility: .visible,
            presenting: confirmingStop
        ) { rule in
            Button("Slutt å følge", role: .destructive) { stopFollowing(rule) }
                .accessibilityIdentifier("followed.stop.confirm")
            Button("Avbryt", role: .cancel) { confirmingStop = nil }
        } message: { rule in
            Text("Hele \(rule.entityName) forsvinner fra tavla. Lag og utøvere du følger enkeltvis blir stående.")
        }
    }

    // MARK: - Row

    private func followRow(_ rule: InterestRule) -> some View {
        HStack(spacing: 12) {
            Image(systemName: SportSymbol.name(for: rule.sport))
                .font(.sportivista(.body))
                .foregroundStyle(SportivistaTokens.tertiaryLabel)
                .frame(width: symbolWidth)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.entityName)
                    .font(.sportivista(.body, weight: .semibold))
                    .foregroundStyle(SportivistaTokens.label)
                Text(subtitles[rule.entityId] ?? " ")
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .lineLimit(2)
            }
        }
        .contentShape(Rectangle())
    }

    private func groupHeader(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.footnote, weight: .semibold))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
    }

    // MARK: - Undo snackbar (HIG-native calm safety net)

    @ViewBuilder private var undoSnackbar: some View {
        if let u = undo {
            HStack(spacing: 12) {
                Text("Sluttet å følge \(u.rule.entityName)")
                    .font(.sportivista(.subheadline))
                    .foregroundStyle(SportivistaTokens.label)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Button("Angre") {
                    viewModel.restore(u.rule)
                    undo = nil
                }
                .font(.sportivista(.subheadline, weight: .semibold))
                .foregroundStyle(SportivistaTokens.accent)
                .accessibilityIdentifier("followed.undo")
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(SportivistaTokens.cell2, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(SportivistaTokens.separator))
            .padding(.horizontal, 16)
            .padding(.bottom, 14)
            .transition(.opacity)
            .task(id: u.id) {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if undo?.id == u.id { withAnimation { undo = nil } }
            }
        }
    }

    // MARK: - Actions

    /// A swipe asked to stop this follow. A BROAD one (whole sport / category)
    /// gets the calm confirmation; everything narrower removes immediately and
    /// answers with «Angre» — WP-252: undo instead of confirm for something
    /// that is trivially reversible.
    private func requestStop(_ rule: InterestRule) {
        let broad = snapshot?.presenter.group(for: rule).isBroadSweep ?? false
        if broad { confirmingStop = rule } else { stopFollowing(rule) }
    }

    private func stopFollowing(_ rule: InterestRule) {
        viewModel.removeRule(rule)
        confirmingStop = nil
        withAnimation { undo = UndoState(rule: rule) }
    }

    private func rebuildSnapshot() {
        let snap = viewModel.followSnapshot()
        snapshot = snap
        var subs: [String: String] = [:]
        for rule in rules { subs[rule.entityId] = snap.presenter.rowSubtitle(for: rule) }
        subtitles = subs
    }
}

// MARK: - Detail (rad → detalj)

/// One follow's detail — since WP-170 the ENTITY PAGE with the follow's own
/// settings underneath, so the whole «hva skjer med X?» answer is ONE tap from
/// the follow row and the admin never sits above the value.
///
/// The value half (anker · KOMMENDE · SISTE RESULTAT · TABELL · SISTE NYTT ·
/// MER) is `EntityPageSections`, shared byte-for-byte with the standalone
/// `EntityPageView` the event detail sheet pushes. WP-120's KOMMENDE + SISTE
/// NYTT moved INTO that shared page rather than being duplicated here; the
/// device-wide reminder read-out, the WP-176 fulltidsvarsel switch and «Slutt å
/// følge» (behind a calm confirmation) are unchanged.
struct FollowDetailView: View {
    var viewModel: AssistantViewModel
    let rule: InterestRule
    /// WP-252 — the follow was stopped here and this screen popped. The list
    /// underneath raises its «Angre» snackbar, so the undo survives the
    /// navigation instead of disappearing with the screen that offered it. It
    /// passes the RULE, which is all a restore needs.
    var onStopped: (InterestRule) -> Void = { _ in }

    @State private var snapshot: AssistantViewModel.FollowSnapshot?
    /// The composed entity page (WP-170) — loaded off the main actor.
    @State private var page: EntityPage?
    @State private var detailRow: AgendaEventRow?
    @State private var confirmingStop = false
    @Environment(\.dismiss) private var dismiss
    /// The device-wide reminder preference — the only notify signal the on-device
    /// profile carries (there is no per-entity notify field), shown honestly.
    private let leadTimeOn = NotificationLeadPreference.isLeadTimeEnabled()
    /// WP-176 — this entity's fulltidsvarsel switch (per device, off by default).
    @State private var resultAlertOn = false

    /// The resolved entity behind the rule (or the rule's own stand-in when the
    /// index hasn't synced) — the entity page's subject.
    private var entity: Entity {
        snapshot?.presenter.entity(for: rule)
            ?? Entity(id: rule.entityId, name: rule.entityName, aliases: [], sport: rule.sport, type: "")
    }
    /// WP-125: this follow's name resolves to nothing we know — likely mistyped.
    private var isUnresolved: Bool { snapshot?.presenter.matchState(for: rule) == .unresolved }
    /// Nearest real names for an unresolved follow (reuses the index fuzzy).
    private var nameSuggestions: [Entity] { snapshot?.presenter.nameSuggestions(for: rule) ?? [] }
    /// WP-134: the leading sport-symbol column scales WITH its `.body` font
    /// (kommende + suggestion rows), so the glyph never overflows at AX sizes.
    @ScaledMetric(relativeTo: .body) private var symbolWidth = 24

    var body: some View {
        List {
            if isUnresolved {
                // WP-164: a deliberate soft-follow («Følg likevel») is not a typo
                // — it waits honestly for coverage instead of blaming the name.
                if rule.isSoftFollow {
                    Section {
                        Text("Vi kjenner ikke «\(rule.entityName)» ennå, men følger navnet. Raden fylles når events eller nyheter dukker opp.")
                            .font(.sportivista(.subheadline))
                            .foregroundStyle(SportivistaTokens.label)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(nameSuggestions, id: \.id) { suggestion in
                            suggestionRow(suggestion)
                        }
                        // WP-165: let the user signal the demand so the server learns
                        // this is wanted — a soft-follow isn't «fulgt men dødt for alltid».
                        CoverageRequestLink(name: rule.entityName, sport: rule.sport.isEmpty ? nil : rule.sport)
                    } header: {
                        groupHeader("VENTER PÅ DEKNING")
                    } footer: {
                        Text(nameSuggestions.isEmpty
                            ? "Du trenger ikke gjøre noe — dekning kan komme senere."
                            : "Mente du ett av disse? Legg det til på nytt i så fall.")
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                    }
                    .listRowBackground(SportivistaTokens.cell)
                } else {
                    Section {
                        Text("Vi finner ingen kamper eller nyheter for «\(rule.entityName)». Navnet stemmer kanskje ikke helt.")
                            .font(.sportivista(.subheadline))
                            .foregroundStyle(SportivistaTokens.label)
                            .fixedSize(horizontal: false, vertical: true)
                        ForEach(nameSuggestions, id: \.id) { suggestion in
                            suggestionRow(suggestion)
                        }
                    } header: {
                        groupHeader("SJEKK NAVNET")
                    } footer: {
                        Text(nameSuggestions.isEmpty
                            ? "Prøv å legge til på nytt med et litt annet navn."
                            : "Kanskje du mente ett av disse? Legg det til på nytt om navnet er feil.")
                            .font(.sportivista(.footnote))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                    }
                    .listRowBackground(SportivistaTokens.cell)
                }
            }

            // WP-170 — the entity page itself: anker · KOMMENDE · SISTE RESULTAT
            // · TABELL · SISTE NYTT · MER, in that fixed order, each section
            // omitted when it has nothing to say.
            EntityPageSections(entity: entity, page: page) { row in
                detailRow = agendaRow(for: row)
            }

            Section {
                // WP-164: a soft-follow has no resolved sport yet — honest
                // «ukjent ennå» beats a silently blank value.
                detailInfoRow("Sport", rule.sport.isEmpty ? "ukjent ennå" : SportVocabulary.display(for: rule.sport))
                if let scope = rule.scope, !scope.isEmpty {
                    detailInfoRow("Avgrensning", scope)
                }
                if !rule.lens.isDefault {
                    detailInfoRow("Perspektiv", rule.lens.label)
                }
            } header: {
                groupHeader("OM")
            }
            .listRowBackground(SportivistaTokens.cell)

            if !rule.reason.isEmpty {
                Section {
                    Text(rule.reason)
                        .font(.sportivista(.subheadline))
                        .foregroundStyle(SportivistaTokens.label)
                        .fixedSize(horizontal: false, vertical: true)
                } header: {
                    groupHeader("HVORFOR")
                }
                .listRowBackground(SportivistaTokens.cell)
            }

            Section {
                HStack(spacing: 8) {
                    Text(leadTimeOn ? "På" : "Av")
                        .font(.sportivista(.subheadline, weight: .semibold))
                        .foregroundStyle(leadTimeOn ? SportivistaTokens.accent : SportivistaTokens.secondaryLabel)
                    Text(leadTimeOn ? "minner deg før start" : "ingen påminnelse")
                        .font(.sportivista(.caption))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                }
                .padding(.vertical, 2)
                // WP-176 — fulltidsvarsel: AV som default, valgt PER ENTITET her.
                // A result notification is by definition a spoiler, so it can never
                // be a blanket switch; the user turns it on for the one team they
                // want to be told about. Per device (ResultAlertPreference), like
                // «Varsel før start» — it never replicates to your other devices.
                Toggle(isOn: $resultAlertOn) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Fulltidsvarsel")
                            .font(.sportivista(.body))
                            .foregroundStyle(SportivistaTokens.label)
                        Text(resultAlertOn ? "sier fra når kampen er ferdig" : "ingen resultatvarsel")
                            .font(.sportivista(.caption))
                            .foregroundStyle(SportivistaTokens.secondaryLabel)
                    }
                }
                .tint(SportivistaTokens.accent)
                .accessibilityIdentifier("followed.resultAlert.\(rule.entityId)")
                .onChange(of: resultAlertOn) { _, on in
                    ResultAlertPreference.setEnabled(on, entityId: rule.entityId)
                }
            } header: {
                groupHeader("VARSEL")
            } footer: {
                // Honest about BOTH limits: iOS decides when a background check
                // may run (there is no server pushing to this app — see
                // README § Det vi ikke gjør), and the spoiler shield still wins.
                Text("Varsel før start styres samlet i Deg › Varsel før start. Fulltidsvarselet kommer når iOS lar appen se etter nytt — vanligvis innen noen timer, aldri live. Har du spoilervern på \(rule.entityName), sier varselet bare at resultatet er klart.")
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
            }
            .listRowBackground(SportivistaTokens.cell)

            Section {
                Button(role: .destructive) {
                    requestStop()
                } label: {
                    Text("Slutt å følge")
                        .font(.sportivista(.body, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.destructive)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .accessibilityIdentifier("followed.stop")
            }
            .listRowBackground(SportivistaTokens.cell)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(SportivistaTokens.background)
        .foregroundStyle(SportivistaTokens.label)
        .navigationTitle(rule.entityName)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            snapshot = viewModel.followSnapshot()
            resultAlertOn = ResultAlertPreference.isEnabled(entityId: rule.entityId)
            // The page's own cache reads run OFF the main actor (a navigation,
            // not a hot path) — the admin sections render immediately meanwhile.
            page = await EntityPageLoader.page(entity: entity, rule: rule)
        }
        .sheet(item: $detailRow) { row in
            EventDetailSheet(row: row,
                             onFollow: { viewModel.follow($0) },
                             onUnfollow: { viewModel.unfollow($0) },
                             onRestore: { viewModel.restore($0) })
        }
        // WP-252 — only a BROAD follow (whole sport / category) still asks.
        .confirmationDialog(
            "Slutt å følge \(rule.entityName)?",
            isPresented: $confirmingStop,
            titleVisibility: .visible
        ) {
            Button("Slutt å følge", role: .destructive) { stopFollowing() }
                .accessibilityIdentifier("followed.stop.confirm")
            Button("Avbryt", role: .cancel) {}
        } message: {
            Text("Hele \(rule.entityName) forsvinner fra tavla. Lag og utøvere du følger enkeltvis blir stående.")
        }
    }

    // MARK: - Stop following (WP-252 — undo instead of confirm)

    /// A broad follow asks first; a single team/athlete/tournament stops on the
    /// spot and hands the list its «Angre» snackbar.
    private func requestStop() {
        let broad = snapshot?.presenter.group(for: rule).isBroadSweep ?? false
        if broad { confirmingStop = true } else { stopFollowing() }
    }

    private func stopFollowing() {
        viewModel.removeRule(rule)
        confirmingStop = false
        onStopped(rule)
        dismiss()
    }

    // MARK: - Detail rows / helpers

    // MARK: - SJEKK NAVNET row (WP-125 lens-miss suggestion)

    /// One calm, informational nearest-name suggestion — the name + its sport.
    /// Deliberately not a button: the honest read is "check the name"; correcting
    /// it is done through the normal Legg til-søk, so nothing is changed by tap.
    private func suggestionRow(_ entity: Entity) -> some View {
        HStack(spacing: 12) {
            Image(systemName: SportSymbol.name(for: entity.sport))
                .font(.sportivista(.body))
                .foregroundStyle(SportivistaTokens.tertiaryLabel)
                .frame(width: symbolWidth)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(entity.name)
                    .font(.sportivista(.body))
                    .foregroundStyle(SportivistaTokens.label)
                Text(SportVocabulary.display(for: entity.sport))
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("followed.suggestion.\(entity.id)")
    }

    private func detailInfoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.sportivista(.body))
                .foregroundStyle(SportivistaTokens.label)
            Spacer()
            Text(value)
                .font(.sportivista(.body))
                .foregroundStyle(SportivistaTokens.secondaryLabel)
                .multilineTextAlignment(.trailing)
        }
    }

    private func groupHeader(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.footnote, weight: .semibold))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
    }

    /// Build the full agenda row for a KOMMENDE event so it can open the SAME
    /// event-detail sheet the agenda uses (venue · streaming · AI provenance).
    /// whyShown/followable default empty — this surface is already scoped to a
    /// followed entity.
    private func agendaRow(for row: EntityUpcomingRow) -> AgendaEventRow? {
        guard let event = row.event else { return nil }
        return AgendaEventRow(
            id: row.id,
            timeLabel: AgendaFormat.timeLabel(time: event.time, endTime: event.endTime),
            title: row.title,
            metaLabel: AgendaFormat.metaLabel(tournament: event.tournament, title: row.title),
            channelLabel: row.channelLabel,
            isMustSee: row.isMustSee,
            mustWatch: row.isMustSee,
            isAIResearch: event.source == "ai-research",
            event: event
        )
    }
}

// MARK: - Shared Norwegian vocabulary for the follow surfaces

enum FollowVocabulary {
    /// A Norwegian word for an entity's `type` (athlete/team/tournament/…), for
    /// the Legg til search rows' «sport · type» line.
    static func typeLabel(_ type: String) -> String {
        switch type {
        case "athlete": return "utøver"
        case "team": return "lag"
        case "tournament": return "turnering"
        case "league": return "liga"
        case "sport": return "sport"
        case "category": return "kategori"
        default: return type
        }
    }
}
