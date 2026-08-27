//
//  AgendaView.swift
//  Sportivista
//
//  WP-81 — the agenda rebuilt as a native, inset-grouped `List` on the
//  Apple-native baseline (DESIGN.md § Agendaen + § Radens anatomi).
//  What changed versus the WP-14 ScrollView/LazyVStack pass:
//   • The board is a native `List` (`.insetGrouped`), one `Section` per day —
//     so the platform owns the separators, grouping, scrolling and inset column.
//   • Each row is a `Button` (`.buttonStyle(.plain)`) — it gets the native
//     pressed-state highlight and a button accessibility role for free, in
//     place of the old naked `.onTapGesture` (a Forbudsliste item).
//   • Row anatomy per the baseline: a leading amber must-see dot, tabular time,
//     the never-truncated title + a quiet meta/channel line, then trailing SF
//     Symbols — `bell.fill` (amber) when the row arms a reminder, `info.circle`
//     when the event is AI-research — and a quiet native-style chevron.
//   • Left swipe → «Følg» on rows that are ABOUT a not-yet-followed entity,
//     routed through the SAME assistant diff/confirm flow the detail sheet uses
//     (`onFollow`); a light `.sensoryFeedback` fires (suppressed under Reduce
//     Motion). Demp/Påminn have no existing action hook wired to the agenda
//     (per-event reminders are explicitly a non-feature — see EventDetailSheet's
//     NotifyStatusRow — and a mute/unfollow host action would have to be wired
//     in ContentView, which WP-83 owns), so only the meaningful, already-backed
//     «Følg» action ships here ("der det er meningsfullt · ikke finn opp ny logikk").
//   • All typography uses the Dynamic Type API (`Font.sportivista` /
//     `Font.sportivistaTabular`) and the semantic colour tokens
//     (`label`/`secondaryLabel`/`separator`/`accent`).
//
//  The detail sheets keep their `.presentationDetents([.medium, .large])`
//  (grabber + drag-to-dismiss), already set on each sheet.
//

import SwiftUI

struct AgendaView: View {
    var viewModel: AgendaViewModel
    /// WP-172 — the foreground live-score overlay. Read per event row (by id) so a
    /// 60 s score update repaints ONLY that row's meta line — never a feed recompile.
    /// Optional so `#Preview` / the unit tests compile without one (nil ⇒ no scores,
    /// the pre-WP-172 row). A spoiler-shielded row never shows a score (see EventRowView).
    var liveStore: LiveScoreStore? = nil
    /// WP-16.4 — a "Følg <entitet>" action (the detail sheet's context action
    /// and now the row's left-swipe); ContentView routes it into the assistant's
    /// diff/confirm flow. Defaults to a no-op so `#Preview` / standalone use compile.
    var onFollow: (Entity) -> Void = { _ in }
    /// WP-252 — the mirror action, forwarded to the detail sheet so a subject you
    /// already follow can be dropped from the same place you added it. It is
    /// deliberately NOT wired to a row swipe: the agenda stays an agenda, and an
    /// unfollow must never be one stray gesture away on the board itself.
    /// Returns what it removed, which is what the sheet's undo puts back.
    var onUnfollow: (Entity) -> UnfollowOutcome? = { _ in nil }
    /// WP-252 — the undo half, forwarded alongside it: restore a rule the sheet
    /// just removed, verbatim (never a rebuilt default).
    var onRestore: (InterestRule) -> Void = { _ in }
    /// WP-30 — an event's detail was opened; the host records a behaviour "open"
    /// stat for it (personal memory, layer 3). No-op default keeps previews/
    /// standalone use compiling.
    var onOpen: (Event) -> Void = { _ in }
    /// WP-66 — an event id the host asks to open (the assistant's «vis
    /// Brann-kampen» command, resolved against the agenda by AssistantViewModel).
    /// Set to a real event id ⇒ this view raises its detail sheet, then clears it
    /// back to nil so the same row can be re-opened later. Default constant keeps
    /// previews / standalone use compiling.
    var openEventID: Binding<String?> = .constant(nil)

