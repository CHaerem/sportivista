//
//  EventLens.swift
//  Sportivista
//
//  WP-255 — the ONE place that answers «hvilken linse ser profilen dette
//  eventet gjennom, og hvilken tid gir den linsen oss lov til å påstå».
//
//  It exists because two surfaces need that answer and must never give
//  different ones: the agenda row (`AgendaViewModel.buildSections` → `place`)
//  and the push reminder (`NotificationPlanner.plan`). Until WP-255 only the
//  agenda knew: it derived an athlete lens for an ordinary «Følg Viktor
//  Hovland» tap (WP-249) and rendered «17:24 Hovland teer av», while the
//  planner scheduled and worded the very same event's reminder from the
//  tournament's nominal 04:00 window start. The board said 17:24; the push
//  fired at, and said, 04:00 — the exact contradiction
//  NotificationPlanner's own doctrine calls «det dyreste tillitsbruddet
//  appen kan begå», and DESIGN.md § Rad («varselklokka står KUN på rader som
//  faktisk armerer en påminnelse») already promised was impossible.
//
//  So the lens resolution (moved here verbatim from AgendaViewModel — same
//  three guards, same behaviour) and the staleness guard live together, and
//  both callers go through them.
//
//  It lives in `Profile/` rather than `Feed/` for the same reason
//  `EffectiveInterests` does: it reads an `InterestProfile`, and the widget
//  target compiles `Feed/` but not `Profile/`. `EffectiveInterests` answers
//  "what does this profile mean for the compiler's interests"; this answers
//  "what does it mean for an event's time".
//

import Foundation

enum EventLens {

    // MARK: - Which lens

    /// The LENS to render an event through, resolved in two steps:
    ///
    ///  1. An EXPLICIT lens — the first followed rule carrying a non-default
    ///     `lens` whose entity actually participates in the event. Maps the
    ///     Assistant `Lens` → the Feed-local `LensMode` the renderer consumes, so
    ///     the renderer stays free of the Assistant module (widget-buildable).
    ///  2. Failing that, the DERIVED athlete lens (WP-249, below).
    ///
    /// `.sportAsSuch` — no lens, the ordinary row — when neither applies. An
    /// EMPTY profile returns before either step: no profile, no lens.
    static func applicableLensMode(for feedEvent: FeedEvent, event: Event, profile: InterestProfile, index: EntityIndex) -> LensMode {
        guard !profile.rules.isEmpty else { return .sportAsSuch }
        let lensed = profile.rules.filter { !$0.lens.isDefault }
        if !lensed.isEmpty {
            let hay = FeedCompiler.serverHaystack(feedEvent)
            for rule in lensed where ruleMatches(rule, event: event, hay: hay, index: index) {
                switch rule.lens {
                case .sportAsSuch:
                    continue
                case .throughNorwegians:
                    return .throughNorwegians
                case let .throughAthletes(athletes):
                    return .throughAthletes(ids: Set(athletes.map(\.entityId)), names: athletes.map(\.name))
                }
            }
        }
        return derivedAthleteLens(event: event, profile: profile, index: index) ?? .sportAsSuch
    }

