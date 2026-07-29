# Golden feed vectors (WP-06)

These fixtures freeze the **personalisation semantics** of Zenji — which events
reach the feed, which get the reminder bell, which get the visual accent, how the
agenda time window behaves, and how stage races collapse — as pure declarative
JSON. They are the contract the future Swift `FeedCompiler` (WP-13) must satisfy
**bit-for-bit**: `f(superset-events, interests) → expected feed`.

Today the same logic is duplicated between the Node server (`scripts/build-events.js`
+ `scripts/lib/helpers.js`) and the browser client (`docs/js/dashboard.js` +
`docs/js/shared-constants.js`). The JS test `tests/feed-vectors.test.js` replays
every vector against those real implementations. A Swift `FeedCompiler` should
decode the very same files and assert the very same expectations from XCTest.

> **These vectors pin _current_ behaviour, not ideal behaviour.** Where the server
> and client disagree, the disagreement is recorded in
> [`DIVERGENCES.md`](./DIVERGENCES.md) and the vector encodes what each side does
> today. Do not "fix" a divergence by editing production code as part of a port —
> reproduce it, or change the vector deliberately with a note.

## Layout

```
tests/fixtures/feed-vectors/
  NN-slug.json      one vector = one self-contained { input, expected } case
  README.md         this file
  DIVERGENCES.md    server/client behavioural mismatches, pinned
```

Each `NN-slug.json` is standalone: it embeds its own `interests` config and event
superset, so a single file fully determines one test case. There are no shared
references to resolve — decode one file, run the checks in it.

## Fixture schema

```jsonc
{
  "name": "short human title",
  "description": "what this vector proves + any quirk it pins",
  "input": {
    "now": "2026-07-13T12:00:00Z",      // reference clock (ISO-8601 UTC).
                                        // Drives the 14-day relevance cutoff and
                                        // series 'next stage' selection. REQUIRED
                                        // when 'relevant' or 'series' is expected.
    "window": {                         // OPTIONAL. Only present with 'inWindow'.
      "start": "2026-07-16T00:00:00Z",  // agenda window [start, end)
      "end":   "2026-07-20T00:00:00Z"
    },
    "interests": { /* see below */ },
    "events":   [ /* superset of event objects, each with a unique "id" */ ]
  },
  "expected": {
    "relevant":  ["id", ...],           // server feed inclusion (see §relevant)
    "mustWatch": ["id", ...],           // server reminder bell (see §mustWatch)
    "mustSee":   ["id", ...],           // client visual accent (see §mustSee)
    "inWindow":  ["id", ...],           // isEventInWindow == true (server & client)
    "series":    [ /* see §series */ ]  // client collapseSeries output
  }
}
```

Only the `expected` keys a vector cares about are present; a runner asserts each
one it finds and skips the rest. Every `id` in an expectation set is one of the
`input.events[].id`. **The order of ids in an expectation set is not significant**
— compare as an unordered set (sort before comparing).

### `input.events`

Each event mirrors an entry in `docs/data/events.json` (schema:
`scripts/config/events.schema.json`). The fixtures only populate the fields each
predicate reads; unlisted fields are absent (treat as `nil`/default). The `id` is
a stable, fixture-local handle used purely to name events in the expectation sets
— it is not computed from anything and need not be a real WP-02 hash.

Fields the predicates read: `sport`, `title`, `tournament`, `time`, `endTime`,
`homeTeam`, `awayTeam`, `norwegian` (bool), `norwegianPlayers` (array of
`{name}`), `participants` (array of string), `isFavorite` (bool), `importance`
(1–5), `source` ("ai-research"), `confidence`, `status`.

### `input.interests`

A trimmed copy of `scripts/config/interests.json` — the same canonical config is
reused across every vector so results are comparable:

```jsonc
{
  "followBroadly": ["football","golf","f1","cycling",
                    "biathlon","cross-country","alpine"],   // sports kept wholesale
                    // WP-92: chess & esports are NOT here — they are entity-gated.
                    // Omitting followBroadly entirely falls back to the same default
                    // (vector 14 does this to exercise the gate against the default).
                    // WP-200: PRESENT-vs-ABSENT now also decides whether the rule-(3)
                    // blanket is sport-scoped. An explicit list — including `[]` —
                    // means "a personal profile owns this board" (vectors 15 & 16,
                    // whose interests are what ssProfileToInterests /
                    // EffectiveInterests.merge derive from a real profile).
  "alwaysTrack": {
    "athletes":    [{ "name","aliases":[...],"sport" }, ...],
    "teams":       [{ "name","aliases":[...],"sport" }, ...],
    "tournaments": [{ "name","aliases":[...],"sport","notify"? }, ...]
  },
  "notify": { "leadMinutes": 30 }
}
```