    /// A single optional target drives both sheets. The event case carries the
    /// whole `AgendaEventRow` (not just the `Event`) so the detail sheet has the
    /// precomputed WP-16.4 context data (whyShown + subjects) too.
    private enum DetailTarget: Identifiable {
        case event(AgendaEventRow)
        case series(AgendaSeriesRow)

        var id: String {
            switch self {
            case .event(let row): return row.id
            case .series(let s): return s.id
            }
        }
    }

    @State private var detailTarget: DetailTarget?
    /// A monotonically increasing trigger for the light swipe-action haptic.
    /// `.sensoryFeedback` fires on each change; we only bump it off the Reduce
    /// Motion path (DESIGN § Bevegelse & haptikk: "Reduce Motion …
    /// ingen haptikk").
    @State private var followHaptic = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        List {
            // WP-67: render the (possibly filtered) view of the board. The
            // filter is a pure view layer — `sections` (and the golden vectors)
            // are unchanged; `displayedSections` just hides rows.
            let sections = viewModel.displayedSections
            if sections.isEmpty {
                Section { emptyRow }
                    .listRowBackground(SportivistaTokens.background)
            } else {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.items) { item in
                            rowButton(for: item)
                        }
                    } header: {
                        dayHeader(section.label)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        // WP-99: HIG keyboard avoidance — dragging the agenda dismisses the
        // command line's keyboard interactively (DESIGN § Hjelperen: "scroll
        // lukker tastaturet"). The command line rides above via safeAreaInset.
        .scrollDismissesKeyboard(.interactively)
        .background(SportivistaTokens.background)
        .refreshable {
            await viewModel.refresh()
        }
        .sensoryFeedback(.impact(weight: .light), trigger: followHaptic)
        .sheet(item: $detailTarget) { target in
            switch target {
            case .event(let row):
                EventDetailSheet(row: row, onFollow: onFollow, onUnfollow: onUnfollow,
                                 onRestore: onRestore, liveStore: liveStore)
            case .series(let series):
                SeriesDetailSheet(series: series)
            }
        }
        // WP-66 — open a specific event's detail on the assistant's command.
        .onChange(of: openEventID.wrappedValue) { _, id in
            guard let id, let row = eventRow(id: id) else { return }
            detailTarget = .event(row)
            onOpen(row.event)
            openEventID.wrappedValue = nil
        }
    }

    /// The compiled agenda row for an event id (WP-66 openEvent), or nil.
    private func eventRow(id: String) -> AgendaEventRow? {
        for section in viewModel.sections {
            for item in section.items {
                if case let .event(row) = item, row.event.id == id { return row }
            }
        }
        return nil
    }

    // MARK: - Day section header (DESIGN § Typografi: gruppeoverskrift)

    private func dayHeader(_ label: String) -> some View {
        Text(label)
            .font(.sportivista(.footnote, weight: .semibold))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
            // WP-99: label-independent handle for UI tests — the label is
            // time-of-day-dependent («I DAG» has no section late at night,
            // when the seeded now+Nh events tip past midnight).
            .accessibilityIdentifier("agenda.dayHeader")
    }

    // MARK: - Rows

    /// One tappable agenda row: a `Button` (native pressed-state + button role),
    /// opening the detail sheet, with the left-swipe «Følg» affordance where the
    /// row is about a not-yet-followed entity.
    @ViewBuilder
    private func rowButton(for item: AgendaItem) -> some View {
        Button {
            open(item)
        } label: {
            rowView(for: item)
        }
        .buttonStyle(.plain)
        .listRowBackground(SportivistaTokens.cell)
        .swipeActions(edge: .leading, allowsFullSwipe: true) {
            if let entity = firstFollowable(item) {
                Button {
                    if !reduceMotion { followHaptic &+= 1 }
                    onFollow(entity)
                } label: {
                    Label("Følg", systemImage: "plus.circle")
                }
                .tint(SportivistaTokens.accent)
            }
        }
    }

