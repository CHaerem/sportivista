---
name: norwegian-rights
description: Norwegian broadcast rights map — which broadcaster/streamer shows each sport/competition in Norway. Use whenever filling in or verifying the streaming field on an event ("hvor kan jeg se det"). Entries carry confidence; verify low-confidence entries per event and correct the map when rights move.
---

# Playbook: Norwegian broadcast rights (seeded 2026-07-03)

The single most important user-facing field after the start time is **where to
watch in Norway**. This map is the prior; `docs/data/tv-listings.json`
(tvkampen.com ground truth, football) and per-event verification override it.

Confidence key: `[solid]` = well-established, `[verify]` = check before relying on it.

## Streaming URL (the tappable deep link in `streaming[].url`)
The dashboard makes each streaming option's `url` tappable — "open where to watch".
A URL on the broadcaster's own domain *may* open its app (iOS Universal Links /
Android App Links) if installed; a deep per-event URL is both likelier to open the
app AND lands on the actual broadcast, not the home screen. Fill it with the most
specific *safe* URL — one you actually reached, never an invented path:
- **NRK — go deep.** NRK's programme/live URLs are stable and reliably deep-linkable:
  use the real `https://tv.nrk.no/serie/…`, `/program/…`, or `/direkte/…` page for
  THIS broadcast when you find it. This is the gold standard.
- **Football:** `docs/data/tv-listings.json` carries a per-match `url` (the tvkampen
  match page listing every Norwegian broadcaster for THAT match). `build-events` now
  applies this automatically — it points TV 2 / Viaplay football options at the
  tvkampen match page (their per-match app URLs 404), keeps NRK football on its own
  `tv.nrk.no` URL (opens the app), and makes the shared/tentative "NRK / TV 2" chip
  link to the tvkampen guide (the ONLY safe link when the broadcaster is unresolved).
  You don't need to set football URLs by hand — but do deep-link NRK per the point above.