    /// WP-249 — the DERIVED athlete lens: following an ATHLETE means «vis meg når
    /// HAN spiller».
    ///
    /// The machinery above it has been complete since WP-18 — `LensRenderer`
    /// splits a golf tournament into one row per tee time and re-homes each row
    /// to the athlete's own day and time. But only a rule that had been given a
    /// non-default `lens` ever reached it, and a lens is set in exactly two
    /// places (the assistant, and the DEBUG demo seeds). An ordinary «Følg Viktor
    /// Hovland» tap therefore left the rule on the default lens, the renderer
    /// declined, and the board showed the tournament's nominal 04:00 window —
    /// while his 17:24 tee time sat unread in the very same event.
    ///
    /// So the lens is DERIVED from PARTICIPATION rather than read off the rule.
    /// Deriving (instead of stamping a lens at follow-time) also repairs every
    /// rule already saved on every device, with no migration.
    ///
    /// Three guards keep it narrow and honest:
    ///
    ///   • **Athletes only.** A rule qualifies only when the entity index types
    ///     it `athlete` — the index is the authority. When the index doesn't
    ///     know the id at all — an UNSYNCED index, or a WP-164 SOFT-FOLLOW,
    ///     whose id is `soft-<slug>` and so matches no entity anywhere — the
    ///     event's own `norwegianPlayers` list stands in: it is an athlete list
    ///     by construction, so appearing there IS the proof. It is checked BY ID
    ///     **and BY NAME**, because a soft rule has no real id to be found under:
    ///     `norwegianPlayers[].entityId` is stamped from `entities.json` by
    ///     `build-events.js` and never carries the `soft-` prefix, so an id-only
    ///     test is structurally false for every soft rule — the fallback would
    ///     have covered only the unsynced half of what it claimed. Name is the
    ///     axis WP-164 designed a soft-follow to travel on («FeedQuery /
    ///     EffectiveInterests are already name-tolerant … a soft rule simply
    ///     starts matching the moment coverage arrives»), and `ruleMatches` puts
    ///     the same rule on the board by the same name — so the row you were
    ///     shown for Hovland now also knows Hovland's tee time. A team /
    ///     tournament / league / sport follow can never acquire this lens: the
    ///     index types them, and a team's name is not in a player list.
    ///   • **Only when the data knows his time.** The lens fires only if one of
    ///     those followed athletes has a per-athlete start time in THIS event.
    ///     With no such time there is nothing to answer «når spiller han» with,
    ///     so the ordinary row stands — no fabricated clock (P320), and no
    ///     cosmetic rewrite of rows in sports that carry no per-athlete timing.
    ///   • **Never over an explicit lens.** The caller reaches this only after
    ///     the explicit-lens pass has declined, so a deliberate
    ///     `.throughNorwegians` / `.throughAthletes` still wins.
    ///
    /// Returns nil when it does not apply, so the caller falls back to
    /// `.sportAsSuch` and the ordinary row is rendered untouched.
    private static func derivedAthleteLens(event: Event, profile: InterestProfile, index: EntityIndex) -> LensMode? {
        // Fast path — and guard 2's cheap half: an event that knows NO per-athlete
        // start time can never answer «når spiller han», so it leaves here without
        // the profile being walked at all. That is most events, and every sport
        // that carries no per-athlete timing.
        guard event.norwegianPlayers.contains(where: { $0.teeTimeUTC != nil }) else { return nil }

        var ids = Set<String>()
        var names: [String] = []
        var seenName = Set<String>()
        for rule in profile.rules where rule.lens.isDefault {
            let entity = index.entity(id: rule.entityId)
            // The index is the AUTHORITY on what a followed entity is. Only when
            // it doesn't know this id (an unsynced index, or a soft-follow, whose
            // `soft-<slug>` id is in no index by construction) do we fall back to
            // the event's own `norwegianPlayers` — an athlete list by
            // construction, so appearing there IS proof. By id OR by name: a soft
            // rule can only ever be found by name (see the doc comment).
            let isAthlete = entity.map { $0.type == "athlete" } ?? event.norwegianPlayers.contains {
                $0.entityId == rule.entityId || TextMatch.normalize($0.name) == TextMatch.normalize(rule.entityName)
            }
            guard isAthlete else { continue }
            ids.insert(rule.entityId)
            // The rule's cached name plus the index's name/aliases — the same
            // term set `ruleMatches` builds, so an athlete whose participation
            // line carries no entity id still matches by name.
            for term in [rule.entityName] + (entity.map { [$0.name] + $0.aliases } ?? []) {
                let key = TextMatch.normalize(term)
                guard !key.isEmpty, seenName.insert(key).inserted else { continue }
                names.append(term)
            }
        }
        guard !ids.isEmpty else { return nil }

        let wanted = seenName
        let knowsHisTime = event.norwegianPlayers.contains { player in
            guard player.teeTimeUTC != nil else { return false }
            if let id = player.entityId, ids.contains(id) { return true }
            return wanted.contains(TextMatch.normalize(player.name))
        }
        guard knowsHisTime else { return nil }
        return .throughAthletes(ids: ids, names: names)
    }

