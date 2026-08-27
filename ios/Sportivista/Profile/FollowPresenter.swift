//
//  FollowPresenter.swift
//  Sportivista
//
//  WP-120 — the pure, testable core behind the «Det du følger» surfaces (the
//  redesigned FollowedListView + FollowDetailView). The owner finding (20.07):
//  the follow list was a name list whose subtitle read identically on every row
//  («varsler på») — dead information. Each row must instead answer «what does
//  following this GIVE me?». This value type answers that per rule:
//
//    • group(for:)        — which display group a rule belongs to
//                           (UTØVERE/LAG/TURNERINGER/LIGAER/SPORTER/KATEGORIER),
//                           so the list can section by rule TYPE.
//    • nextEvents(for:)    — the next 1–3 events for that rule (the row subtitle
//                           + the detail's KOMMENDE section), using the lens's
//                           OWN matching: a whole-sport rule matches by sport,
//                           an athlete/team/tournament rule by FeedQuery's
//                           entity match — never a new fuzzy scheme.
//    • newsItems(for:)     — the lens-matched news pointers about the rule
//                           (the detail's SISTE NYTT), via a single-rule NewsLens.
//    • rowSubtitle(for:)   — the calm «Neste: lør 25. · Strømsgodset – Lyn · TV 2»
//                           line, or an honest quiet-state line (WP-164): a
//                           tracked.json season window when one is known,
//                           «venter på dekning» for a soft-follow, else
//                           «Fulgt — ingen kommende events på tavla ennå».
//
//  Foundation-only and clock-injected (`now` is passed), so FollowPresenterTests
//  drives every branch against the checked-in fixtures with no SwiftUI + no app.
//

import Foundation

/// The display group a follow rule falls into, ordered as the list renders them.
/// Mirrors the entity `type` vocabulary (athlete/team/tournament/league/sport/
/// category) so the sectioning is a true 1:1 with what the rule follows.
enum FollowGroup: Int, CaseIterable {
    case athlete, team, tournament, league, sport, category, other

    init(entityType: String) {
        switch entityType {
        case "athlete": self = .athlete
        case "team": self = .team
        case "tournament": self = .tournament
        case "league": self = .league
        case "sport": self = .sport
        case "category": self = .category
        default: self = .other
        }
    }

    /// WP-252 — whether STOPPING a follow in this group is a BROAD SWEEP: a
    /// whole sport or an umbrella category. Those keep the calm confirmation.
    ///
    /// The reason is OMFANG, not irreversibility. A sport rule is the only kind
    /// that admits events WHOLESALE (`EffectiveInterests` folds it into
    /// `followBroadly`), so dropping it can empty most of the board in one tap,
    /// and an undo affordance is easy to lose sight of when everything under it
    /// moves at once. It is NOT harder to undo than any other follow:
    /// `InterestProfile.applying(.remove)` drops exactly one rule — no cascade —
    /// and the teams and athletes you follow individually stay put, which is
    /// what the dialog itself tells the user.
    ///
    /// Every NARROW follow — one athlete, team, tournament or league — drops the
    /// modal in favour of undo: a modal that guards a reversible action costs a
    /// tap every single time and protects against almost nothing.
    ///
    /// One definition, read by both surfaces: the follow list (per rule) and
    /// the agenda's detail sheet (per subject, via `AgendaSubject.isBroadFollow`).
    var isBroadSweep: Bool { self == .sport || self == .category }

    /// The Norwegian section header (DESIGN § Gruppeoverskrift: uppercase).
    var header: String {
        switch self {
        case .athlete: return "UTØVERE"
        case .team: return "LAG"
        case .tournament: return "TURNERINGER"
        case .league: return "LIGAER"
        case .sport: return "SPORTER"
        case .category: return "KATEGORIER"
        case .other: return "ANNET"
        }
    }
}

/// One type-grouped section of the follow list (Identifiable off the group, so
/// SwiftUI's `ForEach` iterates it directly — a tuple isn't key-path-addressable).
struct FollowSection: Identifiable {
    let group: FollowGroup
    let rules: [InterestRule]
    var id: Int { group.rawValue }
}

struct FollowPresenter {
    let feed: FeedQuery
    let index: EntityIndex
    let news: [NewsItem]
    /// WP-164 — the synced tracked.json (read-only), the source of the honest
    /// season line for a follow with nothing on the board. nil degrades to the
    /// neutral «Fulgt — ingen kommende events …» line.
    let tracked: TrackedConfig?
    let now: Date