    /// The first entity this row is ABOUT that the user doesn't already follow —
    /// what the left-swipe «Følg» offers. Series rows aren't followed this way
    /// (they're the athlete-agnostic collapsed view), so only event rows qualify.
    /// WP-252: there is deliberately NO swipe counterpart for stopping — an
    /// unfollow must never be one stray gesture from a scroll (owner brief), so
    /// it lives in the detail sheet where it is named and deliberate.
    private func firstFollowable(_ item: AgendaItem) -> Entity? {
        if case let .event(row) = item { return row.subjects.first { !$0.isFollowed }?.entity }
        return nil
    }

    @ViewBuilder
    private func rowView(for item: AgendaItem) -> some View {
        switch item {
        case .event(let row):
            EventRowView(row: row, liveStore: liveStore)
        case .series(let row):
            SeriesRowView(row: row)
        }
    }

    private func open(_ item: AgendaItem) {
        switch item {
        case .event(let row): detailTarget = .event(row); onOpen(row.event)
        case .series(let row): detailTarget = .series(row); onOpen(row.nextStage)
        }
    }

    /// "Henter data …" before the very first sync ever completes, else the
    /// honest "nothing right now" — `lastSync == nil` is DataStore's own
    /// "never synced" flag (see DataStore.swift), not just "zero events".
    /// WP-31: when the board is empty AND the follow-profile is empty (onboarding
    /// skipped), point at the assistant (WP-144: the floating bottom «Spør
    /// assistenten» button) instead of reading as "nothing on". The copy NAMES the
    /// button rather than a direction, so it survives future placement churn.
    @ViewBuilder
    private var emptyRow: some View {
        if viewModel.filter != nil {
            // WP-67: a filter is active but nothing matches it — honest, and
            // clearly the filter's doing (the ✕ line above resets it), never
            // read as "nothing on".
            emptyText("Ingen treff for filteret.")
        } else if viewModel.lastSync == nil {
            emptyText("Henter data …")
        } else if viewModel.profileIsEmpty {
            VStack(alignment: .leading, spacing: 8) {
                emptyText("Fortell Sportivista hva du følger, så samler den når og hvor du kan se det.")
                HStack(spacing: 8) {
                    Image(systemName: SportSymbol.assistant)
                        .font(.sportivista(.callout, weight: .semibold))
                        .foregroundStyle(SportivistaTokens.secondaryLabel)
                        .accessibilityHidden(true)
                    Text("Trykk Spør assistenten.")
                        .font(.sportivista(.footnote))
                        .foregroundStyle(SportivistaTokens.secondaryLabel.opacity(0.8))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } else if let seasonNote = SeasonCalendar.emptyBoardExplanation(
            followedSports: viewModel.followedSports,
            month: SeasonCalendar.month(of: Date())
        ) {
            // WP-203: season-honest — everything followed is a known off-season
            // sport, so say WHEN the board fills («skiskyting og langrenn er
            // utenfor sesong. Sesongstart i november — tavla fylles da.») instead
            // of the generic line below, which reads as a broken app to someone
            // who just picked «Vintersport» in August.
            emptyText(seasonNote)
        } else {
            emptyText("Ingen kommende arrangementer akkurat nå.")
        }
    }

    private func emptyText(_ text: String) -> some View {
        Text(text)
            .font(.sportivista(.callout))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Rows

/// One ordinary agenda row (DESIGN § Radens anatomi): amber must-see
/// dot, the time (or a multi-day window) in a fixed left column, then the title
/// — up to two lines, never truncated — with a quiet meta line and the channel.
/// A `bell.fill` (amber) trails when the row arms a reminder, an `info.circle`
/// on AI-research events, then the native-style chevron.
struct EventRowView: View {
    let row: AgendaEventRow
    /// WP-172 — the live-score overlay, read here so a score update repaints only
    /// this row. nil in previews/tests (the pre-WP-172 row).
    var liveStore: LiveScoreStore? = nil

    var body: some View {
        // WP-172: the running score enriches the meta line — but a spoiler-shielded
        // row (SpoilerShield, WP-171/176) NEVER gets it forced on it, exactly like
        // the detail sheet's RESULTAT. `row.spoilerSafe` is the same flag the shield
        // sets; false ⇒ no live score, the calm neutral row.
        let live = row.spoilerSafe ? liveStore?.score(for: row.id) : nil
        AgendaRowScaffold(
            isMustSee: row.isMustSee,
            timeLabel: row.timeLabel,
            sport: row.event.sport,
            identity: row.identity,
            reminder: row.mustWatch,
            aiResearch: row.isAIResearch
        ) {
            RowBody(title: row.title, meta: row.metaLabel, channel: row.channelLabel, liveScore: live)
        }
    }
}

/// A collapsed stage race: one summary line ("Tour de France — 21 etapper"),
/// the next stage's own time/channel; expandable via the detail sheet.
struct SeriesRowView: View {
    let row: AgendaSeriesRow

    var body: some View {
        AgendaRowScaffold(
            isMustSee: false, // series rows are never visually accented (FeedCompiler.isMustSee)
            timeLabel: row.timeLabel,
            sport: row.nextStage.sport,
            identity: row.identity,
            reminder: row.mustWatch,
            aiResearch: row.isAIResearch
        ) {
            RowBody(title: row.summaryLabel, meta: nil, channel: row.channelLabel)
        }
    }
}

/// The layout scaffold shared by ordinary and series agenda rows. It owns the
/// Dynamic Type response for the whole row (WP-134) and the WP-141 clip fix.
///
/// • **Standard sizes (xS–xxxL):** the canonical horizontal row (DESIGN § Radens
///   anatomi), `[• dot] [tid] [⛳] [tittel …] [markører]`, with the time column
///   holding `.layoutPriority(1)` so a multi-day window reserves its width first
///   (the WP-99 behaviour). The row is pinned to the cell width and LEADING-aligned
///   (WP-141) so it can NEVER be centred — the mechanism behind the owner's clip:
///   the row content used to grow WIDER than the cell (an unbounded `.fixedSize()`
///   channel, see `RowBody.secondaryLine`), and the `Button(.plain)` then CENTRED
///   that overflow, shoving the leading time column off the LEFT edge ("15:00" →
///   ":00", owner report 20.07 — NOT curable by a fixed-width time column alone,
///   WP-135). With the row content bounded (channel bounded + title flowing to as
///   many lines as it needs, never truncated) and the row leading-pinned, the title
///   simply WRAPS instead of the row overflowing, and the time keeps its column at
///   every width/size. (A whole-row `ViewThatFits` reflow was tried first, per the
///   WP-141 brief; empirically it reflowed EVERY row to the vertical layout at
///   iPhone widths — `ViewThatFits` measures the title's single-line ideal, which
///   never fits beside the fixed time column — restructuring the whole agenda, so
///   the brief's stated alternative "sikre at Button-label aldri overstiger
///   cellebredden" is used instead.)
/// • **Accessibility sizes (AX1+, `dtSize.isAccessibilitySize`):** the row REFLOWS
///   vertically (WP-134). At AX the fixed-size time column and the sport glyph would
///   win width negotiation and squeeze the flexible title to ~nothing, drawing OVER
///   it. So the time/window + sport symbol move onto their own line ABOVE the title,
///   and the title takes the full row width — never truncated to a «…» (DESIGN
///   § Radens anatomi). This branch is byte-for-byte the WP-134 tree.
private struct AgendaRowScaffold<RowBodyContent: View>: View {
    let isMustSee: Bool
    let timeLabel: String
    let sport: String
    /// WP-185 — the row's entity anchor; `.none` keeps the WP-108 sport symbol.
    var identity: EntityIdentity = .none
    let reminder: Bool
    let aiResearch: Bool
    @ViewBuilder var rowBody: () -> RowBodyContent

    @Environment(\.dynamicTypeSize) private var dtSize

    var body: some View {
        Group {
            if dtSize.isAccessibilitySize {
                // AX: the vertical reflow (WP-134), unchanged.
                verticalLayout
            } else {
                // Standard sizes: the canonical horizontal row (WP-141: bounded +
                // leading-pinned so the time column can never be clipped).
                horizontalLayout
            }
        }
        .padding(.vertical, 4)
    }

    /// The canonical horizontal row. WP-99: the time column wins width negotiation
    /// via `.layoutPriority(1)` so a multi-day WINDOW ("16.–19. juli") reserves its
    /// full width first and the flexible RowBody (maxWidth .infinity) takes the rest.
    /// WP-141: `.frame(maxWidth: .infinity, alignment: .leading)` pins the whole row
    /// (the `Button(.plain)` label) to the cell width and leading edge, so should any
    /// content ever exceed the cell the overflow spills off the TRAILING edge — the
    /// leading time column is never pushed off the LEFT (never centred, never
    /// clipped). With the bounded RowBody it doesn't overflow at all; this is the
    /// belt-and-suspenders guarantee.
    @ViewBuilder private var horizontalLayout: some View {
        HStack(alignment: .top, spacing: 10) {
            MustSeeDot(on: isMustSee)
            TimeColumn(text: timeLabel)
                .layoutPriority(1)
            EntityAvatarView(identity: identity, sport: sport)
            rowBody()
            TrailingMarkers(reminder: reminder, aiResearch: aiResearch)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The reflowed row (WP-134 AX layout): tid/vindu + sport-symbol on their own
    /// line above the full-width title. The trailing markers (bell/info/chevron)
    /// stay on the right so the disclosure affordance keeps its place.
    @ViewBuilder private var verticalLayout: some View {
        HStack(alignment: .top, spacing: 10) {
            MustSeeDot(on: isMustSee)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    TimeColumn(text: timeLabel)
                    EntityAvatarView(identity: identity, sport: sport)
                }
                rowBody()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            TrailingMarkers(reminder: reminder, aiResearch: aiResearch)
        }
    }
}

/// Title (≤ 2 lines, never truncated to a "…") + the channel. The title has
/// priority: on a compact width the channel drops to its own dempet line
/// UNDER the title so the title keeps the full column; on a regular width the
/// channel sits quietly on the right. Either way the channel never squeezes
/// the title (DESIGN: "Kanal … Krymper aldri tittelen").
private struct RowBody: View {
    let title: String
    let meta: String?
    let channel: String
    /// WP-172 — the running score, shown in the EXISTING meta line (tabular,
    /// `live`-coloured), never a new row. nil ⇒ the ordinary meta line.
    var liveScore: LiveScore? = nil
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        if sizeClass == .regular {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    titleText
                    regularMetaLine
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                ChannelLabel(text: channel)
                    .fixedSize()
                    .padding(.top, 2)
            }
        } else {
            VStack(alignment: .leading, spacing: 3) {
                titleText
                secondaryLine
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The regular-width meta line: the live score badge (when present) leads —
    /// a live match's story is the score, not the competition — then the quiet
    /// tournament meta. Nothing drawn when neither is present.
    @ViewBuilder private var regularMetaLine: some View {
        if let liveScore {
            HStack(spacing: 6) {
                LiveScoreBadge(score: liveScore)
                if let meta {
                    MetaSeparator()
                    MetaText(meta)
                }
            }
        } else if let meta {
            MetaText(meta)
        }
    }

    private var titleText: some View {
        Text(title)
            .font(.sportivista(.body))
            .foregroundStyle(SportivistaTokens.label)
            // DESIGN says the title is NEVER truncated to a «…» — that invariant
            // beats the ≤2-line calm-density target (the same trade WP-134 made at
            // AX sizes). WP-141: the cap is lifted at ALL sizes, so when the bounded
            // horizontal title column can't hold the title in two lines (a wide
            // matchup title on a narrow width, or a large content size) it grows a
            // third/fourth line rather than clipping to «…» — the pre-existing
            // truncation the clip fix would otherwise have left behind. Short and
            // two-line titles are unaffected: `nil` only ADDS lines when the text
            // would otherwise be cut, so they stay pixel-identical.
            .lineLimit(nil)
            .fixedSize(horizontal: false, vertical: true) // grow vertically, never clip
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The one dempet line under the title on a narrow screen. The channel
    /// (the "hvor" answer) is the priority; the meta is a "ved behov" extra, so
    /// when "meta · kanal" doesn't fit, the meta is dropped WHOLE (never shown as
    /// an "…"-clipped fragment) and only the channel remains.
    ///
    /// WP-141: the standalone channel is NOT `.fixedSize()` — that was the clip's
    /// root cause. An unbounded secondary label could itself grow WIDER than the
    /// cell (a long channel like "Kick (StarLadder, gratis offisiell strøm)"),
    /// forcing the whole row past the cell edge; the `Button(.plain)` then centred
    /// the overflow and shoved the LEADING time column off the left ("15:00" →
    /// ":00"). Bounding it (flexible + `lineLimit(1)`) keeps the row within the
    /// cell, so the flexible title WRAPS instead of the row overflowing and the
    /// time keeps its column. The channel keeps priority over the meta but yields
    /// to the title (the "what"): on a tight row it tails off with a quiet «…»
    /// rather than push the row wide — the title is never truncated, the channel
    /// may be.
    @ViewBuilder
    private var secondaryLine: some View {
        if let liveScore {
            // WP-172 — a live row: the score leads (the "stilling", `live`-coloured,
            // tabular), then the channel; the tournament meta is dropped so the line
            // stays calm (score + where). If even "score · channel" is too wide, the
            // score alone — never truncated (DESIGN § Typografi).
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    LiveScoreBadge(score: liveScore).fixedSize()
                    MetaSeparator()
                    ChannelLabel(text: channel).fixedSize()
                }
                LiveScoreBadge(score: liveScore)
            }
        } else if let meta {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 6) {
                    MetaText(meta).fixedSize()
                    MetaSeparator()
                    ChannelLabel(text: channel).fixedSize()
                }
                ChannelLabel(text: channel)
            }
        } else {
            ChannelLabel(text: channel)
        }
    }
}

/// WP-172 — the running score in the agenda row's meta line: "2–1 · 67'" while
/// live (`live`-coloured), "2–1" once finished (dempet). Tabular so the digits line
/// up row-to-row; one line, never truncated. The gentlest enrichment — no new row
/// DNA, no per-update animation (DESIGN § Bevegelse).
private struct LiveScoreBadge: View {
    let score: LiveScore

    var body: some View {
        Text(score.display)
            .font(.sportivistaTabular(.subheadline, weight: .semibold))
            .foregroundStyle(score.isLive ? SportivistaTokens.live : SportivistaTokens.secondaryLabel)
            .lineLimit(1)
            .accessibilityLabel(score.accessibilityLabel)
    }
}

/// The quiet "·" that separates meta-line tokens (score · kanal, turnering · kanal).
private struct MetaSeparator: View {
    var body: some View {
        Text("·")
            .font(.sportivista(.subheadline))
            .foregroundStyle(SportivistaTokens.secondaryLabel.opacity(0.6))
            .fixedSize()
    }
}

/// The gentlest possible emphasis (DESIGN: "Prikken er signalet"): a
/// small filled amber dot when on, an invisible placeholder of the same size
/// when off, so rows stay aligned either way. Left of the time column.
private struct MustSeeDot: View {
    let on: Bool

    var body: some View {
        Circle()
            .fill(on ? SportivistaTokens.accent : Color.clear)
            .frame(width: 6, height: 6)
            .padding(.top, 7)
            .accessibilityHidden(true)
    }
}

/// The quiet per-sport SF Symbol (DESIGN § Radens anatomi, rev. 19.07 eier-funn):
/// sits between the time column and the title so "what kind of event" (cycling vs
/// football) reads at a glance without parsing the meta text. `tertiaryLabel`,
/// NEVER coloured (the amber budget is untouched — the must-see dot is the row's
/// only accent), never emoji/logo. A fixed width keeps every title aligned
/// regardless of glyph width; scales with Dynamic Type. Hidden from VoiceOver —
/// the sport is already carried by the title/meta line, so this is a purely
/// visual at-a-glance aid (same policy as `MustSeeDot`). One canonical table
/// (`SportSymbol`) shared with the detail sheet and the Nyheter rows.
/// WP-185: internal (was `private`) so EntityAvatarView can fall back to it when
/// an entity has no flag/monogram — one glyph implementation, two call sites.
struct SportSymbolView: View {
    let sport: String
    // WP-134: the glyph column must scale WITH its `.subheadline` font. A fixed
    // 20 pt frame stayed put while the symbol grew at Accessibility sizes, so the
    // glyph overflowed its box and collided with the neighbours. `@ScaledMetric`
    // grows the column in lock-step with the text style, keeping titles aligned.
    @ScaledMetric(relativeTo: .subheadline) private var symbolWidth = 20

    var body: some View {
        Image(systemName: SportSymbol.name(for: sport))
            .font(.sportivista(.subheadline))
            .foregroundStyle(SportivistaTokens.tertiaryLabel)
            .frame(width: symbolWidth, alignment: .center)
            .padding(.top, 2)
            .accessibilityHidden(true)
    }
}

/// The time column. An ordinary "HH:mm" reads at `.body` semibold tabular; a
/// multi-day window ("13.–20. juli") reads a notch quieter (`.footnote`) so a
/// week-long range stays compact and doesn't shove the title off the row — it is
/// a date span, not a clock. Either way it lives in the SAME left column (never
/// merged into the title).
///
/// WP-135 — the standard-size CLOCK reserves a DEFINITE (Dynamic-Type-scaled)
/// column width rather than `.fixedSize(horizontal: true)`. A fixed-size intrinsic
/// column let the enclosing HStack COUPLE the clock's width to the title's
/// single-line intrinsic width during ideal-size negotiation: at certain widths a
/// wide matchup title ("100 Thieves – Ninjas in Pyjamas") kept the row on one
/// line and pushed the whole HStack past the cell, so the leading clock clipped
/// ("15:00" → ":00") instead of the title wrapping (owner report 20.07, standard
/// text size). A definite reserved width breaks that coupling — the clock ALWAYS
/// gets its column and the flexible title takes the residual and wraps. `58` at
/// the default content size is byte-identical to the old `minWidth: 58`, and
/// `@ScaledMetric` grows the column in lock-step with the `.body` clock text so a
/// large "23:59" still fits. A multi-day WINDOW keeps `.fixedSize` — it genuinely
/// needs its full intrinsic width reserved (WP-99), and its rarer title-truncation
/// edge is the accepted trade for that (a date span must never itself wrap/clip).
private struct TimeColumn: View {
    let text: String

    @Environment(\.dynamicTypeSize) private var dtSize
    /// The reserved clock column width — `58` at the default content size (the old
    /// `minWidth`), scaled up with Dynamic Type so a big clock stays whole. Only
    /// applied to the standard-size clock case (see `body`).
    @ScaledMetric(relativeTo: .body) private var clockColumnWidth = 58

    /// A clock always carries ":"; a window ("13.–20. juli") or honest "–"
    /// never does.
    private var isClock: Bool { text.contains(":") }
    private var isAX: Bool { dtSize.isAccessibilitySize }

    var body: some View {
        let label = Text(text)
            // WP-183 — the display face (DESIGN.md § Typografi): the time column is
            // one of its exactly three surfaces. Digits are tabular in the file
            // itself, so the column still lines up glyph-for-glyph; the fallback
            // path inside `sportivistaDisplay` re-adds `.monospacedDigit` on SF.
            .font(isClock ? .sportivistaDisplay(.body, weight: .semibold) : .sportivistaDisplay(.footnote, weight: .medium))
            .foregroundStyle(SportivistaTokens.label)
            // WP-134: at Accessibility sizes the column is on its own line (see
            // AgendaRowScaffold), so a wide window may WRAP to two lines.
            .lineLimit(isAX ? 2 : 1)

        Group {
            if !isAX && isClock {
                // Standard CLOCK — a DEFINITE, Dynamic-Type-scaled column (no
                // `.fixedSize` intrinsic coupling; see the type's doc comment).
                label
                    .frame(width: clockColumnWidth, alignment: .leading)
            } else {
                // Standard WINDOW keeps `.fixedSize` to reserve its full intrinsic
                // width (WP-99); `minWidth: 58` is its unchanged alignment floor.
                // AX puts the column on its own line, so it reserves nothing.
                label
                    .fixedSize(horizontal: !isAX, vertical: false)
                    .frame(minWidth: isAX ? nil : 58, alignment: .leading)
            }
        }
        .padding(.top, isClock ? 0 : 2)
    }
}

/// The channel ("hvor"): dempet subheadline. An honest, fainter "–" when unknown
/// (DESIGN "Ærlig innhold": ukjent kanal er «–»).
private struct ChannelLabel: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.sportivista(.subheadline))
            .foregroundStyle(text == "–" ? SportivistaTokens.secondaryLabel.opacity(0.5) : SportivistaTokens.secondaryLabel)
            .lineLimit(1)
    }
}

