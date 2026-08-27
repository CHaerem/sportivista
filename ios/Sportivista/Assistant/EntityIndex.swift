//
//  EntityIndex.swift
//  Sportivista
//
//  WP-16 — the grounding substrate. A read-only wrapper around the WP-05
//  entity list (docs/data/entities.json, loaded via DataStore.loadEntities())
//  that answers three questions the FM-lekegrind needs:
//
//    • entity(id:)          exact lookup — the HARD grounding gate. A mutation
//                           is accepted ONLY if its entityId resolves here.
//    • search(_:)           free-text search backing the model's searchEntities
//                           tool (name/alias/id/sport, with Norwegian sport-word
//                           expansion so "tennis"/"sykkel" find their entities).
//    • nearestMatches(to:)  fuzzy lookup for a FAILED grounding — the "mente du
//                           …?" suggestions. String-similarity only (no sport
//                           expansion), so a typo ("Hovlan") suggests "Hovland"
//                           but a genuinely-absent sport ("cricket") suggests
//                           nothing rather than a misleading near-match.
//
//  detectEntities(in:) is the MOCK's utterance→entity matcher (see
//  MockInterestAssistant); it is deliberately NOT part of grounding — grounding
//  only ever trusts an exact `entityId`.
//
//  All matching routes through TextMatch (WP-13) for diacritic-folded,
//  word-boundary comparison, so "Barça" ≡ "Barca" and "Lyn" ≠ "Brooklyn" here
//  exactly as everywhere else in the app.
//

import Foundation

struct EntityIndex: Sendable {
    let entities: [Entity]
    private let byId: [String: Entity]
    /// WP-61 — the exact-match lookup, built ONCE per index. Maps a normalized
    /// term (name / alias / spaced-id, plus its edition-stripped form) to the
    /// ids of every entity that would score a perfect 100 for that query in
    /// `matchScore`. Lets `servedEntity(for:)` answer the common "the name is a
    /// known entity" case in O(1) instead of scanning all entities + running
    /// Levenshtein against each. Ids are de-duplicated so `.count` is a distinct
    /// entity count.
    private let exactTermIds: [String: [String]]

    /// Perf (19.07.2026): everything `matchScore` needs about one stored term,
    /// computed ONCE at init. Before this, every `resolve()` call re-normalized
    /// every term of every entity AND `containsName` compiled a fresh
    /// NSRegularExpression per call — tens of millions of compiles across the
    /// parity suite (48s of its 87s total), and the same waste per real user
    /// query. Semantics are byte-identical: the parity tests + golden vectors
    /// are the judges.
    private struct PreppedTerm {
        /// `TextMatch.normalize(raw)` — also `containsName`'s haystack form.
        let norm: String
        /// Deduped `[norm, editionStripped(norm)]`, order-independent under
        /// `consider` (max-taking) exactly like the old `Set` iteration.
        let variants: [String]
        /// Tokenizations aligned with `variants`.
        let variantTokens: [[String]]
        /// `TextMatch.BoundaryMatcher` with THIS TERM as the name — the
        /// precompiled half of `containsName(q, raw)`.
        let nameMatcher: TextMatch.BoundaryMatcher?
    }
    private struct PreppedEntity {
        let entity: Entity
        let terms: [PreppedTerm]
        let initialsNorm: [String]
        let onFlyInitials: String?
    }
    /// Everything in here is immutable value data (BoundaryMatcher is a plain
    /// String wrapper since the 27.08 de-regexing); `@unchecked` only spares us
    /// marking the nested Entity model chain. Confined to this file.
    private struct Prepped: @unchecked Sendable { let entries: [PreppedEntity] }
    private let prepped: Prepped
    /// WP-61 — the stored-initials lookup, likewise built once: a normalized
    /// `initials` value → the ids scoring 96 for it. `servedEntity`'s fast path
    /// needs this because 96 is the ONLY score strictly between the exact 100
    /// and the 88 prefix tier, so it is the only thing that can deny a lone
    /// exact match its clear lead (see the proof on `servedEntity`).
    private let initialsIds: [String: [String]]

