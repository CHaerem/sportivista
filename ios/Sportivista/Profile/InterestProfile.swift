//
//  InterestProfile.swift
//  Sportivista
//
//  WP-16 — the local interest profile the FM-lekegrind edits: a flat list of
//  `InterestRule`s, one per entity. This is the on-device, human-owned mirror
//  of the "Hva jeg følger" idea — every rule carries an always-filled Norwegian
//  `reason` (the same transparency contract `tracked.json` uses server-side:
//  CLAUDE.md "AI decides what to track and writes a defensible reason per
//  entry"). Persisted as JSON in Application Support by `ProfileStore`.
//
//  `applying(_:now:)` is the PURE diff-application core — no I/O, no clock read
//  (the caller passes `now`) — so `InterestProfileTests` can drive add/update/
//  remove directly. Add and update are BOTH upserts (insert-or-replace, keyed
//  on `entityId`): a rule is uniquely identified by its entity, so re-adding an
//  entity you already follow just refreshes its scope/weight/reason rather than
//  creating a duplicate.
//

import Foundation

/// One "follow this" rule. `id == entityId` — one rule per entity.
struct InterestRule: Codable, Equatable, Identifiable, Sendable {
    /// The WP-05 stable entity id this rule follows. Doubles as `Identifiable`.
    var entityId: String
    /// Cached display name so the UI can render the profile without a second
    /// entity-index lookup (and so an old rule still reads sensibly if the
    /// entity later drops out of the index).
    var entityName: String
    var sport: String
    /// Optional Norwegian scope, e.g. "bare i Grand Slams", "i juli".
    var scope: String?
    /// Relative importance 0…1 used by future personalisation weighting.
    var weight: Double
    /// Always-filled Norwegian rationale.
    var reason: String
    var addedAt: Date
    /// The perspective this rule is followed through (WP-16.1). Defaults to
    /// `.sportAsSuch`; persisted so "med fokus på norske" survives a round-trip.
    var lens: Lens

    var id: String { entityId }

    private enum CodingKeys: String, CodingKey {
        case entityId, entityName, sport, scope, weight, reason, addedAt, lens
    }

    init(entityId: String, entityName: String, sport: String, scope: String? = nil, weight: Double, reason: String, addedAt: Date, lens: Lens = .sportAsSuch) {
        self.entityId = entityId
        self.entityName = entityName
        self.sport = sport
        self.scope = scope
        self.weight = weight
        self.reason = reason
        self.addedAt = addedAt
        self.lens = lens
    }

    /// Forward-compatible decode (same convention as the WP-11 models): unknown
    /// keys ignored, missing optionals default, so a profile written by a newer
    /// build still loads on an older one.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entityId = try c.decode(String.self, forKey: .entityId)
        entityName = try c.decodeIfPresent(String.self, forKey: .entityName) ?? entityId
        sport = try c.decodeIfPresent(String.self, forKey: .sport) ?? ""
        scope = try c.decodeIfPresent(String.self, forKey: .scope)
        weight = try c.decodeIfPresent(Double.self, forKey: .weight) ?? InterestProfile.defaultWeight
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        addedAt = try c.decodeIfPresent(Date.self, forKey: .addedAt) ?? Date(timeIntervalSince1970: 0)
        // Forward-compatible: a profile written by WP-16 (pre-lens) has no `lens`
        // key — default it, exactly like the other optionals above.
        lens = try c.decodeIfPresent(Lens.self, forKey: .lens) ?? .sportAsSuch
    }
}

// MARK: - WP-164 — soft-follow (a NAME-based rule for something the index doesn't know)

extension InterestRule {
    /// Id prefix for a soft-follow rule — a follow the user created for a NAME
    /// the entity index couldn't resolve («Følg likevel»). The prefix is what
    /// lets the presentation layer tell a deliberate name-follow (honest
    /// «venter på dekning») apart from a mistyped one («sjekk navnet»).
    /// Downstream matching needs no special case: FeedQuery/EffectiveInterests
    /// are already name-tolerant (id-first, then name/alias), so a soft rule
    /// simply starts matching the moment coverage arrives.
    static let softFollowIdPrefix = "soft-"

    /// Deterministic id for a soft-follow of `name` — the same name yields the
    /// same id on every device, so the CRDT profile sync converges instead of
    /// duplicating («soft-erling-haaland» everywhere).
    static func softFollowId(for name: String) -> String {
        let normalized = TextMatch.normalize(name)
        let slug = normalized
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: "-")
        return softFollowIdPrefix + (slug.isEmpty ? "navn" : slug)
    }

    /// Whether this rule is a soft-follow (created by name, not from the index).
    var isSoftFollow: Bool { entityId.hasPrefix(Self.softFollowIdPrefix) }
}

