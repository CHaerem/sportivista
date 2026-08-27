//
//  AssistantViewModel+Follow.swift
//  Sportivista
//
//  WP-105 — the ONE direct-follow apply path shared by the assistant-free 3b
//  surfaces (Deg › Det du følger + Legg til, and the event detail sheet's
//  «Følg <navn>» button). "Interesser uten assistent": the path from "så noe
//  interessant" to "følger" never routes through the assistant diff — a tap IS
//  the confirmation.
//
//  This is NOT a new write path. It funnels the same three steps every
//  confirmed mutation already uses into one entry point:
//    profile = profile.applying(mutation)   // the pure diff core (InterestProfile)
//    profileStore.save(profile)             // the persist() body — the one store
//    onProfileChanged?()                    // "umiddelbar konsekvens" recompile
//  i.e. exactly what `confirm`/`confirmAll`/`toggleStarterPack` do, minus the
//  diff round-trip — mirroring `toggleStarterPack`'s "a tap IS the confirmation"
//  contract for a single entity. It lives in Profile/ (like the WP-19 profil-sync
//  arm in AssistantViewModel+ProfileSync.swift) so it can reach the internal
//  `profile` setter, the `profileStore`, and `onProfileChanged` without touching
//  Assistant/.
//

import Foundation

extension AssistantViewModel {
    /// Whether `entityId` is already in the profile — drives the Legg til /
    /// detail «Følg» button's presence (no button for something already
    /// followed) and the "Følger" read-out.
    func isFollowing(_ entityId: String) -> Bool {
        profile.rule(for: entityId) != nil
    }

    /// Follow `entity` directly — the tap IS the confirmation, no assistant diff
    /// (3b: "krever aldri assistenten"). Upsert semantics via
    /// `InterestProfile.applying` (re-following just refreshes the rule), then the
    /// same persist + recompile every confirmed mutation runs. Returns whether the
    /// save succeeded (false only on a genuine disk failure; the in-memory profile
    /// is updated regardless, exactly like the diff/confirm path).
    @discardableResult
    func follow(_ entity: Entity, reason: String? = nil, now: Date = Date()) -> Bool {
        let mutation = GroundedMutation(
            kind: .add,
            entity: entity,
            scope: nil,
            weight: InterestProfile.defaultWeight,
            reason: reason ?? "Du valgte å følge \(entity.name).",
            previousRule: profile.rule(for: entity.id)
        )
        profile = profile.applying(mutation, now: now)
        let saved = (try? profileStore.save(profile)) != nil
        onProfileChanged?()
        return saved
    }

    /// Stop following `entity` — the mirror of `follow`, for the surfaces that
    /// hold an Entity rather than an InterestRule (the event detail sheet's
    /// «Slutt å følge <navn>», WP-252). Deliberately NOT a new write path: it
    /// looks the entity's rule up in the profile and hands it to the SAME
    /// `removeRule` Deg › Det du følger has always used, so the tombstone, the
    /// persist and the `onProfileChanged` recompile are identical whichever door
    /// the user came through.
    ///
    /// Returns WHAT it removed (nil for an entity that wasn't followed — a
    /// no-op, never an error). The removed rule is the undo: hand it back to
    /// `restore(_:)` and the follow returns with its scope, lens, weight,
    /// reason and `addedAt` intact. A surface that only knows the ENTITY cannot
    /// reconstruct those, so returning the rule is what makes «Trykk Følg for å
    /// angre» true rather than approximately true.
    @discardableResult
    func unfollow(_ entity: Entity) -> UnfollowOutcome? {
        guard let rule = profile.rule(for: entity.id) else { return nil }
        removeRule(rule)
        return UnfollowOutcome(removed: rule, wasLastFollow: profile.isEmpty)
    }

    /// Put a removed follow back EXACTLY as it was — the undo behind «Trykk Følg
    /// for å angre» (the detail sheet's row flipping back) and «Angre» (the
    /// follow list's snackbar).
    ///
    /// Not `follow(entity)`: that builds a FRESH rule with no scope, the default
    /// weight and the default lens, so undoing a mistap would quietly widen a
    /// narrow follow. This re-applies the rule VALUE through the pure core
    /// (`InterestProfile.restoring`) and then runs the identical persist +
    /// `onProfileChanged` recompile every other mutation runs — same store, same
    /// single write, no new path.
    ///
    /// It also works for a follow whose entity the index cannot resolve (an
    /// unsynced index, or a WP-164 soft-follow whose `soft-…` id matches no
    /// entity anywhere): the rule carries its own name and sport, so undo never
    /// depends on a lookup that may come back empty.
    @discardableResult
    func restore(_ rule: InterestRule) -> Bool {
        profile = profile.restoring(rule)
        let saved = (try? profileStore.save(profile)) != nil
        onProfileChanged?()
        return saved
    }
}

/// What an unfollow did, in the terms the surface that asked for it needs in
/// order to be honest about it (WP-252).
struct UnfollowOutcome: Equatable, Sendable {
    /// The rule that was removed. `AssistantViewModel.restore` puts exactly this
    /// back — the undo is a restore, never a rebuild.
    var removed: InterestRule
    /// True when that was the LAST follow in the profile.
    ///
    /// This is not bookkeeping trivia, it is the one moment the board does the
    /// opposite of what the receipt implies: `EffectiveInterests.merge` returns
    /// the base interests untouched for an EMPTY profile, and the FeedCompiler
    /// then falls back to `followBroadlyDefault` — so removing the last thing
    /// you follow makes the agenda BROADER, not empty. The surface says so.
    var wasLastFollow: Bool
}

// MARK: - WP-164 — soft-follow («Følg likevel»)

extension AssistantViewModel {

    /// Follow a bare NAME the entity index doesn't know — the explicit user
    /// choice behind «Følg likevel» at a search miss / a grounder rejection.
    /// Builds a stand-in entity (deterministic soft id, empty type) and runs it
    /// through the SAME apply path as every other follow; downstream the
    /// feed/news matching is already name-tolerant, so the rule waits honestly
    /// («venter på dekning») and starts matching the moment coverage arrives.
    @discardableResult
    func softFollow(name: String, sport: String = "", now: Date = Date()) -> Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        let entity = Entity(
            id: InterestRule.softFollowId(for: trimmed),
            name: trimmed,
            aliases: [],
            sport: sport,
            type: ""
        )
        return follow(
            entity,
            reason: "Du valgte å følge «\(trimmed)» selv om vi ikke kjenner navnet ennå. Raden venter til dekningen kommer.",
            now: now
        )
    }

    /// Soft-follow the phrase behind a grounder REJECTION — the calm action in
    /// the avvisningsraden. The anti-hallucination gate is untouched (the model
    /// still can't invent ids); this is the USER explicitly choosing to follow
    /// the name anyway. Clears the rejection it answers.
    @discardableResult
    func softFollow(from rejection: RejectedMutation, now: Date = Date()) -> Bool {
        let name = rejection.query.trimmingCharacters(in: .whitespacesAndNewlines)
        let saved = softFollow(name: name, now: now)
        dismissRejection(rejection)
        if !name.isEmpty {
            // The «ingen endring»-account no longer holds — replace it with a
            // calm receipt (result-state bookkeeping lives in the main file).
            noteSoftFollowApplied(named: name)
        }
        return saved
    }
}
