# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vision (v2)

Sportivista (formerly SportSync/Zenji) is a personal sports dashboard for a Norwegian sports fan. v2 (July 2026)
replaced the v1 "self-improving autonomy" architecture (13 feedback loops, multi-agent
autopilot, pipeline manifest) with a **lean, reliable design** built on one idea:

> **Dynamic AI research is the core value.** Trust modern Claude models to do real
> research on a schedule, instead of maintaining layered feedback-loop machinery.

Four priorities, in order:
1. **Correct, complete data** — especially events that static APIs miss
2. **Dynamic AI research** — scheduled agents with web search find and verify events
3. **Calm dashboard** — one quiet single-column agenda (max 640px), true-black dark default, PWA
4. **Transparent tracking** — AI decides what to track and writes human-readable
   `tracked.json` with a defensible `reason` per entry

### Zero infrastructure constraint (unchanged from v1)

Everything runs on **GitHub Actions + Claude Code Max (`CLAUDE_CODE_OAUTH_TOKEN`) +
GitHub Pages**. No servers, no databases, no paid APIs.

### Portability principle

Vendor lock-in is confined to **one layer**: the agent workflow files
(`.github/workflows/*-agent.yml`, using `anthropics/claude-code-action@v1`).
Prompts (`scripts/agents/*.md`) are capability-described (read files, search the web,
write JSON) with no vendor-specific syntax. Swapping AI provider = replacing the
workflow files only.

## Architecture

Two kinds of scheduled work:

### 1. Static pipeline (no AI, free, ~3 min)
`.github/workflows/static-pipeline.yml` — hourly 05–21 UTC:
- `scripts/fetch/index.js` — ESPN fetchers (football, golf, tennis, F1, chess, cycling) + fotball.no + **Liquipedia CS2 matches** (`esports.js`: hourly `Liquipedia:Matches`, keeps focus-team (100 Thieves) matches at any tier; the `APIClient` sends `Accept-Encoding: gzip` + decompresses, which Liquipedia requires)
- `scripts/fetch-standings.js` → `standings.json` (PL table, golf leaderboards, F1)
- `scripts/fetch-rss.js` → `rss-digest.json` (11 feeds)
- `scripts/fetch-results.js` → `recent-results.json` (7-day history)
- `scripts/fetch-tvkampen.js` → `tv-listings.json` — Norwegian TV/streaming **ground truth** for football (tvkampen.com, today+2 days; lib: `scripts/lib/tvkampen-scraper.js`)
- `scripts/build-events.js` → `events.json` — **preserves `source: "ai-research"` events** from the previous build (dedupe key `sport|title|time`), publishes `tracked.json` to `docs/data/`
- `scripts/validate-events.js` — schema + AI-research contract (high confidence ⇒ 2+ evidence URLs; warns on near-term events missing streaming)
- `scripts/detect-coverage-gaps.js` → `coverage-gaps.json` — recall watch (mechanical, recall-biased; agents triage + cross-check the web). Three signals: **entity gaps** (tracked entity in RSS headlines with no upcoming event, or one only far out while the news says imminent — "i dag"/"denne helgen"), **sport gaps** (a followed sport is imminent in the news but absent from the board soon — the ESPN-blind-spot catcher, e.g. F1 weekends ESPN mis-dates to Friday), and **source anomalies** (a fetcher's own file is missing/empty/dropping events *and the board lacks that sport* — coverage-first, so AI-research-filled sports like chess/cycling don't false-flag). One anomaly deliberately ESCAPES the coverage-first gate: **`stale-retained`** (high) — `retainLastGood` re-serves the last good file when a fetch comes back empty and stamps `_retained.consecutiveRetains`, and nothing used to read that stamp, so a dead fetcher stayed invisible as long as something else covered the sport (football.json sat frozen on the 19 July World Cup final for 137 runs while research hand-filled Eliteserien). A fetcher that has stopped producing is broken whether or not the board hides it
- `scripts/aggregate-calibration.js` → `calibration.json` — mechanical per-source trust stats from `calibration-ledger.jsonl` (180-day window, reliability withheld under 5 checks)
- `scripts/build-ics.js` — calendar export
- Commits `docs/data/` directly to main, then — only when data changed — **auto-publishes** by calling `preview-deploy.yml` via `workflow_call`. (A `GITHUB_TOKEN` push can't *trigger* a workflow, so the pipeline invokes the deploy directly instead of relying on `preview-deploy`'s `push` trigger; no PAT needed. `preview-deploy` keeps `concurrency: pages-deploy`, which `workflow_call` honors, so a called deploy still serialises with merge-triggered ones — never two Pages deploys at once.)

### 2. Claude agents (Claude Code Max OAuth, scheduled)
Nine workflows run `anthropics/claude-code-action@v1` with a prompt file:

| Agent | Prompt | Model | Schedule | Job |
|---|---|---|---|---|
| **research** | `scripts/agents/research.md` | **tiered** — `standard` (default, every 4h) = `claude-opus-4-8`; `deep` = `claude-fable-5` → Opus 4.8 fallback. Deep runs on escalations (scout / coverage-critic pass `-f tier=deep`) and one weekly sweep (Mon 04:xx UTC). Fable 5 is ~2× Opus's price and reserved for the heavy runs; Opus is the workhorse | every 4h (+ escalations) | Find events static APIs miss (Norwegian sports, chess, cycling, winter sports) — fans out parallel scout subagents per in-season sport via the Task tool; append to `events.json` with `source/confidence/evidence`; rewrite `scripts/config/tracked.json`; write `research-log.json`. Prioritizes `coverage-audit.json` high-severity gaps |
| **verify** | `scripts/agents/verify.md` | `claude-opus-4-8` | daily 05:30 UTC | Verify AI-researched + near-term tentative-channel events in the next 7 days via web fetch; confirm/amend/remove; resolve tentative `NRK / TV 2` labels; write `verify-log.json` (Opus 4.8 — this is the correctness gate) |
| **editorial** | `scripts/agents/editorial.md` | `claude-opus-4-8` | 05:00 + 15:00 UTC | Generate `featured.json` (morning/evening brief) — narrative + structured blocks |
| **scout** | `scripts/agents/scout.md` | `claude-haiku-4-5` | hourly 05–21 UTC | The Watchtower: triage RSS + coverage gaps; escalate to research via `gh workflow run` (max 2/day); log to `scout-log.json` |
| **coverage-critic** | `scripts/agents/coverage-critic.md` | `claude-opus-4-8` | daily 04:00 UTC | Recall audit that **trusts no single source**: an imminent pass (is what's happening this weekend actually on the board? verify each in-season followed sport against the web — F1 especially) + a ~4-week horizon pass; corroborates high-severity gaps across ≥2 independent sources, weights by `calibration.json`, records upstream unreliability in `sourceIssues`; write `coverage-audit.json`; escalate high-severity gaps to research (max 1/day) |
| **visual-qa** | `scripts/agents/visual-qa.md` | `claude-sonnet-5` | daily 08:00 UTC | Vision QA: screenshot the dashboard at 375/393/900px, LOOK at the images, flag truncation/overflow/foreign-channel/calm-design issues; write `visual-qa-log.json` |
| **ui-fix** | `scripts/agents/ui-fix.md` | `claude-opus-4-8` | daily 09:00 UTC | Self-heal: read visual-qa findings, fix the frontend ON A BRANCH, re-screenshot to prove the fix + no regressions, `npm test`, open a PR. The workflow then **re-runs the tests as a hard gate and auto-merges + deploys** it (fully hands-off). Fix ships only if it verifies twice; a test failure leaves the PR open + fails loudly. Closes the visual-qa loop |
| **self-repair** | `scripts/agents/self-repair.md` | `claude-opus-4-8` | daily 06:30 UTC | The mechanic: detect real breakage (failed runs, failing tests, validation errors, broken fetchers), fix ON A BRANCH, prove it, open a PR. Workflow re-gates tests and **auto-merges + deploys** — EXCEPT the three protected paths below, which are left open for review. Ignores quota/transient failures |
| **improve** | `scripts/agents/improve.md` | `claude-opus-4-8` | weekly Mon 07:00 UTC | Evolution: mine the logs for ONE evidenced improvement (source/skill/prompt/threshold/fetcher tuning), open a PR. Workflow re-gates tests and **auto-merges** it (except protected paths). Biased toward sharpening what exists over adding machinery (the v1 lesson) |

### CI, test-gate & release workflows (PR/push-triggered, no AI)

Beyond the two kinds of scheduled work above, four non-agent workflows back the automation but run no prompt:

- **`ci.yml`** — the universal web test-gate: `npm ci && npm test` (the full vitest suite) on every PR, plus pushes to `main` that touch `scripts/`/`tests/`/`docs/js/`/`package*.json`/`vitest.config.js`. The job is named **`web-tests`** (pinned by `tests/workflows.test.js` — a rename would silently break the gate). **Honest gate story:** this is *not* a platform-enforced required check. The `main` ruleset enforces only `deletion` + `non_fast_forward` (no required-status-check rule), so nothing in GitHub blocks a red merge. The real gate is **script-side**: the three self-fixing loops wait on this check in `scripts/merge-gate.js` (`gh pr checks <n> --watch --fail-fast`) before auto-merging. **Human PRs and direct pushes to `main` bypass CI entirely** — the check reports for a reviewer's eyes but blocks nothing mechanically. Before `ci.yml` existed even the loops had no standalone gate; they re-ran the suite inline in `merge-gate.js`.
- **`ios-tests.yml`** — the always-reporting iOS test-gate: the Swift unit suite (hostless bundles via the `Sportivista` scheme, incl. the golden vectors that pin JS↔Swift bit-identically) on PRs touching `ios/`. The job is named **`ios-tests`** (also pinned by `tests/workflows.test.js`). A cheap `detect` job self-skips the macOS job when `ios/` is untouched, so the check is satisfied (a skipped job counts green) without ever standing "expected" forever — again, this is **not** a platform-required check (same honest gate story as `web-tests`: the ruleset enforces only `deletion` + `non_fast_forward`; `merge-gate.js` waits on it for the loops, human/direct paths bypass it). **Pre-merge build validation (WP-138):** the iOS gate additionally validates that the app still *archives/builds for release*, so a change that breaks the release lane is caught on the PR rather than only when `ios-release.yml` later tries to upload to TestFlight. macOS runners are free on the public repo; secretless (simulator tests don't sign — `CODE_SIGNING_ALLOWED=NO` is the project default); UI tests run elsewhere (local/agent-driven).
- **`ios-release.yml`** — the TestFlight release lane (WP-17): from a clean checkout it archives, cloud-signs, and uploads the app to App Store Connect, then records the upload (`scripts/record-testflight.js`; build number from `scripts/next-testflight-build.js` — ASC is the source of truth) and kicks the static pipeline to publish `app-version.json`. **Continuous delivery on every new iOS version (WP-137)**, closing the device loop so the owner always dogfoods HEAD, not a build days behind the fixes. Triggers: (1) **push to `main` under `ios/**`** — event-driven, a human merge of an iOS change uploads to TestFlight immediately; (2) an **hourly schedule** (`35 6-22`) as a **safety net** for iOS changes the push trigger can't see — the self-fixing loops (ui-fix/self-repair/improve) auto-merge via `GITHUB_TOKEN`, and a `GITHUB_TOKEN` push never fires a `push` trigger (the same reason the static pipeline must kick deploy explicitly); (3) manual `workflow_dispatch` — also the reliable re-release path. (**No `ios-v*` tag trigger** — WP-140 removed it: a tag push inherits the same `paths: [ios/**]` filter as the push block, so a tag placed on an existing commit *without* new `ios/` changes in the push typically did **not** fire — exactly the re-release case the tag was meant for. `workflow_dispatch` is the reliable manual/re-release lane instead.) A cheap `detect` job (ubuntu) gates it: on `schedule` it builds only when `ios/` changed since the last recorded TestFlight stamp (`scripts/config/testflight.json`), on push/dispatch it always builds. The record commit pushes `scripts/config/` (not `ios/`) via `GITHUB_TOKEN`, so it can't re-trigger the push path — no loop; `concurrency: ios-release` (no cancel) serialises uploads. Needs the three `ASC_*` secrets from an **ADMIN** ASC key (App Manager can't cloud-sign). **Self-opprydning av signeringssertifikater (WP-145):** a **prune step runs before the archive** (`scripts/prune-signing-certs.js`) — because cloud-signing on a fresh CI runner (no keychain identity) makes ASC mint a **new "Apple Development" cert every run**, which with auto-CD (WP-137, every iOS merge) piles up to Apple's certificate cap and then fails the archive with "reached the maximum number of certificates". The step revokes the dead API-minted certs (keeps the owner's named cert + the newest couple), keeping the account under the cap; **fail-soft** — a list/DELETE error is logged and swallowed (exit 0), so prune never fells an otherwise valid build. **Fast CI-signeringsidentitet stopper cert-churn + revokerings-mailene (WP-153):** the prune step *worked* but its per-run revocations each triggered a "Your Certificate Has Been Revoked" email to the account owner — jevnlig spam with auto-CD. Root cause: the fresh-runner minting itself. The lane now imports a **persistent CI signing identity** into a temp keychain **before archive** (`security import` of a `.p12` from secrets `SIGNING_CERT_P12` + `SIGNING_CERT_PASSWORD`; a dedicated ASC-created Apple Development cert whose private key is held only in the secret), so `-allowProvisioningUpdates` **reuses** it instead of minting a new cert each run — no churn, no revocations, no emails. Because the CI cert also carries displayName `Created via API`, prune protects it by ID via `KEEP_CERT_IDS` (so it never revokes the identity it just imported); prune is now a **safety net** that only cleans residual churn, removable once minting is confirmed stopped. **Selv-heler byggnummer-race (WP-151):** the build number is fetched (ASC-max+1) at job start, but ASC registers a fresh upload with eventual-consistency lag — two close runs (auto-CD + a dispatch, or two merges in a burst) can grab the SAME number, and the second then fails the export with `The bundle version must be higher than the previously uploaded version: 'N'` (exit 70). The archive + export/upload are now one self-healing step (`scripts/testflight-upload.js`): it catches that collision, bumps to N+1 and **re-archives** (the archive bakes in `CFBundleVersion` — `manageAppVersionAndBuildNumber:false` — so the number must be set at archive time; re-export alone won't do), then re-uploads, up to a few attempts with an increasing number. The ACTUALLY uploaded number is written to `$GITHUB_OUTPUT` and used by the record step (so `testflight.json` records the real number, not the originally fetched one). It still **fails loudly** if all retries are exhausted — concurrency serialises the runs but doesn't protect against ASC's lag, so the retry is the actual fix. The pure logic (parse the collision → next number; retry decision) is extracted and unit-tested network-free in `tests/testflight-upload.test.js`.
- **`preview-deploy.yml`** — the GitHub Pages deploy (`concurrency: pages-deploy`, never cancel-in-progress): assembles `_site` from `main` plus a `/preview/<branch>/` copy per open PR, then deploys. Triggered by a push to `main` under `docs/**`, by `workflow_call` (how the static pipeline auto-publishes — a `GITHUB_TOKEN` push can't fire the `push` path), by `repository_dispatch`, or manually. Deliberately **not** on `pull_request` (that raced the shared concurrency group → "Deployment failed, try again later").

### Autonomy model (what ships unattended)

The self-fixing loops (ui-fix, self-repair, improve) each fix on a branch, open a
PR, and the **workflow re-runs `npm test` as a hard gate and then auto-merges +
deploys** — fully hands-off. The ONLY exception is the **protected paths** that
are never auto-merged (a change touching them is left open, labelled
`needs-review`; enforced in one place, `scripts/merge-gate.js`) — **five today,
six once WP-139 lands**:

- `.github/workflows/**` — the automation's own definitions and gates; auto-merging
  a broken change here could disable the test-gate or break the fixer itself.
- `.github/actions/**` — **forward reservation**: no such directory exists yet, but
  the pattern is pre-registered in `merge-gate.js` so the first composite action the
  workflows ever adopt is protected the moment it lands (the regex stays in the code).
- `scripts/hooks/**` — the safety hooks (interests protection, post-write validate).
- `scripts/config/interests.json` — user-owned; "AI never writes here" (also hook-enforced).
- `.claude/settings.json` — wires the safety hooks into the harness.
- `scripts/merge-gate.js` (**WP-139 adds this as the sixth**) — the gate itself, so a
  self-fixing loop can never auto-merge a change to its own merge logic. (Until WP-139
  merges, `PROTECTED_PATHS` holds the five above; WP-139 also extends the
  `protect-automation` hook to cover it.)

Everything else — fetchers, libs, agent prompts, skills, other config, docs, tests,
`package.json` — auto-merges once tests pass. Every auto-merge is a revertable
commit; a test failure leaves the PR open and fails the run loudly.

### Quota governor (self-throttling on real Max usage)

Claude Code Max quota is finite and shared with interactive use. Two mechanisms keep the agents from silently dying when it runs low:

- **Tiered model + deep-tier fallback** — the 4-hourly workhorse runs on `claude-opus-4-8` (`standard` tier): Opus is always available on this OAuth tier, so the action's exit status is trustworthy and there is **no commit-detection heuristic** — a quiet run that finds nothing new is a legitimate no-op, not a failure. The `deep` tier (escalations + weekly sweep) prefers `claude-fable-5`, detects if it produced no commit (unavailable / weekly-quota exhausted — Fable error-reports as job success), and re-runs on `claude-opus-4-8`. Quota exhaustion is handled by `usage-gate.js` (below), **not** by failing on no-commit — so the deep tier does not fail loudly on a quiet run either. (History: an earlier design tried Fable 5 on every run and failed loudly on no-commit; that produced a ~50% false-failure rate — a no-op was misread as quota death. Fable 5 is in fact available on this tier when weekly quota is not exhausted.)
- **`usage-monitor.yml`** (hourly 05–22 UTC, cron `20 5-22`, no prompt) — runs `scripts/check-usage.js`, which reads REAL account-wide quota. There is no supported quota API for a Max OAuth token, but a **minimal `/v1/messages` call with `CLAUDE_CODE_OAUTH_TOKEN` returns the `anthropic-ratelimit-unified-*` headers** (5h + 7d utilization, reset epochs, allowed/allowed_warning/rejected). It writes `usage-state.json` (green/amber/red + skipAll/skipNiceToHave), **appends the reading to `usage-history.jsonl`** (append-only, trimmed to ~100 days), and rolls that into **`usage-summary.json`** (latest + 24h trend + 7d/30d peak/avg week utilization + hours spent conserving). It then runs `scripts/update-readme-status.js`, which regenerates the **AI-budsjett block in `README.md`** (between `<!-- STATUS:START/END -->` markers) — budget/ops lives in the repo README, not on the calm dashboard. NB: the headers are **account-wide** (shared with interactive use) — this is total quota pressure, not per-agent attribution. The `improve` agent mines `usage-summary.json` (+ `gh run list` for per-agent frequency) to tune schedules/thresholds to the budget.
- **Gate** — every agent runs `scripts/usage-gate.js <critical|optional>` as a pre-flight step and only proceeds `if: steps.usage.outputs.run == 'true'`. `critical` (research, verify, scout) skip only when `skipAll` (session near-exhausted / rejected); `optional` (editorial, coverage-critic, visual-qa, **and the self-fixing loops ui-fix, self-repair, improve**) also skip when amber/red. **Fail-open**: missing/stale (>3h)/unparsed state ⇒ run. The dashboard shows a quiet "AI-budsjett" line from `usage-state.json`.

### Coverage & correctness loops (the core mission)

The product's primary goal is **correct when/where info and complete coverage**
(see interests.json owner priorities). Four loops enforce it:

1. **Streaming contract** — every AI-research event must carry Norwegian viewing
   options in `streaming` (or explicitly empty + noted). Priors live in the
   `norwegian-rights` skill; football ground truth in `tv-listings.json`.
2. **Write-time fact-check** — research spawns a fresh-context subagent that
   independently verifies time+streaming on candidate events *before* they are
   written; unverifiable events are demoted or dropped.
3. **Grader gate** — research runs end with an independent grader subagent
   scoring against `scripts/agents/rubrics/research-rubric.md` (one bounded
   revision pass, fail-open, result recorded in research-log `quality`).
4. **Calibration ledger** — verify appends one JSONL record per source check;
   `aggregate-calibration.js` turns them into per-source trust stats that steer
   the research agent's source choices.

### Harness-enforced contracts (hooks + skills)

- `.claude/settings.json` wires two hooks (shared by CI agents and local sessions):
  - **PreToolUse** `scripts/hooks/protect-interests.js` — blocks any Write/Edit/Bash
    mutation of `scripts/config/interests.json` (user-owned; enforcement, not convention).
    **CI-only**: it fires only when `GITHUB_ACTIONS`/`CI` is set — the threat is an
    unattended agent drifting the user's intent. A human in a local Claude Code session
    *is* the user editing their own file, so the hook exits 0 and stays out of the way.
  - **PostToolUse** `scripts/hooks/validate-after-write.js` — runs `validate-events.js`
    after every write to `docs/data/events.json` and feeds failures back to the agent
- `.claude/skills/` holds agent playbooks with progressive disclosure (loaded when
  relevant, not stuffed into prompts): `x-sources` (X/Twitter as an indirect source —
  account list + trust rules), `norwegian-rights` (NRK/TV2/Viaplay priors),
  `cs2-sources` (CS2 schedules + streaming — Liquipedia/HLTV/official-X ground truth
  for 100 Thieves / rain matches incl. smaller tournaments, Twitch/Kick viewing; the
  fetcher covers scheduled matches, research/verify cover the late/X-only ones), and
  `source-quirks` (**the qualitative learning loop**: structural failure modes of
  specific sources + how to compensate, e.g. ESPN mis-dating F1 weekends — read by
  research/verify/coverage-critic, appended by `verify` when a repeated, mechanistic
  quirk is confirmed. This is where a source's failure mode is learned *once* instead
  of rediscovered weekly; distinct from `calibration.json`, which is the quantitative
  "how much to trust" side). Agents update their own skills when they learn something
  durable; tests enforce frontmatter and that prompt references point at existing skills.

### Config model

- **`scripts/config/catalog.json`** — **the server's coverage compass (WP-96): "what Sportivista COVERS", not what any one person follows.** `tier1` = sports covered wholesale; `tier2` = the named entity long-tail (athletes/teams/tournaments) that admits events in sports we do NOT cover wholesale (chess/esports entity-gated; tennis via majors + names). `build-events.js`'s `isCovered` and the research/verify/coverage agents key off this. AI-managed (research rewrites it); validated by `catalog.schema.json`. Personal precision (Carlsen-only, 100-Thieves-only, …) is REMOVED from the server and lives only in each user's on-device lens (`docs/js/lens.js` + the web profile store; iOS `FeedCompiler` per profile).
- **`scripts/config/interests.json`** — the OWNER's private profile / catalog seed. **The human owns this; AI never writes here.** Since WP-96 it is no longer the server compass (catalog.json is) and is no longer published to `docs/data/`; it seeds the catalog and remains the owner's personal lens profile + the source for the owner-scoped `events.ics` (its VALARM reminders, computed at build time in `build-ics.js` via `mustWatchEntity`). "AI never writes here" is precise: the two ways it changes are both the human's own intent — (a) the human edits the file directly, or (b) a *follow-request* (below) which a deterministic script transcribes.
- **`scripts/config/tracked.json`** — AI-managed, transparent — the catalog's bookkeeping (the concrete, dated events/entities behind the catalog's coverage). Every entry has `reason`, `addedAt`, `addedBy`, `evidence` (which must cite a `catalog.json#`/`interests.json#` basis), optional `expires`. Rewritten by the research agent, seeded manually at v2 launch.
- **`scripts/config/sources.json`** — **kilderegisteret med rettslig grunnlag (WP-240): "hvor kommer faktumet fra, og har vi lov til å hente det".** One entry per data source, validated by `sources.schema.json` (`tests/sources-schema.test.js`). Per source: `role` — the chain from fact to screen, and the doctrine the later WPs key off: `primary` (the body that CREATES the fact — A.S.O. for Tour de France, Norsk Toppfotball for Eliteserien), `federation` (sanctions the calendar; the local organiser sets the clock — UCI, FIS, IBU), `official-broadcaster` (authoritative for the CHANNEL, never for the time), `aggregator` (ESPN, tvkampen — the STRONGEST sui generis database right and the WEAKEST actual authority, i.e. exactly the wrong end to build on), `encyclopedic`, `media`; `authorityFor` (what it is authoritative for, `sport` or `sport:competition` — a `primary`/`federation` must have at least one, test-enforced); `facts` (which fact types it carries — `start-time` and `channel` are the two the product stands or falls on); `terms` (what the source's own terms say about automated access, with the exact URL the conclusion rests on); `tdmReservation` (DSM art. 4 — whether the rightsholder has machine-readably reserved text-and-data-mining); `robots` (robots.txt for the paths we ACTUALLY touch, kept separate from terms because they systematically diverge); `status` (`in-use` = a fetcher pulls it or the agents cite it repeatedly; `candidate` = the primary source we OUGHT to use). **Ownership: AI-maintained, human-audited.** Agents may add sources and refresh a `reviewedAt`, but the register's value is that every claim is checkable — so a field we have not confirmed stays `"unknown"`, never a guess. A guessed `"permitted"` is worse than no entry, because it looks like documentation. This is the artifact you put in front of Apple under App Review guideline 5.2.2, and in front of the lawyer. It DESCRIBES today's reality and changes nothing on its own: WP-241 builds the authority map, WP-242 wires provenance per fact, WP-245 lets `calibration.json` bind source choice (via each entry's `calibrationKey`).
- `scripts/config/sports-config.js` + `norwegian-golfers.json` — static fetcher infrastructure (not curated event data).

**Published-artefaktenes rekkevidde (WP-131):** exactly ONE published artifact is deliberately owner-scoped — **`docs/data/events.ics`** (the owner's calendar, whose VALARM reminders follow `interests.json` via `mustWatchEntity` in `build-ics.js`). **Everything else in `docs/data/` is USER-NEUTRAL** — it carries what Sportivista *covers* (catalog.json), never one person's *precision*. Catalog-based coverage is the product and is fine to publish; owner precision — favourites, must-see, a Lyn-angle, reminder lead time — is NOT: `build-events.js` publishes `events.json` with no `mustWatch` stamp, and each client recomputes its own must-see/reminders from its device profile (iOS `FeedCompiler`/`NotificationPlanner`; the web now from its OWN `localStorage`/iCloud profile via `lens.js` — see "Web personalisering", or intrinsic signals when the profile is empty). `interests.json` itself remains the owner's private seed (not published, WP-96). When adding a published field, ask: is it coverage (product → publish) or precision (owner → keep it on the owner artifact / the device lens)?

### Follow-request flow (human-initiated edits to interests.json)

`docs/rediger.html` (`docs/js/edit.js`) lets the owner add/remove a follow from the
dashboard by opening a **GitHub Issue Form** (`.github/ISSUE_TEMPLATE/follow.yml`).
The `follow-request.yml` workflow then **deterministically** transcribes that form
into `interests.json` (`scripts/apply-follow-request.js` — parse → validate against
`interests.schema.json` → write; NOT AI), commits to main, and kicks the static
pipeline to republish. It is **OWNER-gated**: the job only runs for issues whose
`author_association == 'OWNER'` (GitHub sets this from the real author and it can't
be forged), so a stranger's issue in the public repo is ignored. This is a
human-initiated, OWNER-gated write path — consistent with "AI never writes here":
the human is still the author, the script is just a typist. (It writes
`scripts/config/interests.json`, so it is *not* one of the CI agents the
protect-interests hook blocks — it is the sanctioned human path.)

### Frontend

Pure static HTML/CSS/JS on GitHub Pages (PWA). No build step. **Calm design** —
the whole page is one quiet, scannable overview of the events you follow;
no dashboard grid, no competing panels.

**`DESIGN.md` is the normative UI contract** for every surface. Any agent or human
changing UI reads it first and never deviates without an explicit owner instruction.
It is an **Apple-native baseline** (semantic system colours, Dynamic Type, SF
Symbols, amber as the one accent) that **every surface now follows** — the iOS app +
widget and, since the 18.07 reskin (commit `1a5e89d31`), the web (`docs/`) too. **The
old Tekst-TV exception is CLOSED** (DESIGN.md § Cross-surface, lines 290–297): the
teletext-rooted identity (a monospace type stack, near-black `#0A0A0C` page, warm
paper) is retired. Web keeps its own layout details (one column max 640px, the
day-grouped agenda) but its colours and type are now the baseline. (WP-128: the
ticking amber header clock was removed for iOS parity; the header keeps the theme
glyph ◐ as a deliberate exception since web has no "Deg" screen — see DESIGN.md
§ Cross-surface.) The web values below must stay verifiable against `base.css`;
DESIGN.md is the source of intent behind them.

- `docs/index.html` — shell: header (wordmark · date · theme toggle), one quiet editorial headline line, live-now line (conditional), the agenda, "Dette dekker vi" disclosure, footer. `docs/rediger.html` — the follow-request page (see below); `docs/activity.html` — the ops/activity view.
- `docs/css/` — `base.css` (Apple-native tokens: true-black dark default `#000000` (cell `#1C1C1E`), grouped-light `#F2F2F7` (cell `#FFFFFF`) via prefers-color-scheme; amber `#FFB000` dark / `#9A6800` light as the ONLY accent; the **system font stack** — `-apple-system, BlinkMacSystemFont, "SF Pro Text", …` — with tabular numerals opted in where digits must align; max-width 640px, fixed 120px time column), `layout.css` (single centered column, all breakpoints), `cards.css` (agenda rows, day groups)
- `docs/js/` — the `Dashboard` class is split along its seams across a shared prototype (window-global, no build step): `dashboard.js` (lifecycle + hero + the day-grouped agenda), `live.js` (ESPN live polling, 60s), `detail.js` (expand/detail + AI-provenance modal + follow buttons), `followed.js` ("Dette dekker vi" disclosure), `chrome.js` (date/footer/usage/install-hint/app-promo). `theme.js` is the shared 3-step theme toggle (system → dark → light) used on all pages; `shared-constants.js` holds shared utilities (time windows, escaping, name matching) that mirror the server helpers; `edit.js` drives `rediger.html`. **Personalisering (web-parity, 20–21.07):** `lens.js` (the SHIPPED lens — a config-driven JS twin of `FeedCompiler`, see below), `profile-sync.js` (the CRDT merge + share codec + localStorage profile store — a JS twin of `ProfileMerge`/`ProfileSyncModel`/`ProfileShareCodec`), `profile-ui.js` (follow/unfollow wiring + the affinity lift), `assistant.js` (a deterministic on-device assistant), `icloud-config.js` + `icloud-sync.js` (CloudKit JS two-way sync).
- Each event row answers only: **when · what · where to watch**. Must-see (favorite / importance≥4 / Norwegian / a followed team-or-athlete) gets a small accent dot — the gentlest possible emphasis, never a card. Channel shown quietly, with an honest faint "–" when unknown.
- The editorial agent produces a single `headline` block shown as one quiet line under the date (a "nice extra"), nothing more. AI-research events carry a small ⓘ that opens a source modal on tap.

### Web personalisering + iCloud-synk (web-parity, 20–21.07.2026)

The web was catalog-wide with no per-user state; it now has a **personal profile**
that makes the board yours — built so it stays in sync with the iOS app over time,
not as a one-off copy.

- **Shared lens tunables — `docs/config/lens-config.json`.** The ONE source for the
  lens's tunable parameters (`followBroadlyDefault`, `entityGatedSports`,
  `retentionDays`, `mustSeeImportance`, `enduranceSports`, `sportNb`). Served by
  Pages AND bundled into the iOS app/widget/test targets (`ios/project.yml`
  references `../docs/config/lens-config.json`; `Feed/LensConfig.swift` decodes it).
  Change a value there and both platforms follow. The lens ALGORITHM stays twinned
  (`FeedCompiler.swift` ↔ `docs/js/lens.js`) and is frozen bit-for-bit by the golden
  feed-vectors — only PARAMETERS are config. `dashboard.isMustSee` now delegates to
  the shipped `lens.js`, so the code users run IS the code the vectors pin.
- **Personal profile — `docs/js/profile-sync.js`.** A JS twin of the iOS profile
  core: the mergeable `ProfileSyncState` (rules/episodic/counters/facts), the CRDT
  merge (LWW+tombstone / union / G-counter), the `ProfileShareCodec` (deflate-raw +
  base64url), and a `localStorage` store (`ss-profile`, `ss-device-id`). Follow /
  unfollow a team or athlete from any event's detail sheet; an EMPTY profile
  reproduces the old catalog-wide board byte-for-byte. Cross-device import via the
  app's QR/deep-link payload (`#profile=…` on `rediger.html`), no login.
- **iCloud two-way sync — `docs/js/icloud-sync.js` + `icloud-config.js`.** Because
  CloudKit JS can't page the app's per-record types, iOS also publishes a plaintext
  **`ProfileSnapshot`** per device (`CloudKitProfileSync.writeSnapshot` — one
  `payload` field = the codec string of the full merged state; `pull()` folds every
  device's snapshot back in). The web signs in with the user's own Apple ID
  (CloudKit JS, `rediger.html` → "Synk med iCloud"), reads/merges/writes snapshots —
  genuine two-way sync, **zero Sportivista server** (the user's own private iCloud).
  The `apiToken` in `icloud-config.js` is a PUBLIC, origin-restricted web token
  (safe to commit). The profile is deliberately **plaintext** (not E2E): a sports
  follow-list is low-sensitivity, and plaintext is what lets the user's own web
  sign-in read it — the privacy boundary that matters (data only in the user's own
  private DB, never our server) is unchanged. Setup: `docs/icloud-sync-setup.md`.
- **Deterministic assistant — `docs/js/assistant.js`.** A grounded, on-device Q&A
  over the personal feed (window questions, an entity's next event, a sport/window
  filter, follow intent), reusing `lens.js`. No model is load-bearing (per the
  web-LLM feasibility spike: Norwegian quality at a browser-LLM's size is the
  binding constraint — a Chrome Prompt API layer is a documented progressive
  enhancement, WebLLM deferred). A calm input under the hero.
- **Adaptive personalisation (WP-138B; renumbered 21.07 from the double-assigned WP-138 — the pre-merge archive validation in `ios-tests.yml` keeps that number) — `ios/Sportivista/Memory/Affinity.swift`.**
  On-device: turns the already-recorded `BehaviorCounter` signal (open/expand/
  dismiss per entity/sport) into a mild, deterministic affinity that LIFTS what you
  engage with in "Det du følger" (a tie-break where order was otherwise arbitrary —
  never a relevance gate, never re-sorting the chronological agenda). Explained in
  "Hva jeg vet om deg". Null new data collection. The cross-user half (axis B —
  public follow-requests → opt-in CloudKit PUBLIC DB) is a documented PLAN.md
  strategy item, not built.

### Data files (docs/data/, gitignore-whitelisted)

`events.json`, `featured.json`, `standings.json`, `rss-digest.json`, `recent-results.json`,
`tracked.json` (published copy), `research-log.json`, `verify-log.json`, `meta.json`,
`coverage-gaps.json`, `coverage-audit.json` (coverage-critic), `visual-qa-log.json` (visual-qa),
`ui-fix-log.json` (ui-fix), `self-repair-log.json` (self-repair), `improve-log.json` (improve),
`usage-state.json` + `usage-history.jsonl` + `usage-summary.json` (quota governor: snapshot, append-only history, digest),
`build-alert.json` (build-events health signal, written every run with `ok: true/false` — WP-94's degrade-gracefully gate keeps the previous good `events.json` on a schema/contract break instead of publishing a bad one, and records the violation here for self-repair; clears automatically on the next clean build),
`scout-log.json`, `calibration.json` + `calibration-ledger.jsonl`, `tv-listings.json`,
`entities.json` (stable-id index of known athletes/teams/tournaments/leagues, published by `build-entities.js`; `build-events.js` uses it to stamp `entityId` onto matched events),
`news.json` (lens-ready news pointers — `id`/`title`/`link`/`source`/`sport`/`entityIds`/`publishedAt`, NEVER article text — built from `rss-digest.json` × the entity index by `scripts/lib/news.js` and published by `build-events.js`; dedupe-on-link, cap ~100 items / 7 days, byte-idempotent; the client lens-filters on `entityIds`/`sport` per profile),
`manifest.json` (per-file `bytes` + `sha256`, published by `build-manifest.js` — the sync contract that lets a client diff its cache without re-downloading everything),
`app-version.json` (siste ios/-commit, published by `build-events.js` via `scripts/lib/app-version.js` — the iOS app compares its build-time stamp against it and shows «SISTE / NYERE FINNES»),
`catalog.json` (a published read-only copy of `scripts/config/catalog.json` — "what we cover" — so the dashboard's "Dette dekker vi" surface can render it; WP-96 replaced the published `interests.json`, which is now the owner's private profile and is no longer published),
per-sport source files (`football.json` …), `events.ics`.

New data files must be whitelisted in `.gitignore` (which ignores `docs/data/*.json`
by default) or the agents' `git add` silently skips them.

### Companion docs & the iOS app

- **`DESIGN.md`** — the **normative design contract** for every surface: tokens,
  type, layout laws. **Every surface now follows the Apple-native baseline**
  (semantic system colours + Dynamic Type) — the iOS app + widget and, since the
  18.07 reskin, the web (`docs/`) too (the Tekst-TV exception is closed). Agents that
  touch UI read it first; it is verified value-for-value against the code and is *not*
  freely rewritten.
- **`PLAN.md`** — the commercialization/execution backlog (phases, work packages,
  gates). Long-horizon planning lives here, not in this file; consult it for what's
  queued/in-flight and update the relevant WP status row when you complete one.
- **`ios/`** — the native iOS app (SwiftUI, a separate track from the web dashboard).
  It is documented on its own in **`ios/README.md`** (a subsystem map: one section per
  `Sportivista/` directory — Assistant, Profile, Memory, Onboarding, Widget — plus targets/
  signing and testing). This CLAUDE.md covers the web pipeline; for anything under
  `ios/`, start from `ios/README.md`.

## Development commands

**Arbeidsflyt-skills for Claude-økter** (`.claude/skills/`, lastes ved behov):
`ios-dev` — bygg/test/FM-eval/enhets-installering av iOS-appen + fallgruvene
(DerivedData, target-medlemskap, prompt-budsjettet, kabel-vs-wifi);
`wp-flow` — arbeidspakke-driften (bølgeplanlegging uten filkollisjoner,
delegering til worktree-agenter, merge-/konfliktoppskrifter, verifiserings-
matrisen per flate). Les den relevante FØR du planlegger/bygger.

- `npm run dev` — local server on port 8000
- `npm run build` — fetch data + build events + calendar
- `npm run build:events` / `npm run validate:data` / `npm run build:calendar`
- `npm run fetch:results`
- `npm test` — vitest, 74 focused files (1218 tests), a few seconds
- `npm run screenshot` — Playwright dashboard screenshot (`node scripts/screenshot.js out.png --width=1280 --full-page`)

## Conventions

- **Event time filtering**: always use `isEventInWindow(event, start, end)` (`scripts/lib/helpers.js` server-side, `shared-constants.js` client-side). Never write manual `new Date(e.time) >= start` filters — they drop multi-day events (golf, stage races).
- **AI-research event schema**: `source: "ai-research"`, `confidence: high|medium|low`, `evidence: [urls]`, `researchedAt`; verify agent adds `verifiedAt`, `verificationStatus`, `verificationSources`. `confidence: "high"` requires 2+ evidence URLs (enforced by `validate-events.js`).
- **build-events must never erase AI-research events** — it partitions by `source` and re-attaches non-duplicates.
- Norwegian-language UI strings; proper nouns stay in original language.
- Tabs for indentation in `scripts/`; escape all user/data strings with `escapeHtml` in client rendering.

## Testing

`tests/` — 74 files / 1218 tests, all fast and network-free:
- Pipeline: `build-events`, `build-events-schema`, `build-events-degrade` (WP-94 degrade-gracefully gate), `events-schema`, `validate-events`, `build-ics`, `build-entities`, `build-manifest`, `news` (news.json pointer build), `detect-coverage-gaps`, `aggregate-calibration`, `integration-pipeline` (spawn scripts against temp `SPORTSYNC_DATA_DIR`/`SPORTSYNC_CONFIG_DIR`)
- Fetchers: `fetch-results`, `fetch-results-golden` (byte-identical output freeze), `fetch-rss`, `fetch-standings`, `f1-fetcher`, `esports`, `golf`, `football-fetcher` (coverage is the CATALOG's call, not the owner's follow list — plus the ESPN→Norwegian club naming)
- Libs: `helpers`, `event-normalizer`, `response-validator`, `llm-client` (mocked fetch), `tvkampen-scraper`, `pgatour-scraper`, `norwegian-rights`, `usage`, `usage-gate` (freshness-aware skip logic), `escalate-research` (scout/coverage-critic dispatch), `app-version` (iOS «har jeg siste?» half), `asc-api` (App Store Connect release-lane client), `readme-status`, `merge-gate`, `apply-follow-request`
- Client: `dashboard-cards` — loaded via `tests/helpers/load-client.js` (vm sandbox, no jsdom); `feed-vectors` (golden personalisation vectors, see `tests/fixtures/feed-vectors/DIVERGENCES.md`)
- Coherence: `agent-prompts` (prompt contracts match client renderers; scans every `scripts/agents/*.md` for skill references), `workflows` (YAML references existing files), `interests-schema`, `tracked-schema`, `catalog-schema` (the AI-managed coverage compass), `design-tokens` (`design/tokens.json` locks shipped CSS/Swift reality), `ios-dynamic-type-gate` (HIG gate: no isolated `.system(size:)` in `ios/Sportivista/`), `hooks` (the safety hooks)

Coherence tests are the v2 replacement for v1's feedback loops: if a prompt, workflow,
or schema drifts from the code, CI fails.

## Rules for automated/agent changes

- **Never modify `scripts/config/interests.json`** — it is user-owned.
- Agents commit only their contracted outputs (see each prompt's output contract).
- **Protected paths — never auto-merged** (self-fixing loops leave them as an open PR for review; enforced by `scripts/merge-gate.js`): `.github/workflows/**`, `.github/actions/**` (a forward reservation — the directory does not exist yet), `scripts/hooks/**`, `scripts/config/interests.json`, `.claude/settings.json`, and — once WP-139 lands — `scripts/merge-gate.js` itself. Everything else the loops touch auto-merges once tests pass (see Autonomy model).
- Run `npm test` before committing code changes; run `node scripts/validate-events.js` after writing events.
- Always `git pull --rebase` before pushing — the static pipeline and agents commit to main on schedules.

## Extending

**New sport**: write a fetcher in `scripts/fetch/` that outputs `{ tournaments: [...] }`
to `docs/data/{sport}.json` and register it in `scripts/fetch/index.js`.
`build-events.js` auto-discovers the file by convention.

**New tracked interest**: edit `scripts/config/interests.json` — the research agent
reconciles `tracked.json` against it on the next run.

**Sports without an API** (biathlon, cross-country, chess, most cycling): no code needed —
the research agent finds and maintains these events from the web.