    init(feed: FeedQuery, index: EntityIndex, news: [NewsItem] = [], tracked: TrackedConfig? = nil, now: Date = Date()) {
        self.feed = feed
        self.index = index
        self.news = news
        self.tracked = tracked
        self.now = now
    }

    // MARK: - Sectioning by rule type

    /// The rules grouped into their display groups, in canonical order, dropping
    /// empty groups. Within a group, WP-138 applies a mild affinity LIFT: the
    /// entities you engage with most float up, with the profile's existing
    /// (sport, name) order as a STABLE tie-break — so an EMPTY affinity (a fresh
    /// user, or no signal) reproduces today's order byte-for-byte. This is a lift
    /// where the intra-group order was otherwise arbitrary (alphabetical), never a
    /// change to WHICH rules appear.
    func sections(for rules: [InterestRule], affinity: Affinity = Affinity(behavior: [])) -> [FollowSection] {
        var byGroup: [FollowGroup: [(rule: InterestRule, idx: Int)]] = [:]
        for (i, rule) in rules.enumerated() { byGroup[group(for: rule), default: []].append((rule, i)) }
        return FollowGroup.allCases.compactMap { g in
            guard let rs = byGroup[g], !rs.isEmpty else { return nil }
            let lifted = rs.sorted { a, b in
                let sa = affinity.score(entityId: a.rule.entityId, sport: a.rule.sport)
                let sb = affinity.score(entityId: b.rule.entityId, sport: b.rule.sport)
                if sa != sb { return sa > sb }
                return a.idx < b.idx            // stable → empty affinity keeps original order
            }
            return FollowSection(group: g, rules: lifted.map(\.rule))
        }
    }

    /// The display group for a rule — the resolved entity's `type` when the index
    /// has it, else inferred from the build-entities id convention (`sport-…` /
    /// `category-…`), else `.other`.
    func group(for rule: InterestRule) -> FollowGroup {
        if let type = index.entity(id: rule.entityId)?.type {
            return FollowGroup(entityType: type)
        }
        if rule.entityId.hasPrefix("sport-") { return .sport }
        if rule.entityId.hasPrefix("category-") { return .category }
        return .other
    }

    // MARK: - Next events (KOMMENDE + the row subtitle)

    /// The next `limit` upcoming events for a rule, in agenda order. A whole-sport
    /// / category rule matches by sport; an athlete/team/tournament/league rule
    /// matches by the resolved entity (falling back to a rule-derived stand-in
    /// entity when the index hasn't synced). Reuses FeedQuery's existing matching.
    func nextEvents(for rule: InterestRule, limit: Int = 3) -> [FeedQueryEvent] {
        switch group(for: rule) {
        case .sport, .category:
            return feed.upcoming(inSports: followedSports(for: rule), limit: limit)
        default:
            return feed.upcoming(matching: entity(for: rule), limit: limit)
        }
    }

    // MARK: - News (SISTE NYTT)

    /// The lens-matched news pointers about a rule, newest first. Uses a
    /// single-rule NewsLens so the match is EXACTLY the Nyheter board's (an
    /// entityId hit, or — for a whole-sport rule — a sport hit); invents nothing.
    func newsItems(for rule: InterestRule, limit: Int = 3) -> [NewsItem] {
        let lens = NewsLens(profile: InterestProfile(rules: [rule]), index: index)
        guard !lens.isEmpty else { return [] }
        let matched = news
            .filter { lens.matches($0) }
            .sorted { ($0.publishedAt ?? .distantPast) > ($1.publishedAt ?? .distantPast) }
        return Array(matched.prefix(limit))
    }

    // MARK: - Match state (the WP-125 lens-miss signal)

    /// How a followed rule is currently doing against the board — the calm signal
    /// that makes a silently-dead follow visible without any telemetry:
    ///   • `.scheduled`  — ≥1 upcoming event → the «Neste: …» subtitle.
    ///   • `.idle`       — a real follow that just has nothing right now (a known
    ///                     entity, a whole-sport follow, or one still carrying
    ///                     news): «Fulgt — …» with a season line when tracked.json
    ///                     knows one (WP-164).
    ///   • `.unresolved` — the followed NAME resolves to nothing we know AND has no
    ///                     news either. For a mistyped follow: «Ingen treff — sjekk
    ///                     navnet», with nearest-name help in the detail. For a
    ///                     deliberate soft-follow (WP-164, «Følg likevel»): the
    ///                     honest «Fulgt — venter på dekning» instead — the user
    ///                     chose the name knowingly; there is nothing to check.
    enum FollowMatchState: Equatable { case scheduled, idle, unresolved }

