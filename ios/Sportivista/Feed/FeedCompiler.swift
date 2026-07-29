//
//  FeedCompiler.swift
//  Sportivista
//
//  WP-13 — the Swift port of the personalisation semantics frozen by the
//  golden feed-vectors (tests/fixtures/feed-vectors/). Its sole hard
//  acceptance criterion is: reproduce EVERY expectation in EVERY vector
//  bit-for-bit, including the four pinned server/client divergences in
//  DIVERGENCES.md (they are reproduced here, never "fixed").
//
//  There is NO single "special?" predicate — there are FIVE, each answering a
//  different product question and keyed off different inputs, faithful to the
//  side that owns it (README §"The five predicates"):
//
//    • isRelevant   — SERVER (scripts/build-events.js + helpers.js). Feed
//      inclusion. NOT sport-scoped. + a 14-day retention cutoff on endTime.
//    • mustWatch    — SERVER (helpers.js mustWatchEntity). The reminder bell.
//      Keyed ONLY off interests.json notify-entities; sport-SCOPED;
//      word-boundary matching.
//    • isMustSee    — CLIENT (docs/js/dashboard.js). The quiet visual accent.
//      NAIVE lowercase-substring team/athlete matching (pinned, DIVERGENCES §2).
//    • isEventInWindow — SERVER & CLIENT, byte-identical. Agenda time window.
//    • collapseSeries — CLIENT (dashboard.js). Stage-race folding.
//
//  The facade `compile(events:interests:now:)` chains the server-side stages
//  (relevance filter → bell/accent annotation → series collapse → day
//  grouping) for the app to consume; the day grouping is NOT vector-covered
//  and is unit-tested separately.
//

import Foundation

enum FeedCompiler {

    // MARK: - Constants (mirror build-events.js:469 / helpers.js)

    /// Server default when `interests.followBroadly` is ABSENT (nil). An
    /// explicit `[]` in the config is honoured as-is — see Interests.followBroadly.
    /// WP-92: chess & esports are deliberately NOT here — the owner tracks them
    /// only through named entities (elite chess / 100 Thieves), so they are
    /// entity-gated (see `entityGatedSports` + `isRelevantIgnoringTime`), not
    /// admitted wholesale. Mirrors build-events.js's default list.
    /// WP-XX: now sourced from the shared `lens-config.json` (see LensConfig) so
    /// the value stays byte-identical to the web lens. Same type, same API — no
    /// consumer changes; only the LITERAL moved to config.
    static let defaultFollowBroadly: [String] = LensConfig.shared.followBroadlyDefault

    /// WP-92 · the relevance gate. Sports the user tracks ONLY through named
    /// entities, never wholesale. For these, `isRelevant` requires a SPORT-SCOPED
    /// tracked-entity match — no norwegian/favorite/importance/ai-research
    /// blanket. `followBroadly` still wins first, so an owner who explicitly
    /// followBroadly-s "chess" gets it wholesale again. Mirrors build-events.js.
    /// Sourced from `lens-config.json` (LensConfig).
    static let entityGatedSports: Set<String> = Set(LensConfig.shared.entityGatedSports)

    private static let msPerDay: TimeInterval = 86_400 // seconds
    static let osloTimeZone = TimeZone(identifier: "Europe/Oslo")!

    // MARK: - Shared server matcher (helpers.js matchInterest)

    /// Port of server `matchInterest` (helpers.js:127): the first entity whose
    /// name/alias word-boundary-matches `haystack`, else nil. When `sport` is
    /// supplied AND an entity carries its own `sport`, a mismatch skips it
    /// (the bell's sport-scoping); an entity with no sport, or a nil `sport`
    /// argument, matches freely.
    static func matchInterest(_ haystack: String, _ entities: [Interests.Entity], sport: String? = nil) -> Interests.Entity? {
        for entity in entities {
            if let sport = sport, let entitySport = entity.sport,
               TextMatch.normalize(entitySport) != TextMatch.normalize(sport) {
                continue
            }
            if entity.terms.contains(where: { TextMatch.containsName(haystack, $0) }) {
                return entity
            }
        }
        return nil
    }