    /// WP-166 — each entity id → its position in the source-priority-ordered
    /// index. `build-entities.js` folds its sources in a deliberate order
    /// ("insertion order = source priority": tracked.json → norwegian-golfers →
    /// sports-config → catalog tier2 → sport/category), so a lower position marks
    /// a more "core" entity: a tracked / tier1 flagship over the tier2 long-tail.
    /// It is the curated, deterministic tie-break both `representativeEntity` and
    /// `search` use when a type-rank or match-score tie would otherwise fall back
    /// to alphabetical name — the reason "Tour de France" (tracked) represents
    /// cycling rather than "Arctic Race of Norway" (tier2), and the reason a
    /// whole-sport search keeps the flagship in its top-N instead of flooding
    /// with the alphabetically-earliest long-tail. First-occurrence wins, matching
    /// `byId`'s de-dup.
    private let sourceRank: [String: Int]

    /// WP-161 — a token → entity-index inverted index for `detectEntities`. A
    /// mention match by EITHER signal (`containsName` or significant-token subset)
    /// requires every token of some term to be present in the utterance, so an
    /// entity sharing NO token with the utterance can never match. At world-
    /// registry scale (3 661 entities) scanning them all per utterance turned the
    /// parser-heavy paths (bulk-fangst, the eval corpus, the assistant at runtime)
    /// into an O(entities) hot loop; this map lets `detectEntities` score only the
    /// handful of candidates that share a token — same results, O(candidates).
    /// Keyed by the SAME `Self.tokens` the scorer reads, over non-bare-sport terms
    /// of non-sport/category entities (both are skipped by the scorer, so indexing
    /// them would only add candidates that score 0).
    private let mentionIndex: [String: [Int]]

