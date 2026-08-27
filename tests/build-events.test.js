// build-events.js: merges sport JSONs + curated configs, preserves AI-research events.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { matchInterest } from "../scripts/lib/helpers.js";

let dataDir, configDir;

function runBuild() {
	execFileSync("node", ["scripts/build-events.js"], {
		env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir, SPORTSYNC_CONFIG_DIR: configDir },
		cwd: process.cwd(),
	});
	return JSON.parse(fs.readFileSync(path.join(dataDir, "events.json"), "utf-8"));
}

const future = (days) => new Date(Date.now() + days * 86400000).toISOString();

beforeEach(() => {
	dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-data-"));
	configDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-config-"));
	fs.writeFileSync(
		path.join(dataDir, "football.json"),
		JSON.stringify({
			tournaments: [
				{ name: "Premier League", events: [{ title: "Liverpool vs Arsenal", time: future(2), homeTeam: "Liverpool", awayTeam: "Arsenal" }] },
			],
		})
	);
});

afterEach(() => {
	fs.rmSync(dataDir, { recursive: true, force: true });
	fs.rmSync(configDir, { recursive: true, force: true });
});

describe("build-events", () => {
	it("merges sport JSON files into events.json", () => {
		const events = runBuild();
		expect(events).toHaveLength(1);
		expect(events[0].sport).toBe("football");
		expect(events[0].tournament).toBe("Premier League");
	});

	it("merges curated configs with events arrays", () => {
		fs.writeFileSync(
			path.join(configDir, "biathlon-test.json"),
			JSON.stringify({ sport: "biathlon", name: "World Cup", events: [{ title: "Sprint", time: future(3) }] })
		);
		const events = runBuild();
		expect(events.map((e) => e.sport).sort()).toEqual(["biathlon", "football"]);
	});

	it("preserves ai-research events from the previous events.json", () => {
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "biathlon", title: "Mixed relay", time: future(5), source: "ai-research", confidence: "high", evidence: ["a", "b"] },
				{ sport: "football", title: "Old static event", time: future(1) },
			])
		);
		const events = runBuild();
		const aiEvents = events.filter((e) => e.source === "ai-research");
		expect(aiEvents).toHaveLength(1);
		expect(aiEvents[0].title).toBe("Mixed relay");
		// static events are rebuilt from source files, not carried over
		expect(events.find((e) => e.title === "Old static event")).toBeUndefined();
	});

	it("rescues an in-progress static event that dropped out of the latest fetch", () => {
		const startedAgo = new Date(Date.now() - 60 * 60000).toISOString(); // kicked off 1h ago → live
		// The live match is NOT in the current fetch (ESPN stops returning it once
		// it goes live) — only the later, not-yet-started match is.
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "FIFA World Cup", events: [
				{ title: "Later match", time: future(1), homeTeam: "A", awayTeam: "B" },
			] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "FIFA World Cup", title: "Egypt at Argentina", time: startedAgo,
				  homeTeam: "Argentina", awayTeam: "Egypt", streaming: [{ platform: "TV 2 Play" }],
				  verifiedAt: "2026-07-05T08:27:09Z", verificationStatus: "amended" },
				// A FUTURE static event missing from the fetch stays dropped (may be cancelled/moved).
				{ sport: "football", tournament: "FIFA World Cup", title: "Cancelled future", time: future(3), homeTeam: "C", awayTeam: "D" },
			])
		);
		const events = runBuild();
		const live = events.find((e) => e.title === "Egypt at Argentina");
		expect(live).toBeDefined();                       // the live match survived the rebuild
		expect(live.streaming).toEqual([{ platform: "TV 2 Play" }]); // with its verified channel
		expect(events.find((e) => e.title === "Cancelled future")).toBeUndefined(); // future drop stays dropped
	});

	it("keeps an agent-marked cancelled event on the board instead of dropping it", () => {
		// The cancelled match is gone from the fetch; only an unrelated match remains.
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "PL", events: [{ title: "Other", time: future(2) }] }] })
		);
		// Previous build: verify marked a real fixture cancelled (kept, not removed).
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "PL", title: "Cancelled match", time: future(1), status: "cancelled", verificationStatus: "amended" },
			])
		);
		const events = runBuild();
		const c = events.find((e) => e.title === "Cancelled match");
		expect(c).toBeDefined();          // it stays on the board...
		expect(c.status).toBe("cancelled"); // ...still labelled cancelled
	});

	it("carries agent amendments (streaming, verification) onto re-fetched static events", () => {
		const time = future(2);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "PL", events: [{ title: "Derby", time }] }] })
		);
		// Previous build: verify agent added streaming + verification to the static event
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{
					sport: "football", tournament: "PL", title: "Derby", time,
					streaming: [{ platform: "TV 2 Play" }],
					verifiedAt: "2026-07-03T05:30:00Z",
					verificationStatus: "confirmed",
				},
			])
		);
		const events = runBuild();
		const derby = events.find((e) => e.title === "Derby");
		expect(derby.streaming).toEqual([{ platform: "TV 2 Play" }]);
		expect(derby.verificationStatus).toBe("confirmed");
	});

	// The Corales revert-war fix. Helper: a golf event the rights map sends to X,
	// with a prior events.json carrying a verify amendment to Y.
	const runGolfRevertWar = ({ title, tournament, priorStreaming, verifiedAt, verificationSources }) => {
		const time = future(2);
		fs.writeFileSync(
			path.join(dataDir, "golf.json"),
			JSON.stringify({ tournaments: [{ name: tournament, events: [
				{ title, time, norwegian: true, norwegianPlayers: [{ name: "Someone" }] },
			] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{
					sport: "golf", tournament, title, time,
					norwegian: true, norwegianPlayers: [{ name: "Someone" }],
					streaming: priorStreaming,
					verificationStatus: "amended",
					verifiedAt,
					verificationSources,
				},
			])
		);
		const golf = runBuild().find((e) => e.title === title);
		expect(golf).toBeTruthy();
		return golf.streaming.map((s) => s.platform);
	};

	it("a fresh verify amendment survives a differing confident map default (verified-wins)", () => {
		// The Open maps to Viaplay; verify amended to HBO Max and its SOURCES back HBO Max.
		const platforms = runGolfRevertWar({
			title: "The Open Championship", tournament: "PGA Tour",
			priorStreaming: [{ platform: "HBO Max (Sport)", url: "https://www.hbomax.com/no/no/sports/pga-tour" }],
			verifiedAt: new Date().toISOString(),
			verificationSources: ["https://www.hbomax.com/no/no/sports/pga-tour"],
		});
		expect(platforms).toEqual(["HBO Max (Sport)"]); // verify's correction wins over the map's Viaplay
	});

	it("lets the map default reclaim the channel once the verification ages past its TTL", () => {
		const platforms = runGolfRevertWar({
			title: "The Open Championship", tournament: "PGA Tour",
			priorStreaming: [{ platform: "HBO Max (Sport)", url: "https://www.hbomax.com/no/no/sports/pga-tour" }],
			verifiedAt: new Date(Date.now() - 20 * 86400000).toISOString(), // 20 days — past the 14-day TTL
			verificationSources: ["https://www.hbomax.com/no/no/sports/pga-tour"],
		});
		expect(platforms).toEqual(["Viaplay"]); // stale ⇒ the fresh map default wins again
	});

	it("discards a stale revert-war array the map + the event's own sources contradict (the live Corales state)", () => {
		// The actual corrupt live state: streaming=Viaplay, but verificationSources
		// point at hbomax.com and the map now (correctly) says HBO Max. The leftover
		// Viaplay array must NOT be re-pinned — the corrected map wins.
		const platforms = runGolfRevertWar({
			title: "Corales Puntacana Championship", tournament: "PGA Tour",
			priorStreaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport" }],
			verifiedAt: new Date().toISOString(),
			verificationSources: ["https://golferen.no/tv-kampguiden-til-golfarrangementer/", "https://www.hbomax.com/no/en/sports/pga-tour"],
		});
		expect(platforms).toEqual(["HBO Max (Sport)", "Eurosport"]); // corrected map, not the stale Viaplay
	});

	it("upgrades a generic landing URL to a deeper per-event URL from the previous build", () => {
		const time = future(2);
		// biathlon → rights map returns the NRK sport-section landing (tv.nrk.no/direkte, depth 1).
		fs.writeFileSync(
			path.join(configDir, "biathlon.json"),
			JSON.stringify({ sport: "biathlon", name: "IBU World Cup", events: [{ title: "Sprint", time }] })
		);
		// Previous build: verify found the real NRK programme page (deeper).
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "biathlon", tournament: "IBU World Cup", title: "Sprint", time,
				  streaming: [{ platform: "NRK", url: "https://tv.nrk.no/serie/skiskyting/sprint-abc" }] },
			])
		);
		const events = runBuild();
		const sprint = events.find((e) => e.title === "Sprint");
		expect(sprint.streaming[0].url).toBe("https://tv.nrk.no/serie/skiskyting/sprint-abc"); // deep URL survived, not clobbered by /direkte
	});

	it("lifts a bare broadcaster homepage to its sport/live section", () => {
		const time = future(2);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "FIFA World Cup", events: [
				{ title: "Norway vs Brazil", time, homeTeam: "Norway", awayTeam: "Brazil" },
			] }] })
		);
		// Previous build: verify confirmed NRK but wrote the bare homepage URL.
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "FIFA World Cup", title: "Norway vs Brazil", time, homeTeam: "Norway", awayTeam: "Brazil",
				  streaming: [{ platform: "NRK", url: "https://tv.nrk.no" }] },
			])
		);
		const events = runBuild();
		const m = events.find((e) => e.title === "Norway vs Brazil");
		expect(m.streaming[0].url).toBe("https://tv.nrk.no/direkte"); // homepage → sport/live section
	});

	it("keeps a confirmed channel instead of downgrading it to a tentative guess", () => {
		const time = future(2);
		// A World Cup fixture — resolveStreaming would produce the tentative NRK / TV 2 label.
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "FIFA World Cup 2026", events: [
				{ title: "Brazil vs Norway", time, homeTeam: "Brazil", awayTeam: "Norway" },
			] }] })
		);
		// Previous build: verify agent confirmed the real broadcaster (no tentative flag).
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "FIFA World Cup 2026", title: "Brazil vs Norway", time,
				  streaming: [{ platform: "NRK", url: "https://tv.nrk.no" }] },
			])
		);
		const events = runBuild();
		const match = events.find((e) => e.title === "Brazil vs Norway");
		// Confirmed NRK is kept (not downgraded to the tentative NRK/TV 2 guess);
		// the bare homepage is lifted to NRK's live section — which is still only a
		// LANDING page, and WP-246 says so on the entry itself.
		expect(match.streaming).toEqual([{ platform: "NRK", url: "https://tv.nrk.no/direkte", urlKind: "landing" }]);
		expect(match.streaming.some((s) => s.tentative)).toBe(false);
	});

	it("dedupes ai-research events that a static fetcher now covers", () => {
		const time = future(2);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "PL", events: [{ title: "Derby", time }] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([{ sport: "football", title: "Derby", time, source: "ai-research", confidence: "low" }])
		);
		const events = runBuild();
		expect(events.filter((e) => e.title === "Derby")).toHaveLength(1);
		expect(events[0].source).toBeUndefined();
	});

	it("de-dupes an ai-research event a static fetcher already covers under a different start time", () => {
		const base = new Date(Date.now() + 2 * 86400000);
		const at = (h) => { const d = new Date(base); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
		const end = () => { const d = new Date(base.getTime() + 3 * 86400000); d.setUTCHours(20, 0, 0, 0); return d.toISOString(); };
		// Static ESPN event at 04:00 with the field data.
		fs.writeFileSync(
			path.join(dataDir, "golf.json"),
			JSON.stringify({ tournaments: [{ name: "PGA Tour", events: [
				{ title: "Genesis Scottish Open", time: at(4), endTime: end(), norwegian: true, norwegianPlayers: [{ name: "Viktor Hovland", teeTime: "09:39" }] },
			] }] })
		);
		// Previous build: the research agent re-added the SAME tournament at 06:00.
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "golf", tournament: "DP World Tour / PGA Tour", title: "Genesis Scottish Open", time: at(6), endTime: end(), source: "ai-research", confidence: "high", evidence: ["a", "b"] },
			])
		);
		const events = runBuild();
		const scottish = events.filter((e) => e.title === "Genesis Scottish Open");
		expect(scottish).toHaveLength(1);            // not two rows for the same tournament
		expect(scottish[0].source).toBeUndefined();  // kept the static one (carries the field/tee times)
	});

	it("grafts ai-research enrichment onto a bare static stub it dedupes against", () => {
		// Regression: ESPN's tennis feed lists "EFG Swiss Open Gstaad" as a bare
		// stub (no player, not norwegian) — off-interest, so the relevance filter
		// would drop it. The research agent's copy carries Casper Ruud + TV 2 Play.
		// The fuzzy-dedupe must merge that enrichment onto the stub, else BOTH copies
		// vanish (the real-world Gstaad / Ruud silent drop).
		const base = new Date(Date.now() + 3 * 86400000);
		const at = (h) => { const d = new Date(base); d.setUTCHours(h, 0, 0, 0); return d.toISOString(); };
		const end = () => { const d = new Date(base.getTime() + 6 * 86400000); d.setUTCHours(16, 0, 0, 0); return d.toISOString(); };
		fs.writeFileSync(
			path.join(dataDir, "tennis.json"),
			JSON.stringify({ tournaments: [{ name: "ATP/WTA Tour", events: [
				{ title: "EFG Swiss Open Gstaad", time: at(4), endTime: end() },
			] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "tennis", title: "Swiss Open Gstaad 2026 (Casper Ruud)", time: at(9), endTime: end(),
					norwegian: true, norwegianPlayers: [{ name: "Casper Ruud" }],
					streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport" }],
					source: "ai-research", confidence: "high", evidence: ["a", "b"] },
			])
		);
		const events = runBuild();
		const gstaad = events.filter((e) => /gstaad/i.test(e.title));
		expect(gstaad).toHaveLength(1);                              // survives, not dropped
		expect(gstaad[0].norwegian).toBe(true);                     // enrichment grafted on
		// WP-05: "Casper Ruud" is a real tracked athlete entity (sport tennis), so
		// the enrichment pass stamps entityId — expected, not a regression.
		expect(gstaad[0].norwegianPlayers).toEqual([{ name: "Casper Ruud", entityId: "casper-ruud" }]);
		expect(gstaad[0].streaming).toEqual([{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }]);
		// And it must PERSIST: the next rebuild re-fetches the bare stub, so the
		// grafted enrichment has to carry forward or the event vanishes an hour later.
		const rebuilt = runBuild().filter((e) => /gstaad/i.test(e.title));
		expect(rebuilt).toHaveLength(1);
		expect(rebuilt[0].norwegian).toBe(true);
		expect(rebuilt[0].norwegianPlayers).toEqual([{ name: "Casper Ruud", entityId: "casper-ruud" }]);
		expect(rebuilt[0].streaming).toEqual([{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }]);
	});

	it("dedupes a World Cup knockout placeholder against the ai-research event, keeping the AI copy", () => {
		// Regression: ESPN re-emits knockout slots as bracket placeholders
		// ("Semifinal 2 Winner at Semifinal 1 Winner") whose title shares NO words
		// with the ai-research "VM-finalen 2026". The sport|title|time key misses
		// them and, before this fix, the title-only fuzzy check missed them too — so
		// both survived and verify had to remove the placeholder by hand every day.
		// They match on venue + exact kickoff; keep the human-titled, channel-confirmed
		// AI event and drop the placeholder.
		const time = future(4);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "FIFA World Cup", events: [
				{ title: "Semifinal 2 Winner at Semifinal 1 Winner", time, round: "Finale",
				  homeTeam: "Semifinal 1 Winner", awayTeam: "Semifinal 2 Winner", venue: "MetLife Stadium" },
			] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "FIFA World Cup", title: "VM-finalen 2026", time,
				  round: "Finale", venue: "MetLife Stadium, East Rutherford, New Jersey",
				  streaming: [{ platform: "NRK", url: "https://tv.nrk.no/direkte" }],
				  source: "ai-research", confidence: "high", evidence: ["a", "b"],
				  verificationStatus: "confirmed" },
			])
		);
		const events = runBuild();
		const wc = events.filter((e) => e.tournament === "FIFA World Cup");
		expect(wc).toHaveLength(1);                                   // not two rows for the final
		expect(wc[0].title).toBe("VM-finalen 2026");                 // the human title won
		expect(wc[0].source).toBe("ai-research");                    // the placeholder was dropped
		expect(wc[0].streaming).toEqual([{ platform: "NRK", url: "https://tv.nrk.no/direkte", urlKind: "landing" }]);
		// The placeholder team names must not leak onto the surviving event.
		expect(wc[0].awayTeam).not.toBe("Semifinal 2 Winner");
	});

	it("does NOT merge two different same-time matches at different venues", () => {
		// Safety: the venue path must not collapse unrelated fixtures. Two knockout
		// slots kick off at the same instant but at different stadiums — both stay.
		const time = future(4);
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "FIFA World Cup", events: [
				{ title: "Semifinal 2 Winner at Semifinal 1 Winner", time, homeTeam: "Semifinal 1 Winner", awayTeam: "Semifinal 2 Winner", venue: "MetLife Stadium" },
			] }] })
		);
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "football", tournament: "FIFA World Cup", title: "VM-bronsefinale", time,
				  venue: "Hard Rock Stadium, Miami Gardens, Florida",
				  source: "ai-research", confidence: "high", evidence: ["a", "b"] },
			])
		);
		const events = runBuild();
		const titles = events.filter((e) => e.tournament === "FIFA World Cup").map((e) => e.title).sort();
		expect(titles).toEqual(["Semifinal 2 Winner at Semifinal 1 Winner", "VM-bronsefinale"]);
	});

	it("filters out events older than 14 days", () => {
		fs.writeFileSync(
			path.join(dataDir, "football.json"),
			JSON.stringify({ tournaments: [{ name: "PL", events: [
				{ title: "Ancient", time: new Date(Date.now() - 20 * 86400000).toISOString() },
				{ title: "Upcoming", time: future(1) },
			] }] })
		);
		const events = runBuild();
		expect(events.map((e) => e.title)).toEqual(["Upcoming"]);
	});

	it("publishes tracked.json to the data dir when present in config", () => {
		fs.writeFileSync(path.join(configDir, "tracked.json"), JSON.stringify({ version: 1, leagues: [] }));
		runBuild();
		expect(fs.existsSync(path.join(dataDir, "tracked.json"))).toBe(true);
	});

	// WP-04: participation-form normalization.
	it("normalizes a freshly-built event's participation to canonical form (pushEvent)", () => {
		// Regression: the chess fetcher path used to emit norwegianPlayers: null and
		// bare-string participants (scripts/lib/event-normalizer.js). build-events.js's
		// own pushEvent() must guarantee the canonical shape regardless of what any
		// sport file emits.
		// WP-92: chess is now entity-gated (not broadly covered), so the catalog must
		// cover the player to keep this event on the board — the point of this test is
		// participation normalization, not the coverage decision. WP-96: the compass
		// is catalog.json (tier2), not interests.json.
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { athletes: [{ name: "Johan-Sebastian Christiansen", sport: "chess" }] } })
		);
		fs.writeFileSync(
			path.join(dataDir, "chess.json"),
			JSON.stringify({ tournaments: [{ name: "Sant Martí", events: [
				{ title: "Round 1", time: future(1), participants: ["Johan-Sebastian Christiansen"], norwegianPlayers: null },
			] }] })
		);
		const events = runBuild();
		const ev = events.find((e) => e.title === "Round 1");
		expect(ev).toBeDefined();
		expect(ev.participants).toEqual([{ name: "Johan-Sebastian Christiansen" }]);
		expect(ev.norwegianPlayers).toEqual([]);
	});

	it("normalizes a preserved ai-research event's participation to canonical form (bypasses pushEvent)", () => {
		// Regression: preserved ai-research / kept-on-board events are pushed
		// straight from a previous events.json (see the preservation pass), so they
		// never go through pushEvent(). The final pass over `kept` must catch them.
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([
				{ sport: "biathlon", title: "Mixed relay", time: future(5), source: "ai-research", confidence: "high", evidence: ["a", "b"],
				  participants: ["Johannes Thingnes Bø"], norwegianPlayers: null },
			])
		);
		const events = runBuild();
		const ev = events.find((e) => e.title === "Mixed relay");
		expect(ev).toBeDefined();
		expect(ev.participants).toEqual([{ name: "Johannes Thingnes Bø" }]);
		expect(ev.norwegianPlayers).toEqual([]);
	});

	it("keeps a non-broadly-covered event on the board when a catalog athlete appears only in participants", () => {
		// Regression: isCovered()'s hay-building used to spread raw participants
		// strings; once participants became canonical {name} objects, a naive spread
		// would embed "[object Object]" instead of the name and silently break
		// entity matching for any event relying purely on participants (tennis,
		// chess) rather than norwegianPlayers/homeTeam/awayTeam. WP-96: the compass
		// is catalog.json (tier2).
		fs.writeFileSync(
			path.join(configDir, "catalog.json"),
			JSON.stringify({ tier2: { athletes: ["Casper Ruud"] } })
		);
		fs.writeFileSync(
			path.join(dataDir, "tennis.json"),
			JSON.stringify({ tournaments: [{ name: "ATP Tour", events: [
				{ title: "R32 Match", time: future(2), participants: ["Casper Ruud", "Someone Else"] },
			] }] })
		);
		const events = runBuild();
		expect(events.find((e) => e.title === "R32 Match")).toBeDefined();
	});

	// WP-92/WP-96 · the coverage gate. chess/esports are NOT covered wholesale — a
	// chess/esports event is kept ONLY when it names a CATALOG entity (sport-scoped),
	// and the norwegian/favorite/importance/ai-research shortcuts do NOT rescue it.
	// WP-96: the compass is catalog.json (tier2), not one person's interests.json.
	describe("WP-92/96 coverage gate (chess/esports entity-gated, catalog-keyed)", () => {
		const gateCatalog = {
			tier1: ["football", "golf", "f1", "cycling", "biathlon", "cross-country", "alpine", "nordic", "ski jumping"],
			tier2: {
				athletes: [{ name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess" }],
				teams: [
					{ name: "Barcelona", aliases: ["FC Barcelona", "Barça"], sport: "football" },
					{ name: "100 Thieves", aliases: ["100T"], sport: "esports" },
				],
			},
		};
		// Chess/esports have no static fetcher — the research agent writes them, so
		// they arrive as source:"ai-research" preserved from the previous events.json.
		const ai = (extra) => ({ source: "ai-research", confidence: "high", evidence: ["https://ex.com/1", "https://ex.com/2"], ...extra });
		function seedGate() {
			fs.writeFileSync(path.join(configDir, "catalog.json"), JSON.stringify(gateCatalog));
			fs.writeFileSync(
				path.join(dataDir, "events.json"),
				JSON.stringify([
					// Sant Martí class: a minor Norwegian chess open, one club player,
					// neither Carlsen nor Tari. norwegian:true must NOT rescue it.
					ai({ sport: "chess", title: "Round 6 – XXVI Obert Internacional Sant Martí 2026", time: future(3), norwegian: true, participants: [{ name: "Johan-Sebastian Christiansen" }] }),
					// Cross-sport trap: a chess event held in the CITY of Barcelona must
					// NOT match the tracked FOOTBALL club "Barcelona" (sport-scoped gate).
					ai({ sport: "chess", title: "Barcelona Chess Open 2026 – round 1", time: future(4), norwegian: true, participants: [{ name: "Some Local Player" }] }),
					// Kept: names a tracked chess athlete.
					ai({ sport: "chess", title: "Esports World Cup 2026 – sjakk", time: future(5), norwegian: true, norwegianPlayers: [{ name: "Magnus Carlsen" }] }),
					// Kept: names the tracked esports team.
					ai({ sport: "esports", title: "BLAST Bounty S2: 100 Thieves vs Falcons", time: future(2), homeTeam: "100 Thieves", awayTeam: "Falcons" }),
					// Dropped: a CS2 match between two untracked teams — ai-research does NOT rescue it.
					ai({ sport: "esports", title: "ESL Pro League: Vitality vs Spirit", time: future(2), homeTeam: "Vitality", awayTeam: "Spirit" }),
				])
			);
		}

		it("filters the Sant Martí class and other off-interest chess/esports while keeping Carlsen + 100 Thieves", () => {
			seedGate();
			const events = runBuild();
			const titles = events.map((e) => e.title);
			// Dropped
			expect(titles.find((t) => t.includes("Sant Martí"))).toBeUndefined();
			expect(titles.find((t) => t.includes("Barcelona Chess Open"))).toBeUndefined();
			expect(titles.find((t) => t.includes("Vitality vs Spirit"))).toBeUndefined();
			// Kept
			expect(titles).toContain("Esports World Cup 2026 – sjakk");
			expect(titles).toContain("BLAST Bounty S2: 100 Thieves vs Falcons");
			// Sanity: exactly two of the five gated events survived.
			expect(events.filter((e) => e.sport === "chess" || e.sport === "esports")).toHaveLength(2);
		});

		it("keeps ordinary tier1-sport events untouched (football stays)", () => {
			seedGate();
			const events = runBuild();
			// The default beforeEach football.json event is a wholesale-covered sport.
			expect(events.find((e) => e.title === "Liverpool vs Arsenal")).toBeDefined();
		});
	});

	// WP-96 · the flerbruker-split acceptance: the SERVER publishes ONE
	// catalog-scoped feed; TWO DISJOINT client profiles each get a meaningful,
	// disjoint slice of it through their own on-device lens — and the owner's own
	// lens yields exactly what it did before the split. Proves the server no
	// longer scopes to one person: the catalog is the compass, the lens is per-user.
	describe("WP-96 two-profile split (catalog feed → disjoint client lenses)", () => {
		// The catalog COVERS a broad elite chess + tier-1 CS2 set (a moderate
		// superset of any one person's follows).
		const twoProfileCatalog = {
			tier1: ["football", "golf", "f1", "cycling", "biathlon", "cross-country", "alpine", "nordic", "ski jumping"],
			tier2: {
				athletes: [
					{ name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess" },
					{ name: "Hikaru Nakamura", aliases: ["Nakamura"], sport: "chess" },
				],
				teams: [
					{ name: "100 Thieves", aliases: ["100T"], sport: "esports" },
					{ name: "Natus Vincere", aliases: ["NAVI"], sport: "esports" },
				],
			},
		};
		const ai = (extra) => ({ source: "ai-research", confidence: "high", evidence: ["https://ex.com/1", "https://ex.com/2"], ...extra });

		// The client lens (FeedCompiler.isRelevant / serverRelevant reference):
		// per-user relevance over the ALREADY-catalog-scoped feed. Entity-gated
		// sports need a SPORT-SCOPED profile-entity match; other non-broad sports
		// use the norwegian/favorite/importance blanket + an unscoped match.
		function lensRelevant(e, profile) {
			const sport = (e.sport || "").toLowerCase();
			const broad = new Set((profile.followBroadly || []).map((s) => s.toLowerCase()));
			if (broad.has(sport)) return true;
			const entities = [
				...(profile.alwaysTrack?.teams || []),
				...(profile.alwaysTrack?.athletes || []),
				...(profile.alwaysTrack?.tournaments || []),
			];
			const hay = [e.title, e.tournament, e.homeTeam, e.awayTeam,
				...(e.norwegianPlayers || []).map((p) => p?.name || p),
				...(e.participants || []).map((p) => p?.name || p)].join(" ");
			if (["chess", "esports"].includes(sport)) {
				return matchInterest(hay, entities, { sport: e.sport }) != null;
			}
			if (e.norwegian || e.isFavorite || (e.importance || 0) >= 4) return true;
			return matchInterest(hay, entities) != null;
		}

		function seedTwoProfiles() {
			fs.writeFileSync(path.join(configDir, "catalog.json"), JSON.stringify(twoProfileCatalog));
			fs.writeFileSync(
				path.join(dataDir, "events.json"),
				JSON.stringify([
					ai({ sport: "chess", title: "Norway Chess 2026 – Carlsen vs Nakamura", time: future(2), norwegianPlayers: [{ name: "Magnus Carlsen" }], participants: [{ name: "Magnus Carlsen" }, { name: "Hikaru Nakamura" }] }),
					ai({ sport: "chess", title: "Tata Steel 2026 – Nakamura vs Giri", time: future(3), participants: [{ name: "Hikaru Nakamura" }, { name: "Anish Giri" }] }),
					ai({ sport: "esports", title: "IEM Cologne: 100 Thieves vs FaZe", time: future(2), homeTeam: "100 Thieves", awayTeam: "FaZe" }),
					ai({ sport: "esports", title: "IEM Cologne: NAVI vs Vitality", time: future(3), homeTeam: "Natus Vincere", awayTeam: "Team Vitality" }),
					// Not covered by the catalog → never reaches ANY client.
					ai({ sport: "chess", title: "XXVI Obert Sant Martí – round 1", time: future(4), norwegian: true, participants: [{ name: "Local Player" }] }),
					ai({ sport: "esports", title: "ESEA: TeamX vs TeamY", time: future(4), homeTeam: "TeamX", awayTeam: "TeamY" }),
				])
			);
		}

		it("the catalog feed feeds two disjoint profiles, and the owner's feed is unchanged", () => {
			seedTwoProfiles();
			const feed = runBuild(); // ONE server-published, catalog-scoped feed.

			// Server scope: only the four covered events survive; uncovered dropped.
			const gated = feed.filter((e) => e.sport === "chess" || e.sport === "esports");
			expect(gated).toHaveLength(4);
			expect(feed.find((e) => e.title.includes("Sant Martí"))).toBeUndefined();
			expect(feed.find((e) => e.title.includes("ESEA"))).toBeUndefined();

			// Owner profile (Carlsen chess + 100 Thieves) — same follows as today.
			const owner = { alwaysTrack: { athletes: [{ name: "Magnus Carlsen", aliases: ["Carlsen"], sport: "chess" }], teams: [{ name: "100 Thieves", aliases: ["100T"], sport: "esports" }] } };
			// Profile A: an EXTERNAL tester who follows Nakamura chess (not Carlsen).
			const profileA = { alwaysTrack: { athletes: [{ name: "Hikaru Nakamura", aliases: ["Nakamura"], sport: "chess" }] } };
			// Profile B: an EXTERNAL tester who follows a DIFFERENT tier-1 CS2 team.
			const profileB = { alwaysTrack: { teams: [{ name: "Natus Vincere", aliases: ["NAVI"], sport: "esports" }] } };

			const lensTitles = (p) => feed.filter((e) => lensRelevant(e, p)).map((e) => e.title).sort();
			const ownerFeed = lensTitles(owner);
			const aFeed = lensTitles(profileA);
			const bFeed = lensTitles(profileB);

			// Each profile gets meaningful, NON-EMPTY events from the same feed.
			expect(ownerFeed.length).toBeGreaterThan(0);
			expect(aFeed.length).toBeGreaterThan(0);
			expect(bFeed.length).toBeGreaterThan(0);

			// Owner sees Carlsen's chess + 100 Thieves' CS2 (his historical feed) — and
			// NOT Nakamura's Tata Steel nor NAVI's match.
			expect(ownerFeed).toContain("Norway Chess 2026 – Carlsen vs Nakamura");
			expect(ownerFeed).toContain("IEM Cologne: 100 Thieves vs FaZe");
			expect(ownerFeed).not.toContain("Tata Steel 2026 – Nakamura vs Giri");
			expect(ownerFeed).not.toContain("IEM Cologne: NAVI vs Vitality");

			// Profile A gets Nakamura's events (incl. the Carlsen-vs-Nakamura game),
			// but NOT the 100 Thieves / NAVI CS2 matches.
			expect(aFeed).toContain("Tata Steel 2026 – Nakamura vs Giri");
			expect(aFeed.some((t) => t.includes("100 Thieves"))).toBe(false);
			expect(aFeed.some((t) => t.includes("NAVI"))).toBe(false);

			// Profile B gets its NAVI match, but no chess and not the 100 Thieves game.
			expect(bFeed).toEqual(["IEM Cologne: NAVI vs Vitality"]);
		});
	});
});

// ── WP-245: kalibreringen binder — demoter high når eneste grunnlag er mistrodd ──
describe("calibration gate (WP-245)", () => {
	const seedCalibration = () =>
		fs.writeFileSync(
			path.join(dataDir, "calibration.json"),
			JSON.stringify({
				sources: {
					"cyclingstage.com": { checks: 17, agreed: 9, reliability: 0.53 },
					"wikipedia.org": { checks: 10, agreed: 10, reliability: 1 },
				},
			})
		);
	const aiEvent = (evidence) => ({
		sport: "cycling", title: "Etappe 14", time: future(5), source: "ai-research",
		confidence: "high", evidence,
	});

	it("demotes a preserved high-confidence event whose entire basis is distrusted", () => {
		seedCalibration();
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([aiEvent(["https://www.cyclingstage.com/e14/", "https://www.cyclingstage.com/start/"])])
		);
		const events = runBuild();
		const stage = events.find((e) => e.title === "Etappe 14");
		expect(stage.confidence).toBe("medium");
	});

	it("leaves a corroborated event alone — one trusted source blocks the demotion", () => {
		seedCalibration();
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([aiEvent(["https://www.cyclingstage.com/e14/", "https://en.wikipedia.org/wiki/Tour"])])
		);
		const events = runBuild();
		expect(events.find((e) => e.title === "Etappe 14").confidence).toBe("high");
	});

	it("is inert without calibration.json (fail-soft)", () => {
		fs.writeFileSync(
			path.join(dataDir, "events.json"),
			JSON.stringify([aiEvent(["https://www.cyclingstage.com/e14/", "https://www.cyclingstage.com/start/"])])
		);
		const events = runBuild();
		expect(events.find((e) => e.title === "Etappe 14").confidence).toBe("high");
	});

	// WP-186-oppfølging (27.08): homeTeam/awayTeam names a CLUB, so the canonical
	// team entity must win over a club-as-league duplicate (tracked.json's misfiled
	// "FC Barcelona", the season-scoped europacup-playoff entries) — those ids carry
	// no identity (logo), and stamping them cost the row its club mark.
	describe("team stamping prefers the canonical team entity over league duplicates", () => {
		it("stamps the team id even when a matching league entity registers first", () => {
			const regDir = path.join(configDir, "registry");
			fs.mkdirSync(regDir);
			fs.writeFileSync(
				path.join(regDir, "football.json"),
				JSON.stringify({
					entities: [
						{ id: "fc-barcelona-dup", name: "FC Barcelona", aliases: [], sport: "football", type: "league" },
						{ id: "barcelona", name: "Barcelona", aliases: ["FC Barcelona"], sport: "football", type: "team" },
					],
				})
			);
			fs.writeFileSync(
				path.join(dataDir, "football.json"),
				JSON.stringify({
					tournaments: [
						{ name: "La Liga", events: [{ title: "Getafe at Barcelona", time: future(2), homeTeam: "Barcelona", awayTeam: "Getafe" }] },
					],
				})
			);
			const events = runBuild();
			const match = events.find((e) => e.title === "Getafe at Barcelona");
			expect(match.homeTeamEntityId).toBe("barcelona");
		});
	});

});