    /// The haystack the server relevance/bell matchers scan: title +
    /// tournament + home/away teams + Norwegian players' names + participants'
    /// names, space-joined (helpers.js:163 / build-events.js:480). Nil fields
    /// contribute "" exactly as JS `[...].join(" ")` coerces undefined.
    static func serverHaystack(_ e: FeedEvent) -> String {
        var parts: [String] = [e.title, e.tournament ?? "", e.homeTeam ?? "", e.awayTeam ?? ""]
        parts.append(contentsOf: e.norwegianPlayers.map { $0.name })
        parts.append(contentsOf: e.participants.map { $0.name })
        return parts.joined(separator: " ")
    }

    // MARK: - §relevant — feed inclusion (SERVER, build-events.js:477 + cutoff)

    /// WP-200 — the sports a profile-shaped board actually COVERS: the sports it
    /// follows wholesale PLUS the sport of every tracked entity. This is the scope
    /// of the norwegian/favorite/importance blanket (rule 3 below).
    ///
    /// `nil` means "no profile speaks here" — `interests.followBroadly` is ABSENT
    /// (the WP-13 absent-vs-empty distinction), so the blanket stays un-scoped and
    /// the board behaves exactly as it did before WP-200. That is the hard
    /// empty-profile guarantee: `EffectiveInterests.merge` returns `base` untouched
    /// for an empty profile, `base.followBroadly` is nil on device, so nothing moves.
    ///
    /// With a profile the blanket was a blank cheque: any Norwegian / favourite /
    /// importance≥4 event reached the board whatever the user had chosen, so a
    /// "Formel 1"-only profile still got golf, cycling and biathlon. Scoping it
    /// keeps the blanket inside the sports you chose without demanding an entity
    /// match for every big moment in them (following Hovland still surfaces a
    /// Norwegian golf week — it just cannot surface an F1-only user's golf week).
    /// An entity with no `sport` widens nothing; it still matches through the
    /// UNSCOPED rule (4). Twin of `ssLensSportScope` in docs/js/lens.js.
    static func sportScope(_ interests: Interests) -> Set<String>? {
        guard let broad = interests.followBroadly else { return nil }
        var scope = Set(broad.map { $0.lowercased() })
        let tracked = interests.alwaysTrack.teams
            + interests.alwaysTrack.athletes
            + interests.alwaysTrack.tournaments
        for entity in tracked {
            if let sport = entity.sport, !sport.isEmpty { scope.insert(sport.lowercased()) }
        }
        return scope
    }

    /// `isRelevant` on its own (no time gate) — mirrors build-events.js
    /// `isRelevant`. Order (WP-92):
    ///  1. followBroadly sport → in (wholesale; wins over the gate);
    ///  2. entity-gated sport (chess/esports) → a SPORT-SCOPED tracked-entity
    ///     match is the ONLY way in (no norwegian/favorite/importance/ai-research
    ///     blanket) — DIVERGENCES §5;
    ///  3. any other non-broad sport → norwegian / favorite / importance≥4 blanket
    ///     (`source == "ai-research"` is NO LONGER a standalone pass — WP-92),
    ///     SPORT-SCOPED to the profile's coverage since WP-200 (see `sportScope`);
    ///  4. UNSCOPED tracked-entity match (DIVERGENCES §1: the football club
    ///     "Barcelona" can still pull a tennis "Barcelona Open" onto the board).
    static func isRelevantIgnoringTime(_ e: FeedEvent, interests: Interests) -> Bool {
        let follow = Set((interests.followBroadly ?? defaultFollowBroadly).map { $0.lowercased() })
        let sport = e.sport.lowercased()
        if follow.contains(sport) { return true }                       // (1)
        let tracked = interests.alwaysTrack.teams
            + interests.alwaysTrack.athletes
            + interests.alwaysTrack.tournaments
        if entityGatedSports.contains(sport) {                          // (2)
            return matchInterest(serverHaystack(e), tracked, sport: e.sport) != nil
        }
        if sportScope(interests)?.contains(sport) ?? true {              // (3)
            if e.norwegian || e.isFavorite || (e.importance ?? 0) >= LensConfig.shared.mustSeeImportance { return true }
        }
        return matchInterest(serverHaystack(e), tracked) != nil         // (4) unscoped
    }

    /// Full server feed inclusion = the 14-day retention cutoff AND
    /// `isRelevant`. With `t = endTime ?? time`, keep only if
    /// `t >= now - 14 days` (multi-day events survive on their END). No time →
    /// never relevant. Boundary is inclusive (strict `<` drops), matching
    /// build-events.js:487-494.
    static func isRelevant(_ e: FeedEvent, interests: Interests, now: Date) -> Bool {
        guard let time = e.time else { return false }
        let relevantTime = e.endTime ?? time
        let cutoff = now.addingTimeInterval(-Double(LensConfig.shared.retentionDays) * msPerDay)
        if relevantTime < cutoff { return false }
        return isRelevantIgnoringTime(e, interests: interests)
    }