    init(_ entities: [Entity]) {
        self.entities = entities
        var ids = Dictionary(entities.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        // WP-162 — a FORMER id (`premier-league-2026-27`) resolves to the entity
        // that now carries it as an `altIds` entry, so a profile rule frozen on
        // last season's id keeps working the moment the new index syncs — before
        // (and independently of) `ProfileIdMigration` re-pointing it. A live
        // primary id ALWAYS wins: alt ids only fill gaps, never shadow.
        var alts: [String: Entity] = [:]
        for e in entities {
            for alt in e.altIds where ids[alt] == nil && alts[alt] == nil { alts[alt] = e }
        }
        for (alt, e) in alts { ids[alt] = e }
        self.byId = ids
        var rankMap: [String: Int] = [:]
        rankMap.reserveCapacity(entities.count)
        for (i, e) in entities.enumerated() where rankMap[e.id] == nil { rankMap[e.id] = i }
        self.sourceRank = rankMap

        // Build the WP-61 exact/initials maps with EXACTLY the normalization
        // `matchScore` applies, so a fast-path hit is byte-identical to what the
        // full scan would have found. `exact` keys mirror the `termNorm == q`
        // branch (both the plain-normalized and edition-stripped forms of every
        // name/alias/spaced-id term); `initials` keys mirror the
        // `TextMatch.normalize(ini) == q` branch. Ids stay de-duplicated per key.
        var exact: [String: [String]] = [:]
        var inits: [String: [String]] = [:]
        func append(_ id: String, forKey key: String, into map: inout [String: [String]]) {
            guard !key.isEmpty else { return }
            if map[key]?.contains(id) == true { return }
            map[key, default: []].append(id)
        }
        var mention: [String: [Int]] = [:]
        var preppedEntries: [PreppedEntity] = []
        preppedEntries.reserveCapacity(entities.count)
        for (entityIndex, e) in entities.enumerated() {
            // WP-161 mention index: register this entity under every token of its
            // non-bare-sport name/alias terms (the tokens `detectEntities` reads).
            if e.type != "sport", e.type != "category" {
                var seenTok = Set<String>()
                for term in [e.name] + e.aliases where !Self.isBareSportWord(term) {
                    for t in Self.tokens(term) where seenTok.insert(t).inserted {
                        mention[t, default: []].append(entityIndex)
                    }
                }
            }
            var terms = [e.name] + e.aliases
            terms.append(e.id.replacingOccurrences(of: "-", with: " "))
            var preppedTerms: [PreppedTerm] = []
            preppedTerms.reserveCapacity(terms.count)
            for raw in terms {
                let tn = TextMatch.normalize(raw)
                var variants: [String] = []
                for termNorm in Set([tn, Self.editionStripped(tn)]) {
                    append(e.id, forKey: termNorm, into: &exact)
                    if !termNorm.isEmpty { variants.append(termNorm) }
                }
                preppedTerms.append(PreppedTerm(
                    norm: tn,
                    variants: variants,
                    variantTokens: variants.map { $0.split(separator: " ").map(String.init) },
                    nameMatcher: TextMatch.BoundaryMatcher(forNormalizedName: tn)
                ))
            }
            var initialsNorm: [String] = []
            for ini in e.initials {
                let n = TextMatch.normalize(ini)
                append(e.id, forKey: n, into: &inits)
                initialsNorm.append(n)
            }
            preppedEntries.append(PreppedEntity(
                entity: e,
                terms: preppedTerms,
                initialsNorm: initialsNorm,
                onFlyInitials: Self.onTheFlyInitials(e)
            ))
        }
        self.exactTermIds = exact
        self.initialsIds = inits
        self.mentionIndex = mention
        self.prepped = Prepped(entries: preppedEntries)
    }

    // MARK: - Exact lookup (the grounding gate)

    func entity(id: String) -> Entity? { byId[id] }

    var isEmpty: Bool { entities.isEmpty }

    // MARK: - Ranked fuzzy resolver (WP-16.2 — the shared identity lookup)

    /// The outcome of resolving a free-text phrase to real entities. `candidates`
    /// is the ranked, score-descending shortlist (each ≥ `candidateFloor`);
    /// `served` is the single, confident, UNAMBIGUOUS winner (nil when nothing
    /// clears the bar or when two candidates are too close to separate).
    struct Resolution: Equatable, Sendable {
        var candidates: [ScoredEntity]
        var served: Entity?
        var isEmpty: Bool { candidates.isEmpty }
    }

    struct ScoredEntity: Equatable, Sendable {
        var entity: Entity
        var score: Int
    }

    // Thresholds. `candidateFloor`: minimum score to be offered as a "mente du"
    // suggestion. `autoUseFloor` + `leadMargin`: an AUTO-eligible top hit (exact
    // name/alias, exact initials, or a same-shape typo) at/above this score that
    // clearly leads the runner-up is SERVED directly — so "tour de france",
    // "tdf" and "Tour de Farnce" never reach the rejection path again. A merely
    // strong-but-partial match (a prefix like "Hovlan", a substring) is
    // suggestion-only, never auto-served.
    static let candidateFloor = 55
    static let autoUseFloor = 66
    static let leadMargin = 12

    /// Resolve a phrase to a ranked candidate list + (maybe) one served winner.
    /// Diacritic/case-folded (TextMatch), year-suffix-agnostic, alias-aware,
    /// prefix/contains, initials-aware, and edit-distance≤2 typo-tolerant. No
    /// Norwegian sport-word expansion — resolving an IDENTITY from "tennis" must
    /// not silently pick one tennis entity (that stays ambiguous / unresolved).
    func resolve(_ query: String, limit: Int = 5) -> Resolution {
        let q = TextMatch.normalize(query)
        guard !q.isEmpty else { return Resolution(candidates: [], served: nil) }
        let qTokens = q.split(separator: " ").map(String.init)

        // One boundary regex for the QUERY (containsName(raw, q)'s name-half),
        // compiled once and reused across every entity/term below.
        let queryMatcher = TextMatch.BoundaryMatcher(forNormalizedName: q)

        var scored: [(entity: Entity, score: Int, auto: Bool)] = []
        for p in prepped.entries {
            if let m = Self.matchScore(for: p, queryNorm: q, queryTokens: qTokens, queryMatcher: queryMatcher),
               m.score >= Self.candidateFloor {
                scored.append((p.entity, m.score, m.auto))
            }
        }
        let ranked = scored.sorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            return lhs.entity.name < rhs.entity.name
        }
        let candidates = ranked.prefix(limit).map { ScoredEntity(entity: $0.entity, score: $0.score) }

        var served: Entity?
        if let top = ranked.first, top.auto, top.score >= Self.autoUseFloor {
            let clearLead = ranked.count < 2 || (top.score - ranked[1].score) >= Self.leadMargin
            if clearLead { served = top.entity }
        }
        return Resolution(candidates: Array(candidates), served: served)
    }

