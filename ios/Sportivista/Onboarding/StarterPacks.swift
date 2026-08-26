//
//  StarterPacks.swift
//  Sportivista
//
//  WP-31 — the quick-picks step for onboarding: a small, curated set of
//  Norwegian "startpakker" a first-time user can tap to build a profile without
//  Apple Intelligence. Since WP-132 this is the FIRST step for everyone (not a
//  fallback) — the path that must give FULL value on a cold start (dossier
//  P310) — so each pack carries its own entity data (id, name, sport, type,
//  lens) and grounds against the real WP-05 index when it has synced, but falls
//  back to a synthesised `Entity` from the curated data when it hasn't yet.
//  Tapping a pack is itself the confirmation (no diff round-trip) — it upserts
//  the pack's rules straight into the SAME `InterestProfile` the conversation
//  edits, through the SAME `InterestProfile.applying` core, so the two paths
//  converge on one profile.
//
//  WP-132 — the packs are now GENERIC (broadly meaningful to any Norwegian
//  sports fan), not the owner's personal picks: national teams over the owner's
//  club, big competitions over one favourite. Every id is grounded in a real
//  entity in the index (entities.json) — enforced by
//  `OnboardingTests.test_starterPacks_areGroundedAndUnique` — so the agenda
//  reflects a tap immediately (the WP-16.4 «umiddelbar konsekvens» contract).
//  Sensible lenses are baked in where a competition should be seen "through the
//  Norwegians" (WP-18): golf's The Open, cycling's Tour, and athletics' EM —
//  so those render as the Norwegian names you'd actually watch, not a flat
//  foreign leaderboard.
//
//  WP-133 — Eliteserien and Jakob Ingebrigtsen are now grounded server-side
//  (both seeded as entities in tracked.json → entities.json), so "Norsk fotball"
//  follows Eliteserien + the national team and "Friidrett" follows Warholm +
//  Ingebrigtsen directly. WP-133 also consolidated the Norway/Norge national-team
//  duplicate into a single `norge` entity (curated known-alias in build-entities).
//
//  WP-162 — every pack id is now the CANONICAL, SEASONLESS entity id
//  (`premier-league`, not `premier-league-2026-27`). An edition-stamped id is a
//  ship-dated follow: it dies the moment next season's bookkeeping publishes a
//  new one, silently, for every user who tapped the pack. The `tests/
//  starter-packs.test.js` CI guard checks these ids against the LIVE published
//  index (docs/data/entities.json), not the test fixture — the drift that hid
//  here before was invisible precisely because only the fixture was checked.
//
//  Grounding notes (why some owner-named entities aren't literal ids):
//    • Grand Slams / golf majors beyond The Open have no entities — following
//      Ruud/Hovland already surfaces their matches in those tournaments.
//    • Winter sport (skiskyting/langrenn/alpint/hopp) grounds on the four
//      sport-level entities (WP-64/116). It is OFF-SEASON in July, so it matches
//      nothing yet — honest and expected; the rows appear at season start (Nov).
//

import Foundation

/// One entity a starter pack follows, with the perspective it's followed
/// through. Plain value type — no index dependency — so a pack is fully
/// self-describing at cold start.
struct StarterRule: Equatable, Sendable {
    var entityId: String
    var entityName: String
    var sport: String
    /// "athlete" | "team" | "tournament" | "league".
    var type: String
    var lens: Lens
    var scope: String?

    init(_ entityId: String, _ entityName: String, sport: String, type: String, lens: Lens = .sportAsSuch, scope: String? = nil) {
        self.entityId = entityId
        self.entityName = entityName
        self.sport = sport
        self.type = type
        self.lens = lens
        self.scope = scope
    }
}

/// A tappable curated bundle of follow-rules.
struct StarterPack: Identifiable, Equatable, Sendable {
    var id: String
    /// Short title ("Norske golfere").
    var title: String
    /// One dempet line under it — what the pack covers.
    var subtitle: String
    /// The shared Norwegian rationale stamped on every rule the pack adds
    /// (the same always-filled `reason` transparency contract the assistant
    /// uses — so "Hva jeg følger" reads sensibly for a tapped pack too).
    var reason: String
    var rules: [StarterRule]

