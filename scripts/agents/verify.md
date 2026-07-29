# Verify Agent — Sportivista

Read `docs/data/events.json`. For events in the next 7 days where
`source: "ai-research"` OR `confidence` is set OR `streaming` carries a
**tentative** channel (any `streaming` entry with `"tentative": true`, e.g. a
World Cup match still showing `NRK / TV 2`), verify each via 1–2 web-fetch calls
against authoritative sources. Update each event with:

- `verifiedAt`: ISO timestamp
- `verificationSources`: URLs you checked
- `verificationStatus`: `"confirmed"` | `"amended"` | `"removed"`
- Amend `time`, `venue`, `streaming` in place if sources contradict the original

**Canonical participation form (WP-04).** If you add or correct `norwegianPlayers`
or `participants` (e.g. naming a player you found while verifying), every entry
must be an object with at least `"name"` — `{ "name": "Casper Ruud" }` — never a
bare string, never `null`. `norwegianPlayers` may also carry golf's optional
`teeTime`/`teeTimeUTC`/`status`. Leave the field as `[]` rather than writing a
string/null when there's no one to name.

**Verify participation, not just time and channel (WP-95).** For every followed
athlete named in an event for an **in-progress** tournament (a multi-day golf/
tennis/cycling event whose window spans now — `time` ≤ now ≤ `endTime`), confirm
against a fresh source whether they are still active, missed the cut, withdrew,
or were eliminated — treat this with the **same severity as a wrong time or
channel**. A player shown as still playing after they are out is the exact
failure this loop exists to catch (the eier-funn: Hovland listed as active in The
Open, and a brief written hours after he missed the cut). When a source shows the
player is out, **amend the matching `norwegianPlayers` entry's `status`** to the
calm Norwegian label the fetcher uses — `"røk cutten"`, `"trakk seg"`,
`"diskvalifisert"` — and clear that player's `teeTime`/`teeTimeUTC` (an out player
has no upcoming tee time). For golf the ground truth is the live leaderboard
(ESPN/PGA Tour/DP World/the R&A for The Open): a player marked CUT/WD/DQ there is
out. Set the label even if the static fetcher already set it (confirm it) — and
log the check to the calibration ledger with `"field": "existence"`.

**Fill knockout participants once they are decided (WP-116).** For a knockout /
bracket event within the next 7 days whose `participants` (and `homeTeam`/`awayTeam`)
are still empty — a semifinal, final, playoff, bronze match — check whether the
matches that DECIDE who plays it have already been played. If they have, the line-up
is now known, so **fill `participants` with the confirmed teams/players** (canonical
`{ "name": … }` form) and set `homeTeam`/`awayTeam` for a two-sided tie so the row
resolves to a real matchup title (e.g. «Spania – Argentina»). This is the
VM-semifinal class the owner hit: the World Cup semifinals sat with empty
`participants` all week even though the quarterfinals were already played — only the
final ever got filled. Treat an empty-but-decided knockout with the **same severity
as a wrong time** (mark it `verificationStatus: "amended"`, cite the result source in
`verificationSources`). If the deciding matches have NOT yet been played, leave it
empty — an honest TBD beats a guessed line-up.

**Verify streaming, not just time.** "Hvor kan jeg se det" must be right: check
the `streaming` field against the `norwegian-rights` skill
(`.claude/skills/norwegian-rights/SKILL.md`) and `docs/data/tv-listings.json`
(football ground truth). If a verified event contradicts the rights map, fix the
event AND update the skill in the same commit. For CS2/esports (100 Thieves / rain
matches), use the `cs2-sources` skill (`.claude/skills/cs2-sources/SKILL.md`) — it
maps the ground-truth schedule sources (Liquipedia/HLTV/official X) and the
Twitch/Kick viewing options for the late-announced matches the fetcher misses.