    /// WP-61 — the served winner ONLY (`resolve(query).served`), but O(1) on the
    /// common path via the prebuilt exact-match maps. `AgendaViewModel.subjects` calls
    /// this once per home/away/tournament NAME on every agenda row; the full
    /// `resolve` scans all entities + runs Levenshtein per one, which is O(events
    /// × entities) across a compile. This is proven byte-identical to
    /// `resolve(query).served` (see EntityServedParityTests):
    ///
    ///   • An exact term match scores 100 (auto). Because the ONLY scores
    ///     strictly above 88 that `matchScore` can emit are 100 (exact term) and
    ///     96 (stored initials == q), the runner-up needed for the ≥12-point
    ///     "clear lead" is fully knowable from the two maps alone — no scan:
    ///       – two+ exact matches ⇒ a 100–100 tie ⇒ no clear lead ⇒ not served;
    ///       – one exact match with ANOTHER entity's initials == q ⇒ 100 vs 96 ⇒
    ///         lead 4 < 12 ⇒ not served;
    ///       – one exact match and nothing else at 96/100 ⇒ runner-up ≤ 88 ⇒
    ///         lead ≥ 12 ⇒ that entity is served.
    ///   • With NO exact term match, a served result can still arise from the
    ///     lower auto tiers (initials 96, same-shape typo 84/80), so we fall back
    ///     to the unchanged full resolver — identical by construction.
    func servedEntity(for query: String) -> Entity? {
        let q = TextMatch.normalize(query)
        guard !q.isEmpty else { return nil }
        if let exact = exactTermIds[q], !exact.isEmpty {
            guard exact.count == 1 else { return nil }        // 100–100 tie
            let winner = exact[0]
            if let ini = initialsIds[q], ini.contains(where: { $0 != winner }) {
                return nil                                    // another entity at 96 denies the lead
            }
            return byId[winner]
        }
        return resolve(query).served
    }

    // MARK: - Tool-facing search

    /// Free-text search for the `searchEntities` tool — the resolver's ranked
    /// hits PLUS Norwegian sport-keyword expansion (a bare "tennis"/"sykkel"
    /// returns that sport's entities), so the model gets the same fuzzy quality
    /// (year/alias/initials/typo) the grounder does. Deterministic order so the
    /// tool output — and therefore the model's grounding — is reproducible.
    func search(_ query: String, limit: Int = 8) -> [Entity] {
        let q = TextMatch.normalize(query)
        guard !q.isEmpty else { return [] }

        var scoreById: [String: Int] = [:]
        for c in resolve(query, limit: entities.count).candidates {
            scoreById[c.entity.id] = c.score
        }
        if let sport = Self.sportKeyword(in: query) {
            for e in entities where e.sport == sport {
                scoreById[e.id] = max(scoreById[e.id] ?? 0, 50)
            }
        }
        return entities
            .filter { scoreById[$0.id] != nil }
            .sorted { lhs, rhs in
                let a = scoreById[lhs.id] ?? 0, b = scoreById[rhs.id] ?? 0
                if a != b { return a > b }
                // WP-166: equal scores break by curated source priority, not by
                // name. The whole-sport keyword expansion gives every entity of a
                // sport the SAME score, so a bare "sykkel"/"tennis" used to sort
                // that large tie alphabetically and flood the top-N with the
                // earliest long-tail — pushing the flagship (e.g. Tour de France)
                // out. Ranking the tie by source position keeps tracked/tier1
                // flagships in the top-N with a stable, deterministic order.
                let ra = sourceRank[lhs.id] ?? .max, rb = sourceRank[rhs.id] ?? .max
                if ra != rb { return ra < rb }
                return lhs.name < rhs.name
            }
            .prefix(limit)
            .map { $0 }
    }

    // MARK: - Fuzzy nearest (failed-grounding suggestions)

    /// Nearest real entities for a phrase that did NOT ground — the resolver's
    /// candidate list (identity-only, no sport expansion), so it never
    /// fabricates a sport-level suggestion. Empty when nothing is genuinely
    /// close (the correct answer for "cricket").
    func nearestMatches(to query: String, limit: Int = 3) -> [Entity] {
        resolve(query, limit: limit).candidates.map(\.entity)
    }