    /// Classify a rule (see `FollowMatchState`). A whole-sport / category follow is
    /// always a valid follow, so it is never `.unresolved`. Everything else is
    /// `.unresolved` only when its entityId is absent from the index (an unknown
    /// name) AND no lens-matched news carries it.
    func matchState(for rule: InterestRule) -> FollowMatchState {
        if !nextEvents(for: rule, limit: 1).isEmpty { return .scheduled }
        switch group(for: rule) {
        case .sport, .category:
            return .idle
        default:
            let known = index.entity(id: rule.entityId) != nil
            let hasNews = !newsItems(for: rule, limit: 1).isEmpty
            return (known || hasNews) ? .idle : .unresolved
        }
    }

    /// Nearest known names for an `.unresolved` follow — the index's OWN fuzzy
    /// resolver (`nearestMatches`, no new matching), so a mistyped follow can be
    /// checked against real entities. Empty for a resolved follow, or when nothing
    /// is genuinely close (the honest answer). The rule's own id is filtered out.
    func nameSuggestions(for rule: InterestRule, limit: Int = 3) -> [Entity] {
        guard matchState(for: rule) == .unresolved else { return [] }
        return index.nearestMatches(to: rule.entityName, limit: limit)
            .filter { $0.id != rule.entityId }
    }

    // MARK: - Row subtitle

    /// The calm per-entity subtitle: «Neste: lør 25. · Strømsgodset – Lyn · TV 2»
    /// (day · what · where) when scheduled. When nothing is scheduled (WP-164,
    /// honest off-season): «Fulgt — sesongstart medio august 2026» when
    /// tracked.json knows the season window, else the neutral «Fulgt — ingen
    /// kommende events på tavla ennå»; a soft-follow waits with «Fulgt — venter
    /// på dekning», and only a genuinely mistyped name gets «Ingen treff — sjekk
    /// navnet» (the WP-125 lens-miss signal). No technical words ever.
    func rowSubtitle(for rule: InterestRule) -> String {
        if let next = nextEvents(for: rule, limit: 1).first {
            var parts = ["Neste: \(shortDayLabel(dayKey: next.dayKey))", next.title]
            if next.channelLabel != "–" { parts.append(next.channelLabel) }
            return parts.joined(separator: " · ")
        }
        if let season = seasonLine(for: rule) { return "Fulgt — \(season)" }
        if matchState(for: rule) == .unresolved {
            return rule.isSoftFollow ? "Fulgt — venter på dekning" : "Ingen treff — sjekk navnet"
        }
        return "Fulgt — ingen kommende events på tavla ennå"
    }

    // MARK: - Season line (WP-164 — the honest off-season answer)

    /// The season phrase for a quiet follow («sesongstart medio august 2026»),
    /// pulled from the matching tracked.json entry's `reason` — the server
    /// bookkeeping ALREADY narrates season windows in plain Norwegian there.
    /// nil when tracked.json is absent, no entry matches, or no season sentence
    /// is found (the caller degrades to the neutral line). A mistyped follow
    /// (`.unresolved`, not soft) never gets a season line — «sjekk navnet» is
    /// the honest answer there.
    func seasonLine(for rule: InterestRule) -> String? {
        if matchState(for: rule) == .unresolved, !rule.isSoftFollow { return nil }
        return Self.seasonInfo(for: rule, entity: entity(for: rule), tracked: tracked)
    }

    /// Find the tracked.json entry matching this follow (by id, else by the
    /// entity's name/alias terms word-boundary-matching the entry name — the
    /// SAME TextMatch the feed uses, no new fuzzy) and extract its season
    /// phrase. Static + pure so tests drive it directly.
    static func seasonInfo(for rule: InterestRule, entity: Entity, tracked: TrackedConfig?) -> String? {
        guard let tracked else { return nil }
        let terms = ([rule.entityName, entity.name] + entity.aliases).filter { !$0.isEmpty }
        let entries = tracked.leagues + tracked.tournaments + tracked.athletes
        for entry in entries {
            let hit = entry.id == rule.entityId || terms.contains { term in
                TextMatch.containsName(entry.name, term) || TextMatch.containsName(term, entry.name)
            }
            guard hit else { continue }
            if let phrase = seasonPhrase(in: entry.reason) { return phrase }
        }
        return nil
    }

