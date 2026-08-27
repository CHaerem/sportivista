//
//  RitualPriming.swift
//  Sportivista
//
//  WP-202 — the pure half of the onboarding's notification decision. The ritual
//  step PRIMES before it asks (the copy explains exactly what notifications are
//  — must-see reminders before start, a quiet «briefen er klar» ping, never
//  results, never spoilers — BEFORE the one-shot iOS system prompt is spent),
//  and this enum owns what a grant/denial MEANS, so the behaviour is
//  unit-testable without UNUserNotificationCenter:
//
//    • granted → the daily-brief ping is opted IN (BriefAlertPreference).
//      Deliberate WP-181 exception: that preference is opt-in-only precisely so
//      nothing buzzes unasked — and this IS the user asking, from a screen whose
//      entire copy is that ask. Event reminders need no flag: NotificationPlanner
//      plans them whenever authorization exists.
//    • denied  → nothing is written. The honest line points at Innstillinger —
//      iOS only shows the system prompt once, so a later change of heart goes
//      through Settings, and pretending otherwise would be a lie.
//
//  The view keeps only the async shell (request via NotificationScheduling,
//  hand the Bool here, render the returned line).
//

import Foundation

enum RitualPriming {
    /// The outcome of the one notification decision, applied + explained.
    /// Returns the calm status line the ritual step renders under the choice.
    @discardableResult
    static func apply(granted: Bool, defaults: UserDefaults = .standard) -> String {
        if granted {
            BriefAlertPreference.setEnabled(true, defaults)
            return "Varsler er på — du får beskjed før må-se-øyeblikkene, og når morgenbriefen er klar."
        }
        return "Varsler er av. Ombestemmer du deg, slår du dem på i Innstillinger › Sportivista."
    }
}
