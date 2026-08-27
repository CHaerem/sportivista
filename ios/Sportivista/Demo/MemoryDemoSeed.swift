//
//  MemoryDemoSeed.swift
//  Sportivista
//
//  WP-30 — DEBUG-only screenshot harness for personal memory. Apple Intelligence
//  and live sync aren't deterministic in the Simulator, so this seeds a fixed
//  memory state (facts + episodic + behaviour) into the SAME ProfileSyncState
//  the app reads, plus a small agenda cache with a spoiler-sensitive result — so
//  `SPORTIVISTA_DEMO=memory` captures the "Hva jeg vet om deg" page and
//  `SPORTIVISTA_DEMO=spoiler` captures a spoiler-masked detail sheet, both with no
//  network. Never compiled into a release build (`#if DEBUG`); lives in
//  Sportivista/Demo/ (WP-48) — only the app targets' `path: Sportivista` picks that folder
//  up, so neither the widget nor the test bundle compiles it. (Its old home,
//  Sportivista/Memory/, WAS compiled into SportivistaTests — the previous "the test target
//  doesn't pick this up" claim here only became true with this move.)
//

#if DEBUG
import Foundation

enum MemoryDemoSeed {

    /// Seed a representative memory state (all three layers) so the "Hva jeg vet
    /// om deg" page renders full and readable. Sport-scoped throughout so the
    /// labels resolve without a synced entity index.
    static func seedMemory(into store: MemoryStore, now: Date = Date()) {
        // Idempotent: reset first so relaunching the demo (e.g. once per theme)
        // never accumulates duplicate facts in the same Simulator container.
        store.forgetAll(now: now)
        store.save(SaveMemoryCommand(sport: "f1", kind: .spoilerPolicy, value: "opptak",
                                     reason: "Ser F1 på opptak i helgene — vil ikke vite resultatet."), now: now)
        store.upsertFact(MemoryFact(sport: "chess", kind: .knowledgeLevel, value: "nybegynner",
                                    reason: "Ny i sjakk — forklar gjerne fagtermer.", updatedAt: now), now: now)
        store.upsertFact(MemoryFact(kind: .notifyWindow, value: "ikke før 08:00",
                                    reason: "Vil ikke varsles før frokost.", updatedAt: now), now: now)
        store.appendEpisodic(DistilledNote(summary: "Lærte: skal se Tour-etappen i opptak i kveld.",
                                           entityRefs: ["cycling"], kind: .spoilerPolicy,
                                           expiresAt: MockMemoryDistiller.endOfOsloDay(now)), now: now)
        for _ in 0..<4 { store.record(.open, sport: "f1") }
        for _ in 0..<2 { store.record(.open, sport: "chess") }
        store.record(.dismiss, sport: "tennis")
    }

    /// A masked, spoiler-sensitive detail row: an in-progress F1 race carrying a
    /// result, with `spoilerSafe == false` — the detail sheet hides the RESULTAT
    /// behind the tap-to-reveal.
    static func spoilerRow(now: Date = Date()) -> AgendaEventRow {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let dict: [String: Any] = [
            "sport": "f1", "title": "Britisk Grand Prix", "tournament": "Formel 1",
            "time": iso.string(from: now.addingTimeInterval(-1800)), "venue": "Silverstone",
            "status": "in_progress", "result": "Verstappen leder foran Norris og Piastri",
            "streaming": [["platform": "Viaplay", "url": "https://viaplay.no"]],
        ]
        let event = (try? JSONSerialization.data(withJSONObject: dict)).flatMap {
            try? SportivistaJSON.decoder.decode(Event.self, from: $0)
        }!
        return AgendaEventRow(
            id: "demo-spoiler",
            timeLabel: AgendaFormat.timeLabel(time: event.time, endTime: nil),
            title: "Britisk Grand Prix",
            metaLabel: "Formel 1 · Silverstone",
            channelLabel: "Viaplay",
            isMustSee: true, mustWatch: true, isAIResearch: false,
            event: event,
            whyShown: "Du følger Formel 1.",
            spoilerSafe: false
        )
    }
}
#endif