    // MARK: - Scoring one entity against a query

    /// Best (score, auto-eligible) for one entity, or nil if nothing matches.
    /// `auto` marks a HIGH-confidence identity match (exact name/alias/initials
    /// or a same-shape typo) that may be served without the user tapping; a
    /// partial match (prefix/substring/single-word fuzz) scores well but stays
    /// suggestion-only.
    private static func matchScore(
        for p: PreppedEntity, queryNorm q: String, queryTokens qTokens: [String],
        queryMatcher: TextMatch.BoundaryMatcher?
    ) -> (score: Int, auto: Bool)? {
        var best = 0
        var bestAuto = false
        func consider(_ score: Int, _ auto: Bool) {
            if score > best { best = score; bestAuto = auto }
            else if score == best, auto, !bestAuto { bestAuto = true }
        }

        for term in p.terms {
            // The two containsName checks depend only on (raw term, query) —
            // never on the variant — so the old code evaluated them to the same
            // result for every non-exact variant. Once is byte-identical.
            var ranContains = false
            for (i, termNorm) in term.variants.enumerated() {
                if termNorm == q { consider(100, true); continue }
                if q.count >= 3, termNorm.count >= 3, (termNorm.hasPrefix(q) || q.hasPrefix(termNorm)) {
                    consider(88, false)
                }
                if !ranContains {
                    ranContains = true
                    // containsName(raw, q): name = q (prebuilt queryMatcher),
                    // haystack = normalize(raw) = term.norm.
                    if let m = queryMatcher, m.matches(inNormalized: term.norm) {
                        consider(82, false)
                    }
                    // containsName(q, raw): name = raw (precompiled at init),
                    // haystack = q (already normalized).
                    if let m = term.nameMatcher, m.matches(inNormalized: q) {
                        consider(78, false)
                    }
                }
                let tTokens = term.variantTokens[i]
                if tTokens.count >= 2, qTokens.count == tTokens.count,
                   let d = tokenwiseDistance(qTokens, tTokens), d >= 1, d <= 2 {
                    consider(d == 1 ? 84 : 80, true)   // same-shape typo — auto
                }
                if q.count >= 3, (termNorm.contains(q) || q.contains(termNorm)) { consider(58, false) }
                let sim = similarity(q, termNorm)
                if sim >= 60 { consider(min(sim, 79), false) }
            }
        }
        for ini in p.initialsNorm where ini == q { consider(96, true) }
        if let onFly = p.onFlyInitials, onFly == q { consider(72, false) }

        return best > 0 ? (best, bestAuto) : nil
    }

    /// Sum of per-token Levenshtein distances when the two token lists align
    /// 1:1; nil when they cannot be trusted as the same phrase (a differing
    /// pair too short to be a mere typo, or any single pair already > 2 apart).
    static func tokenwiseDistance(_ a: [String], _ b: [String]) -> Int? {
        guard a.count == b.count, !a.isEmpty else { return nil }
        var total = 0
        for (x, y) in zip(a, b) where x != y {
            if max(x.count, y.count) < 4 { return nil }   // too short to fuzz safely
            let d = levenshtein(Array(x), Array(y))
            if d > 2 { return nil }
            total += d
            if total > 2 { return nil }
        }
        return total
    }