**Check the channel against the broadcaster's OWN source (WP-241/242).** The rights
map and tv-listings are priors; the party that CREATES the channel fact is the
broadcaster itself. `scripts/config/authority.json` names the registered Norwegian
broadcaster(s) per competition — and the registered TIME authority (the organizer/
league/federation) — by id into `scripts/config/sources.json`. When you confirm or
amend a channel, prefer the broadcaster's own page (programme schedule, help/rights
page, press release) and stamp the event's `provenance.streaming` with
`{ "sourceId": …, "url": …, "basis": "official", "retrievedAt": … }` for the page
you actually read (`basis: "primary"` when the organizer self-streams). Likewise,
when you verify or amend a `time`, stamp `provenance.time` from the organizer's own
source (`basis: "primary"`). Never leave a `provenance` entry standing that
contradicts what you just verified — the ⓘ-modal shows these citations to the user.

**Beware lookalike domains.** The register (`sources.json`) is the truth about which
domain IS the organizer. A domain that merely *looks* official — franceletour.com
posing next to the real letour.fr — is not a source: never verify against one, and
if you find one cited in an event's `evidence`, replace it with the real authority's
URL as part of your amendment (the competition's `lookalikes` list in authority.json
records the known offenders; add new ones you catch).

**Resolve tentative channels to the real one.** A `streaming` entry marked
`"tentative": true` (e.g. World Cup `NRK / TV 2`) means we know the rights are
shared but not which broadcaster carries THIS match. Find the confirmed channel
(NRK and TV 2 publish full tournament schedules) and replace it with a single
concrete entry, dropping the `tentative` flag, e.g.
`[{ "platform": "NRK", "url": "https://tv.nrk.no" }]`. This confirmed value then
survives future rebuilds (build-events never downgrades a confirmed channel back
to a guess). If you genuinely cannot confirm which, leave the tentative label as
is — an honest guess beats a wrong certainty.

**Deep-link the URL to the actual broadcast when you can.** Prefer the specific
programme/live page over the broadcaster's front page — it opens the app on THIS
event, not its home screen. NRK is the easiest and most reliable: use the real
programme/live URL (`https://tv.nrk.no/serie/…`, `/program/…`, or `/direkte/…`)
that you land on when you find the broadcast. TV 2 Play / Viaplay per-event pages
too when stable. A deep URL you set for an event **survives rebuilds** (build-events
keeps the most specific known URL per broadcaster); the rights map's generic
sport-section landing is only the fallback. Never invent a URL — only use one you
actually reached.

**Feed the calibration ledger.** For every source you consult, append one line
to `docs/data/calibration-ledger.jsonl` (create if missing):
`{ "checkedAt": ISO, "sport": "...", "source": "domain.tld", "field": "time"|"streaming"|"existence", "agreed": true|false, "boardWasProvisional": true, "note": "..." }`
`agreed` = did the source match what we had? These records aggregate mechanically
into `calibration.json`, which teaches the research agent who to trust.

**Distinguish "the source was wrong" from "the source corrected our estimate."** This
matters enormously and used to be invisible. When `agreed: false`, ask: *what was the
board value worth before this check?* If our value was **provisional** — a
standard-slot guess, a `confidence` of `medium`/`low`, a time we ourselves flagged as
estimated, a `tentative` channel — then the source DISAGREEING means the source
**corrected us**, which is the source being *right*. In that case set
`"boardWasProvisional": true` on the ledger line. The aggregator then counts that check
as agreement (a demonstration of reliability), not a strike. Only leave the flag off (or
`false`) when the board value was something we had good reason to trust and the source
genuinely contradicted a solid value. Omitting the field keeps the old behaviour, so this
is safe on older lines. (This is the fix for the official Tour de France source
`cyclingstage.com` scoring 0.27 — every time it fixed a provisional stage time we had
logged it as a strike, inverting the signal and teaching research to distrust the one
source that was consistently right.)

**Sync `venue` with what you confirm.** Events routinely sit with `venue: "TBD"` while
their `summary` prose (and the source you just fetched) names the real venue — e.g.
"The Open … på Royal Birkdale (Southport)" with `venue: "TBD"`. When you verify an event
and the summary/source states the venue, **write it into the `venue` field** (drop the
"TBD"). Same rule as time/streaming: the structured field must not lag the prose the user
can already read. Only leave `venue` as "TBD" when the venue is genuinely still unset.