    /// Whether `rule`'s followed entity participates in `event`: an authoritative
    /// entity-id match on the event's players/teams, else the SAME sport-scoped
    /// name/alias word-boundary test `whyShown`/`mustWatch` use (so a golf
    /// tournament rule matches that tournament's events, a football club rule
    /// its club's matches). Falls back to the rule's cached name/sport when the
    /// entity isn't in the (maybe unsynced) index.
    private static func ruleMatches(_ rule: InterestRule, event: Event, hay: String, index: EntityIndex) -> Bool {
        if event.norwegianPlayers.contains(where: { $0.entityId == rule.entityId }) { return true }
        if event.homeTeamEntityId == rule.entityId || event.awayTeamEntityId == rule.entityId { return true }
        let entity = index.entity(id: rule.entityId)
        let sport = entity?.sport ?? rule.sport
        if !sport.isEmpty, TextMatch.normalize(sport) != TextMatch.normalize(event.sport) { return false }
        let terms = entity.map { [$0.name] + $0.aliases } ?? [rule.entityName]
        return terms.contains { !$0.isEmpty && TextMatch.containsName(hay, $0) }
    }

    // MARK: - Which time that lens lets us claim

    /// The athlete's own (tee) time, but ONLY when we can stand behind it: a
    /// time whose Oslo day is today-or-later. `nil` otherwise — the caller then
    /// keeps the event's own honest window.
    ///
    /// This is the ONE guard both the board and the reminder apply, which is
    /// why it lives here rather than inline in `AgendaViewModel.place`. A
    /// tournament frozen mid-week (a `retainLastGood` re-serve, or
    /// `parseTeeTimeToUTC` anchoring a string tee time to the tournament's START
    /// date for every round) publishes YESTERDAY's clock as today's tee time.
    /// On the board that would print a stale clock in today's time column; in a
    /// push it is worse — the fire date would clamp to "now" and buzz the user
    /// about a tee-off that already happened. Grunnlov 3 is «aldri lat som»: no
    /// proof the clock belongs to a day still ahead of us, no clock. Same rule
    /// the web board applies (`dashboard.js golfTeeHint`, «en gammel tee-tid …
    /// ville vært en løgn»).
    static func trustedTime(_ effective: Date?, todayKey: String) -> Date? {
        guard let effective, FeedCompiler.osloDayKey(effective) >= todayKey else { return nil }
        return effective
    }

    /// What a REMINDER for `event` should follow under this profile — the
    /// athlete's own moment when the lens knows one, `nil` when it does not (the
    /// caller then falls back to the event's nominal start, i.e. every
    /// pre-WP-255 behaviour, unchanged).
    ///
    /// Resolved through exactly the same two steps the board uses — the same
    /// `applicableLensMode`, the same `LensRenderer.render` — so the push can
    /// never disagree with the row it belongs to. On top of the board's
    /// staleness guard it adds ONE further condition: the time must still be
    /// AHEAD of us. A reminder is a promise about something that has not
    /// happened yet, so a tee time earlier today is honest on the board (it
    /// happened, today) and meaningless in a push.
    ///
    /// With several followed athletes in one event, the EARLIEST still-upcoming
    /// one wins: the reminder is keyed on the event id, so there is exactly one,
    /// and the next thing to happen is what a reminder is for. Its `title` is
    /// that row's own title («Hovland teer av — TOUR Championship»), so the
    /// notification names WHOSE time it is stating — with two Norwegians teeing
    /// off 42 minutes apart, a bare tournament title plus a clock would be
    /// ambiguous in exactly the way a wrong time is.
    static func reminder(
        for event: Event,
        feedEvent: FeedEvent,
        profile: InterestProfile,
        index: EntityIndex,
        followedIds: Set<String>,
        now: Date
    ) -> Reminder? {
        let mode = applicableLensMode(for: feedEvent, event: event, profile: profile, index: index)
        guard let rows = LensRenderer.render(event: event, mode: mode, followedIds: followedIds) else { return nil }
        let todayKey = FeedCompiler.osloDayKey(now)
        return rows
            .compactMap { row -> Reminder? in
                guard let time = trustedTime(row.effectiveTime, todayKey: todayKey), time > now else { return nil }
                return Reminder(time: time, title: row.title)
            }
            .min { $0.time < $1.time }
    }

    /// The athlete moment a reminder follows: when it happens, and the board's
    /// own words for it.
    struct Reminder: Equatable {
        var time: Date
        var title: String
    }
}
