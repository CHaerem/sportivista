//
//  TextMatch.swift
//  Sportivista
//
//  WP-13 — the single most correctness-critical port. These are bit-faithful
//  Swift ports of the SERVER text matchers in scripts/lib/helpers.js
//  (`normalizeText`, `containsName`) — the diacritic-insensitive,
//  word-boundary containment used by relevance (unscoped) and the reminder
//  bell (sport-scoped). Kept as pure, side-effect-free functions so they are
//  unit-testable in isolation and give identical answers to the JS for every
//  golden feed-vector input.
//
//  IMPORTANT — two DIFFERENT matchers coexist by design (DIVERGENCES.md §2):
//    • SERVER matching (this file: `normalize` + `containsName`) folds
//      diacritics ("Barça" ≡ "Barca") AND requires word boundaries ("Lyn"
//      matches "Lyn Oslo"/"Vålerenga-Lyn" but NOT "Brooklyn").
//    • CLIENT accent matching (FeedCompiler.isMustSee) uses a NAIVE plain
//      `lowercased()` + substring `contains` — no diacritic folding, no word
//      boundaries — so it fires on "Brooklyn".contains("lyn"). That naive
//      behaviour is PINNED, so it lives inline in isMustSee and must NOT be
//      routed through this file.
//

import Foundation

enum TextMatch {

    /// Port of server `normalizeText` (helpers.js:69): NFD-decompose, strip
    /// every Unicode Mark (JS `/\p{M}/gu` == general categories Mn/Mc/Me),
    /// then lowercase — in that order.
    ///
    /// - "Barça" → "barca"  (ç → c + combining cedilla, mark stripped)
    /// - "Vålerenga" → "valerenga" (å → a + combining ring, mark stripped)
    /// - "Tromsø" → "tromsø"  (ø has no canonical decomposition — stays, as
    ///   in JS; parity holds even though it is not vector-exercised)
    static func normalize(_ s: String?) -> String {
        guard let s = s, !s.isEmpty else { return "" }
        let decomposed = s.decomposedStringWithCanonicalMapping // NFD
        var scalars = String.UnicodeScalarView()
        for scalar in decomposed.unicodeScalars {
            switch scalar.properties.generalCategory {
            case .nonspacingMark, .spacingMark, .enclosingMark:
                continue // JS: .replace(/\p{M}/gu, "")
            default:
                scalars.append(scalar)
            }
        }
        return String(scalars).lowercased()
    }

    /// Port of the JS metacharacter escape `/[.*+?^${}()|[\]\\]/g` — the exact
    /// same character set the reference escapes before building its RegExp, so
    /// a name containing a regex special is treated literally, identically.
    static func escapeRegex(_ s: String) -> String {
        let specials: Set<Character> = [".", "*", "+", "?", "^", "$", "{", "}", "(", ")", "|", "[", "]", "\\"]
        var out = ""
        out.reserveCapacity(s.count)
        for ch in s {
            if specials.contains(ch) { out.append("\\") }
            out.append(ch)
        }
        return out
    }

    /// Port of server `containsName` (helpers.js:81): word-boundary,
    /// accent-insensitive containment. Both sides are `normalize`d first, then
    /// the name must occur with non-letter/non-digit (or string edge) on both
    /// sides — the semantics of the reference regex
    /// `(?:^|[^\p{L}\p{N}])<name>(?:[^\p{L}\p{N}]|$)`.
    ///
    /// "Lyn" matches "Lyn Oslo" and "Vålerenga – Lyn" but NOT "Brooklyn" —
    /// boundaries kill the substring false-positive class.
    static func containsName(_ haystack: String, _ name: String) -> Bool {
        guard let m = BoundaryMatcher(forNormalizedName: normalize(name)) else { return false }
        return m.matches(inNormalized: normalize(haystack))
    }

    /// The boundary matcher for one (already `normalize`d) name — split out of
    /// `containsName` so hot paths can build it ONCE and reuse it across many
    /// haystacks (EntityIndex keeps one per stored term, and one per query in
    /// `resolve`). nil ⟺ `containsName` would have returned false for every
    /// haystack.
    ///
    /// Minne-lærdom (27.08.2026): this used to be a precompiled
    /// `NSRegularExpression` per term. At world-register scale (3 666 entities
    /// × ~6 terms) those ~20 000 live ICU programs held ≈600 MB resident
    /// (32 KB `icu::UnicodeSet` state EACH, for a pattern whose only classes
    /// are \p{L}\p{N}) — the app's dominant footprint, and jetsam-pressure
    /// hangs on device. The matcher below is a plain substring scan with
    /// explicit boundary checks: same answers (the parity suite + golden
    /// vectors judge), no ICU state at all.
    struct BoundaryMatcher {
        /// The normalized, trimmed, non-empty name to find — case-FOLDED, not
        /// just lowercased: the old regex's `.caseInsensitive` performed full
        /// Unicode case folding, which `normalize`'s `lowercased()` does NOT
        /// cover for the ß-class ("Weißhaidinger" must keep matching the
        /// uppercased surface form "WEISSHAIDINGER" → "weisshaidinger"; the
        /// EntityServedParity suite pins it). `.folding(.caseInsensitive)` is
        /// that same full folding, applied once per side.
        let foldedName: String

        init?(forNormalizedName n0: String) {
            let n = n0.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !n.isEmpty else { return nil }
            self.foldedName = n.folding(options: .caseInsensitive, locale: nil)
        }

        /// True when the name occurs in the (already normalized) haystack with a
        /// non-\p{L}\p{N} scalar (or the string edge) immediately on each side.
        /// The haystack gets the same full case folding as the name; `.literal`
        /// search is then exact scalar-sequence comparison — both sides are
        /// already NFD + mark-stripped by `normalize`.
        func matches(inNormalized h0: String) -> Bool {
            let h = h0.folding(options: .caseInsensitive, locale: nil)
            guard !h.isEmpty else { return false }
            var searchFrom = h.startIndex
            while let r = h.range(of: foldedName, options: .literal, range: searchFrom..<h.endIndex) {
                let beforeOK = r.lowerBound == h.startIndex
                    || !TextMatch.isLetterOrNumber(h.unicodeScalars[h.unicodeScalars.index(before: r.lowerBound)])
                let afterOK = r.upperBound == h.endIndex
                    || !TextMatch.isLetterOrNumber(h.unicodeScalars[r.upperBound])
                if beforeOK && afterOK { return true }
                // Overlap-safe: advance ONE scalar, not past the whole match —
                // "aa" in "aaa aa" must reach the later, boundary-clean
                // occurrence even though the first two overlap.
                searchFrom = h.unicodeScalars.index(after: r.lowerBound)
            }
            return false
        }
    }

    /// `[\p{L}\p{N}]` — the reference regex's boundary class, by general
    /// category (letters Lu/Ll/Lt/Lm/Lo, numbers Nd/Nl/No), exactly as ICU
    /// defines \p{L} and \p{N}.
    static func isLetterOrNumber(_ u: Unicode.Scalar) -> Bool {
        switch u.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber:
            return true
        default:
            return false
        }
    }
}