    /// The entity ids this pack follows — used to show an "applied" state and
    /// to toggle the pack off.
    var entityIds: [String] { rules.map(\.entityId) }

    /// Grounded mutations that ADD every rule. Uses the real index entity when
    /// present (authoritative aliases/type), else a synthesised `Entity` from
    /// the curated data — so the pack still applies before entities.json has
    /// synced. `previousRule` is carried so an already-followed entity is a
    /// clean upsert rather than a duplicate.
    func addMutations(index: EntityIndex, profile: InterestProfile) -> [GroundedMutation] {
        rules.map { rule in
            let entity = index.entity(id: rule.entityId)
                ?? Entity(id: rule.entityId, name: rule.entityName, aliases: [], sport: rule.sport, type: rule.type)
            return GroundedMutation(
                kind: .add,
                entity: entity,
                scope: rule.scope,
                weight: InterestProfile.defaultWeight,
                reason: reason,
                previousRule: profile.rule(for: rule.entityId),
                lens: rule.lens
            )
        }
    }

    /// Remove mutations for every rule — lets a tap toggle a pack back off.
    func removeMutations(index: EntityIndex, profile: InterestProfile) -> [GroundedMutation] {
        rules.compactMap { rule in
            guard let existing = profile.rule(for: rule.entityId) else { return nil }
            let entity = index.entity(id: rule.entityId)
                ?? Entity(id: rule.entityId, name: rule.entityName, aliases: [], sport: rule.sport, type: rule.type)
            return GroundedMutation(
                kind: .remove, entity: entity, scope: nil,
                weight: existing.weight, reason: "Fjernet fra startpakke.", previousRule: existing
            )
        }
    }
}