/// The quiet meta line ("turnering"): dempet subheadline.
private struct MetaText: View {
    let text: String
    init(_ text: String) { self.text = text }

    var body: some View {
        Text(text)
            .font(.sportivista(.subheadline))
            .foregroundStyle(SportivistaTokens.secondaryLabel)
            .lineLimit(1)
    }
}

/// The trailing markers (DESIGN § Radens anatomi): `bell.fill` (amber)
/// when the row arms a reminder, `info.circle` on AI-research events, then a
/// quiet native-style chevron so the row reads as a disclosure. SF Symbols scale
/// with Dynamic Type and carry their own accessibility labels. The row is a
/// Button (`.buttonStyle(.plain)`), which does not draw the system chevron, so
/// the chevron is a `chevron.forward` glyph tinted like the native one.
private struct TrailingMarkers: View {
    let reminder: Bool
    let aiResearch: Bool

    var body: some View {
        HStack(spacing: 8) {
            if reminder {
                Image(systemName: "bell.fill")
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.accent)
                    .accessibilityLabel("Varsel på")
            }
            if aiResearch {
                Image(systemName: "info.circle")
                    .font(.sportivista(.footnote))
                    .foregroundStyle(SportivistaTokens.secondaryLabel)
                    .accessibilityLabel("Funnet av AI")
            }
            Image(systemName: "chevron.forward")
                .font(.sportivista(.footnote, weight: .semibold))
                .foregroundStyle(SportivistaTokens.tertiaryLabel)
                .accessibilityHidden(true)
        }
        .padding(.top, 2)
    }
}

#Preview {
    AgendaView(viewModel: AgendaViewModel())
}