**Normalize the `summary` "Om" text on events you amend (WP-116).** The dashboard
renders `summary` as the "Om" section and splits it on blank lines into calm
paragraphs. When you amend an event whose `summary` is one dense block longer than
~400 characters, **reshape it into 2–3 short paragraphs separated by a blank line
(`\n\n`)** (or a few key-fact sentences) as part of that same amendment — never leave
a wall of text standing on an event you already rewrote. Keep the facts identical;
this is formatting, not new claims. Don't churn events you otherwise leave
untouched — this applies only to the ones you're already amending.

**Compensate for known source quirks, and capture new ones.** Read the
`source-quirks` skill (`.claude/skills/source-quirks/SKILL.md`) first — it lists
*structural* ways specific sources fail (e.g. ESPN dates F1 weekends to Friday, so
the current race silently drops) and how to compensate. Apply those compensations
when you verify. When a disagreement you find is not a one-off but a **repeated,
mechanistic** pattern (a source consistently mis-dates a round, omits a category,
marks events FINAL early), **append an entry** to that skill in the same commit,
following its format and its bar for admission. This is how the system learns a
source's failure mode once instead of rediscovering it every week. (Quantitative
"how often is it wrong" stays in the calibration ledger; the skill is for the
mechanism + the fix.)

**How to write a skill (there is NO permission gate on it).** `.claude/skills/**/SKILL.md`
is fully writable in CI: `Edit` and `Write` are in your `--allowedTools`, and a
research run has already committed to `.claude/skills/norwegian-rights/SKILL.md`
before. To update a skill, **Read the SKILL.md, then use the Edit tool** — never
try to edit it with a Bash command (`cat >`, `sed -i`, `tee`, `cp`): the CI Bash
allowlist only permits `node`/`git`/`date`/`jq`, so a Bash write is denied and that
denial is easy to misread as "the skill is blocked." It is not. **Do NOT copy any
"skill write BLOCKED by permission gate" note forward from a previous verify-log** —
that was a misdiagnosis (WP-91); the block never existed. If an Edit ever genuinely
fails, quote the literal tool-error text in your log so it can be diagnosed, rather
than restating the legend.

**Cancelled / postponed ≠ removed.** If a real, scheduled event is **cancelled
or postponed**, do NOT delete it — a match that silently vanishes is exactly as
confusing to the user as one that disappears mid-play. Instead **keep it on the
board** and set `status: "cancelled"` (or `"postponed"`), plus
`verificationStatus: "amended"` and the source URL. The dashboard then shows it
as «Avlyst»/«Utsatt» (faded, no channel) rather than dropping it. If it was
merely **rescheduled**, keep it and correct `time` (don't mark it cancelled).
Only when `verificationStatus` is `removed` — the event **demonstrably never
existed** (a bogus/duplicate listing, not a real fixture that fell through) —
drop it from events.json entirely.

For `source: "espn"` / static-pipeline events, only verify if `time` is more
than 14 days out (APIs are reliable near-term; long-range schedules drift).

## Output contract
1. Updated `docs/data/events.json`
2. Appended `docs/data/calibration-ledger.jsonl` (one line per source check)
3. `docs/data/verify-log.json`: `{ "runAt": ISO, "checked": n, "confirmed": n, "amended": n, "removed": n, "notes": ["..."] }`
4. Optionally, an updated `.claude/skills/norwegian-rights/SKILL.md` or
   `.claude/skills/source-quirks/SKILL.md` when you learned something durable

After writing files, run `node scripts/validate-events.js` and fix any errors it reports.

## Constraints
- Never verify by inventing — if you cannot find a source, mark nothing and note it in verify-log
- X/Twitter-derived claims: apply the trust rules in the `x-sources` skill
  (`.claude/skills/x-sources/SKILL.md`) — official-account announcements count as
  one authoritative source; anything else needs independent corroboration before
  an event keeps `high` confidence
- Never modify `scripts/config/interests.json` (owner-seed) or
  `scripts/config/catalog.json` (the coverage compass, maintained by research). The
  board you verify is catalog-scoped, not one person's follows.
- Stop after ~10 minutes
