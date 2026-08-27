//
//  SeasonCalendar.swift
//  Sportivista
//
//  WP-203 — sesongærlighet som DATA, ikke prosa. Verste-kombinasjonen fra
//  COMMERCIAL.md § Spor A: velger man «Vintersport» i august, var tavla tom til
//  november uten forklaring — startpakken lovet, agendaen svarte med ingenting.
//  Løsningen er en liten, ren sesongtabell (kalendermåneder per sport — samme
//  form som serverens WP-243-dekningskontrakter bruker i authority.json) som to
//  flater leser:
//
//    • Startpakke-raden (OnboardingView.packRow) viser en stille «Sesongstart i
//      november»-linje når ALT pakken følger er utenfor sesong AKKURAT NÅ —
//      beregnet mot dagens dato, aldri en hardkodet setning som ruster.
//    • Agendaens tomtilstand (AgendaView.emptyRow) forklarer et tomt brett når
//      profilen bare følger sporter utenfor sesong: «Skiskyting og langrenn er
//      utenfor sesong — tavla fylles fra november.» i stedet for det generiske
//      «Ingen kommende arrangementer akkurat nå.»
//
//  Ærlighetsregelen er konservativ begge veier: en sport som IKKE står i
//  tabellen regnes som i sesong (vi påstår aldri «utenfor sesong» uten å vite
//  det), og én eneste i-sesong-sport i pakken/profilen demper hele meldingen.
//  Ren verdi-logikk (måned inn, dom ut) — unit-testbar uten klokke-stubbing
//  utover et Date/Calendar-argument.
//

import Foundation

enum SeasonCalendar {
    /// Kalendermånedene (1–12) hver VINTERSPORT er i sesong for norsk seer-
    /// relevans (verdenscupene). Kun sporter med et VELDEFINERT dødt halvår
    /// står her — alt annet behandles som i sesong (ærlig default: vi sier
    /// aldri «utenfor sesong» på gjetning). Nøklene er appens sport-strenger
    /// (StarterPacks/InterestRule.sport).
    static let seasons: [String: Set<Int>] = [
        "biathlon": [11, 12, 1, 2, 3],
        "cross-country": [11, 12, 1, 2, 3],
        "alpine": [10, 11, 12, 1, 2, 3],
        "ski jumping": [11, 12, 1, 2, 3, 4],
    ]

    /// Norske månedsnavn i genitiv-løs «i …»-form (indeks 1–12).
    private static let monthNames = [
        "", "januar", "februar", "mars", "april", "mai", "juni",
        "juli", "august", "september", "oktober", "november", "desember",
    ]

    /// I sesong? Ukjente sporter er ALLTID i sesong (den ærlige defaulten).
    static func isInSeason(_ sport: String, month: Int) -> Bool {
        guard let months = seasons[sport.lowercased()] else { return true }
        return months.contains(month)
    }

    /// Neste sesongstart-måned (1–12) for en sport som er utenfor sesong nå —
    /// den første måneden i sesongtabellen når man teller fremover fra `month`.
    /// nil når sporten er i sesong eller ukjent.
    static func nextSeasonStartMonth(_ sport: String, month: Int) -> Int? {
        guard let months = seasons[sport.lowercased()], !months.contains(month) else { return nil }
        for offset in 1...12 {
            let candidate = (month - 1 + offset) % 12 + 1
            if months.contains(candidate) { return candidate }
        }
        return nil
    }

    /// «november» — navnet på neste sesongstart-måned; nil i sesong/ukjent.
    static func seasonStartName(_ sport: String, month: Int) -> String? {
        nextSeasonStartMonth(sport, month: month).map { monthNames[$0] }
    }

    /// Den stille pakke-linjen: settes KUN når hver eneste sport pakken følger
    /// har et kjent sesongvindu og alle er utenfor det nå. Én i-sesong- eller
    /// ukjent sport ⇒ nil (pakken gir verdi i dag, ingen grunn til å dempe den).
    static func offSeasonNote(sports: [String], month: Int) -> String? {
        guard !sports.isEmpty, sports.allSatisfy({ seasons[$0.lowercased()] != nil && !isInSeason($0, month: month) }) else {
            return nil
        }
        // Den tidligste kommende starten er den ærlige datoen å love.
        let starts = sports.compactMap { nextSeasonStartMonth($0, month: month) }
        guard let earliest = starts.min(by: { monthsUntil($0, from: month) < monthsUntil($1, from: month) }) else { return nil }
        return "Sesongstart i \(monthNames[earliest]) — tavla fylles da."
    }

    /// Tomtilstands-forklaringen: profilen følger noe, brettet er tomt, og ALT
    /// profilen følger av kjente sesong-sporter er utenfor sesong (og minst én
    /// slik finnes). Ukjente sporter blokkerer — et tomt brett for en
    /// helårs-sport er et dekningshull, ikke en sesong, og skal ikke bortforklares.
    static func emptyBoardExplanation(followedSports: [String], month: Int) -> String? {
        let distinct = orderedDistinct(followedSports.map { $0.lowercased() })
        guard !distinct.isEmpty, distinct.allSatisfy({ seasons[$0] != nil }) else { return nil }
        let offSeason = distinct.filter { !isInSeason($0, month: month) }
        guard offSeason.count == distinct.count else { return nil }
        guard let note = offSeasonNote(sports: offSeason, month: month) else { return nil }
        let names = offSeason.map(displayName)
        let list: String
        switch names.count {
        case 1: list = names[0]
        default: list = names.dropLast().joined(separator: ", ") + " og " + names[names.count - 1]
        }
        return "\(list) er utenfor sesong. \(note)"
    }

    /// Måneds-avstand fremover (0–11) fra `from` til `target`, med kalender-wrap.
    private static func monthsUntil(_ target: Int, from: Int) -> Int {
        (target - from + 12) % 12
    }

    private static func orderedDistinct(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    /// Visningsnavn for sesong-sportene (norsk, liten forbokstav — de står
    /// midt i en setning). Speiler SportVocabulary uten å trekke den inn her.
    private static func displayName(_ sport: String) -> String {
        switch sport {
        case "biathlon": return "skiskyting"
        case "cross-country": return "langrenn"
        case "alpine": return "alpint"
        case "ski jumping": return "hopp"
        default: return sport
        }
    }

    /// UTC-måned for en dato — hele appen dømmer datoer i faste soner, og en
    /// sesonggrense treffer aldri så presist at tidssonen betyr noe.
    static func month(of date: Date) -> Int {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .current
        return calendar.component(.month, from: date)
    }
}
