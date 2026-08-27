# Sportivista — iOS app

SwiftUI app **Sportivista** + WidgetKit extension
**SportivistaWidget**, generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml`. The app is a
pure consumer of the same static JSON the web dashboard reads (published to GitHub
Pages) — no separate backend, per the zero-infrastructure constraint in `CLAUDE.md`.
It syncs that data into an on-disk cache, compiles a personalised, day-grouped
agenda + home-screen widget, sends calm local reminders, and hosts an
on-device (Foundation Models) assistant that edits *what you follow* and answers
questions over your own local data.

This README is a **subsystem map** — one section per directory in `Sportivista/`, plus
targets/signing and testing. The per-work-package build narrative lives in git/PR
history, not here.

## Generate, open, build

```sh
brew install xcodegen        # once, if not already installed
cd ios
xcodegen generate            # writes Sportivista.xcodeproj (gitignored — never check it in)
open Sportivista.xcodeproj         # or build/test from the CLI:

xcodebuild -scheme Sportivista -destination 'generic/platform=iOS Simulator' build
xcodebuild -scheme SportivistaWidgetExtension -destination 'generic/platform=iOS Simulator' build
xcodebuild test -project Sportivista.xcodeproj -scheme Sportivista \
  -destination 'platform=iOS Simulator,name=<a device from `xcrun simctl list devices available`>'
```

`Sportivista.xcodeproj` (and `xcuserdata/`, `DerivedData/`) are gitignored via a
directory-scoped `ios/.gitignore` — **regenerate from `project.yml` after every
pull**. `xcodegen generate` also rewrites the three `Info.plist` files from the
`info.properties` blocks in `project.yml` (XcodeGen owns them — edit the
properties, never the generated plists).

## Targets, schemes & signing

`project.yml` (checked-in source of truth) declares five targets + four schemes:

| Target | Type | Scheme | Notes |
|---|---|---|---|
| `Sportivista` | application | `Sportivista` | The Simulator app; embeds `SportivistaWidgetExtension`. Sources: the whole `Sportivista/` tree. |
| `SportivistaWidgetExtension` | app-extension | `SportivistaWidgetExtension` | The widget. Compiles a deliberate subset of `Sportivista/` (see [Widget](#widget)). |
| `SportivistaTests` | unit-test bundle | (runs under `Sportivista`) | Hostless logic bundle — see [Testing](#testing). |
| `SportivistaUITests` | ui-test bundle | `SportivistaUITests` | XCUITest that drives the app in the Simulator — see [UI-flyter](#ui-flyter-wp-70--xcuitest-i-simulator). |
| `SportivistaDeviceDev` | application | `SportivistaDeviceDev` | Device/TestFlight build (paid team since WP-17) — see below. |

- **Bundle ids:** `app.sportivista.ios` (app + `SportivistaDeviceDev`), `.widget`, `.tests`, `.uitests`.
  **Deployment target:** iOS 26.0 everywhere; Swift 6.0.
- **Deep-link scheme:** `sportivista://` (`CFBundleURLTypes`) — the custom scheme the
  profile-share QR / link opens, so no Associated-Domains entitlement (and no paid
  account) is needed.

### Signing

The base config uses `CODE_SIGN_STYLE: Automatic` with
`CODE_SIGNING_ALLOWED/REQUIRED: NO` and no `DEVELOPMENT_TEAM` — the Simulator app
builds and runs **with no signing at all**. The device target and the widget carry
target-level Automatic signing against team `9LVCB72DT8` (**paid** since WP-17 —
the Individual enrollment converted the old free personal team in place, same ID),
with `CODE_SIGN_ENTITLEMENTS` pointing at the full entitlements
(`group.app.sportivista` App Group + CloudKit — `Sportivista.entitlements` /
`SportivistaWidget.entitlements`).

### `SportivistaDeviceDev` — the device/TestFlight build

A device-flavoured build of the same app sources (so it includes the on-device
Foundation Models code, which only *runs* on real hardware). Since WP-17 it signs
with the full paid-team entitlements, **embeds the widget**, and compiles with
`-D SPORTIVISTA_CLOUDKIT` (flipping `ProfileSyncBackendFactory` to CloudKit profile
sync). It reuses bundle id `app.sportivista.ios` with a distinct `PRODUCT_NAME` so
its product never collides with `Sportivista.app` (home-screen name stays
"Sportivista").

```sh
cd ios && xcodegen generate
xcodebuild -project Sportivista.xcodeproj -scheme SportivistaDeviceDev \
  -destination 'generic/platform=iOS' -derivedDataPath build/DerivedData \
  -allowProvisioningUpdates build
APP=build/DerivedData/Build/Products/Debug-iphoneos/SportivistaDeviceDev.app
xcrun devicectl device install app --device <CoreDevice-UUID> "$APP"
xcrun devicectl device process launch --device <CoreDevice-UUID> app.sportivista.ios
```

**TestFlight** ships through the repo's release lane —
`gh workflow run ios-release.yml` archives, cloud-signs (Admin ASC API key from
repo secrets), uploads with the next App-Store-Connect-assigned build number, and
records the upload in `scripts/config/testflight.json` (which `app-version.json`
folds in, so TestFlight installs judge "SISTE" against the last *upload*, not the
last commit). The manual fallback ritual + the versioning traps live in
`.claude/skills/ios-dev`.

## Directory layout

```
ios/
├── project.yml                    XcodeGen spec — source of truth, checked in
├── .gitignore                     scoped to ios/: *.xcodeproj, xcuserdata, DerivedData
├── Sportivista/                         app target
│   ├── SportivistaApp.swift             @main entry point
│   ├── ContentView.swift          NavigationStack host: header + gearshape→Deg + live line + AgendaView + command line + sync/notify hook
│   ├── DesignTokens.swift         shared baseline tokens: semantic system colours + amber + Dynamic Type font API (also used by widget + tests)
│   ├── ThemeOverride.swift        manual system/dark/light override enum (pure)
│   ├── Interaction.swift          shared ≥44pt tap-target helpers
│   ├── LaunchTrace.swift          DEBUG-only launch-phase timing — the «Henter data …» cold-start measuring stick (no-op in Release)
│   ├── Models/                    Codable models mirroring the data contract
│   ├── Sync/                      manifest-diff sync + cache + background refresh
│   ├── Live/                      WP-172 foreground live scores (ESPN scoreboard, gated)
│   ├── Feed/                      FeedCompiler + agenda formatting + lens renderer
│   ├── Agenda/                    the day-grouped agenda UI + detail sheets
│   ├── News/                      the Nyheter board: client lens + pure four-section builder + off-main model + thin view
│   ├── Widget/                    the widget's pure timeline logic
│   ├── Notifications/             local push reminders for must-watch events
│   ├── Assistant/                 on-device (Foundation Models) assistant
│   ├── Profile/                   local interest profile: sync, share, reset, effective-merge
│   ├── Memory/                    personal memory (facts/episodic/behaviour) + spoiler shield
│   ├── Onboarding/                first-run gate + starter packs + flow
│   ├── Perf/                      os_signpost helper + local MetricKit log/subscriber
│   ├── Eval/                      FM-eval harness: corpus/runner/scorer (shared CI+device) + DEBUG EvalView
│   ├── Demo/                      DEBUG-only screenshot-harness seeds (app-only)
│   ├── Info.plist                 generated by xcodegen
│   ├── Sportivista.entitlements         App Group (group.app.sportivista)
│   └── Assets.xcassets/
├── SportivistaWidget/                   WidgetKit extension: SportivistaWidgetBundle + SportivistaWidget
│   │                              (TimelineProvider), Info.plist, entitlements (App Group)
├── SportivistaDeviceDev/                device/TestFlight build: Info.plist (entitlements shared with the app since WP-17)
└── SportivistaTests/                    hostless logic-test bundle (*Tests.swift + doubles +
                                   Fixtures/ frozen snapshots) — see Testing
```