- **TV 2 Play / Viaplay & the rest:** do NOT invent per-match paths
  (`play.tv2.no/…/<match>`) — they 404 (auth-gated). Use the service's **sport-section
  landing** (the map's fallback: `play.tv2.no/sport`, `tv.nrk.no/direkte`, `viaplay.no`),
  or a real per-event page only if you genuinely land on one.

A deep `url` you set **survives rebuilds** — build-events keeps the most specific
known URL per broadcaster and won't clobber it with the generic landing.

## Football
- Premier League → **TV 2 Play / TV 2 Sport Premium** [solid]
- La Liga → **TV 2 Play** [solid] (TV 2 renewed the Norwegian rights through summer 2030 — NTB press release kommunikasjon.ntb.no/pressemelding/18978442; the Disney+/ESPN shift is DK/SE/FI/IS only, not Norway; verified 2026-07-18)
- Champions League → **TV 2 Play** [solid]
- Europa League + Conference League → **Viaplay** [solid] (UEFA-klubbrettighetene i Norge t.o.m. 2030/31: kun CL er TV 2s — presse.viaplaygroup.no + tvkampen.com; verifisert 2026-07-27. Viaplay/TV 2-fellesavtalen gjør enkeltkamper også tilgjengelige på TV 2 Play, og norske klubbers tidlige kvalikkamper kan ha egne fri-sublisenser, f.eks. VG TV. Speiler `scripts/lib/norwegian-rights.js`, som ble rettet i #417)
- OBOS-ligaen + Eliteserien → **TV 2 Play** [solid]
- FIFA World Cup 2026 → **NRK + TV 2** (shared, per-match split) [verify per match]
- Cross-check every football entry against `docs/data/tv-listings.json` when present.

## Golf
Rights are **tiered for 2026** — the old "all golf → Viaplay" is WRONG and caused the
Corales Puntacana revert-war (verify kept amending the channel to HBO Max, the fetcher
map kept reverting it to Viaplay). Warner Bros. Discovery took ordinary PGA Tour +
two majors; Viaplay keeps the other two majors + DP World Tour. Verified 2026-07-18.
- Ordinary **PGA Tour** (incl. opposite-field events, e.g. Corales Puntacana) → **HBO Max (Sport) / Eurosport Norge** (WBD) [solid] — hbomax.com/no lists Corales/3M Open/Rocket Classic. Viaplay LOST PGA Tour for 2026.
- **The Open Championship** + **US Open** → **Viaplay** [solid]
- **DP World Tour** → **Viaplay** [verify] (golferen.no: Viaplay holds parts of DP World Tour)
- **Ryder Cup** → **Viaplay** [verify]
- **The Masters** → **Discovery+ / Max** (WBD) [solid] — WBD press release (presse.warnerbrosdiscovery.no)
- **PGA Championship** → **Discovery+ / Max** (WBD) [verify]

## Motorsport
- Formula 1 (all sessions) → **Viaplay** [solid]

## Tennis
- Roland-Garros → **Discovery+/Eurosport** [solid]
- Australian Open → **Discovery+/Eurosport** [solid]
- Wimbledon → **Max (WBD/Eurosport)** [verify] (changed from Viaplay 2026-07-03: tvkampen.com rights page lists Discovery Networks, tvtilbud.no says Max Sport carries all Grand Slams incl. Wimbledon 2026; no 2026-specific press release found)
- ATP/WTA tour events → [verify per event]

## Winter sports
- Biathlon (IBU World Cup/WCH) → **NRK** [solid]
- Cross-country, ski jumping, nordic combined (FIS World Cup) → **NRK** [solid] through 2025/26; from season 2026/27 **TV 2 + Viaplay** share FIS World Cup rights [verify] (NTB press release Dec 2025, kommunikasjon.ntb.no/pressemelding/18377092; noted 2026-07-03)
- Alpine (FIS World Cup) → **Viaplay** [verify]

## Athletics (friidrett)
- Wanda Diamond League (incl. Bislett Games) → **NRK** [solid] — NRK holds the rights 2025–2029 (14 meets/season + Bislett), acquired from Infront; NTB press release kommunikasjon.ntb.no/pressemelding/18535635 (announced 2025-05-22, verified 2026-07-18). NRK also has friidretts-EM 2026, VM t.o.m. 2029, and OL t.o.m. 2032.

## Cycling
- Tour de France → **TV 2 Play** [solid] (TV 2 deal covers 2026–2030 per NTB press release; hjelp.tv2.no confirms TV 2 Direkte + TV 2 Play; Eurosport Norge reportedly shares 2026 rights per cyclingweekly.com [verify]; confirmed 2026-07-03). **Owner preference: show TV 2 Play only** for the Tour — don't re-add Max/Eurosport as a "+1" even though WBD carries the opening hour (they follow it on TV 2 Play).
- Arctic Race of Norway → **TV 2 / TV 2 Play** [solid] (all stages live on TV 2 Direkte + Play — TV2 Sykkel's own announcement; also Eurosport Norge/Max internationally; verified 2026-07-18)
- PostNord Tour of Denmark (Danmark Rundt) → **Norwegian broadcaster NOT confirmed for 2026** [verify] (historically Eurosport Norge/Max; DR/DRTV is the Danish holder). Leave `streaming` empty with an honest note until confirmed.
- Other UCI races → [verify per event]

## Chess
- Norway Chess, Carlsen events → often **NRK** or **TV 2**, plus free official streams (chess24/chess.com/YouTube) [verify per event]

## Esports (CS2)
- Official tournament streams (Twitch/YouTube) — free [solid]

## Maintenance
Rights move between seasons. When a verified event contradicts this map, or a
rights change is announced (X/broadcaster accounts are usually first — see the
`x-sources` skill), update the relevant line **in the same commit** and
date-stamp the change. Never leave a known-wrong entry standing.