Note `tennis` is deliberately **absent** from `followBroadly`, so tennis events
only reach the feed via a tracked entity / Norwegian / favorite / importance —
this is what makes the "Casper Ruud pulls a tennis event onto the board" and the
"Barcelona Open false-positive" cases observable.

## The five predicates (exact semantics + source of truth)

> **WP-96 note.** `relevant` pins the **personal lens** — "given a user's
> interests, what's in THEIR feed?". WP-96 (the flerbruker-split) moved this
> predicate off the server: `build-events.js` now applies `isCovered(catalog.json)`
> ("does Sportivista COVER this?", a superset), and the personal narrowing lives
> ONLY on the clients (iOS `FeedCompiler.isRelevant`; the web board is catalog-wide).
> The lens **algorithm is unchanged**, so these vectors are **not** re-frozen — see
> [`DIVERGENCES.md` §6](./DIVERGENCES.md). The server `isCovered` predicate has no
> client mirror and is tested in `tests/build-events.test.js`, not here.

| Predicate  | Question                                   | Reference (Node)                                           | Client (browser)                                   |
|------------|--------------------------------------------|------------------------------------------------------------|----------------------------------------------------|
| `relevant` | Is the event in the user's personal feed?  | the lens `lensRelevant` (JS twin of `FeedCompiler.isRelevant`) + 14-day cutoff | iOS `FeedCompiler.isRelevant`; web board is catalog-wide |
| `mustWatch`| Does it get a reminder bell 🔔?            | `helpers.js` `mustWatchEntity` → `e.mustWatch`             | reads precomputed `e.mustWatch`                    |
| `mustSee`  | Does it get the quiet visual accent?       | —                                                          | `dashboard.js` `isMustSee` (176–192)               |
| `inWindow` | Does it overlap an agenda window?          | `helpers.js` `isEventInWindow`                             | `shared-constants.js` `isEventInWindow` (identical)|
| `series`   | How do stage races collapse?               | —                                                          | `dashboard.js` `collapseSeries` (375–405)          |

### §relevant — personal feed inclusion (the lens)

The personal lens (iOS `FeedCompiler.isRelevant`; JS reference `lensRelevant`).
WP-96 moved it off the server — the server now filters by `isCovered(catalog)` —
but the algorithm below is unchanged. Kept iff **both**:

1. **Retention cutoff.** With `t = endTime ?? time`, keep only if
   `t >= now - 14 days` (multi-day events survive on their *end*, not their start).
2. **isRelevant** (in this order — WP-92):
   1. `sport ∈ followBroadly` → **in** (wholesale). Checked first, so it wins over
      the gate below. NB: **chess and esports are NOT in the default followBroadly**
      — the owner tracks them only through named entities (elite chess / 100 Thieves).
   2. **Entity-gated sport** (chess, esports): keep **only** if a tracked entity
      matches, and that match **is sport-scoped** (DIVERGENCES.md §5). The
      norwegian / favorite / importance / ai-research shortcuts do **not** apply here.
   3. Any other non-broad sport (e.g. tennis): keep if `norwegian == true` OR
      `isFavorite == true` OR `importance >= 4`. **`source == "ai-research"` is NOT a
      standalone pass** (WP-92 scoped it — an AI find must also be a followBroadly
      sport or match a tracked entity). **WP-200 scopes this blanket to a SPORT:**
      it fires only when the event's sport is in `followBroadly ∪ every tracked
      entity's sport` — and only when `followBroadly` is *present*. With
      `followBroadly` ABSENT (vector 14) the scope is undefined and the blanket
      stays un-scoped, exactly as before WP-200. See DIVERGENCES.md §8.
   4. A tracked entity (teams ∪ athletes ∪ tournaments) matches the haystack
      `title + tournament + homeTeam + awayTeam + norwegianPlayers[].name + participants`.
      **This match is NOT sport-scoped** (see DIVERGENCES.md §1).

Matching uses word-boundary, diacritic-insensitive containment (`helpers.js`
`containsName`): `"Barça"` ≡ `"Barca"`; `"Lyn"` matches `"Lyn Oslo"` but not
`"Brooklyn"`.