enum StarterPacks {
    /// The curated list — broadly-meaningful Norwegian interests first, niche
    /// last (WP-132). Every id is a real WP-05 entity (entities.json) so a tap
    /// has immediate consequence on the board.
    static let all: [StarterPack] = [
        StarterPack(
            id: "norsk-fotball",
            title: "Norsk fotball",
            subtitle: "Eliteserien og landslaget",
            reason: "Lagt til fra startpakken «Norsk fotball» — Eliteserien og det norske landslaget.",
            rules: [
                // The two broadly-meaningful Norwegian football follows (not the
                // owner's club): the top league + the national team. Both are now
                // grounded server-side (WP-133 seeded Eliteserien as an entity and
                // consolidated the Norway/Norge national-team duplicate to `norge`).
                StarterRule("eliteserien", "Eliteserien", sport: "football", type: "tournament"),
                StarterRule("norge", "Norge", sport: "football", type: "team"),
            ]
        ),
        StarterPack(
            id: "vintersport",
            title: "Vintersport",
            subtitle: "Skiskyting, langrenn, alpint og hopp — fra sesongstart i november",
            reason: "Lagt til fra startpakken «Vintersport».",
            rules: [
                // The four sport-level entities (WP-64/116). Off-season in July —
                // matches nothing yet; the rows appear at season start (honest).
                StarterRule("sport-biathlon", "Skiskyting", sport: "biathlon", type: "sport"),
                StarterRule("sport-cross-country", "Langrenn", sport: "cross-country", type: "sport"),
                StarterRule("sport-alpine", "Alpint", sport: "alpine", type: "sport"),
                StarterRule("sport-ski-jumping", "Hopp", sport: "ski jumping", type: "sport"),
            ]
        ),
        StarterPack(
            id: "friidrett",
            title: "Friidrett",
            subtitle: "Karsten Warholm og Jakob Ingebrigtsen",
            reason: "Lagt til fra startpakken «Friidrett» — Karsten Warholm og Jakob Ingebrigtsen.",
            rules: [
                // The two marquee Norwegian track stars, both grounded server-side.
                // WP-133 seeded Ingebrigtsen as an entity, so the pack follows him
                // directly instead of routing through the EM-tournament workaround.
                StarterRule("karsten-warholm", "Karsten Warholm", sport: "athletics", type: "athlete"),
                StarterRule("jakob-ingebrigtsen", "Jakob Ingebrigtsen", sport: "athletics", type: "athlete"),
            ]
        ),
        StarterPack(
            id: "norsk-sykkel",
            title: "Sykkel",
            subtitle: "Tour de France gjennom de norske · Uno-X",
            reason: "Lagt til fra startpakken «Sykkel».",
            rules: [
                StarterRule("uno-x-mobility", "Uno-X Mobility", sport: "cycling", type: "team"),
                StarterRule("tour-de-france", "Tour de France", sport: "cycling", type: "tournament", lens: .throughNorwegians),
            ]
        ),
        StarterPack(
            id: "norske-golfere",
            title: "Golf",
            subtitle: "Viktor Hovland, Kristoffer Reitan og The Open — gjennom de norske",
            reason: "Lagt til fra startpakken «Golf».",
            rules: [
                StarterRule("viktor-hovland", "Viktor Hovland", sport: "golf", type: "athlete"),
                StarterRule("kristoffer-reitan", "Kristoffer Reitan", sport: "golf", type: "athlete"),
                // The lens does its work on the tournament: The Open becomes
                // Norwegian-athlete rows rather than a flat leaderboard (WP-18).
                StarterRule("the-open-championship", "The Open Championship", sport: "golf", type: "tournament", lens: .throughNorwegians),
            ]
        ),
        StarterPack(
            id: "sjakk-carlsen",
            title: "Sjakk",
            subtitle: "Magnus Carlsen — når han spiller",
            reason: "Lagt til fra startpakken «Sjakk».",
            rules: [
                StarterRule("magnus-carlsen", "Magnus Carlsen", sport: "chess", type: "athlete"),
            ]
        ),
        StarterPack(
            id: "tennis-ruud",
            title: "Tennis",
            subtitle: "Casper Ruud — også i Grand Slam-turneringene",
            reason: "Lagt til fra startpakken «Tennis».",
            rules: [
                StarterRule("casper-ruud", "Casper Ruud", sport: "tennis", type: "athlete"),
            ]
        ),
        StarterPack(
            id: "internasjonal-fotball",
            title: "Internasjonal toppfotball",
            subtitle: "Premier League, La Liga og VM",
            reason: "Lagt til fra startpakken «Internasjonal toppfotball».",
            rules: [
                StarterRule("premier-league", "Premier League", sport: "football", type: "tournament"),
                StarterRule("la-liga", "La Liga", sport: "football", type: "tournament"),
                StarterRule("fifa-world-cup", "FIFA World Cup", sport: "football", type: "tournament"),
            ]
        ),
        StarterPack(
            id: "formel1",
            title: "Formel 1",
            subtitle: "Hele sesongen",
            reason: "Lagt til fra startpakken «Formel 1».",
            rules: [
                StarterRule("f1-world-championship", "Formula 1 World Championship", sport: "f1", type: "tournament"),
            ]
        ),
        StarterPack(
            id: "cs2",
            title: "e-sport (CS2)",
            subtitle: "De store CS2-turneringene",
            reason: "Lagt til fra startpakken «e-sport (CS2)».",
            rules: [
                // Generalised (WP-132): the marquee tournament, not the owner's
                // 100 Thieves / rain. Following it shows the whole event.
                //
                // Grounds on the DURABLE catalog id "esports-world-cup" (WP-162),
                // not the edition-derived "esports-world-cup-cs2". The discipline
                // form only exists in entities.json while tracked.json books a
                // dated CS2 edition, and vanishes off-season — a starter pack that
                // pointed there followed NOTHING between editions. "esports-world-cup"
                // is the coverage-compass tournament (catalog.json tier2), always
                // present, exactly like the football pack's "eliteserien"/"norge".
                StarterRule("esports-world-cup", "Esports World Cup", sport: "esports", type: "tournament"),
            ]
        ),
    ]
}
