//
//  OnboardingGate.swift
//  Sportivista
//
//  WP-31 — the pure decision layer for the first-run onboarding (dossier P310's
//  «definere»-løkke: "onboarding er en samtale, ikke et skjema"). Kept FM-free
//  and I/O-free so the whole "should we show it / where does it start" logic is
//  unit-testable directly, the same pure-core/thin-shell split the rest of the
//  app uses (ContentView is a thin `@AppStorage` + overlay shell around this).
//
//  The persistent flag is a single Bool in `@AppStorage` (mirroring
//  ThemeOverride.storageKey): onboarding is a one-time thing, re-runnable on
//  demand from "Hva jeg følger" (which just clears the flag / re-presents).
//

import Foundation

/// The steps of the calm first-run flow (WP-132). `welcome` is always first,
/// then `quickPicks` — the tap-to-follow path that works for EVERYONE, now the
/// first build step for all users (the flip WP-129 flagged). `converse` (the
/// say-what-you-follow conversation) is a clearly-secondary, Apple-Intelligence-
/// gated entry off the quick-picks step. `ritual` (WP-202) sells the daily
/// ritual once the profile exists — the morning brief, the ONE notification
/// decision (primed with the why before the system prompt ever shows), and the
/// widget — because a follow-list without the ritual is a bookmark, not a habit.
/// `assistantIntro` is the calm finish that SHOWS the deep-personalisation the
/// assistant unlocks (a few tappable examples + «prøv nå») and drops the user
/// into the already-filled agenda.
enum OnboardingStep: Equatable, Sendable {
    case welcome
    case quickPicks
    case converse
    case ritual
    case assistantIntro
}

/// Pure show-decision helper for onboarding.
enum OnboardingGate {
    /// `@AppStorage` key for the persistent "onboarding done" flag. A single
    /// value, applied at the app root — no per-screen wiring (same convention
    /// as `ThemeOverride.storageKey`).
    static let storageKey = "sportivista.onboardingCompleted"

    /// First-run detection: show the onboarding ONLY when it hasn't been
    /// completed/skipped AND the local profile is still empty. A user who
    /// already follows something (e.g. after a QR import, or a returning
    /// install) never sees it unprompted; a re-run is an explicit action
    /// (`restart`, below), never automatic.
    static func shouldShow(completed: Bool, profileIsEmpty: Bool) -> Bool {
        !completed && profileIsEmpty
    }
}