    // MARK: - §mustWatch — the reminder bell (SERVER, helpers.js)

    /// Port of `notifyEntities` (helpers.js:146): the entities that arm the
    /// bell. Teams & athletes default to notify:true; tournaments default to
    /// notify:false — only entities that end up notify:true are candidates.
    static func notifyEntities(_ interests: Interests) -> [Interests.Entity] {
        var out: [Interests.Entity] = []
        for e in interests.alwaysTrack.teams + interests.alwaysTrack.athletes {
            if e.notify ?? true { out.append(e) }           // defaultNotify: true
        }
        for e in interests.alwaysTrack.tournaments {
            if e.notify ?? false { out.append(e) }          // defaultNotify: false
        }
        return out
    }

    /// Which notify-entity (if any) makes this event a must-watch — else nil.
    /// Sport-SCOPED (helpers.js:171), so a football club can't ring the bell on
    /// a tennis event that merely mentions its name.
    static func mustWatchEntity(_ e: FeedEvent, interests: Interests) -> Interests.Entity? {
        matchInterest(serverHaystack(e), notifyEntities(interests), sport: e.sport)
    }

    static func mustWatch(_ e: FeedEvent, interests: Interests) -> Bool {
        mustWatchEntity(e, interests: interests) != nil
    }

    // MARK: - §mustSee — the quiet visual accent (CLIENT, dashboard.js:180)

    private static let norwayNationalRegex = try! NSRegularExpression(
        pattern: "\\bnorway\\b|\\bnorge\\b", options: [.caseInsensitive]
    )

    /// Every term a set of tracked entities can be recognised by (name +
    /// aliases), mirroring the client `trackedTerms` (shared-constants.js:98).
    private static func clientTerms(_ entities: [Interests.Entity]) -> [String] {
        entities.flatMap { [$0.name] + $0.aliases }.filter { !$0.isEmpty }
    }

    /// Port of client `isMustSee` (dashboard.js:180-192). Order matters:
    ///  1. series rows are never accented (handled by the facade / not applied
    ///     to raw events here);
    ///  2. isFavorite OR importance>=4 OR (norwegian AND a Norwegian in the
    ///     field) — the "golf lens";
    ///  3. homeTeam/awayTeam matches /\bnorway\b|\bnorge\b/ (national team);
    ///  4. homeTeam/awayTeam NAIVELY contains a tracked-team term (plain
    ///     lowercase substring — pinned, DIVERGENCES §2: "Brooklyn" matches
    ///     "Lyn");
    ///  5. title + Norwegian players' names NAIVELY contains a tracked-athlete
    ///     term (substring; reads title + players, NOT participants, NOT
    ///     tournament).
    static func isMustSee(_ e: FeedEvent, interests: Interests) -> Bool {
        if e.isFavorite || (e.importance ?? 0) >= LensConfig.shared.mustSeeImportance || (e.norwegian && !e.norwegianPlayers.isEmpty) {
            return true
        }
        let teams = [e.homeTeam ?? "", e.awayTeam ?? ""].map { $0.lowercased() }
        if teams.contains(where: { matchesNorwayNational($0) }) { return true }

        let trackedTeams = clientTerms(interests.alwaysTrack.teams).map { $0.lowercased() }
        if teams.contains(where: { team in
            !team.isEmpty && trackedTeams.contains { !$0.isEmpty && team.contains($0) }
        }) {
            return true
        }

        let playerNames = e.norwegianPlayers.map { $0.name }.joined(separator: " ")
        let hay = "\(e.title) \(playerNames)".lowercased()
        let trackedAthletes = clientTerms(interests.alwaysTrack.athletes).map { $0.lowercased() }
        return trackedAthletes.contains { !$0.isEmpty && hay.contains($0) }
    }

    private static func matchesNorwayNational(_ lowercasedTeam: String) -> Bool {
        let range = NSRange(lowercasedTeam.startIndex..., in: lowercasedTeam)
        return norwayNationalRegex.firstMatch(in: lowercasedTeam, options: [], range: range) != nil
    }

