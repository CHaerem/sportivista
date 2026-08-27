//
//  AgendaModels.swift
//  Sportivista
//
//  WP-14 — the view-ready row/section types AgendaViewModel produces and
//  AgendaView renders. Plain data, no SwiftUI: every label here is already a
//  formatted String (via AgendaFormat) computed once by
//  `AgendaViewModel.buildSections`, not recomputed per render — the view
//  layer only lays these out.
//

import Foundation

/// One entity an agenda row is ABOUT, with whether the profile follows it —
/// the unit behind the detail sheet's LAG OG UTØVERE rows and its symmetric
/// «Følg» / «Slutt å følge» actions (WP-252).
///
/// The status is a snapshot of the profile at compile time. The sheet keeps its
/// own local override for a subject the user just toggled, because the agenda
/// recompiles BEHIND an open sheet and the row it was handed is a value copy.
struct AgendaSubject: Identifiable, Equatable {
    var entity: Entity
    /// True when the profile has a rule for `entity.id` — the sheet renders
    /// «Slutt å følge» instead of «Følg».
    var isFollowed: Bool

    var id: String { entity.id }

    /// Whether STOPPING this follow is a broad sweep — a whole sport or an
    /// umbrella category, which can empty a large part of the board in one tap.
    /// Those keep a calm confirmation; a single team/athlete/tournament does
    /// not (WP-252: the same row flips straight back to «Følg»). The dividing
    /// line is SIZE, not reversibility — a broad follow is undone by exactly the
    /// same one-rule restore as a narrow one. Keyed off the SAME entity-type
    /// vocabulary the follow list groups by (`FollowGroup`), so the two
    /// surfaces can never disagree about what counts as broad.
    var isBroadFollow: Bool { FollowGroup(entityType: entity.type).isBroadSweep }
}

/// One ordinary event row: when · what · where, plus the two independent
/// annotations FeedCompiler attaches (the reminder bell and the quiet visual
/// accent — see FeedCompiler.swift's header on why there are two, not one).
/// Carries the full `Event` for the tap-to-expand detail sheet (venue,
/// summary, every streaming option, AI provenance).
struct AgendaEventRow: Identifiable, Equatable {
    var id: String
    var timeLabel: String
    var title: String
    /// A quiet second line — the tournament/context — shown "ved behov"
    /// (DESIGN.md "Radens anatomi"): only when it adds something the title
    /// doesn't already carry, else nil (no empty line). See
    /// `AgendaFormat.metaLabel`.
    var metaLabel: String?
    var channelLabel: String
    var isMustSee: Bool
    var mustWatch: Bool
    /// True for `source == "ai-research"` events — the ONLY rows that carry
    /// the quiet mono ⓘ glyph (DESIGN.md: "ⓘ-glyf … KUN på AI-research-events").
    var isAIResearch: Bool
    var event: Event
    /// WP-16.4 — the deterministic "hvorfor vises denne?" reason
    /// (FeedCompiler.whyShown against the EFFECTIVE interests), precomputed so
    /// the detail sheet's context action shows it with no model and no work per
    /// render. Empty only when the index/interests weren't available.
    var whyShown: String = ""
    /// WP-30 — the spoiler flag derived from personal memory (`SpoilerShield`):
    /// `false` when the user has a spoiler policy on this event's sport/entity,
    /// so the agenda + detail sheet MASK result/score for it. Defaults to `true`
    /// (safe to show) so every existing caller/test is unchanged.
    var spoilerSafe: Bool = true
    /// WP-185 — the row's ONE entity anchor (flag / colour monogram), resolved
    /// once per compile from the entity index. `.none` (the default) keeps the
    /// WP-108 sport symbol, so every existing caller/test renders exactly as
    /// before. Deliberately a PRESENTATION field computed here, never in
    /// FeedCompiler — the golden feed vectors must stay bit-identical.
    var identity: EntityIdentity = .none
    /// WP-170 / WP-252 — the entities this event is ABOUT (home/away team,
    /// tournament, Norwegian players), resolved once per compile from the entity
    /// index, EACH CARRYING whether the profile follows it. One list with a
    /// status per entity, not two overlapping lists: WP-252 folded the old
    /// `followable` (the same resolution minus what you already follow) in here,
    /// because the sheet must offer BOTH directions on the same subject —
    /// «Følg X» when you don't, «Slutt å følge X» when you do — and two lists
    /// that were complements of each other could never say that in one place.
    /// It also ended a quiet inconsistency: both lists capped at three
    /// INDEPENDENTLY, so LAG OG UTØVERE and HANDLINGER could name different
    /// entities for the same event. Empty (the default) keeps every existing
    /// caller/test rendering exactly as before.
    var subjects: [AgendaSubject] = []
}

/// A folded stage race — dashboard.js `collapseSeries`'s Swift-side output,
/// re-shaped for display: one summary line ("Tour de France — 21 etapper"),
/// expandable to every stage.
struct AgendaSeriesRow: Identifiable, Equatable {
    var id: String
    /// The NEXT stage's own time (HH:mm) — never a window; mirrors
    /// dashboard.js's seriesRow, which shows the next stage's start time, not
    /// a start-to-end span for the whole race.
    var timeLabel: String
    var summaryLabel: String
    /// The next stage's own channel — same "first platform, honest '–'"
    /// convention as an ordinary row.
    var channelLabel: String
    /// True when ANY stage in the collapsed race is itself a must-watch
    /// (mirrors dashboard.js seriesRow's `s.stages.some(st => st.mustWatch)`)
    /// — the bell rings for the race even though the visual accent never
    /// applies to a collapsed row (FeedCompiler.isMustSee always returns
    /// false for a series — see FeedCompiler.swift's header).
    var mustWatch: Bool
    /// True when the collapsed race's next stage is an AI-research event — the
    /// same quiet mono ⓘ glyph an ordinary AI-research row carries.
    var isAIResearch: Bool
    var tournament: String
    /// Chronological, full `Event`s (so the expanded detail can show each
    /// stage's own channel/venue).
    var stages: [Event]
    var nextStage: Event
    /// WP-185 — the collapsed race's anchor, resolved from its next stage.
    var identity: EntityIdentity = .none
}

/// One quiet "live now" line under the header (DESIGN.md "Agendaens
/// semantikk" §4): rendered in the live colour with a `▌ LIVE` marker, at
/// most two at once, invisible when nothing is ongoing. Just enough to say
/// what · where — the agenda row itself carries the rest.
struct AgendaLiveRow: Identifiable, Equatable {
    var id: String
    var title: String
    var channelLabel: String
}

/// One row in a day section — either an ordinary event or a collapsed series.
enum AgendaItem: Identifiable, Equatable {
    case event(AgendaEventRow)
    case series(AgendaSeriesRow)

    var id: String {
        switch self {
        case .event(let row): return row.id
        case .series(let row): return row.id
        }
    }
}

/// One Europe/Oslo calendar day's worth of rows, with its Norwegian section
/// label already resolved ("I DAG" / "I MORGEN" / "TIRSDAG 15. JULI").
struct AgendaSection: Identifiable, Equatable {
    var id: String
    var label: String
    var items: [AgendaItem]
}