    /// Pull the season-window sentence out of a tracked `reason`: the first
    /// sentence that names BOTH a season/start cue and a month, trimmed at the
    /// first dash/semicolon clause so only the calm fact remains
    /// («Sesongstart medio august 2026 — statiske ESPN-fetchere …» →
    /// «sesongstart medio august 2026»). nil when no such sentence exists or
    /// the remainder is still too long for a subtitle — graceful degradation,
    /// never a truncated half-sentence.
    static func seasonPhrase(in reason: String) -> String? {
        for sentence in sentences(in: reason) {
            let lower = sentence.lowercased()
            guard Self.seasonCues.contains(where: { lower.contains($0) }),
                  Self.monthNames.contains(where: { lower.contains($0) }) else { continue }
            var phrase = sentence
            for separator in [" — ", " – ", "; ", " ("] {
                if let range = phrase.range(of: separator) {
                    phrase = String(phrase[..<range.lowerBound])
                }
            }
            phrase = phrase.trimmingCharacters(in: CharacterSet(charactersIn: " .,:—–-"))
            guard !phrase.isEmpty, phrase.count <= 90 else { continue }
            return lowercasedIfCommonNoun(phrase)
        }
        return nil
    }

    /// «Sesongstart …» → «sesongstart …» after the subtitle's tankestrek, but a
    /// phrase leading with a proper noun («Premier League starter …») keeps its
    /// capital. Only the small closed set of season cue-words is lowered.
    private static func lowercasedIfCommonNoun(_ phrase: String) -> String {
        guard let firstWord = phrase.split(separator: " ").first else { return phrase }
        let lowered = firstWord.lowercased()
        guard seasonCues.contains(where: { lowered.hasPrefix($0) }) else { return phrase }
        return lowered + phrase.dropFirst(firstWord.count)
    }

    private static let seasonCues = [
        "sesongstart", "seriestart", "sesongåpning", "sesongen starter",
        "starter", "begynner", "tilbake"
    ]

    private static let monthNames = [
        "januar", "februar", "mars", "april", "mai", "juni",
        "juli", "august", "september", "oktober", "november", "desember"
    ]

    /// Split a tracked `reason` into sentences: a period followed by whitespace
    /// and an uppercase letter. Deliberately conservative so «kl. 21.00»,
    /// «26. aug» and abbreviations never fragment a sentence.
    private static func sentences(in text: String) -> [String] {
        var out: [String] = []
        var current = ""
        var previous: Character?
        for (i, ch) in text.enumerated() {
            current.append(ch)
            if previous == ".", ch == " " || ch == "\n" {
                // Peek: next non-space char uppercase ⇒ sentence boundary.
                let rest = text.dropFirst(i + 1)
                if let next = rest.first(where: { $0 != " " && $0 != "\n" }), next.isUppercase {
                    out.append(current.trimmingCharacters(in: .whitespacesAndNewlines))
                    current = ""
                }
            }
            previous = ch
        }
        let tail = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !tail.isEmpty { out.append(tail) }
        return out
    }

    // MARK: - Helpers

    /// The resolved entity for a rule, or a stand-in built from the rule's own
    /// cached fields when the index hasn't synced (so matching still works off the
    /// carried entityId + name).
    func entity(for rule: InterestRule) -> Entity {
        index.entity(id: rule.entityId)
            ?? Entity(id: rule.entityId, name: rule.entityName, aliases: [], sport: rule.sport, type: "")
    }

    /// The canonical sports a whole-sport / category rule opens — the SAME
    /// classification NewsLens uses (sport / umbrella category), via a single-rule
    /// lens so there is one source of truth for "what sports does this follow?".
    func followedSports(for rule: InterestRule) -> Set<String> {
        NewsLens(profile: InterestProfile(rules: [rule]), index: index).followedSports
    }

    /// «i dag» / «i morgen» / «lør 25.» for an Oslo day-key (never a clock — the
    /// subtitle answers "when", the day; the detail carries the exact time).
    func shortDayLabel(dayKey: String) -> String {
        if dayKey == FeedCompiler.osloDayKey(now) { return "i dag" }
        if dayKey == FeedCompiler.osloDayKey(now.addingTimeInterval(86_400)) { return "i morgen" }
        guard let date = Self.dayKeyFormatter.date(from: dayKey) else { return dayKey }
        return Self.shortDayFormatter.string(from: date)
    }

    private static let dayKeyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = FeedCompiler.osloTimeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private static let shortDayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "nb_NO")
        f.timeZone = FeedCompiler.osloTimeZone
        f.dateFormat = "EEE d."
        return f
    }()
}