    // MARK: - §whyShown — "hvorfor vises denne?" (CLIENT, dashboard.js:621)

    /// Norwegian sport display words for the "you follow <sport>" reason. Kept
    /// local (not `SportVocabulary`, which lives in the Assistant module the
    /// widget target does NOT compile) so FeedCompiler stays buildable in every
    /// target that includes Feed/.
    private static let sportNb: [String: String] = LensConfig.shared.sportNb

    private static let enduranceSports: Set<String> = Set(LensConfig.shared.enduranceSports)

    /// The deterministic "why is this on my board" reason (WP-16.4 context
    /// action «Hvorfor vises denne?»). A faithful port of dashboard.js
    /// `whyShown` — sport-scoped tracked-entity match (athlete → team →
    /// tournament), then ai-research / norwegian / followed-sport / generic,
    /// in that priority order. The reminder tail is worded WITHOUT the 🔔 emoji
    /// (DESIGN.md forbids emoji in chrome; the detail sheet is chrome).
    static func whyShown(_ e: FeedEvent, interests: Interests) -> String {
        let hay = serverHaystack(e)
        func firstHit(_ entries: [Interests.Entity]) -> String? {
            for x in entries {
                if let sport = x.sport, TextMatch.normalize(sport) != TextMatch.normalize(e.sport) { continue }
                if x.terms.contains(where: { TextMatch.containsName(hay, $0) }) { return x.name }
            }
            return nil
        }
        let at = interests.alwaysTrack
        let verb = enduranceSports.contains(e.sport) ? "er med" : "spiller"

        var why: String
        if let athlete = firstHit(at.athletes) {
            why = "Fordi \(athlete) \(verb)"
        } else if let team = firstHit(at.teams) {
            why = "Fordi \(team) \(verb)"
        } else if let tourn = firstHit(at.tournaments) {
            why = "Del av \(tourn), som du følger"
        } else if e.source == "ai-research" {
            why = "AI-research fant dette for deg"
        } else if e.norwegian {
            why = "Norsk deltakelse"
        } else if (interests.followBroadly ?? defaultFollowBroadly).map({ $0.lowercased() }).contains(e.sport.lowercased()) {
            why = "Du følger \(sportNb[e.sport] ?? e.sport)"
        } else {
            why = "Passer interessene dine"
        }
        if mustWatch(e, interests: interests) { why += " · varsler deg før start" }
        return why
    }

    // MARK: - §inWindow — agenda time window (SERVER & CLIENT, identical)

    /// Port of `isEventInWindow` (helpers.js:52 ≡ shared-constants.js:23). With
    /// `s = time`, `e = endTime ?? time`, the event overlaps `[start, end)`
    /// iff `s < end && e >= start`. No time → false.
    static func isEventInWindow(_ event: FeedEvent, start: Date, end: Date) -> Bool {
        guard let time = event.time else { return false }
        let eventEnd = event.endTime ?? time
        return time < end && eventEnd >= start
    }

    // MARK: - §series — stage-race collapse (CLIENT, dashboard.js:375)

    /// A synthetic collapsed series row (dashboard.js:391-402).
    struct SeriesRow: Equatable {
        var id: String
        var sport: String
        var tournament: String?
        var title: String
        var time: Date?
        var endTime: Date?
        var stages: [FeedEvent]
        var nextStage: FeedEvent
    }

    /// One item of the collapse output: either an untouched event or a folded
    /// series row.
    enum SeriesItem {
        case event(FeedEvent)
        case series(SeriesRow)
    }

    private static let stageRegex = try! NSRegularExpression(
        pattern: "\\betappe\\b|\\bstage\\s*\\d", options: [.caseInsensitive]
    )

    private static func isStageTitle(_ title: String) -> Bool {
        let range = NSRange(title.startIndex..., in: title)
        return stageRegex.firstMatch(in: title, options: [], range: range) != nil
    }

    /// JS template-literal coercion of an optional string (`${x}` → "undefined"
    /// when x is undefined). Keeps the group key / series id bit-identical even
    /// in the (vector-untested) nil-tournament case.
    private static func jsString(_ value: String?) -> String { value ?? "undefined" }