## Design tokens

`Sportivista/DesignTokens.swift` — the Apple-native baseline token layer: semantic iOS
system colours + a single amber accent, kept in lock-step with the `DESIGN.md`
token table. (The web dashboard now follows the same Apple-native baseline — the
Tekst-TV exception is closed, see `DESIGN.md` § Cross-surface.)

| Token | Dark (default) | Light |
|---|---|---|
| Background | `#000000` | `#F2F2F7` |
| Label (text) | `#FFFFFF` | `#000000` |
| Accent (amber) | `#FFB000` | `#9A6800` |

Plus the semantic tokens `cell` / `secondaryLabel` / `separator` / `live` /
`destructive` (the neutrals map to iOS system colours; `accent` / `live` /
`destructive` are dynamic `Color`s following the system colour scheme). Typography
goes through the Dynamic Type API — `Font.sportivista(_:weight:)` binds each text role to
a SwiftUI text style (San Francisco) so text scales with the user's setting, and
`Font.sportivistaTabular(...)` adds monospaced digits for the time column; a fixed
`.system(size:)` point is barred (HIG gate `tests/ios-dynamic-type-gate.test.js`).

**`ThemeOverride.swift`** — a `String`-backed enum (`system`/`dark`/`light`) with a
tap-cycle, a `colorScheme: ColorScheme?` fed to `.preferredColorScheme`, a
quantized header glyph (`◐`/`●`/`○`) and an `@AppStorage` key. Applied once at the
`ContentView` window root, so it cascades to every `.sheet` and survives a fresh
launch. The widget does **not** compile it (a WidgetKit extension follows the OS's
own per-surface appearance). **`Interaction.swift`** gives every interactive glyph
a HIG ≥44×44pt hit area (`.sportivistaTapTarget()` / `SportivistaActionButtonStyle`; owner
finding: "veldig små knapper").
Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`, (fjernet 20.07 — se PR-historikk).

## Models

`Sportivista/Models/` is the Swift mirror of the data contract — it turns raw JSON into
typed values, nothing more (no networking, no feed logic).

- `SportivistaJSON.swift` — the one shared `JSONDecoder`; its only job beyond the
  default is dates: real `events.json` carries ISO 8601 both with fractional
  seconds (JS `toISOString()`) and without (hand-written agent output), so the
  decoder tries the fractional formatter first and falls back to whole-second.
- `Event.swift` — mirrors `events.schema.json` field-for-field (with
  `StreamingChannel`/`Participant`/`NorwegianPlayer`/`FeaturedGroup`);
  `Entity.swift` (`entities.json`), `Manifest.swift` (`manifest.json`),
  `TrackedConfig.swift` (`tracked.json`).

**Forward compatibility:** unknown JSON keys are ignored automatically. Where the
pipeline always writes a field the schema doesn't strictly require,
`Event`/`Entity`/`TrackedConfig.Entry` use hand-written `init(from:)` with
`decodeIfPresent(...) ?? default`. Enum-like string fields (`confidence`, `status`,
`source`, entity `type`, …) stay plain `String`, not closed Swift enums, so a new
server value decodes gracefully on an older client rather than crashing the event.

### «Lenkeløftet» (urlKind)

`StreamingChannel.urlKind` (WP-246, mirrored on iOS by WP-247) says what the URL
actually points at: `"deep"` = the broadcast itself, `"landing"` = the service's
front page or a generic section. `StreamingChannel.linkURL` is the **single choke
point** deciding whether a channel may look like a link — the Swift twin of
`docs/js/dashboard.js`'s `streamLink`, read by the detail sheet; the agenda row and
the widget render the channel through `AgendaFormat.channelLabel`, which is a NAME
and never a link by construction.

The channel name is always shown (it is true and useful); only a `deep`, http(s)
URL is presented as a link. Two deliberate strictnesses:

- **A missing `urlKind` is treated as `landing`** — stricter than web, which keeps
  the old behaviour for unstamped entries. iOS is the surface with a persistent
  on-device cache, so "no `urlKind`" means "cached before the pipeline stamped it",
  not "this URL is fine"; the honest degradation is the name without the link.
- **A `tentative` (shared-rights «NRK / TV 2») entry links only to a tvkampen match
  guide** — linking one of the two broadcasters would mislead whenever it turns out
  to be the other.

The detail sheet explains a withheld link with a quiet «(ingen direkte lenke)» —
no warning icon (DESIGN.md § Grunnlov 3, § Stemme). Pinned by
`StreamingLinkContractTests`.

### Model fixtures

`SportivistaTests/Fixtures/` holds **checked-in, deliberately-frozen snapshots** of the
real `events` / `entities` / `manifest` / `tracked` / `interests` JSON (each
verified byte-identical to the live site via sha256 when added). They are the
Swift side's fasit for the contract — update them by deliberately re-copying the
live files and committing the diff, **never** by an automated job.

## Sync

`Sportivista/Sync/` is the app's networking to **our own** host (sportivista.com) —
everything else reads from the on-disk cache it maintains. The ONE other network
read the app makes is `Sportivista/Live/` (WP-172): a direct ESPN scoreboard fetch, only
while a followed match is live and only in the foreground — see [Live](#live). **The
manifest-diff flow** (`SyncClient.sync() async -> SyncResult`):

1. **GET `manifest.json`** from `baseURL` (default `https://sportivista.com/data/`,
   injectable) with `If-None-Match` set to the persisted ETag.
2. **304 → `.upToDate`**, no further requests — the common case after the first sync.
3. **200 → decode** with `Manifest`, diff its per-file `sha256` against
   `SyncState.appliedFiles` (a **reconciled** snapshot of what the cache has actually
   applied, *not* a copy of the last server manifest), and fetch only files that
   changed **and** are in `filesOfInterest` (`events`/`entities`/`tracked`/
   `app-version`/`news`/`featured`/`recent-results`/`standings`.json — the ~22 other
   manifest entries are irrelevant here; `standings.json` joined in WP-171 for the
   detail sheet's TABELL surface).
4. Each fetched file is **verified against the manifest's declared sha256**
   (`Checksum.swift`, CryptoKit) before it is trusted, then written **atomically**.
   A mismatch or network hiccup silently discards that one file, leaves the old copy
   alone, and carries its **old** manifest entry forward — so a flaky file is retried
   next sync, never wrongly "already applied" nor failing the whole sync.
5. Persists the new ETag + reconciled snapshot + `lastSync`, and returns
   `.upToDate`, `.changedFiles([String])` (exactly the files written this run), or
   `.failure(SyncError)` (the manifest fetch failed — cache + state untouched).

**`CacheStore`** prefers the `group.app.sportivista` App Group container, falling back to
Application Support when it's unavailable (a pre-WP-17 free-team build — kept as a
safety net). Since the
Simulator resolves the container even for an unsigned build, `CacheStoreTests`
proves the fallback via a `FileManager` subclass returning `nil`. **`DataStore`** is
the read-only facade: `loadEvents()`/`loadEntities()`/`loadTracked()`/
`loadInterests()` decode from the cache and **never throw** (a missing/corrupt file
is an empty list or `nil`); `DataStore.lastSync` is the "have we ever synced" flag
(`nil` = never) the UI and `NotificationPlanner` read for staleness.