### §mustWatch — the reminder bell (server)

`mustWatchEntity(event, interests) != null`. The candidate entities are the
**notify set**: every tracked team and athlete (bell by default) plus tournaments
with `notify: true`. Matching is over the same haystack as relevance BUT **is
sport-scoped**: a `sport:"football"` entity cannot match a non-football event.
Uses `containsName` (word boundary + diacritics). Keyed strictly off
`interests.json` — never off an event's own `isFavorite`/`importance`, so what
interrupts the user stays user-governed.

### §mustSee — the visual accent (client)

`isMustSee(event)`, in order:

1. `isSeries` → `false` (collapsed rows are never accented).
2. `isFavorite`, OR `importance >= 4`, OR (`norwegian` AND `norwegianPlayers`
   non-empty) → `true`. *(The last is the "golf lens": a Norwegian in the field.)*
3. `homeTeam`/`awayTeam` matches `/\bnorway\b|\bnorge\b/` → `true`.
4. `homeTeam`/`awayTeam` **contains** (naive lowercase substring) any tracked-team
   term → `true`. *(Substring, not word-boundary — see DIVERGENCES.md §2.)*
5. `title + norwegianPlayers[].name` **contains** any tracked-athlete term →
   `true`. *(Substring; reads title + players, NOT participants, NOT tournament.)*

Note the accent uses plain `toLowerCase()` + `includes()` (no diacritic
stripping, no word boundaries) — deliberately different from the server matcher.

### §inWindow — the agenda time window (server AND client, identical)

`isEventInWindow(event, start, end)`: with `s = time`, `e = endTime ?? time`, the
event overlaps `[start, end)` iff `s < end && e >= start`. No `time` → `false`.
This is the one function implemented on both sides; the JS test asserts the two
implementations agree on every vector.

### §series — stage-race collapse (client)

`collapseSeries(events, now)` groups events whose title matches
`/\betappe\b|\bstage\s*\d/i` by `sport + "||" + tournament`. A group of **4 or
more** collapses into one synthetic series row; fewer than 4 pass through as
individual rows. Non-stage events always pass through. The synthetic row's
"next stage" is the first stage whose `endTime ?? time >= now`, else the last.

Expected `series` entries describe the collapsed output, order-independent:

```jsonc
{ "isSeries": false, "id": "gc" }                       // a passthrough event
{ "isSeries": true,                                     // a collapsed series
  "id": "series|<sport>|<tournament>",
  "tournament": "<tournament>",
  "stageCount": 6,
  "nextStageId": "st4" }                                // id of the chosen next stage
```

## Running the reference (JS)

```
npm test -- feed-vectors     # just these vectors
npm test                     # whole suite
```

`tests/feed-vectors.test.js` is the executable reference: it reconstructs the
personal lens `lensRelevant` from the exported `matchInterest` (the JS twin of
`FeedCompiler.isRelevant`), calls the real `mustWatchEntity` and `isEventInWindow`,
and drives the real client `isMustSee`/`collapseSeries` in a `vm` sandbox.

## Replaying from XCTest (WP-13)

The files are plain JSON with no JS, so decode them straight into Swift and assert.
Sketch:

```swift
struct Vector: Decodable {
  struct Window: Decodable { let start: String; let end: String }
  struct Input: Decodable {
    let now: String?
    let window: Window?
    let interests: Interests
    let events: [Event]        // your Codable Event (WP-11); unknown keys ignored
  }
  struct Expected: Decodable {
    let relevant, mustWatch, mustSee, inWindow: [String]?
    let series: [SeriesItem]?
  }
  let name, description: String
  let input: Input
  let expected: Expected
}

// Load every tests/fixtures/feed-vectors/*.json (add the folder as a test
// resource / bundle reference), then for each vector:
//   • relevant  → FeedCompiler.isRelevant + 14-day cutoff, ids sorted == expected
//   • mustWatch → FeedCompiler.mustWatchEntity != nil
//   • mustSee   → FeedCompiler.isMustSee
//   • inWindow  → FeedCompiler.isEventInWindow(event, start, end)
//   • series    → FeedCompiler.collapseSeries(events, now) mapped to {isSeries,id,…}
// Compare id sets unordered (Set); compare series entries unordered by id.
```

The Swift port passes WP-13 when it reproduces **every** expectation in **every**
file — including the divergent cases in `DIVERGENCES.md` (reproduce today's
behaviour; changing it is a separate, deliberate decision).
