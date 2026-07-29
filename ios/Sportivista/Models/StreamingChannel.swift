//
//  StreamingChannel.swift
//  Sportivista
//
//  One Norwegian viewing option on an Event — mirrors events.schema.json
//  `definitions.streamingChannel`. All fields are optional in the schema
//  itself, so plain Optional properties are enough: Swift's synthesized
//  Codable already decodes a missing key to `nil` for an Optional property
//  and ignores JSON keys it doesn't know about, so no custom init is needed
//  here (unlike Event.swift, which also needs array/Bool *defaults*).
//

import Foundation

struct StreamingChannel: Codable, Equatable, Hashable {
    var platform: String?
    var url: String?
    /// True while the channel is an unverified guess (e.g. the shared
    /// "NRK / TV 2" placeholder before the verify agent resolves it).
    var tentative: Bool?
    /// WP-246 — what the URL actually points at: `"deep"` = the broadcast/match/
    /// stream itself, `"landing"` = the service's front page or a generic section
    /// (sport/direkte/language code). Stamped deterministically by the pipeline
    /// (`classifyStreamingUrl` in scripts/lib/norwegian-rights.js, applied last in
    /// build-events.js) so the label can never drift from the URL it describes.
    ///
    /// Kept as the RAW string rather than an enum on purpose: the schema may grow
    /// a third kind, and an unknown value must decode rather than throw. `linkURL`
    /// below is the only reader, and it allowlists — so a kind we don't know is
    /// simply not a link.
    var urlKind: String?
}

extension StreamingChannel {
    /// The `urlKind` value that earns a link. Everything else — `"landing"`, a
    /// future kind, or a missing field — does not (see `linkURL`).
    static let deepURLKind = "deep"

    /// The URL to present as a tappable link, or `nil` when this channel must be
    /// shown as plain text. The Swift twin of `dashboard.js`'s `streamLink`, and
    /// the ONE place either answer is decided — the row, the detail sheet and the
    /// widget all read this rather than re-deriving it.
    ///
    /// DESIGN.md § Radens anatomi (Kanal / "Lenkeløftet", WP-246): the channel NAME
    /// is always true and always shown, but only a URL that points at the broadcast
    /// itself may look like a link. A front page dressed up as the answer to "hvor
    /// ser jeg det" breaks Grunnlov 3 ("Ærlig innhold — aldri lat som").
    ///
    /// Two rules, both allowlists:
    ///
    /// 1. **`urlKind` must be `"deep"`.** A MISSING field is treated exactly like
    ///    `"landing"` — deliberately stricter than web, which keeps the old
    ///    behaviour for entries without the field. iOS is the surface with a
    ///    persistent on-device cache (`CacheStore`), so "no `urlKind`" here means
    ///    "this event was cached before the pipeline stamped it", not "this URL is
    ///    fine". Falling back to a link would be guessing; the honest degradation
    ///    is the channel name without the link, until the next sync says otherwise.
    ///    DESIGN.md words the contract as an allowlist too — only `"deep"` gets to
    ///    look like a link.
    /// 2. **A tentative entry links only to a tvkampen match guide.** When rights
    ///    are shared ("NRK / TV 2") we don't know which broadcaster carries THIS
    ///    match, so linking one of them would mislead when it turns out to be the
    ///    other. The neutral match guide is the one honest destination.
    ///
    /// The URL must also be http(s). `URL(string:)` is deliberately lenient (it
    /// happily builds a scheme-less, un-openable URL out of arbitrary text), so
    /// the scheme is what actually separates "a web address" from "a string".
    var linkURL: URL? {
        guard let raw = url, !raw.isEmpty, let parsed = URL(string: raw) else { return nil }
        guard let scheme = parsed.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
        guard urlKind == Self.deepURLKind else { return nil }
        guard tentative != true else { return Self.isMatchGuide(parsed) ? parsed : nil }
        return parsed
    }

    /// True when the channel carries a URL we refuse to link — the case the detail
    /// sheet explains with a quiet "(ingen direkte lenke)". A channel with NO url at
    /// all is not this: there is nothing to explain, so it stays silent.
    var hasUnlinkableURL: Bool {
        url?.isEmpty == false && linkURL == nil
    }

    /// tvkampen.com — the neutral Norwegian match guide (host or a subdomain of it).
    private static func isMatchGuide(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "tvkampen.com" || host.hasSuffix(".tvkampen.com")
    }
}