**Background refresh** is split pure/impure:
`BackgroundRefreshScheduling.earliestBeginDate(...)` is a *pure*, unit-tested
function ("when should the next refresh run" — never sooner than the research
agent's 4-hourly cadence); `BackgroundRefreshScheduler` is the thin
`BGTaskScheduler` wrapper (`register(...)` from `SportivistaApp.init()`,
`scheduleNextRefresh(...)`). Requires `app.sportivista.refresh` in
`BGTaskSchedulerPermittedIdentifiers` and `UIBackgroundModes: [fetch]`
(`project.yml`).

## Live

`Sportivista/Live/` (WP-172) is the app's **only third-party network read** — a direct
`URLSession` GET of ESPN's public soccer scoreboard, enriching a followed match's
agenda row with the running score + match clock. It exists because live scores are on
`site.api.espn.com`, not our static host, and only ESPN has them minute-by-minute.
**The privacy boundary is exact and stated honestly** (root README + `docs/personvern.html`):
the fetch happens **only while the app is in the FOREGROUND** and **only when a
followed/board match is in its match window right now** — never in the background,
never otherwise. No BGTask, no push, no device token.

- **`LiveLeague`** — the six ESPN leagues polled, the Swift twin of
  `SS_FOOTBALL_LEAGUES` (docs/js/shared-constants.js, pinned to sports-config by
  `tests/live-leagues.test.js`): the covered football leagues minus esp.copa_del_rey.
  nor.1/nor.2 are here, so an Eliteserien/OBOS (Lyn) match finally gets a live score —
  the old web gate hardcoded only eng.1/esp.1/fifa.world, and iOS polled nothing at all.
  `forEvent` maps a board event's `tournament` back to its league code.
- **`LiveScorePlan`** — the PURE surface-pressure gate: which scoreboards to poll THIS
  minute = the league of any football match whose kickoff sits in `(now - 3h, now]`
  (live + a short post-match tail). The common single-live-match case fetches ONE
  scoreboard; nothing on ⇒ zero requests. Twin of `footballLeaguesToPoll` (live.js).
- **`ESPNScoreboard`** — pure parse (scoreboard JSON → in/post matches) + match (by
  home AND away team name, the `ssTeamMatch` twin) → `[event id: LiveScore]`.
- **`LiveScore` / `LiveScoreStore`** — the value (running score + clock + state) and
  the `@Observable` holding it by event id. The agenda row reads it back in its body,
  so a score update repaints ONLY that row's meta line — never a feed recompile, never
  the golden vectors. A **spoiler-shielded** row (`SpoilerShield`, WP-171/176) never
  shows a score (`spoilerSafe`), exactly like the detail sheet's RESULTAT.
- **`LiveScorePoller`** — the impure service: a 60 s foreground timer + an in-flight
  guard, network behind the injected `LiveScoreTransport` (tests drive a recording
  mock — no real request in any test). `pollOnce` is the static, transport-injected
  chain; `start()`/`stop()` are wired to scenePhase in `ContentView` (foreground only).

## Feed

`Sportivista/Feed/` is the Swift port of the personalisation semantics — which events
reach the feed, which get the bell/accent, how the window behaves, how stage races
collapse. Its one hard acceptance criterion: it reproduces **every** golden
feed-vector (`tests/fixtures/feed-vectors/`, referenced directly from `project.yml`,
never copied) **bit-for-bit**, including the four pinned server/client divergences
(`DIVERGENCES.md`) — reproduced, never "fixed".

**There is no single "special?" predicate — there are five,** each ported faithful
to the side that owns it (server and client intentionally differ):

| Predicate | Question | Ported from |
|---|---|---|
| `isRelevant` | In the feed at all? | server `build-events.js` (+ 14-day cutoff on `endTime ?? time`; entity match is **not** sport-scoped) |
| `mustWatch` | Reminder bell 🔔? | server `helpers.js` `mustWatchEntity` (**sport-scoped**, keyed only off `interests.json` notify-entities, word-boundary + diacritic-folded) |
| `isMustSee` | Quiet visual accent? | client `dashboard.js` `isMustSee` (naive lowercase-substring match — the pinned `"Brooklyn".contains("lyn")` behaviour is kept) |
| `isEventInWindow` | Overlaps the agenda window? | server & client, byte-identical (`s < end && e >= start`) |
| `collapseSeries` | How do stage races fold? | client `dashboard.js` (titles matching `/\betappe\b|\bstage\s*\d/i`; **4+** fold into one row) |

- `TextMatch.swift` — the server matchers as pure functions: `normalize` (NFD →
  strip `\p{M}` → lowercase, so "Barça" ≡ "Barca") and `containsName` (word-boundary,
  accent-insensitive). The accent's *naive* substring match deliberately does **not**
  route through it (its lack of folding is pinned).
- `FeedEvent.swift` / `Interests.swift` — the small pure input the predicates read
  (`time` is `Date?` so the vectors' pinned `"time": null` decodes; `init(from:)`
  bridges the real cached `[Event]`) + the mirror of the `interests.json` fields.
- `FeedCompiler.swift` — the five predicates + `compile(events:interests:now:)`
  (relevance filter → bell/accent → series collapse → Europe/Oslo day grouping) +
  `whyShown`. `AgendaFormat.swift` / `EventBridge.swift` (formatting + the
  `[Event] → [FeedEvent]` bridge) live in `Feed/` too, so the widget picks them up.
- `LensRenderer.swift` — "rad = event × deltakelse × linse": with a
  `.throughNorwegians` / `.throughAthletes` lens active a golf tournament renders
  as "Reitan teer av 14:32" rather than "The Open" — a pure rendering layer, the
  predicates and golden vectors untouched. HVILKEN linse som gjelder avgjøres i
  `AgendaViewModel.applicableLensMode`: først en EKSPLISITT linse på en fulgt
  regel, deretter (WP-249) en **avledet utøver-linse** — å følge en UTØVER betyr
  «vis meg når HAN spiller», så en fulgt utøver som har sin EGEN starttid i
  eventet gir athlete-linsen uten at regelen har lagret noen. Tre vakter holder
  avledningen smal: kun utøver-entiteter (indeksen er fasit; kjenner den ikke
  id-en — usynket indeks, eller en WP-164 soft-follow, hvis `soft-<slug>`-id
  ikke finnes i noen indeks — gjelder eventets egen `norwegianPlayers`, sjekket
  både på id OG NAVN, siden en soft-regel bare kan finnes på navn), kun når
  dataene faktisk kjenner tiden hans (ellers står den vanlige raden — aldri en
  oppdiktet klokke), og aldri over en eksplisitt linse.
  **Tidskolonnen og dagen bestemmes ÉTT sted** (`AgendaViewModel.place`, som
  returnerer `clock` sammen med dag/sortering): en utslagstid som ikke fikk
  re-hjemle raden til dagen den vises på, får heller ikke skrive klokka —
  raden viser eventets eget vindu i stedet. Samme regel som web
  (`dashboard.js golfTeeHint`). `keptLensRows` holder ro-kontrakten: flere
  KLOKKEDE rader per dag er greit (hver svarer på sitt eget «når»), men
  vindus-raden vikes når en klokket rad står samme dag, og det står aldri mer
  enn én vindus-rad per event per dag.
  Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`.

## Agenda

`Sportivista/Agenda/` is the real, day-grouped agenda — a pure consumer of Sync's
cache and Feed's `FeedCompiler`. **`AgendaViewModel`** is `@MainActor @Observable`,
but its logic is a `nonisolated static` pure function
`buildSections(events:interests:now:) -> [AgendaSection]` (the codebase's usual
pure-core/thin-wrapper split). The chain is `DataStore → EventBridge →
FeedCompiler.compile() → AgendaFormat → day sections`. `AgendaFormat` produces the
row text — `timeLabel` ("HH:mm", or a compact "16.–19. juli" WINDOW for a multi-day
event, never a misleading bare start time), `title`, `channelLabel` (first platform
or an honest "–"), `dayLabel` ("I DAG"/"I MORGEN"/"TIRSDAG 14. JULI") and
`seriesSummary`. `buildSections` drops every day before today (I DAG always first,
no passed day; `FeedCompiler` re-homes a still-running multi-day event onto today);
`liveRows` computes the events ongoing at `now` for the live line.

**`AgendaView`** is a `List` of day `Section`s. Must-see gets the gentlest
emphasis — a 6pt amber dot, never a card; must-watch shows no inline glyph (the
varsel state is in the detail sheet); a quiet mono `ⓘ` trails only on
`ai-research` rows. Pull-to-refresh re-syncs + recompiles but does **not** run the
notification reconcile (see [Notifications](#notifications)). Tapping a row opens
`EventDetailSheet` (venue, summary, streaming — every channel NAMED, but only a
URL that points at the broadcast itself rendered as a real `Link`; see
[«Lenkeløftet»](#lenkeløftet-urlkind) — the AI-provenance
block only on `ai-research` rows, a quiet varsel read-out, the spoiler-masked
`RESULTAT`, the **`TABELL`** section (WP-171 — `EventStandingsSection`: the league
table / golf leaderboard / F1 championship from `standings.json`, built by the pure
`StandingsTable`, shown only when it is genuinely THIS event's table and masked
behind the same spoiler reveal), and the assistant [context actions](#assistant))
or `SeriesDetailSheet`
(the expanded stage race: every Norwegian rider de-duplicated, the next stage's
summary, every stage as its own line).

`ContentView` wraps `AgendaView` in a `NavigationStack` (WP-83): a header with the
`SPORTIVISTA` wordmark (label + amber colon — Kolonet) + date and a `gearshape` toolbar button that pushes the
**Deg** settings screen (`Profile/DegView.swift`); a quiet `▌ LIVE …` line (invisible
when nothing is on); and the always-present command line at the bottom. The
assistant's result (a diff or an answer) presents as a native `.sheet`
(`.presentationDetents`) over the agenda — no longer a bespoke fade-overlay. The v2
header glyphs (`P100`, the ticking clock, `»_`, the theme glyph) were removed; theme
now lives in Deg. Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`.

## News

`Sportivista/News/` is the **Nyheter board** — the other half of the root segmented
control («Uka | Nyheter», WP-104/106). It is ENDELIG: exactly four sections, no
unread counters, no engagement mechanics (spec § Nyheter-v0, DESIGN § Nyheter).

- `NewsBoard.swift` — the **pure builder**. A function of plain cached values (news,
  featured, results, events, entities, profile, spoiler shield, now) with no I/O and
  no clock read, so the whole board is unit-testable directly (`NewsBoardTests` /
  `NewsLensTests`) and the view is a thin renderer over it. Four sections: **I DIN
  VERDEN I DAG** (the editorial headline from `featured.json`, one line), **NYTT**
  (lens-matched `news.json` pointers, newest first, capped 20), **RESULTAT** (recent
  results for what you follow across EVERY sport in `recent-results.json` — football
  with goal scorers + minute, a finished golf tournament's leaderboard, the F1
  finishing order, tennis — projected onto ONE row DNA, ordered by a per-sport round
  robin (`interleaveBySport`) so every sport gets an answer inside the `resultCap` of
  5, the rest behind «Vis alle»; each row stamped whether the spoiler shield must
  mask its outcome AND its detail lines), **FREMOVER** (followed events beyond the 7-day near horizon —
  forvarsler; capped 8, via `FeedCompiler.isEventInWindow`, never a manual `time >= x`
  filter so multi-day events survive).
- `NewsLens.swift` — the **client-side lens** (the two-layer architecture: the server
  publishes catalog-wide, the profile is on-device). A pointer shows when it is ABOUT
  something followed, decided two ways: an `entityIds` ∩ followed-entities hit, or a
  followed WHOLE-sport rule (a `sport`/`category`-type entity). It reuses the profile's
  own rule semantics + `SportVocabulary` (the same keyword→sport / category→sports maps
  the assistant grounds against) — it invents no new fuzzy matching. Athlete/team/
  tournament rules stay entity-scoped (following Hovland admits golf headlines that
  name Hovland, not every golf headline). `matchesEvent` applies the same lens to a
  full `Event` for FREMOVER, mirroring `AgendaViewModel.ruleMatches`.
- `NewsModel.swift` — the **living, ContentView-owned model** (WP-107). It survives
  root-segment switches, so a switch back to Nyheter renders the last board instantly
  (never a blank/hitch), and the heavy build (five cache reads + decodes + `EntityIndex`
  build + `NewsBoard.build`) runs OFF the main actor — the same coalescing shape as
  `AgendaViewModel` (one compute at a time, "siste vinner"), guarded by the shared
  `MainThreadGuard`, and only when the board is actually stale (a profile change or a
  completed sync — a plain tab switch is a no-op). This removed the "merkbar lag hver
  gang man bytter til Nyheter" the owner saw on build 6.
- `NewsView.swift` — the **thin renderer** over `news.board`: an `.insetGrouped` `List`
  with a «Det du følger ›» link to WP-105's `FollowedListView`, a provenance ⓘ on the
  brief, NYTT rows that tap OUT to the source (`Link`, never inlining article text —
  DSM art. 15), and the spoiler-shielded RESULTAT reveal. No spinner ever (DESIGN
  § Bevegelse); amber is the one accent.

## Widget

`Sportivista/Widget/WidgetTimelineBuilder.swift` is a **pure function** (no
`import WidgetKit` — deliberate): given `[Event]` + `Interests` + "now" it returns
one `Entry` per full remaining Europe/Oslo hour, each "the next must-see event as of
that moment, else the nearest relevant upcoming one, else an honest
'Ingenting i dag'". `SportivistaWidget.swift` (the `TimelineProvider`) is the thin wrapper
reading `DataStore`. Families: `systemSmall` + `systemMedium` on the home screen
(same tokens as the app) and, since **WP-176**, `accessoryRectangular` +
`accessoryInline` on the lock screen / StandBy — the same one highlight in the
shapes those families allow (`SportivistaWidgetBackground` keeps the accessory
families on the system's own vibrant material instead of our page background).

**WP-176 — «siste resultat» (medium only):** the second line under the highlight is
**pre-rendered by the app** (`Widget/WidgetResultSnapshot.swift`, written to the App
Group cache as `widget-result.json` by `Sync/WidgetResultSnapshotWriter.swift`) and
merely rendered here. The reason is structural: the widget target compiles no
`Profile/` and no `Memory/`, so it **cannot see the user's spoiler policy** — a score
it rendered on its own could be exactly the spoiler WP-30/WP-171 shield. The app
decides what is safe (`News/ResultDigest.swift`), the widget renders a string. An
absent file = no result line, never a stale or unshielded one. By
construction there is **no network code in the widget target**: `project.yml` gives
it `Models`/`Feed`/`DesignTokens`/`WidgetTimelineBuilder` and only the **read** half
of `Sync` — never `SyncClient`/`Checksum` nor the app-only subsystems.

## Notifications

`Sportivista/Notifications/` schedules local push reminders for must-watch events —
**a wrong time in a push is the most expensive trust violation the app can commit**,
so reminders are few, correct, and calm. **`NotificationPlanner.plan(...)`** is the
pure core: two event snapshots in, a diff of `[NotificationOperation]` out (no
`UNUserNotificationCenter`, no async, no I/O). Keyed **exclusively** on the WP-02
stable event id: same id + a different
computed reminder = `.reschedule`; an id that no longer resolves to a plannable
reminder = `.cancel`; a never-seen plannable id = `.scheduleNew`; **unchanged**
content = **no operation** (reconciling never re-touches a correct reminder).

- **Who:** only events `FeedCompiler.mustWatch` rings the bell for. Fire date =
  `event.time` minus `interests.notify.leadMinutes` (default 30 — the **same** lead
  `scripts/build-ics.js`'s VALARM uses, so calendar + push never disagree), clamped
  to "now" if already passed.
- **Quality gates** (each a hard `nil`): (a) `confidence == "low"` **and**
  `verificationStatus != "confirmed"` is never planned; (b) if `lastSync` is >6h old
  (or `nil`), the body hedges ("Etter planen: …") instead of stating the time as
  settled fact; (c) `event.time <= now` is never planned.
- **Text** (Norwegian, calm): body `"Kl. HH:mm · kanal"` (Europe/Oslo), honest
  `"Kanal ukjent"` when streaming is empty — never invented, no emoji.

**`NotificationScheduling`** wraps `UNUserNotificationCenter` behind a protocol
(tests substitute `RecordingNotificationScheduler`); permission is requested
**lazily** in `reconcile(...)`, only when the plan wants to schedule — never at app
start. The sync hook `ContentView.refresh()` snapshots `loadEvents()` *before*
`sync()`, then calls `reconcile(...)` with the before/after snapshots — **only** on
the app-start `.task`, not on pull-to-refresh (WP-121 added `SyncFreshness`, which
covers the background + pull paths).

### Fulltidsvarsel (WP-176)

The second notification kind: **one** calm local notification when a contest a user
follows is **over** («Fulltid: Lyn – Sogndal» / «2–1 · OBOS-ligaen»). Planned by the
pure `News/ResultDigest.swift` from two `recent-results.json` snapshots taken around
a sync, executed by `SyncFreshness.deliverResults(...)`.

- **Opt-in per entity, off by default** (`Notifications/ResultAlertPreference.swift`
  — a per-DEVICE preference like `NotificationLeadPreference`, never part of the
  synced profile). The switch lives on that follow's own page (`FollowDetailView`
  § VARSEL).
- **Spoilervernet vinner.** A shielded entity/sport still gets its alert (the user
  asked for it) but the body says only «Resultatet er klart. Åpne når du vil se
  det.» — the score never appears on the lock screen uninvited.
- **FÅ:** one per finished contest (never per goal), a hard cap per sync
  (`ResultDigest.maxAlerts`), a 12h recency window, a delivered ledger, and **no
  alerts at all on a seeding sync** (an empty "before" snapshot ⇒ a fresh install
  never opens with a burst).
- **Honest timing:** discovery rides `BGAppRefreshTask`, which iOS grants on its own
  terms (~4h floor). This is «når iOS lar oss», not a guarantee — and it is stated
  in the UI footer and in the root README's «what we deliberately don't do» section.
  There is **no APNs, no server, no device-token register** in this app, by design.

## Assistant

`Sportivista/Assistant/` is a conversational way to edit *what the app follows* and ask
questions over your own local data. The principle is **"assistenten ER
grensesnittet"** — a fixed, quiet command line pinned to the bottom of the agenda
(`CommandLineView`: `»_` sigil · text field · blinking cursor), a helper that follows
you rather than a room behind a button. WP-82 gave it three discoverability states: a
concrete example placeholder at rest, context suggestions on focus, and live entity
grounding while typing. Its result presents as a native `.sheet` (`AssistantPanel`,
slimmed by WP-83 to conversation/result only); the permanent "rooms" (follows,
memory, share, reset, theme, version) moved to the **Deg** settings screen
(`Profile/DegView.swift`).

**The model is behind the `InterestAssistant` protocol** — the vendor surface is one file:

- **`FoundationModelsInterestAssistant`** — the real one (Apple Intelligence via
  **FoundationModels**, iOS 26+), the **only** file that `import FoundationModels`:
  it defines the `@Generable` schema + tools (`searchEntities`/`searchEvents`/
  `getProfile`/`saveMemory`) and runs one `LanguageModelSession` (`.unavailable` on
  Simulator/CI).
- **`MockInterestAssistant`** / **`MockAnswerer`** — deterministic Norwegian keyword
  parsers used by every test + previews. **Not** a silent fallback: with Apple
  Intelligence off the app shows an honest "unavailable" banner, never degrading to
  keywords.

**Intent routing:** `interpret(...)` returns an `AssistantTurn` =
`.mutations([ProposedMutation])` (the edit-what-you-follow diff flow) OR
`.answer(AssistantAnswer)`. Questions are answered over **LOCAL data only** — no
cloud: `FeedQuery` reduces the relevance-filtered agenda to a queryable value.

**Entity grounding is the hard rule.** A proposal is applied **only** if its
`entityId` resolves in the WP-05 entity index; `MutationGrounder.ground(...)`
re-checks every id and **rejects** a hallucinated / free-text entity with up to
three "mente du …?" suggestions. `EntityIndex.resolve` (a ranked fuzzy resolver —
diacritic/case-folded, year-suffix-agnostic, alias/initials-aware, edit-distance ≤ 2)
backs it: a confident hit is served straight through, a partial match stays a
**tappable** suggestion that re-grounds the original proposal (intent survives —
never a dead button).

`Lens` (on the mutations + persisted `InterestRule`) gives *how* a follow is seen
a home — `.sportAsSuch` / `.throughNorwegians` / `.throughAthletes([LensAthlete])`.
**Always-explain:** when an utterance produces no confirmable change,
`AssistantExplanation.make(…)` builds an honest `understood` + `reason` note (no
bare "fant ingen endringer"). Every utterance not turned into a mutation becomes
durable, local, private raw material in **`MisunderstoodLog`** — ONE capped JSON
file in Application Support, **no network code**, surfaced as a discreet "DET JEG
IKKE FORSTO (N)" disclosure with a "Del rapport" `ShareLink` over an **anonymised**
export. **Context actions** (`EventDetailSheet`): "Følg <entitet>" (a pre-filled
add through the same grounded flow) and "Hvorfor vises denne?"
(`FeedCompiler.whyShown` — its XCUITest `testEventDetailWhyShown` was fixed in
PR #292, a **test-only** fix: the `EffectiveInterests.merge → FeedCompiler.whyShown`
data flow was verified correct, so no app code changed).

Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`,
driven by a DEBUG-only `SPORTIVISTA_DEMO=…` launch harness (never compiled into release).

## Profile

`Sportivista/Profile/` is the on-device, human-owned interest profile the assistant edits,
plus its sync/share/reset/effective-merge machinery. **Our server never sees this**
— it is device-local, syncing only through the user's own iCloud or a QR bridge (P360).

- **`DegView.swift`** (WP-83) — the **Deg** settings screen, pushed from `ContentView`'s
  `gearshape` toolbar button. A native inset-grouped `List` (SF Symbols leading, value +
  chevron trailing) that re-homes the permanent surfaces the slimmed `AssistantPanel` no
  longer holds: PROFIL (Hva jeg følger, Sett opp på nytt), DATA OM MEG (Hva jeg vet om
  deg → `WhatIKnowView`, Det jeg ikke forsto, Del profil → `ProfileSharePanel`), APP
  (varsel-ledetid, Utseende = the `ThemeOverride` cycle, Nullstill → `ResetService`),
  the version line, and the DEBUG eval/telemetry entries. It reuses the existing views
  rather than reimplementing their logic.

- **`InterestProfile.swift` / `ProfileStore.swift`** — a flat list of
  `InterestRule`s (each with an always-filled Norwegian `reason`, the transparency
  contract `tracked.json` uses server-side; `applying(_:)` is the pure
  upsert/remove diff), persisted as JSON in Application Support (**no** App Group by
  design — profile data stays app-private; the widget never reads it). Assistant +
  `AgendaViewModel` share ONE.
- **`ProfileSyncModel.swift` / `ProfileMerge.swift`** — the mergeable transport
  shape + **the heart of sync**: a pure, deterministic, order-independent CRDT-like
  `merge(local, remote) → (state, push set)`, testable with **no iCloud account**
  (rules/facts/notes/counters merge LWW + tombstone).
- **`CloudKitProfileSync.swift` / `ProfileSyncCoordinator.swift`** — the real
  backend syncs to the **user's own private CloudKit database**, never our server;
  the coordinator does one offline-first round (pull → merge → push only what the
  remote is behind on). `ProfileSyncBackend.swift` is the protocol tests substitute.
- **`ProfileShareCodec.swift` / `ProfileQRCode.swift` / `ProfileSharePanel.swift`**
  — the valuable-NOW half needing **nothing but two phones**: a profile is a
  compressed base64url payload in a QR code + a `sportivista://` link, imported via the
  same merge. Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`.
- **`EffectiveInterests.swift`** — makes "Bekreft → agendaen re-kompileres med det
  samme" real: `merge` folds the local `InterestProfile` into the SYNCED,
  server-owned `Interests` the agenda compiles from, so a confirmed mutation is live
  at once. **WP-200**: the merge also DERIVES `followBroadly` from the profile — a
  `type: "sport"` rule (the starter packs' `sport-biathlon` &c.) follows that sport
  wholesale, every other rule is a precise follow, and an EMPTY profile leaves
  `followBroadly` absent (the unchanged-board guarantee). Together with
  `FeedCompiler.sportScope` — which narrows the norwegian/favorite/importance
  blanket to the sports the profile covers — that is what makes the onboarding
  choice actually shape the agenda; before it, a "Formel 1"-only profile still got
  golf, cycling and biathlon. Frozen cross-platform by feed-vectors 15 & 16 (see
  `tests/fixtures/feed-vectors/DIVERGENCES.md` §8).
  **`ResetService.swift`** — "nullstill profil + re-onboard" (reset without
  reinstalling): one pure function clears local state through the same stores.
  Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`.

## Memory

`Sportivista/Memory/` makes the assistant an editor who **remembers you** between
sessions (Foundation Models is stateless, so "memory" = persisted data + smart
insertion into the session). **Personal context** (how you relate to what you
follow) is kept device-local, apart from server-produced world context — the server
never gathers it. All three layers ride WP-19's `ProfileSyncState`, so memory syncs
through the user's own iCloud / QR bridge for free:

- **Structured** (`MemoryFact`, `MemoryStore`) — per entity/sport `knowledgeLevel`,
  `spoilerPolicy`, `notifyWindow`, `preference`, `note`; editable/deletable ⇒ LWW +
  tombstone.
- **Episodic** (`MemoryDistiller`) — after a conversation an FM distils ONE compact
  `@Generable` note (never a raw transcript), append-only; `MockMemoryDistiller` is
  the CI stand-in. **Behaviour** (`Counter`) — opens/expansions/dismissals per
  entity/sport; pure, no AI, grow-only.

**Retrieval is pure Swift** (no AI): `MemoryDigest.build(...)` selects the
facts/notes relevant to what's in front of the user, ages out expired notes, floats
spoiler policies to the front, caps at ~500 tokens, and is injected into the
`LanguageModelSession` instructions + the `saveMemory` tool. **Spoiler protection**
(`SpoilerShield`, a presentation layer impossible server-side) derives
spoiler-scoped sports/entities from `spoilerPolicy` facts and exposes a per-row
`spoilerSafe` flag — the detail sheet's `RESULTAT` is masked behind a calm "Skjult —
spoilervern på". **"Hva jeg vet om deg"** (`WhatIKnowView`) is the trust surface +
plain-language GDPR answer: everything remembered listed, facts editable, all
deletable, plus **"Glem alt"** (wipes memory, keeps the follow-profile).
Screenshots: i WP-ens PR (bevis-galleriet fjernet 20.07, regel 8; regenerer ved behov: `design/screens/generate.sh`).png`.

## Onboarding

`Sportivista/Onboarding/` is the calm first-run experience (dossier P310: "onboarding er
en samtale, ikke et skjema") — five quiet steps on the Apple-native baseline, no hero
art, no carousel, no emoji. `OnboardingGate.swift` is the pure, FM-free, I/O-free
decision layer ("should we show it / where does it start"); `StarterPacks.swift` is
the quick-picks fallback — Norwegian "startpakker" a first-timer taps to build a
profile **without** Apple Intelligence (each carrying its own entity data, the path
that must give full value on a cold start); `OnboardingView.swift` is the flow.
`SeasonCalendar.swift` (WP-203) is the season-honesty table — the pack row's computed
«Sesongstart i november»-line and the agenda's season-honest empty state both read it,
so «Vintersport» tapped in August explains WHEN the board fills instead of promising
nothing silently. `RitualPriming.swift` (WP-202) is the pure half of the ritual step's
one notification decision (primed copy BEFORE the one-shot system prompt; a grant is
the user's opt-in to the daily-brief ping, a denial writes nothing and points at
Innstillinger).
Screenshots:
(fjernet 20.07 — se PR-historikk).

## Testing

`SportivistaTests/` is a **hostless** unit-test bundle — no `TEST_HOST`, no
`@testable import`; it compiles the real sources it exercises directly into the
bundle (every `Sportivista/` subsystem, plus `DesignTokens`/`ThemeOverride`/`Interaction`),
the same trick `SportivistaWidgetExtension` uses. All tests are **network-free**:
`MockURLProtocol` (via `URLSessionConfiguration.protocolClasses`) intercepts every
request, the Foundation Models tests drive `MockInterestAssistant`/`MockAnswerer`
only, and they reuse the frozen `SportivistaTests/Fixtures/*` snapshots as decode input
and mock-server responses.

There are **61 `*Tests.swift` files** (plus 8 shared doubles/fixtures — 69 `.swift`
in all) and **573 tests**, at least one per subsystem — e.g. `SyncClientTests` (304 /
changed-manifest / offline / corrupt-download), `CacheStoreTests` (App Group fallback),
the `FeedCompilerUnit`/`FeedVector` pair, `AgendaViewModelTests`,
`NotificationPlannerTests`, the `NewsBoard`/`NewsLens`/`NewsModel` trio (WP-106/107),
and the Assistant / Profile / Memory / Onboarding suites (see the `SportivistaTests/`
listing for all). Run them with:

```sh
cd ios && xcodegen generate
xcodebuild test -project Sportivista.xcodeproj -scheme Sportivista \
  -destination 'platform=iOS Simulator,name=<a device from `xcrun simctl list devices available`>'
```

`npm test` (the repo-root JS suite) is unaffected by anything under `ios/`.

### UI-flyter (WP-70) — XCUITest i simulator

`SportivistaUITests/` er et **UI-test-bundle** (`bundle.ui-testing`, `TEST_TARGET_NAME:
Sportivista`) som DRIVER den kjørende appen via `XCUIApplication` — motsatt av det
hostløse `SportivistaTests`. Det ligger i sin **egen scheme** (`SportivistaUITests`) så det
raske unit-runet (`Sportivista`-scheme, kommandoen over) er uendret; `Sportivista`-scheme
kjører fortsatt kun `SportivistaTests`.

Appen kjøres mot et deterministisk harness — miljøvariabelen `SPORTIVISTA_DEMO=uitest`
(en verdi av det eksisterende demo-harnesset) + `SPORTIVISTA_UITEST_STATE`
(`onboarding` | `agenda`). `UITestSeed` (i `Sportivista/Demo/`, `#if DEBUG`) seeder en
fast cache (events/entities/interests + synket klokke), nullstiller onboarding-/
tema-flaggene, og backer assistenten med `MockInterestAssistant` — så ingen nett,
ingen Apple Intelligence, ingen flakiness. Flytene slår opp via **additive
accessibility-identifiers** og seedede fikstur-strenger, og venter kun med
`waitForExistence`/predikat (ingen `sleep`).

Dekker seks hovedflyter (onboarding quick-picks + samtale, følg via kommandolinja
→ diff → Bekreft, N raske starter-pack-toggles uten heng — vokter WP-60-
koalesceringen, event-detalj + «Hvorfor vises denne?», tema-toggle, nullstill-
flyten) pluss en `XCTApplicationLaunchMetric` kaldstart-baseline
(`LaunchMetricsUITests`). Kjør hele suiten:

```sh
cd ios && xcodegen generate
xcodebuild test -project Sportivista.xcodeproj -scheme SportivistaUITests \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

CI-kravet er kun at targeten **bygger** (den bygges av `SportivistaUITests`-scheme);
flytene kjøres lokalt / på PR-agentens Mac. NB: launch-metrikk-**baselinen** lagres
i `.xcodeproj` (xcbaselines), som genereres av xcodegen og bevisst IKKE sjekkes
inn (`ios/.gitignore`) — det innsjekkede artefaktet er testen selv; det målte
tallet (~0,97 s på iPhone 17-simulatoren) rapporteres i PR-en. Under tung last
(flere parallelle `xcodebuild`) kan simulatoren gi forbigående «Busy»/«server
died» ved oppstart — kjør på nytt før du konkluderer med reell feil.

### FM-eval harness (WP-69) — measuring real assistant quality

Apple Intelligence can't run in CI, so assistant quality is measured two ways
against **one versioned corpus** (`SportivistaTests/Fixtures/eval-corpus.json`, ≥20
cases: WP-16 canon, the owner's multi-clause class, winter sport, feed
questions). The corpus scores **structure, never prose**: an entity id-SET for
mutations; a row/claim rubric for answers (must-reference-rows, referenced
sport, must-contain-any, forbidden-claims, no phantom rows). Cases flagged
`knownGap` are targets for a named future WP (WP-64 winter entities, WP-65 bulk
capture), not failures.

- **CI (mock).** `EvalCorpusTests` runs the SAME corpus through
  `MockInterestAssistant` and asserts every deterministic case; `knownGap` cases
  are skipped with a printed marker. The pure `EvalScorer`/`EvalRunner`/`EvalReport`
  (in `Sportivista/Eval/`) are shared with the device path, so the two can't drift.
- **On device (real FM).** A **DEBUG-only** eval screen (`Sportivista/Eval/EvalView.swift`)
  is reached from the assistant ark's foot ("EVAL (DEBUG)", next to "Det jeg ikke
  forsto"). It runs the corpus through the real `FoundationModelsInterestAssistant`
  on a physical iPhone (`SportivistaDeviceDev` scheme — the corpus is bundled as an app
  resource), shows a **pass-rate per category**, and exports an **anonymised JSON
  report** via the share sheet (same privacy posture as the MisunderstoodLog
  export — never any network, no device id). A second button exports the local
  "forsto ikke"-log as **corpus candidates** (utterance + note) for the human to
  curate — an export, never an auto-incorporation. There is **no new target** and
  only a minimal `project.yml` change (the corpus as a resource + `Sportivista/Eval` in
  the test sources).

**Report format** — the shared JSON (`EvalReport`): `corpusVersion`,
`generatedAt`, `assistant` (`"mock"`/`"foundation-models"`), `available`,
`totals` (`total` / `passed` / `evaluated` / `knownGap` / `knownGapPassed`),
`categories[]` (per-category `total` / `evaluated` / `passed` / `knownGap` /
`knownGapPassed`), and `cases[]` (each with `caseId`, `category`, `utterance`,
`kind`, `knownGap`, `knownGapRef`, and its `checks[]` of `{label, passed,
detail}`). `evaluated` excludes `knownGap` cases; `knownGapPassed` counts gaps
that *unexpectedly* passed (a gap closed — promote it out of `knownGap`).

**Running a real eval (the owner's one manual step):** build & run the
`SportivistaDeviceDev` scheme on a physical iPhone with Apple Intelligence on → open
the assistant (`»_`) → its foot → **EVAL (DEBUG)** → **KJØR EVAL** → **DEL
RAPPORT** and share the JSON. Each assistant WP (WP-65/66/68) adds its cases to
the corpus in the same PR, so the pass-rate is the regression signal that
replaces manual exploratory testing.

**Running the real eval from the CLI (an AI-enabled Mac).** The same corpus runs
through the real FM in the Simulator (which proxies the host Mac's Apple
Intelligence) via `RealFMEvalTests`, opt-in and reporting+threshold-guarding:

```
TEST_RUNNER_SPORTIVISTA_REALFM_EVAL=1 xcodebuild test -scheme Sportivista \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -only-testing:SportivistaTests/RealFMEvalTests
```

The report prints between `REALFM-EVAL-REPORT-BEGIN/END`. A full run (55 cases)
is ~25 min, so for **cheap single-category / single-case iteration** two DEBUG
env filters narrow the corpus (a filtered run reports only — it never asserts a
threshold): `TEST_RUNNER_SPORTIVISTA_EVAL_CATEGORY=canon,command` and/or
`TEST_RUNNER_SPORTIVISTA_EVAL_CASE=canon-02-magnus-carlsen`.

**Prompt budget (WP-71).** The on-device context is **4096 tokens** and must
hold the prompt + the tool definitions + the `@Generable` schema + the whole
tool-calling conversation. WP-66/67/68 grew ONE monolithic prompt (all four
arms) + one `GeneratedTurn` schema (every arm's fields) + four tools onto every
generation, which overran that window (~95 «Context length of 4096 exceeded»,
eval 10/55). The fix splits each interpretation into **two small generations**:
a tiny **tool-less intent classifier** (phase 1), then a **focused per-arm
session** (phase 2) that carries only that arm's schema and only the tools it
needs (mutations→`searchEntities`, answer→`searchEvents`/`getProfile`/`getHelp`,
command & present→no tools). The prompts live in the FoundationModels-free
`AssistantInstructions` so `AssistantInstructionsTests` can length-guard each
phase in CI (a documented ~3.5 chars/token proxy) — the tripwire that fails a
future prompt inflation in CI, not 25 minutes into a device eval.

## Ytelse: signposts + MetricKit (WP-63)

`Sportivista/Perf/` instruments the two hotpaths the WP-60 audit flagged — **local and
private, never any remote telemetry** (same contract as the MisunderstoodLog
export).

**os_signpost intervals (`PerfSignpost.swift`).** One subsystem, `app.sportivista.perf`,
with two categories:

- `reload` — the WP-60 off-main agenda pipeline (`AgendaViewModel.computeReloadSync`).
  Emits three nested intervals inside an outer `reload`: **`load`** (cache read +
  JSON decode), **`index`** (EntityIndex build — near-zero on a cache hit), and
  **`compile`** (FeedCompiler + section building + live-now scan).
- `assistant` — the **`submit-prelude`** interval around
  `AssistantViewModel.submit`'s synchronous prep (feed build + memory context)
  before the on-device model call.

The intervals are pure wrappers: they change no value the pipelines produce (the
golden agenda vectors stay bit-identical) and cost ~nothing in Release, so they
ship.

**Reading them in Instruments (against a Hang).** Profile a device build
(Product → Profile) with the **Time Profiler + os_signpost** template (or add the
**os_signpost** / **Points of Interest** instrument and, for stalls, the **Hangs**
instrument). Filter the os_signpost instrument by **Subsystem = `app.sportivista.perf`**.
A real hang shows on the **Hangs** track as a main-thread stall; line the hang's
time range up against the signpost intervals below it — if a `reload` (or one of
its `load`/`index`/`compile` children) or a `submit-prelude` interval overlaps the
hang, that phase is the culprit and the interval's own duration tells you which
half (I/O+decode vs. compile). Because the reload pipeline runs OFF the main actor
(WP-60), a `reload` interval overlapping a main-thread hang is itself the
regression signal that the work leaked back onto main.

**MetricKit log + export (`MetricLog.swift` / `MetricSubscriber.swift`).**
`SportivistaApp` starts one `MetricSubscriber` for the app's lifetime; it persists
compact, anonymised summaries of `MXAppLaunchMetric` (launch/resume time
histograms) and `MXHangDiagnostic` (hang durations) to
`Application Support/SportivistaProfile/metric-log.json` — capped at 50 per kind,
oldest dropped first, exactly like the misunderstood-log. Collection runs in
Release too (the point is REAL on-device data). MetricKit **only delivers on a
physical device** — the log stays empty in the Simulator, and the payload types
have no public initializer, so the subscriber is split into a thin
(untested) MX-extraction and a unit-tested `ingest`/summarize/persist core
(`MetricSubscriberTests` / `MetricLogStoreTests`).

The export lives on the **same DEBUG surface as the eval screen**: assistant
`»_` → foot → **EVAL (DEBUG)** → **TELEMETRI (METRICKIT)** → **DEL TELEMETRI**
shares an anonymised JSON (durations + launch summaries + app build + timestamp;
never a device id or raw call-stack). Deep call-stacks for a hang come from
Instruments (above) and Xcode's **Organizer → Hangs**, not from this local log.

## Data contract

The iOS client is a pure consumer of the static JSON published to GitHub Pages for
the web dashboard — no separate backend. Each file has a Swift mirror in `Models/`
and is read via `DataStore`:

- **`manifest.json`** (per-file `bytes`/`sha256`, what `SyncClient` polls) →
  `Manifest.swift`; **`events.json`** (schema `events.schema.json`, draft-07) →
  `Event.swift` + supporting models, field-for-field, forward-compatible.
- **`entities.json`** (the stable-id index `Event.entityId` points into) →
  `Entity.swift`; **`tracked.json`** → `TrackedConfig.swift`.
- **`interests.json`** — the user-owned source of truth (CLAUDE.md: "the human edits
  this, AI never writes here") → `Interests.swift`; what `FeedCompiler` and
  `NotificationPlanner` key off.
- **`app-version.json`** (last ios/-touching commit, published by `build-events.js`)
  → `AppVersion.swift` (`Sync/`). «Har jeg siste versjon?»: a post-build script
  (project.yml, both app targets) stamps the built Info.plist with the tree's own
  ios/-commit (`SportivistaBuildStamp`, `-dirty` when uncommitted); `AppVersionCheck`
  compares stamp vs published and the assistant-ark foot shows a quiet
  «BYGG a1b2c3d · dato · SISTE / NYERE FINNES (…)» line. Pure judgement is
  unit-tested (`AppVersionCheckTests`); a preview/unstamped build shows the stamp
  alone, no verdict.

## What plugs in next

- **External TestFlight testers** — the app is live on TestFlight (internal
  group); externals are gated on the engine port-measurement going green plus
  the formal trademark check.