    /// Port of client `collapseSeries` (dashboard.js:375-405). Groups events
    /// whose title matches /\betappe\b|\bstage\s*\d/i by `sport||tournament`;
    /// a group of 4 OR MORE folds into one synthetic series row (fewer pass
    /// through as individual rows). Non-stage events always pass through. The
    /// series row's "next stage" is the first stage whose `endTime ?? time >=
    /// now`, else the last.
    static func collapseSeries(_ events: [FeedEvent], now: Date) -> [SeriesItem] {
        var out: [SeriesItem] = []
        var groups: [String] = []             // preserves insertion order (Map semantics)
        var byKey: [String: [FeedEvent]] = [:]

        for e in events {
            if isStageTitle(e.title) {
                let key = "\(e.sport)||\(jsString(e.tournament))"
                if byKey[key] == nil { groups.append(key) }
                byKey[key, default: []].append(e)
            } else {
                out.append(.event(e))
            }
        }

        for key in groups {
            var stages = byKey[key] ?? []
            if stages.count < 4 {
                out.append(contentsOf: stages.map { .event($0) }) // too few — keep as rows
                continue
            }
            // sort by start time ascending (stable; all vector stages distinct)
            stages.sort { ($0.time ?? .distantPast) < ($1.time ?? .distantPast) }
            let upcoming = stages.first { ($0.endTime ?? $0.time ?? .distantPast) >= now }
            let next = upcoming ?? stages[stages.count - 1]
            let s0 = stages[0]
            let last = stages[stages.count - 1]
            let row = SeriesRow(
                id: "series|\(s0.sport)|\(jsString(s0.tournament))",
                sport: s0.sport,
                tournament: s0.tournament,
                title: s0.tournament ?? "",
                time: next.time,
                endTime: last.endTime ?? last.time,
                stages: stages,
                nextStage: next
            )
            out.append(.series(row))
        }
        return out
    }

    // MARK: - Facade: compile the feed for the app (WP-14 consumes this)

    /// A fully annotated feed, grouped by Europe/Oslo calendar day.
    struct CompiledFeed: Equatable {
        struct Day: Equatable {
            /// "YYYY-MM-DD" in Europe/Oslo.
            var key: String
            var items: [Item]
        }
        enum Item: Equatable {
            /// A single event with its bell/accent annotations.
            case event(FeedEvent, mustWatch: Bool, mustSee: Bool)
            /// A folded stage-race row (never accented; the web reads no
            /// precomputed mustWatch on synthetic rows).
            case series(SeriesRow)

            var time: Date? {
                switch self {
                case .event(let e, _, _): return e.time
                case .series(let s): return s.time
                }
            }
        }
        var days: [Day]
    }

    /// relevance filter → bell/accent annotation → series collapse → day
    /// grouping (Europe/Oslo). The pipeline order matches the WP-13 contract;
    /// the day grouping is not vector-covered (unit-tested separately).
    static func compile(events: [FeedEvent], interests: Interests, now: Date) -> CompiledFeed {
        let relevant = events.filter { isRelevant($0, interests: interests, now: now) }
        let collapsed = collapseSeries(relevant, now: now)

        let todayKey = osloDayKey(now)
        var order: [String] = []
        var byDay: [String: [CompiledFeed.Item]] = [:]

        for item in collapsed {
            let mapped: CompiledFeed.Item
            let time: Date?
            let endTime: Date?
            switch item {
            case .event(let e):
                mapped = .event(e, mustWatch: mustWatch(e, interests: interests), mustSee: isMustSee(e, interests: interests))
                time = e.time
                endTime = e.endTime
            case .series(let s):
                mapped = .series(s)
                time = s.time
                endTime = s.endTime
            }
            var key = time.map { osloDayKey($0) } ?? todayKey
            // Multi-day item that started before today but is still running
            // belongs under "today", not its past start day (dashboard.js:352).
            if key < todayKey, let end = endTime, end >= now { key = todayKey }
            if byDay[key] == nil { order.append(key) }
            byDay[key, default: []].append(mapped)
        }

        let days = order.sorted().map { key in
            CompiledFeed.Day(
                key: key,
                items: (byDay[key] ?? []).sorted { ($0.time ?? .distantPast) < ($1.time ?? .distantPast) }
            )
        }
        return CompiledFeed(days: days)
    }

    // MARK: - Day key (Europe/Oslo, mirrors dashboard.js osloDayKey)

    /// "YYYY-MM-DD" for `date` in Europe/Oslo — the same key
    /// `toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo' })` produces on
    /// the web (dashboard.js:175).
    static func osloDayKey(_ date: Date) -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = osloTimeZone
        let c = cal.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}
