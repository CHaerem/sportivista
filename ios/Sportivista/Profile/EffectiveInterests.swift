//
//  EffectiveInterests.swift
//  Sportivista
//
//  WP-16.4 — the bridge that makes "Bekreft → agendaen re-kompileres synlig med
//  det samme" real. The agenda is compiled from the SYNCED, server-owned
//  `Interests`; the assistant edits a SEPARATE, local, human-owned
//  `InterestProfile` (ProfileStore). Without a bridge, confirming "Følg X"
//  would change the profile but leave the board unchanged — the opposite of
//  "the assistant IS the interface". This folds the local profile into the
//  interests the FeedCompiler keys off, so a just-confirmed follow shows up on
//  recompile immediately.
//
//  Additive by design: every profile rule becomes a tracked entity in the
//  bucket matching its entity type (athlete/team/league → the team & athlete
//  buckets that ring the bell + earn the accent; tournament → the quieter
//  tournament bucket), carrying the entity's real aliases from the index so
//  word-boundary matching still finds it ("Lyn" as well as "FK Lyn Oslo"). A
//  rule of UNKNOWN type (WP-164: a soft-follow name the index can't resolve)
//  matches from the athlete bucket too, but with an explicit neutral
//  notify:false so it never inherits the bucket's bell default. It
//  NEVER removes what the server already tracks — a `remove` in the profile
//  simply drops that rule, so it stops being merged in.
//
//  WP-200 — the merge no longer leaves `followBroadly` untouched. Until now it
//  passed `base.followBroadly` straight through, so a non-empty profile could
//  only ever ADD to the board: on device `base` is `Interests()` (interests.json
//  stopped being published in WP-96), its `followBroadly` is nil, and the
//  FeedCompiler therefore fell back to the nine-sport default no matter what the
//  user chose in onboarding. Someone who picked only "Formel 1" got an agenda
//  full of golf, cycling and biathlon — the onboarding promise unhonoured.
//
//  So a NON-EMPTY profile now speaks for `followBroadly`:
//    • a rule on a SPORT-level entity (`type == "sport"`, e.g. `sport-biathlon`
//      from Vintersport-pakken) means "follow that sport wholesale";
//    • every other rule (team / athlete / tournament / league) is a precise
//      follow: it admits its own events through the entity match and puts its
//      sport in the blanket's scope (FeedCompiler.sportScope), nothing more;
//    • whatever `base` already followed broadly is KEPT (the local layer still
//      does not fight the server config — it only adds what the profile says).
//  An EMPTY profile keeps returning `base` untouched (the guard below), which is
//  the hard backward-compatibility guarantee: no profile ⇒ today's board.
//

import Foundation

enum EffectiveInterests {

    /// The interests the agenda should compile against right now: the synced
    /// `base` with the local `profile` folded in. Pure — no disk, no clock — so
    /// the "immediate consequence" contract is unit-testable directly.
    static func merge(profile: InterestProfile, into base: Interests, index: EntityIndex) -> Interests {
        guard !profile.rules.isEmpty else { return base }

        var athletes = base.alwaysTrack.athletes
        var teams = base.alwaysTrack.teams
        var tournaments = base.alwaysTrack.tournaments
        // WP-200 — the sports this profile follows WHOLESALE, seeded with whatever
        // `base` already followed broadly (nil on device since WP-96).
        var broadly = Set((base.followBroadly ?? []).map { $0.lowercased() })

        func contains(_ list: [Interests.Entity], _ name: String) -> Bool {
            list.contains { TextMatch.normalize($0.name) == TextMatch.normalize(name) }
        }

        for rule in profile.rules {
            let entity = index.entity(id: rule.entityId)
            let name = entity?.name ?? rule.entityName
            let aliases = Self.seasonProof(name: name, aliases: entity?.aliases ?? [])
            let sport = entity?.sport ?? rule.sport
            let type = entity?.type ?? ""
            let merged = Interests.Entity(name: name, aliases: aliases, sport: sport, notify: nil)

            switch type {
            case "team", "league":
                if !contains(teams, name) { teams.append(merged) }
            case "tournament":
                if !contains(tournaments, name) { tournaments.append(merged) }
            case "sport":
                // WP-200 — a sport-level follow is WHOLESALE: every event in that
                // sport belongs on the board. It also stays in the athlete bucket
                // (unchanged) so the bell/accent behave exactly as before.
                if !sport.isEmpty { broadly.insert(sport.lowercased()) }
                if !contains(athletes, name) { athletes.append(merged) }
            case "athlete", "category":
                if !contains(athletes, name) { athletes.append(merged) }
            default:
                // WP-164 — an UNKNOWN type (a soft-follow / an id the index can't
                // resolve) still lands in the athlete bucket for MATCHING, but
                // with an explicit neutral notify: the athlete bucket's implicit
                // notify:true is bell semantics (FeedCompiler.notifyEntities)
                // the user never opted into for a name we can't even resolve.
                let neutral = Interests.Entity(name: name, aliases: aliases, sport: sport, notify: false)
                if !contains(athletes, name) { athletes.append(neutral) }
            }
        }

        return Interests(
            // WP-200 — ALWAYS explicit for a non-empty profile, even when it is
            // empty (`[]`, "I follow no sport wholesale"): `Interests.followBroadly`
            // has distinguished absent from empty since WP-13, and the lens reads
            // exactly that distinction — an EXPLICIT list is what tells
            // FeedCompiler a profile owns this board and narrows the
            // norwegian/favorite/importance blanket to the sports it covers.
            // Sorted so the projection is deterministic and equal to the web twin's.
            followBroadly: broadly.sorted(),
            alwaysTrack: Interests.AlwaysTrack(athletes: athletes, teams: teams, tournaments: tournaments),
            notify: base.notify
        )
    }

    /// WP-162 — the SEASON-PROOF alias set for a followed entity: its aliases
    /// plus the edition-stripped form of the display name / of any alias that
    /// carries one ("Premier League 2026/27" → "Premier League").
    ///
    /// A profile rule freezes the entity NAME at follow time. Without this, a
    /// rule created against one edition word-boundary-matches NOTHING once the
    /// next edition's title reaches the board — the follow dies with no signal.
    /// The stripped form is a full, yearless name, so it is a legitimate
    /// word-boundary term (never an acronym-style near-collision), and it is
    /// purely ADDITIVE: a name with no edition token contributes nothing. Mirrors
    /// `ssWithEditionlessTerms` in docs/js/lens.js.
    static func seasonProof(name: String, aliases: [String]) -> [String] {
        var out = aliases
        var seen = Set(([name] + aliases).map { TextMatch.normalize($0) })
        for raw in [name] + aliases {
            let stripped = EntityIndex.editionStripped(TextMatch.normalize(raw))
            guard !stripped.isEmpty, seen.insert(stripped).inserted else { continue }
            out.append(stripped)
        }
        return out
    }
}