struct InterestProfile: Codable, Equatable, Sendable {
    /// Neutral default weight for a freshly added rule with no explicit weight.
    static let defaultWeight: Double = 0.5

    var rules: [InterestRule]

    init(rules: [InterestRule] = []) {
        self.rules = rules
    }

    private enum CodingKeys: String, CodingKey { case rules }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rules = try c.decodeIfPresent([InterestRule].self, forKey: .rules) ?? []
    }

    func rule(for entityId: String) -> InterestRule? {
        rules.first { $0.entityId == entityId }
    }

    var isEmpty: Bool { rules.isEmpty }

    /// Applies one grounded mutation, returning a NEW profile (value semantics —
    /// nothing here mutates in place). Add/update upsert; remove drops the rule
    /// if present and is otherwise a no-op. Rules are kept sorted by
    /// (sport, entityName) so the "Hva jeg følger" list is stable and the type
    /// stays value-comparable regardless of insertion order.
    func applying(_ mutation: GroundedMutation, now: Date = Date()) -> InterestProfile {
        var next = rules
        let entityId = mutation.entity.id

        switch mutation.kind {
        case .remove:
            next.removeAll { $0.entityId == entityId }

        case .add, .update:
            let existing = next.first { $0.entityId == entityId }
            let rule = InterestRule(
                entityId: entityId,
                entityName: mutation.entity.name,
                sport: mutation.entity.sport,
                scope: mutation.scope,
                weight: mutation.weight,
                reason: mutation.reason,
                // Preserve the original addedAt on an update; stamp now on a
                // genuine first add.
                addedAt: existing?.addedAt ?? now,
                lens: mutation.lens
            )
            next.removeAll { $0.entityId == entityId }
            next.append(rule)
        }

        next.sort { lhs, rhs in
            if lhs.sport != rhs.sport { return lhs.sport < rhs.sport }
            return lhs.entityName.localizedCaseInsensitiveCompare(rhs.entityName) == .orderedAscending
        }
        return InterestProfile(rules: next)
    }

    /// Convenience: fold a whole batch of confirmed mutations in one call.
    func applying(_ mutations: [GroundedMutation], now: Date = Date()) -> InterestProfile {
        mutations.reduce(self) { $0.applying($1, now: now) }
    }

    /// Put `rule` back EXACTLY as it was — the undo half of `.remove` (WP-252).
    ///
    /// Why this is not just `applying(.add)`: an `.add` BUILDS a rule from a
    /// mutation, and every surface that offers «angre» holds an `Entity`, not
    /// the scope/weight/lens the removed rule carried. Rebuilding from the
    /// entity therefore silently drops them — you followed Casper Ruud «bare i
    /// Grand Slams» through «de norske», tapped undo, and were left following
    /// him wholesale. Both fields are USER-VISIBLE (Det du følger renders
    /// «Avgrensning» and «Perspektiv»), so a lossy undo is a lie in the
    /// receipt's own words. Restoring the VALUE, not the intent, is the only
    /// way an undo can leave no trace.
    ///
    /// Precisely which `lens` this restores, since WP-249 made a lens two
    /// different things: the STORED `rule.lens` — the explicit perspective the
    /// assistant set («gjennom norske»), the only one that is persisted — and
    /// the DERIVED athlete lens, which `AgendaViewModel.applicableLensMode`
    /// computes per event from participation and never writes down. Restoring
    /// the stored value is therefore both necessary and sufficient: the derived
    /// half re-derives itself on the next render either way.
    ///
    /// `addedAt` comes along untouched for the same reason — the rule is the one
    /// you already had, not a new one. That is safe for the CRDT sync: the
    /// stamping half (`ProfileSyncState.updatingRules`) compares the rule
    /// PAYLOAD against the live record and stamps `modifiedAt = now` whenever it
    /// differs (a tombstone always differs), so a restored rule beats its own
    /// tombstone on every peer regardless of how old its `addedAt` is.
    ///
    /// Upsert on `entityId` and the same sort as `applying`, so the two
    /// representations stay interchangeable. Pure — no I/O, no clock.
    func restoring(_ rule: InterestRule) -> InterestProfile {
        var next = rules.filter { $0.entityId != rule.entityId }
        next.append(rule)
        next.sort { lhs, rhs in
            if lhs.sport != rhs.sport { return lhs.sport < rhs.sport }
            return lhs.entityName.localizedCaseInsensitiveCompare(rhs.entityName) == .orderedAscending
        }
        return InterestProfile(rules: next)
    }
}