    /// A normalized string with edition noise stripped: a trailing "(…)"
    /// annotation and any 4-digit year / "2026/27" season token, collapsed —
    /// so "tour de france 2026" ≡ "tour de france". Mirrors build-entities.js's
    /// `editionStrippedName` on the resolver side.
    static func editionStripped(_ norm: String) -> String {
        var s = norm.replacingOccurrences(of: "\\s*\\([^)]*\\)\\s*$", with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\b(?:19|20)\\d{2}(?:\\s*/\\s*\\d{2})?\\b", with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "\\s{2,}", with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
    }

    /// The acronym a 3+-letter-word name would fold to ("tour de france" →
    /// "tdf"), computed on the fly (normalized). A softer, suggestion-tier
    /// signal than the STORED, collision-checked `initials` field: two entities
    /// sharing an acronym have it dropped from their stored data, but both still
    /// surface here as "mente du" candidates rather than one being mis-served.
    static func onTheFlyInitials(_ e: Entity) -> String? {
        let words = editionStripped(TextMatch.normalize(e.name))
            .split(separator: " ")
            .map(String.init)
            .filter { $0.first?.isLetter == true }
        guard words.count >= 3 else { return nil }
        return words.compactMap(\.first).map(String.init).joined()
    }

    // MARK: - Mock utterance detection (NOT grounding)

    /// Entities an utterance mentions, for the mock parser. Two signals:
    /// (3) the whole name/alias appears as words in the utterance
    /// (`containsName`), or (2) every significant token of the name (years and
    /// parenthetical qualifiers dropped) is present — so a year-suffixed
    /// tournament name like "Tour de France 2026" still matches "Tour de
    /// France". Only the highest-confidence tier is returned. WP-166/161 add
    /// three full-long-tail guards: a bare sport-word term is ignored (a
    /// whole-sport signal, not a target); a sub-span match is dropped (a
    /// single-word entity like the national side "France" that only matches a
    /// word INSIDE a longer matched name, "Tour de France", is not a separate
    /// mention); and a co-mentioned competition drops out when a specific
    /// team/athlete is the target — so a scope phrase ("i OBOS-ligaen") never
    /// competes with the real target ("Lyn").
    func detectEntities(in utterance: String) -> [Entity] {
        let hayTokens = Set(Self.tokens(utterance))
        // WP-161: only score entities that share a token with the utterance — a
        // match by either signal requires all of some term's tokens to be present,
        // so a non-sharing entity can never match. O(candidates), not O(all).
        var candidateIndices = Set<Int>()
        for token in hayTokens {
            if let ids = mentionIndex[token] { candidateIndices.formUnion(ids) }
        }
        // Track, per matched entity, the token-set of EVERY term that matched —
        // the sub-span guard needs the spans, not just a scalar score.
        var scored: [(entity: Entity, score: Int, matchTokenSets: [Set<String>])] = []
        for idx in candidateIndices {
            let e = entities[idx]
            // WP-64: sport-/category-level entities are NOT matched as explicit
            // targets here — a whole-sport command ("mer langrenn") routes
            // through sportKeyword → representativeEntity, and an umbrella term
            // ("vintersport") through categoryKeyword, so the plain sport word
            // never out-competes the real tournament/team for that sport.
            // (Already excluded from mentionIndex; kept for clarity.)
            if e.type == "sport" || e.type == "category" { continue }
            var score = 0
            var matchTokenSets: [Set<String>] = []
            for term in [e.name] + e.aliases {
                // WP-166: a term that is nothing but bare sport vocabulary ("F1",
                // "Formel 1") is a WHOLE-SPORT signal, not an explicit target — it
                // routes through sportKeyword → the sport-level entity. So a
                // tournament aliased with the sport's own abbreviation
                // (f1-world-championship-2026 ↔ "F1") never steals "litt F1" from
                // sport-f1. The entity's real, descriptive NAME still matches.
                if Self.isBareSportWord(term) { continue }
                var termMatched = false
                if TextMatch.containsName(utterance, term) { score = max(score, 3); termMatched = true }
                let sig = Set(Self.significantTokens(term))
                if !sig.isEmpty, sig.isSubset(of: hayTokens) { score = max(score, 2); termMatched = true }
                if termMatched {
                    let tokenSet = Set(Self.tokens(term))
                    if !tokenSet.isEmpty { matchTokenSets.append(tokenSet) }
                }
            }
            if score > 0 { scored.append((e, score, matchTokenSets)) }
        }
        guard let best = scored.map(\.score).max() else { return [] }
        var winners = scored.filter { $0.score == best }
        // WP-161: at register scale a single-word entity name ("France", "Norge")
        // spuriously matches a word INSIDE a longer matched name ("Tour de
        // France") — a sub-span, not a separate mention. Drop an entity whose
        // EVERY matched-term span is a STRICT subset of another winner's matched
        // span. An entity with any span of its own that no other winner subsumes
        // (a genuinely-separate mention like "Lyn" beside "OBOS-ligaen") survives.
        let allSpans = winners.flatMap(\.matchTokenSets)
        winners = winners.filter { w in
            w.matchTokenSets.contains { mine in
                !allSpans.contains { other in other.count > mine.count && mine.isSubset(of: other) }
            }
        }
        var result = winners.map(\.entity)
        // WP-166: within ONE clause a specific team/athlete is the follow-target
        // and a co-mentioned competition (league/tournament) is its SCOPE — "Lyn i
        // OBOS-ligaen" follows Lyn, not the 1. divisjon. So when a team/athlete is
        // present at the top tier, the competition drops out. A competition named
        // ALONE (no team/athlete) stays a legitimate target ("Følg Tour de
        // France"); clause-splitting already separates a genuine multi-follow
        // ("Barcelona og La Liga") into its own clauses before this runs.
        if result.contains(where: { $0.type == "team" || $0.type == "athlete" }) {
            result.removeAll { $0.type == "league" || $0.type == "tournament" }
        }
        var seen = Set<String>()
        return result.filter { seen.insert($0.id).inserted }.sorted { $0.name < $1.name }
    }

    /// WP-166: is a name/alias term nothing but bare sport vocabulary — "F1",
    /// "Formel 1", "Formula 1" — i.e. every ALPHABETIC token is a sport keyword?
    /// Such a term is a whole-sport signal (it routes through `sportKeyword`), not
    /// an explicit-target one, so `detectEntities` ignores it: a tournament aliased
    /// with the sport's own abbreviation never out-competes the sport-level entity
    /// for a bare "litt F1". A full name like "Formula 1 World Championship" keeps
    /// non-keyword tokens ("world", "championship"), so it is NOT bare and still
    /// matches normally.
    static func isBareSportWord(_ term: String) -> Bool {
        let alpha = tokens(term).filter { $0.contains(where: \.isLetter) }
        guard !alpha.isEmpty else { return false }
        return alpha.allSatisfy { SportVocabulary.keywordToSport[$0] != nil }
    }

    /// A representative entity for a whole-sport command ("mer sykkel", "slutt
    /// med tennis"). Prefers one already in the profile; otherwise the most
    /// "headline" entity of that sport (tournament > team > athlete > league),
    /// and within one type the curated source priority (WP-166) — so a tracked /
    /// tier1 flagship wins the long-tail. "Tour de France" (tracked, low source
    /// position) represents cycling, not "Arctic Race of Norway" (tier2), even
    /// though both are tournaments and Arctic Race sorts first alphabetically.
    func representativeEntity(forSport sport: String, preferredIn profile: InterestProfile) -> Entity? {
        if let rule = profile.rules.first(where: { $0.sport == sport }), let e = entity(id: rule.entityId) {
            return e
        }
        let rank: [String: Int] = ["tournament": 0, "team": 1, "athlete": 2, "league": 3]
        return entities
            .filter { $0.sport == sport }
            .sorted { lhs, rhs in
                let a = rank[lhs.type] ?? 9, b = rank[rhs.type] ?? 9
                if a != b { return a < b }
                let ra = sourceRank[lhs.id] ?? .max, rb = sourceRank[rhs.id] ?? .max
                if ra != rb { return ra < rb }
                return lhs.name < rhs.name
            }
            .first
    }

    // MARK: - Tokenisation helpers

    /// Diacritic-folded, lower-cased alphanumeric tokens.
    static func tokens(_ s: String) -> [String] {
        TextMatch.normalize(s)
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
    }

    /// Tokens of a name with parenthetical qualifiers and 4-digit years dropped
    /// — the "meaningful" words to require for a token-overlap match.
    static func significantTokens(_ s: String) -> [String] {
        let noParens = s.replacingOccurrences(of: "\\([^)]*\\)", with: " ", options: .regularExpression)
        return tokens(noParens).filter { !isYear($0) }
    }

    static func isYear(_ t: String) -> Bool { t.count == 4 && t.allSatisfy(\.isNumber) }

    /// Canonical sport tag for a Norwegian/English keyword found in the query,
    /// if any (e.g. "sykkel" → "cycling", "sjakk" → "chess").
    static func sportKeyword(in query: String) -> String? {
        for token in tokens(query) {
            if let sport = SportVocabulary.keywordToSport[token] { return sport }
        }
        return nil
    }

    /// Canonical umbrella-category key for a keyword found in the query, if any
    /// (e.g. "vintersport" → "winter-sports"). WP-64: lets a bare umbrella term
    /// ground to the published category entity as one broad-scope following.
    static func categoryKeyword(in query: String) -> String? {
        for token in tokens(query) {
            if let cat = SportVocabulary.keywordToCategory[token] { return cat }
        }
        return nil
    }

    /// The published category (umbrella) entity for a category key, if any —
    /// e.g. "winter-sports" → the "Vintersport" entity (id `category-winter-sports`).
    func categoryEntity(for category: String) -> Entity? { byId["category-\(category)"] }

    // MARK: - Similarity

    /// 0…100 similarity used only by `nearestMatches`. Cheap, deterministic:
    /// exact / prefix / substring shortcuts, else a length-normalised
    /// Levenshtein score.
    static func similarity(_ a: String, _ b: String) -> Int {
        if a.isEmpty || b.isEmpty { return 0 }
        if a == b { return 100 }
        if b.hasPrefix(a) || a.hasPrefix(b) { return 85 }
        if b.contains(a) || a.contains(b) { return 70 }
        let dist = levenshtein(Array(a), Array(b))
        let maxLen = max(a.count, b.count)
        let sim = 1.0 - Double(dist) / Double(maxLen)
        return Int((sim * 100).rounded())
    }

    private static func levenshtein(_ a: [Character], _ b: [Character]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        var curr = [Int](repeating: 0, count: b.count + 1)
        for i in 1...a.count {
            curr[0] = i
            for j in 1...b.count {
                let cost = a[i - 1] == b[j - 1] ? 0 : 1
                curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
            }
            swap(&prev, &curr)
        }
        return prev[b.count]
    }
}

extension Entity {
    /// Memberwise initializer. `Entity` (WP-11) declares a custom `init(from:)`,
    /// which suppresses Swift's synthesised memberwise init — this restores a
    /// direct constructor so tests and previews can build entities without
    /// round-tripping through JSON.
    init(id: String, name: String, aliases: [String] = [], sport: String, type: String, initials: [String] = [],
         country: String? = nil, national: Bool = false, colors: EntityColors? = nil,
         logo: EntityLogo? = nil, edition: String? = nil, altIds: [String] = []) {
        // WP-162 — the edition metadata + former ids (defaulted, so every
        // existing call site is unchanged).
        self.edition = edition
        self.altIds = altIds
        self.id = id
        self.name = name
        self.aliases = aliases
        self.sport = sport
        self.type = type
        self.initials = initials
        // WP-185 identity metadata — defaulted so every existing call site is unchanged.
        self.country = country
        self.national = national
        self.colors = colors
        // WP-186 — the real mark (and its provenance).
        self.logo = logo
    }
}

/// Norwegian (and English) sport vocabulary — maps free-text keywords to the
/// canonical English sport tag entities carry, and back to a Norwegian display
/// word for the assistant's reasons.
enum SportVocabulary {
    // WP-XX: now sourced from the SHARED assistant-vocab.json (AssistantVocab) so
    // keywords stay identical to the web. Same type/API — no consumer changes.
    static let keywordToSport: [String: String] = AssistantVocab.shared.sportKeywords

    static let sportDisplay: [String: String] = [
        "football": "fotball", "golf": "golf", "tennis": "tennis", "chess": "sjakk",
        "cycling": "sykkel", "athletics": "friidrett", "f1": "Formel 1", "esports": "CS2/esport",
        "biathlon": "skiskyting", "cross-country": "langrenn", "alpine": "alpint",
        "nordic": "kombinert", "ski jumping": "hopp"
    ]

    static func display(for sport: String) -> String { sportDisplay[sport] ?? sport }

    // MARK: - WP-64: umbrella categories

    /// A free-text umbrella keyword ("vintersport") → the canonical category key
    /// build-entities.js publishes a category entity under (category-<key>).
    static let keywordToCategory: [String: String] = AssistantVocab.shared.categories.keywords

    /// A category key → the member sports it expands to («vintersport» → settet).
    /// This is the app-side expansion the server's category entity stands in for.
    static let categoryToSports: [String: [String]] = AssistantVocab.shared.categories.members

    static let categoryDisplayNames: [String: String] = AssistantVocab.shared.categories.display

    static func categoryDisplay(for category: String) -> String { categoryDisplayNames[category] ?? category }
}
