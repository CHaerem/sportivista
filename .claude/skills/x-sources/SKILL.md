---
name: x-sources
description: How to use X/Twitter as an indirect sports source — account list, search patterns, and trust rules for confidence levels. Use when researching schedule changes, broadcaster/streaming announcements, start lists, or athlete withdrawals.
---

# Playbook: X/Twitter as a source

X is often first with schedule changes, broadcaster announcements, withdrawals and
start lists — but x.com blocks unauthenticated fetching and the API is paid.
**Never try to fetch x.com or nitter directly** (verified dead/blocked 2026-07-03).
**The oEmbed/embed endpoint is ALSO off-limits**: `publish.twitter.com/robots.txt`
explicitly disallows `/oembed` for all agents (verified 2026-08-27) — X has
machine-readably reserved even the embed surface, so the courtesy layer would
refuse the call and so must you. Reach X content **indirectly via web search**:
search engines index posts, and Norwegian sports media quote relevant posts
within minutes to hours. (`sources.json#x-twitter` carries the full legal
picture; the only sanctioned DIRECT route is the pay-per-use API — an owner
decision, see COMMERCIAL.md WP-221.)

## Mirror-first: go to the surface that legally mirrors the post

For each information type there is a faster, fetchable surface that mirrors X
within minutes — search it FIRST, use generic X-search only as fallback:

| Info type | Mirror to read (fetchable, often faster than press) |
|---|---|
| CS2 match changes / late announcements | HLTV.org + Liquipedia (editors mirror org/tournament posts in minutes — see `cs2-sources`) |
| Football transfers / club news | The CLUB's own site is the PRIMARY source — the tweet is just distribution. Then NTB/VG/TV 2. |
| Golf field/tee-time/format changes | pgatour.com / europeantour.com event pages + officialworldgolfranking; golf press (GolfDigest, bunkered) |
| Chess schedule/pairing changes | The organiser's site (Norway Chess, FIDE calendar, chess.com/events), chess24/Lichess coverage |
| Broadcaster/rights announcements | The broadcaster's own press/schedule pages (NRK presse, TV 2, Viaplay) — see `norwegian-rights` |
| Startlists/withdrawals (winter sports, athletics) | Federation live sites (FIS, IBU, World Athletics) publish entry lists directly |

## How to search
- `"<account name>" <topic>` e.g. `"NRK Sport" skiskyting sendeplan`
- `site:x.com <athlete/event>` for indexed posts
- `<athlete name> twitter <event>` to surface media coverage of a post

## Trust rules (feed into confidence levels)
- Post from an **official federation/broadcaster/club account** (see list) reported
  consistently by 1+ index/media source → counts as one authoritative source.
- Journalist or insider account → `medium` confidence at best; corroborate before `high`.
- Fan/unverified account → lead only; never evidence on its own.
- Always record the *indirect* URL you actually read (news article / search result),
  not a bare x.com link you could not fetch.

## Accounts that matter (update when you learn of better ones)
Broadcasters (streaming/rights announcements — key for "hvor kan jeg se det"):
- @NRK_sport (NRK), @TV2Sporten (TV 2), @ViaplaySportNO (Viaplay), @discoveryplusNO / @Eurosport_NO

Federations & tours (schedule changes, start lists):
- @IBU_WC (biathlon), @FIS_skiing / @fisalpine / @FISCrossCountry (ski), @pgatour, @DPWorldTour,
  @ATPtour / @WTA, @F1, @FIDE_chess, @letour (Tour de France), @UCI_cycling

Clubs & teams (lineups, fixture changes):
- @LFC (Liverpool), @FCBarcelona, @LynFotball (Lyn Oslo), @100Thieves (CS2), @UnoXteam (cycling)

Athletes (participation, withdrawals):
- Viktor Hovland (no active account — follow via golf media), @CasperRuud98 (Casper Ruud),
  @MagnusCarlsen (Magnus Carlsen)

## Maintenance
When a search reveals an account name here is wrong or a better official account
exists, update this file in the same commit as your other outputs. Date-stamp
non-obvious claims. This playbook was seeded 2026-07-03.
