// docs/js/dashboard.js — the calm agenda renders sane HTML from fixture data.
import { describe, it, expect, beforeAll } from "vitest";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let dash;
let win;

beforeAll(() => {
	const sandbox = createClientSandbox();
	loadClientScript(sandbox, "shared-constants.js");
	loadClientScript(sandbox, "lens.js");
	loadClientScript(sandbox, "dashboard.js");
	loadClientScript(sandbox, "live.js");
	loadClientScript(sandbox, "detail.js");
	loadClientScript(sandbox, "followed.js");
	loadClientScript(sandbox, "chrome.js");
	loadClientScript(sandbox, "news-web.js");
	loadClientScript(sandbox, "entity-page.js");
	dash = sandbox.window.dashboard;
	win = sandbox.window;
});

const soon = () => new Date(Date.now() + 3600000).toISOString();

describe("agenda event row", () => {
	it("renders a match with both teams, time and channel in a flat row (no sport badge)", () => {
		const html = dash.eventRow({
			id: "x", sport: "football", tournament: "Premier League",
			homeTeam: "Liverpool FC", awayTeam: "Arsenal FC", title: "Liverpool vs Arsenal",
			time: soon(), streaming: [{ platform: "TV 2 Play", url: "https://tv2.no" }],
		});
		expect(html).toContain("Liverpool");
		expect(html).toContain("Arsenal");
		expect(html).toContain("TV 2 Play");
		expect(html).toContain("ev-time");
		// Pinned v1 look → now DESIGN.md: sport is signalled by the content, not an
		// emoji sticker in a rounded box. The per-row sport badge is gone.
		expect(html).not.toContain("ev-badge");
	});

	it("renders a non-match event by its title", () => {
		const html = dash.eventRow({ id: "g", sport: "golf", tournament: "PGA Tour", title: "The Open", time: soon() });
		expect(html).toContain("The Open");
	});

	it("gently marks must-see events (no loud card)", () => {
		const fav = dash.eventRow({ id: "f", sport: "golf", title: "Hovland", time: soon(), isFavorite: true });
		expect(fav).toContain('class="ev must"');
		const plain = dash.eventRow({ id: "p", sport: "golf", title: "Random", time: soon() });
		expect(plain).toContain('class="ev"');
		expect(plain).not.toContain("ev must");
	});

	it("makes ai-research events expandable, with sources in the detail (no loud badge)", () => {
		const e = { id: "z", sport: "biathlon", title: "Sprint", time: soon(), source: "ai-research", confidence: "high", evidence: ["https://a.no", "https://b.no"] };
		const row = dash.eventRow(e);
		expect(row).toContain("expandable");
		expect(row).not.toContain("ai-badge"); // provenance is folded into the tap-to-expand detail
		const detail = dash.eventDetail(e);
		expect(detail).toContain("Funnet av AI");
		expect(detail).toContain("kilde 1");
	});

	it("shows both country teams by name, with no flag emoji in the chrome", () => {
		const html = dash.eventTitle({ homeTeam: "Norway", awayTeam: "Brazil" });
		expect(html).toContain("Norway");
		expect(html).toContain("Brazil");
		expect(html).toContain("–"); // the two teams, joined
		// Pinned v1 look → now DESIGN.md: emoji is forbidden in the chrome (only
		// the amber must-see dot + the plain team names carry the row).
		expect(html).not.toContain("🇳🇴");
		expect(html).not.toContain("🇧🇷");
	});

	it("shows round context when present (e.g. WC knockout round)", () => {
		const html = dash.eventRow({ id: "w", sport: "football", homeTeam: "Brazil", awayTeam: "Norway", time: soon(), round: "Åttedelsfinale", tournament: "FIFA World Cup" });
		expect(html).toContain("ev-round");
		expect(html).toContain("Åttedelsfinale");
	});

	it("escapes HTML in event fields", () => {
		const html = dash.eventRow({ id: "q", sport: "golf", title: "<script>alert(1)</script>", time: soon() });
		expect(html).not.toContain("<script>alert");
	});
});

// WP-111: an event that carries `participants` but no homeTeam/awayTeam (e.g. the
// VM final: participants Spania/Argentina, generic title "VM-finalen 2026") must
// show the matchup — the participants are the "hva", the generic title mere context.
describe("head-to-head participants render as the row matchup", () => {
	const base = { id: "vm", sport: "football", time: soon(), tournament: "FIFA World Cup", round: "Finale", title: "VM-finalen 2026", importance: 5, streaming: [{ platform: "NRK 1", url: "https://tv.nrk.no/direkte" }] };

	it("shows the two participants as the title instead of the generic name", () => {
		const html = dash.eventTitle({ ...base, participants: [{ name: "Spania" }, { name: "Argentina" }] });
		expect(html).toContain("Spania");
		expect(html).toContain("Argentina");
		expect(html).toContain("–");            // the two sides, joined
		expect(html).not.toContain("VM-finalen"); // generic title no longer leads
	});

	it("keeps the generic title's context (tournament + round + channel) in the meta", () => {
		const html = dash.eventRow({ ...base, participants: [{ name: "Spania" }, { name: "Argentina" }] });
		expect(html).toContain("Spania");
		expect(html).toContain("Argentina");
		expect(html).toContain("FIFA World Cup"); // tournament survives as context
		expect(html).toContain("Finale");          // round survives
		expect(html).toContain("NRK 1");           // where to watch
		expect(html).not.toContain("VM-finalen");
	});

	it("keeps the generic title as context when nothing else (tournament/round) carries it", () => {
		const html = dash.eventRow({ id: "p2", sport: "football", time: soon(), title: "Treningskamp", participants: [{ name: "Norge" }, { name: "Brasil" }] });
		expect(html).toContain("Norge");
		expect(html).toContain("Brasil");
		expect(html).toContain("Treningskamp"); // preserved in meta — no tournament/round to carry it
	});

	it("does NOT turn a 4-team field (a tournament, not a match) into a name list", () => {
		const e = { id: "ewc", sport: "esports", time: soon(), title: "Esports World Cup 2026 – CS2 (gruppespill)", tournament: "Esports World Cup 2026", participants: [{ name: "Team Vitality" }, { name: "Natus Vincere" }, { name: "FaZe Clan" }, { name: "Team Falcons" }] };
		const html = dash.eventTitle(e);
		expect(html).toContain("Esports World Cup 2026");
		expect(html).not.toContain("Team Vitality");
		expect(html).not.toContain("Natus Vincere");
	});

	it("leaves a single-participant event on its own title (not a lone name)", () => {
		const html = dash.eventTitle({ id: "arn", sport: "cycling", time: soon(), title: "Arctic Race of Norway 2026", participants: [{ name: "Uno-X Mobility" }] });
		expect(html).toContain("Arctic Race of Norway 2026");
		expect(html).not.toContain("Uno-X Mobility");
	});

	it("prefers homeTeam/awayTeam over participants when both exist", () => {
		const html = dash.eventTitle({ homeTeam: "Liverpool FC", awayTeam: "Arsenal FC", participants: [{ name: "Spania" }, { name: "Argentina" }] });
		expect(html).toContain("Liverpool");
		expect(html).toContain("Arsenal");
		expect(html).not.toContain("Spania");
	});

	it("escapes HTML in participant names", () => {
		const html = dash.eventTitle({ sport: "football", title: "x", participants: [{ name: "<script>alert(1)</script>" }, { name: "B" }] });
		expect(html).not.toContain("<script>alert");
	});
});

// WP-127: the detail's share/report title must name the SAME two sides the row
// title does — the plain-text mirror of eventTitle, via the shared ssParticipantMatchup.
describe("detail title (share/report) names the participants", () => {
	it("uses the participant matchup, not the generic title", () => {
		expect(dash.eventPlainTitle({ title: "VM-finalen 2026", participants: [{ name: "Spania" }, { name: "Argentina" }] }))
			.toBe("Spania – Argentina");
	});

	it("uses home – away (shortened) for a team match", () => {
		expect(dash.eventPlainTitle({ homeTeam: "Liverpool FC", awayTeam: "Arsenal FC", title: "Liverpool vs Arsenal" }))
			.toBe("Liverpool – Arsenal");
	});

	it("falls back to the event's own title for a many-sided field (not a matchup)", () => {
		expect(dash.eventPlainTitle({ title: "Esports World Cup 2026", participants: [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }] }))
			.toBe("Esports World Cup 2026");
	});

	it("returns plain (un-escaped) text — the caller (navigator.share/issue url) is not HTML", () => {
		// ssParticipantMatchup is the shared, un-escaped source; eventTitle escapes for the row.
		expect(dash.eventPlainTitle({ title: "x", participants: [{ name: "A & B" }, { name: "C" }] }))
			.toBe("A & B – C");
	});
});

// WP-136: the editorial brief is DAY-GATED — shown only on the Oslo calendar day
// it was generated. Its language is day-relative ("i kveld"/"i morgen"), so a brief
// that outlives its Oslo day is a factual error (20.07: yesterday's "VM-finalen i
// kveld" stayed up the day after the final). A pure Oslo calendar-day compare, `now`
// injected so the midnight boundary is deterministic. Supersedes the WP-111 "~20h"
// window, which still showed a 15:00 evening brief the next morning. Oslo is UTC+2 in
// July (CEST): Oslo midnight 2026-07-20 = 2026-07-19T22:00:00Z.
describe("editorial brief day-gate on the hero headline (WP-136)", () => {
	const briefAt = (iso) => ({
		generatedAt: iso,
		blocks: [{ type: "headline", text: "Finalen venter i kveld." }],
	});

	it("shows a brief generated earlier TODAY (same Oslo day)", () => {
		const now = Date.parse("2026-07-20T06:00:00Z");   // Oslo 08:00, 20 July
		dash.featured = briefAt("2026-07-20T03:00:00Z");  // Oslo 05:00, 20 July — today
		expect(dash.featuredIsFresh(now)).toBe(true);
		expect(dash.heroHeadline(now)).toContain("Finalen venter");
	});

	it("hides YESTERDAY's evening brief the next morning (the 20.07 bug)", () => {
		const now = Date.parse("2026-07-20T06:00:00Z");   // Oslo 08:00, 20 July
		dash.featured = briefAt("2026-07-19T13:00:00Z");  // Oslo 15:00, 19 July — evening brief, yesterday
		expect(dash.featuredIsFresh(now)).toBe(false);
		expect(dash.heroHeadline(now)).toBe(dash.heroFallback());
		expect(dash.heroHeadline(now)).not.toContain("Finalen venter");
	});

	it("drops the brief the instant the Oslo day rolls (midnight boundary)", () => {
		// `now` just after Oslo midnight into 20 July; the brief is 1h old but from 19 July.
		const now = Date.parse("2026-07-19T22:30:00Z");   // Oslo 00:30, 20 July
		dash.featured = briefAt("2026-07-19T21:30:00Z");  // Oslo 23:30, 19 July — yesterday
		expect(dash.featuredIsFresh(now)).toBe(false);
		expect(dash.heroHeadline(now)).toBe(dash.heroFallback());
	});

	it("keeps a brief generated just AFTER Oslo midnight (same new day)", () => {
		const now = Date.parse("2026-07-19T22:30:00Z");   // Oslo 00:30, 20 July
		dash.featured = briefAt("2026-07-19T22:15:00Z");  // Oslo 00:15, 20 July — today
		expect(dash.featuredIsFresh(now)).toBe(true);
		expect(dash.heroHeadline(now)).toContain("Finalen venter");
	});

	it("treats a brief with no generatedAt as untrustworthy (fall back)", () => {
		dash.featured = { blocks: [{ type: "headline", text: "Udatert." }] };
		expect(dash.featuredIsFresh()).toBe(false);
		expect(dash.heroHeadline()).toBe(dash.heroFallback());
	});

	it("falls back when there is no featured brief at all", () => {
		dash.featured = null;
		expect(dash.featuredIsFresh()).toBe(false);
		expect(dash.heroHeadline()).toBe(dash.heroFallback());
	});
});

// WP-111: the "Om" section was one wall of text. Structure it into calm paragraphs
// and surface key facts as their own quiet lines — without splitting abbreviations.
describe("«Om» readability — paragraphs, not a wall", () => {
	it("splits a multi-sentence summary into separate paragraph rows", () => {
		const summary = "Første setning her. Andre setning her. Tredje setning kommer. Fjerde runder av.";
		const paras = dash.aboutParagraphs(summary);
		expect(paras.length).toBeGreaterThan(1); // not one wall
		const detail = dash.eventDetail({ sport: "football", title: "x", summary });
		expect(detail).toContain('<span class="d-k">Om</span>');
		// WP-127: the "Om" prose is a full-width .d-prose block of <p class="d-p">
		// paragraphs, no longer squeezed into the narrow key/value value column.
		expect(detail).toContain('class="d-prose"');
		expect((detail.match(/<p class="d-p">/g) || []).length).toBeGreaterThan(1); // ≥2 paragraphs
	});

	it("puts long prose in a full-width .d-prose block, not the narrow d-v column", () => {
		const summary = "Første setning her. Andre setning her. Tredje setning kommer.";
		const detail = dash.eventDetail({ sport: "football", title: "x", summary });
		expect(detail).toContain('<div class="d-prose">');
		expect(detail).toContain('<div class="d-prose-body">');
		expect(detail).toContain('<p class="d-p">');
		// The paragraphs must NOT be emitted as key/value value cells.
		expect(detail).not.toContain('<span class="d-v">Første setning');
	});

	it("does not split inside abbreviations/numbers like «kl. 21.00» or «29. juli»", () => {
		const summary = "Kampen vises på NRK1 (kl. 21.00 norsk tid). Løpet går 29. juli i Aalborg.";
		const paras = dash.aboutParagraphs(summary);
		expect(paras.length).toBe(1); // two real sentences (≤2) → one calm block
		expect(paras[0]).toContain("kl. 21.00");
		expect(paras[0]).toContain("29. juli");
	});

	it("renders key-fact lines (Runde/Underlag/Format) where the fields exist", () => {
		const detail = dash.eventDetail({ sport: "tennis", title: "x", round: "Semifinale", surface: "Grus", format: "Best av 5", summary: "Kort." });
		expect(detail).toContain("Runde");
		expect(detail).toContain("Semifinale");
		expect(detail).toContain("Underlag");
		expect(detail).toContain("Grus");
		expect(detail).toContain("Format");
		expect(detail).toContain("Best av 5");
	});

	it("returns nothing for an empty or missing summary", () => {
		expect(dash.aboutParagraphs("")).toEqual([]);
		expect(dash.aboutParagraphs(null)).toEqual([]);
	});

	it("escapes HTML inside summary paragraphs", () => {
		const detail = dash.eventDetail({ sport: "football", title: "x", summary: "<script>alert(1)</script> Andre setning." });
		expect(detail).not.toContain("<script>alert");
	});
});

describe("cancelled / postponed matches stay on the board, labelled", () => {
	it("shows a cancelled match faded with an 'Avlyst' label instead of a channel", () => {
		const html = dash.eventRow({ id: "c", sport: "football", title: "Barcelona vs X", time: soon(), status: "cancelled", streaming: [{ platform: "TV3" }] });
		expect(html).toContain("Avlyst");
		expect(html).toContain("cancelled");   // dims the row
		expect(html).not.toContain("TV3");      // channel is moot when cancelled
	});
	it("labels a postponed match 'Utsatt'", () => {
		const html = dash.eventRow({ id: "p", sport: "football", title: "Y", time: soon(), status: "postponed" });
		expect(html).toContain("Utsatt");
	});
	it("leaves a normal match unaffected", () => {
		const html = dash.eventRow({ id: "n", sport: "football", title: "Z", time: soon(), streaming: [{ platform: "NRK" }] });
		expect(html).not.toContain("cancelled");
		expect(html).toContain("NRK");
	});
});

describe("finished matches show their result, not a channel", () => {
	const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
	it("shows 'Ferdig' + the score for a completed football match", () => {
		dash.liveScores = {};
		dash.recentResults = { football: [{ homeTeam: "Argentina", awayTeam: "Egypt", homeScore: 2, awayScore: 1 }] };
		const html = dash.eventRow({ id: "f1", sport: "football", title: "Argentina vs Egypt", homeTeam: "Argentina", awayTeam: "Egypt", time: hoursAgo(2), streaming: [{ platform: "TV 2 Play" }] });
		expect(html).toContain("Ferdig");
		expect(html).toContain("2–1");
		expect(html).toContain("done");
		expect(html).not.toContain("TV 2 Play"); // it's over — not "watch here"
	});
	it("marks a clearly-ended football match finished even without a score", () => {
		dash.liveScores = {};
		dash.recentResults = { football: [] };
		const html = dash.eventRow({ id: "f2", sport: "football", title: "A vs B", homeTeam: "A", awayTeam: "B", time: hoursAgo(3) });
		expect(html).toContain("Ferdig");
		expect(html).toContain("done");
	});
	it("does not guess 'finished' for an open-ended entry (non-football, no endTime)", () => {
		dash.liveScores = {};
		dash.recentResults = null;
		const html = dash.eventRow({ id: "f3", sport: "tennis", title: "Some tournament", time: hoursAgo(5) });
		expect(html).not.toContain("done");
	});
});

describe("progressive disclosure detail", () => {
	it("only marks rows expandable when there's genuinely more to show", () => {
		const bare = { id: "b", sport: "chess", title: "Round 3", time: soon() };
		expect(dash.hasDetail(bare)).toBe(false);
		const rich = { id: "r", sport: "golf", title: "The Open", time: soon(), venue: "Royal Portrush" };
		expect(dash.hasDetail(rich)).toBe(true);
	});

	it("builds a Norwegian-channel 'Se på' line in the detail", () => {
		const html = dash.eventDetail({ sport: "football", title: "x", streaming: [{ platform: "NRK", url: "https://tv.nrk.no" }, { platform: "TV 2 Play" }] });
		expect(html).toContain("Se på");
		expect(html).toContain("NRK");
		expect(html).toContain("TV 2 Play");
	});
});

// WP-250 — the tee time is golf's real "when": a golf row's time column shows a
// four-day WINDOW, so without this the board never says when to turn the TV on.
// It rides in the meta line, one name only, and ONLY when `teeTimeUTC` proves the
// tee time belongs to today's round (DESIGN.md § Grunnlov 3 — no proof, no claim).
describe("golf row: the tee time in the meta line (WP-250)", () => {
	// A fixed instant so the pick order is deterministic: 16:00 Oslo on 27 Aug,
	// with both tee times later the same Oslo day.
	const NOW = Date.parse("2026-08-27T14:00:00.000Z");
	// A four-day window straddling "now", so the row-level tests (which use the real
	// clock via teeTodayUTC) see a tournament still in progress — never one the
	// calendar has rolled past, which would render "Ferdig" and drop the tee hint.
	const DAY = 24 * 3600 * 1000;
	const tourChampionship = (players) => ({
		id: "tc", sport: "golf", tournament: "PGA Tour", title: "TOUR Championship",
		time: new Date(Date.now() - DAY).toISOString(), endTime: new Date(Date.now() + DAY).toISOString(),
		norwegianPlayers: players,
		featuredGroups: [{ player: "Viktor Hovland", teeTime: "17:24", groupmates: [{ name: "Robert MacIntyre" }] }],
		streaming: [{ platform: "HBO Max (Sport)" }],
	});
	const hovland = { name: "Viktor Hovland", teeTime: "17:24", teeTimeUTC: "2026-08-27T15:24:00.000Z" };
	const reitan = { name: "Kristoffer Reitan", teeTime: "18:06", teeTimeUTC: "2026-08-27T16:06:00.000Z" };

	/** An ISO stamp guaranteed to sit on TODAY's Oslo day whatever hour the suite
	 *  runs at (the hint's honesty gate is a same-day check). */
	const teeTodayUTC = (offsetMs) => {
		const now = Date.now();
		const key = dash.osloDayKey(new Date(now));
		for (const ms of [offsetMs, 60000, -60000]) {
			const t = now + ms;
			if (dash.osloDayKey(new Date(t)) === key) return new Date(t).toISOString();
		}
		return new Date(now).toISOString();
	};

	it("shows the next Norwegian out, by surname, in the row itself", () => {
		const hint = dash.golfTeeHint(tourChampionship([hovland, reitan]), NOW);
		expect(hint).toContain("ev-tee");
		expect(hint).toContain("Hovland ut 17:24");
		expect(hint).not.toContain("Reitan");   // ONE name — the row must not swell
	});

	it("moves on to the next player once the earlier one has teed off", () => {
		const afterHovland = Date.parse("2026-08-27T15:40:00.000Z");
		expect(dash.golfTeeHint(tourChampionship([hovland, reitan]), afterHovland)).toContain("Reitan ut 18:06");
	});

	it("keeps the latest start once everyone is out on the course", () => {
		const afterBoth = Date.parse("2026-08-27T17:00:00.000Z");
		expect(dash.golfTeeHint(tourChampionship([hovland, reitan]), afterBoth)).toContain("Reitan ut 18:06");
	});

	it("stays silent when the tee time carries no day we can verify", () => {
		// A bare "17:24" with no teeTimeUTC could be yesterday's round — the board
		// says nothing rather than something it cannot stand behind.
		const e = tourChampionship([{ name: "Viktor Hovland", teeTime: "17:24" }]);
		expect(dash.golfTeeHint(e, NOW)).toBe("");
	});

	it("stays silent when the tee time belongs to another day", () => {
		const e = tourChampionship([{ ...hovland, teeTimeUTC: "2026-08-28T15:24:00.000Z" }]);
		expect(dash.golfTeeHint(e, NOW)).toBe("");
	});

	it("never gives a cut player a tee time (WP-95)", () => {
		const e = tourChampionship([{ ...hovland, status: "røk cutten" }, reitan]);
		const hint = dash.golfTeeHint(e, NOW);
		expect(hint).toContain("Reitan ut 18:06");
		expect(hint).not.toContain("Hovland");
	});

	it("renders the hint into the agenda row, before the channel", () => {
		const row = dash.eventRow(tourChampionship([{ ...hovland, teeTimeUTC: teeTodayUTC(3600000) }]));
		expect(row).toContain("ev-tee");
		expect(row).toContain("Hovland ut 17:24");
		expect(row.indexOf("ev-tee")).toBeLessThan(row.indexOf("HBO Max (Sport)"));
	});

	// DESIGN.md § Radens anatomi already trades the tournament away for a live
	// score ("turneringen viker for roens skyld", WP-172). Same trade here: without
	// it the meta line wrapped onto a THIRD line at 375px, and a row that swells to
	// hold a hint is a bad row. The row keeps its two facts — når · hvor.
	it("lets the tournament yield to the tee time so the row keeps its height", () => {
		const e = tourChampionship([{ ...hovland, teeTimeUTC: teeTodayUTC(3600000) }]);
		const row = dash.eventRow(e);
		expect(row).toContain("Hovland ut 17:24");
		expect(row).toContain("HBO Max (Sport)");
		expect(row).not.toContain("PGA Tour");
		// …and it comes straight back the moment there is no tee time to show.
		expect(dash.eventRow(tourChampionship([]))).toContain("PGA Tour");
	});

	it("leaves a golf row with no tee data exactly as it was", () => {
		const row = dash.eventRow({ id: "g", sport: "golf", tournament: "PGA Tour", title: "The Open", time: soon() });
		expect(row).not.toContain("ev-tee");
	});

	it("leaves every non-golf row alone", () => {
		const row = dash.eventRow({
			id: "f", sport: "football", tournament: "Premier League",
			homeTeam: "Liverpool FC", awayTeam: "Arsenal FC", time: soon(),
			norwegianPlayers: [{ name: "Erling Haaland", teeTime: "17:24", teeTimeUTC: teeTodayUTC(3600000) }],
		});
		expect(row).not.toContain("ev-tee");
	});

	it("drops the tee time on a cancelled row — a tee time is a promise about a round still to come", () => {
		const e = { ...tourChampionship([{ ...hovland, teeTimeUTC: teeTodayUTC(3600000) }]), status: "cancelled" };
		expect(dash.eventRow(e)).not.toContain("ev-tee");
	});
});

describe("golf detail: who plays, tee times, featured group", () => {
	it("lists each Norwegian with tee time and their marquee groupmates", () => {
		const html = dash.eventDetail({
			sport: "golf", title: "Genesis Scottish Open", time: soon(),
			norwegianPlayers: [{ name: "Viktor Hovland", teeTime: "09:39" }, { name: "Kristoffer Reitan", teeTime: "09:06" }],
			featuredGroups: [
				{ player: "Viktor Hovland", teeTime: "09:39", groupmates: [{ name: "Wyndham Clark" }, { name: "Eugenio Chacarra" }] },
				{ player: "Kristoffer Reitan", teeTime: "09:06", groupmates: [{ name: "Xander Schauffele" }, { name: "Adam Scott" }] },
			],
			totalPlayers: 156,
		});
		expect(html).toContain("Viktor Hovland");
		expect(html).toContain("09:39");                 // tee time
		expect(html).toContain("Wyndham Clark");          // groupmate
		expect(html).toContain("Eugenio Chacarra");
		expect(html).toContain("Kristoffer Reitan");
		expect(html).toContain("156");                    // field size
	});
	it("writes the tee time as a tee-OFF, matching the agenda row (WP-250)", () => {
		const html = dash.eventDetail({
			sport: "golf", title: "TOUR Championship", time: soon(),
			norwegianPlayers: [{ name: "Viktor Hovland", teeTime: "17:24" }],
			featuredGroups: [{ player: "Viktor Hovland", teeTime: "17:24", groupmates: [{ name: "Robert MacIntyre" }] }],
		});
		// «ut 17:24 · med Robert MacIntyre» — a bare clock read like a second start
		// time next to the event's own four-day window in the row above.
		expect(html).toContain("ut 17:24");
		expect(html).toContain("med Robert MacIntyre");
	});

	it("shows a Norwegian without tee data as simply in the field", () => {
		const html = dash.eventDetail({ sport: "golf", title: "US Open", time: soon(), norwegianPlayers: [{ name: "Kristoffer Ventura" }] });
		expect(html).toContain("Kristoffer Ventura");
		expect(html).toContain("i feltet");
	});
	it("shows a cut player's status verbatim, never a tee time or «i feltet» (WP-95)", () => {
		const html = dash.eventDetail({
			sport: "golf", title: "The Open", time: soon(),
			norwegianPlayers: [
				{ name: "Viktor Hovland", teeTime: null, teeTimeUTC: null, status: "røk cutten" },
				{ name: "Kristoffer Reitan", teeTime: "15:50", status: null },
			],
			featuredGroups: [{ player: "Kristoffer Reitan", teeTime: "15:50", groupmates: [{ name: "Shane Lowry" }] }],
			totalPlayers: 156,
		});
		expect(html).toContain("Kristoffer Reitan");
		expect(html).toContain("15:50");                 // active player keeps his tee
		// Hovland's own row shows the cut status verbatim, not a tee or «i feltet».
		expect(html).toContain('<span class="d-k">Viktor Hovland</span><span class="d-v">røk cutten</span>');
	});
});

describe("stage-race detail (TdF): Norwegian squad + current context", () => {
	it("surfaces the Norwegian riders (deduped) and the current-stage note", () => {
		const stages = [
			{ title: "Etappe 1", time: new Date(Date.now() - 86400000).toISOString(), norwegianPlayers: [{ name: "Tobias Halland Johannessen" }, { name: "Jonas Abrahamsen" }] },
			{ title: "Etappe 2", time: new Date(Date.now() + 86400000).toISOString(), norwegianPlayers: [{ name: "Tobias Halland Johannessen" }, { name: "Søren Wærenskjold" }], summary: "Uno-X jakter etappeseier; Johannessen 4. sammenlagt." },
		];
		const html = dash.seriesDetail({ isSeries: true, stages, nextStage: stages[1] });
		expect(html).toContain("Norske");
		expect(html).toContain("Tobias Halland Johannessen");
		expect(html).toContain("Søren Wærenskjold"); // union across stages
		expect(html).toContain("Nå");
		expect(html).toContain("sammenlagt");          // current context from the summary
	});

	// WP-148: the "Nå" note is now a FULL-WIDTH .d-prose block (like eventDetail's
	// "Om", WP-127) instead of a narrow d-v value column that squeezed a ~700-char
	// summary into a ~130px strip. WP-127 fixed every summary path EXCEPT this one.
	it("renders the current-stage note as a full-width .d-prose block, not a narrow d-v (WP-148)", () => {
		const summary = "Første setning om tempoetappen. Andre setning med mer kontekst. Tredje setning om sammenlagt. Fjerde runder av dagen.";
		const stages = [
			{ title: "Etappe 1", time: new Date(Date.now() + 86400000).toISOString(), norwegianPlayers: [{ name: "Tobias Halland Johannessen" }] },
		];
		const html = dash.seriesDetail({ isSeries: true, stages, nextStage: { summary } });
		expect(html).toContain('<div class="d-prose"><span class="d-k">Nå</span>');
		expect(html).toContain('<div class="d-prose-body">');
		expect((html.match(/<p class="d-p">/g) || []).length).toBeGreaterThan(1); // ≥2 paragraphs, not one wall
		// and NOT the old narrow key/value rendering of the note
		expect(html).not.toContain('<div class="d-row"><span class="d-k">Nå</span>');
	});
});

describe("F1 detail: championship + last race (data we already fetch)", () => {
	it("shows the F1 standings top and the previous race podium", () => {
		dash.standings = { f1: { drivers: [
			{ position: 1, driver: "Kimi Antonelli", team: "Mercedes", points: 179 },
			{ position: 2, driver: "George Russell", team: "Mercedes", points: 154 },
		] } };
		dash.recentResults = { f1: [{ raceName: "British Grand Prix", topDrivers: [
			{ position: 1, driver: "Charles Leclerc" }, { position: 2, driver: "George Russell" }, { position: 3, driver: "Lewis Hamilton" },
		] }] };
		const html = dash.eventDetail({ sport: "f1", title: "Belgian GP", time: soon() });
		expect(html).toContain("VM-stilling");
		expect(html).toContain("Kimi Antonelli");
		expect(html).toContain("179");
		expect(html).toContain("Forrige løp");
		expect(html).toContain("Charles Leclerc");
		expect(dash.hasDetail({ sport: "f1", title: "Belgian GP", time: soon() })).toBe(true);
	});
});

describe("whereToWatch — the core 'hvor kan jeg se det'", () => {
	it("links a channel when a url is present", () => {
		const html = dash.whereToWatch({ streaming: [{ platform: "NRK 1", url: "https://tv.nrk.no" }] });
		expect(html).toContain("NRK 1");
		expect(html).toContain("tv.nrk.no");
	});
	it("only links a tentative (shared-rights) channel to a tvkampen guide, never to one broadcaster", () => {
		expect(dash.streamLink({ platform: "TV 2 Play", url: "https://play.tv2.no/sport" })).toBe(true);           // confirmed → link
		expect(dash.streamLink({ platform: "NRK / TV 2", url: "https://tv.nrk.no", tentative: true })).toBe(false); // tentative broadcaster → don't link (misleads)
		expect(dash.streamLink({ platform: "NRK / TV 2", url: "https://www.tvkampen.com/kamp/x-1", tentative: true })).toBe(true); // tentative guide → link
	});
	it("renders a tentative WC chip as a tappable tvkampen guide link", () => {
		const html = dash.whereToWatch({ streaming: [{ platform: "NRK / TV 2", url: "https://www.tvkampen.com/kamp/x-1", tentative: true }] });
		expect(html).toContain("tvkampen.com/kamp/x-1");
		expect(html).toContain("<a ");
	});
	it("shows a faint dash when the channel is unknown (honest, not noisy)", () => {
		const html = dash.whereToWatch({ streaming: [] });
		expect(html).toContain("ev-where unknown");
		expect(html).toContain("–");
	});
	it("shows one primary channel plus a quiet +N when there are more", () => {
		const html = dash.whereToWatch({ streaming: [{ platform: "NRK 1" }, { platform: "TV 2" }, { platform: "Viaplay" }] });
		expect(html).toContain("NRK 1");   // primary channel
		expect(html).toContain("+2");       // the rest, quietly counted
		expect(html).not.toContain("Viaplay");
	});
});

describe("WP-246 — a landing page is never presented as the match link", () => {
	const landing = { platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" };
	const deep = { platform: "TV 2 Play", url: "https://play.tv2.no/sport/sykkel/arctic-race-of-norway", urlKind: "deep" };

	it("streamLink is false for a landing URL and true for a deep one", () => {
		expect(dash.streamLink(landing)).toBe(false);
		expect(dash.streamLink(deep)).toBe(true);
	});
	it("the row keeps the channel NAME but drops the link (the name is still true)", () => {
		const html = dash.whereToWatch({ streaming: [landing] });
		expect(html).toContain("TV 2 Play");        // where to watch — still answered
		expect(html).not.toContain("<a ");           // …but nothing pretends to be the match
		expect(html).not.toContain("play.tv2.no");   // the front page never ships as an href
	});
	it("a real deep link is still a link — this package removes the lie, not the links", () => {
		const html = dash.whereToWatch({ streaming: [deep] });
		expect(html).toContain("<a ");
		expect(html).toContain("arctic-race-of-norway");
	});
	it("older payloads without urlKind keep the previous behaviour (backward compatible)", () => {
		expect(dash.streamLink({ platform: "NRK", url: "https://tv.nrk.no" })).toBe(true);
	});
	it("the detail sheet says quietly why there is no link — no warning icon", () => {
		const html = dash.eventDetail({ sport: "cycling", title: "Etappe 5", time: soon(), streaming: [landing] });
		expect(html).toContain("Se på");
		expect(html).toContain("TV 2 Play");
		expect(html).toContain('<span class="tbd">(ingen direkte lenke)</span>');
		expect(html).not.toContain('href="https://play.tv2.no/sport"');
		expect(html).not.toMatch(/⚠|advarsel/i);
	});
	it("the detail sheet links a deep URL and says nothing extra", () => {
		const html = dash.eventDetail({ sport: "cycling", title: "Etappe 5", time: soon(), streaming: [deep] });
		expect(html).toContain('href="https://play.tv2.no/sport/sykkel/arctic-race-of-norway"');
		expect(html).not.toContain("(ingen direkte lenke)");
	});
	it("a tentative channel still reads (bekreftes), not the landing note", () => {
		const html = dash.eventDetail({
			sport: "football", title: "Norge – Brasil", time: soon(),
			streaming: [{ platform: "NRK / TV 2", url: "https://tv.nrk.no", tentative: true, urlKind: "landing" }],
		});
		expect(html).toContain("(bekreftes)");
		expect(html).not.toContain("(ingen direkte lenke)");
	});
});

describe("followed 'neste' index — answers 'when's X next?'", () => {
	const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

	it("finds the next upcoming event for a followed entity, ignoring the agenda window", () => {
		dash.allEvents = [
			{ sport: "tennis", title: "Wimbledon final (Casper Ruud)", time: inDays(40) },
			{ sport: "tennis", title: "Swiss Open Gstaad (Casper Ruud)", time: inDays(6) },
		];
		const next = dash.nextEventForEntity({ name: "Casper Ruud", aliases: ["Ruud"], sport: "tennis" });
		expect(next.title).toContain("Swiss Open"); // the nearer one, though both are far out
	});

	it("is sport-scoped so a name collision in another sport doesn't match", () => {
		dash.allEvents = [{ sport: "cycling", title: "Etappe 5: Barcelona – Girona", time: inDays(1) }];
		expect(dash.nextEventForEntity({ name: "Barcelona", sport: "football" })).toBe(null);
	});

	// WP-170: the follow row no longer carries an inline expandable detail — a tap
	// opens the ENTITY PAGE (data-entity-key). A row with nothing scheduled is
	// tappable too (the page can still answer with a result/table/news).
	it("renders an honest 'ikke satt opp ennå' when nothing is scheduled — still tappable (WP-170)", () => {
		dash.allEvents = [];
		const html = dash.followRow({ name: "Aryan Tari", aliases: ["Tari"], sport: "chess" }, true);
		expect(html).toContain("no-event");
		expect(html).toContain("ikke satt opp ennå");
		expect(html).not.toContain("fn-detail");
		expect(html).toContain("data-entity-key");   // opens the page
	});

	it("renders a tappable row with a relative 'neste' opening the entity page (WP-170)", () => {
		dash.allEvents = [{ sport: "esports", title: "BLAST Bounty – 100 Thieves", time: inDays(13), streaming: [{ platform: "Twitch" }] }];
		const html = dash.followRow({ name: "100 Thieves", aliases: ["100T"], sport: "esports" }, true);
		expect(html).toContain("has-event");
		expect(html).toMatch(/om \d+ dager/);
		expect(html).toContain('role="button"');
		expect(html).toContain("data-entity-key");
		// The when·what·where blurb is no longer inline — it is the page's KOMMENDE
		// section (followDetail), reachable by the tap.
		expect(html).not.toContain("fn-detail");
	});

	it("escapes HTML in entity names", () => {
		dash.allEvents = [];
		const html = dash.followRow({ name: "<script>x</script>", sport: "chess" }, false);
		expect(html).not.toContain("<script>x");
	});

	it("surfaces a golfer's own tee time inline in the row (WP-170)", () => {
		dash.allEvents = [{
			sport: "golf", title: "Genesis Scottish Open", time: inDays(2),
			norwegianPlayers: [{ name: "Viktor Hovland", teeTime: "09:39" }],
			featuredGroups: [{ player: "Viktor Hovland", teeTime: "09:39", groupmates: [{ name: "Wyndham Clark" }] }],
		}];
		const html = dash.followRow({ name: "Viktor Hovland", aliases: ["Hovland"], sport: "golf" }, true);
		expect(html).toContain("09:39");        // tee time inline in the when-label
	});

	it("shows a cut golfer's status instead of «pågår nå» for the ongoing tournament (WP-95)", () => {
		// The tournament is live (window spans now) so relDay alone would say
		// «pågår nå», but this golfer is out — the row must show the status.
		dash.allEvents = [{
			sport: "golf", title: "The Open", time: inDays(-2), endTime: inDays(1),
			norwegianPlayers: [{ name: "Viktor Hovland", teeTime: null, teeTimeUTC: null, status: "røk cutten" }],
		}];
		const html = dash.followRow({ name: "Viktor Hovland", aliases: ["Hovland"], sport: "golf" }, true);
		expect(html).toContain("røk cutten");
		expect(html).not.toContain("pågår nå");
	});
});

describe("entity page — «hva skjer med X?» (WP-170)", () => {
	const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

	const hovland = { id: "viktor-hovland", name: "Viktor Hovland", aliases: ["Hovland"], sport: "golf" };

	it("composes KOMMENDE (with tee time) + MER, omitting sections with no data", () => {
		dash.allEvents = [{
			sport: "golf", title: "Genesis Scottish Open", time: inDays(2),
			norwegianPlayers: [{ name: "Viktor Hovland", teeTime: "09:39" }],
			featuredGroups: [{ player: "Viktor Hovland", teeTime: "09:39", groupmates: [{ name: "Wyndham Clark" }] }],
			streaming: [{ platform: "Discovery+" }],
		}];
		dash.recentResults = {};
		dash.standings = {};
		dash.news = [];
		dash.entities = [];
		dash._identityIndex = null;
		const html = dash.entityPageHtml(hovland);
		expect(html).toContain("Kommende");
		expect(html).toContain("Tee-tid");        // followDetail's tee-time row
		expect(html).toContain("Wyndham Clark");
		expect(html).not.toContain("Siste resultat"); // no results data → omitted
		expect(html).not.toContain("Tabell");          // golf has no leaderboard here
	});

	it("shows the honest empty line when nothing is known", () => {
		dash.allEvents = [];
		dash.recentResults = {};
		dash.standings = {};
		dash.news = [];
		const html = dash.entityPageHtml({ name: "Ukjent IL", sport: "handball" });
		expect(html).toContain("Ingenting på tavla");
		expect(html).not.toContain("Kommende");
	});

	it("shows a football team its OWN league table, and never another's (WP-171 gate)", () => {
		dash.standings = {
			football: {
				premierLeague: [
					{ position: 1, team: "Liverpool", points: 30 },
					{ position: 2, team: "Arsenal", points: 28 },
					{ position: 14, team: "Everton", points: 13 },
				],
			},
		};
		const table = win.ssEntityStandingsTable(dash.standings, { name: "Everton", sport: "football" });
		expect(table.title).toBe("Premier League");
		expect(table.rows.some((r) => r.name === "Everton" && r.highlighted)).toBe(true);
		// A club we publish no table for gets nothing — not the PL table.
		expect(win.ssEntityStandingsTable(dash.standings, { name: "Lyn", sport: "football" })).toBe(null);
	});

	it("links to the specialist only for sports with a verified endpoint", () => {
		expect(win.ssSpecialistLink("football", "FK Lyn Oslo").url).toContain("fotmob.com");
		expect(win.ssSpecialistLink("football", "A & B").url).not.toContain("&B");
		expect(win.ssSpecialistLink("chess", "Magnus Carlsen")).toBe(null);
	});
});

describe("'Neste opp' top glance — upcoming-only, nearest first", () => {
	const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

	it("keeps only covered entities with an upcoming event, sorted soonest-first", () => {
		// WP-96: the glance sources from the catalog (dash.covers), not a personal profile.
		dash.covers = { alwaysTrack: {
			athletes: [
				{ name: "Casper Ruud", aliases: ["Ruud"], sport: "tennis" },
				{ name: "Aryan Tari", aliases: ["Tari"], sport: "chess" }, // no event → excluded
			],
			teams: [{ name: "Lyn", sport: "football" }],
		} };
		dash.allEvents = [
			{ sport: "football", title: "Strømsgodset – Lyn", homeTeam: "Strømsgodset", awayTeam: "Lyn", time: inDays(18) },
			{ sport: "tennis", title: "Swiss Open (Casper Ruud)", time: inDays(6) },
		];
		const rows = dash.nextUpEntries();
		expect(rows.map((r) => r.entry.name)).toEqual(["Casper Ruud", "Lyn"]); // Tari dropped, Ruud (6d) before Lyn (18d)
	});

	it("returns nothing when no covered entity has an upcoming event (section stays hidden)", () => {
		dash.covers = { alwaysTrack: { athletes: [{ name: "Aryan Tari", sport: "chess" }], teams: [] } };
		dash.allEvents = [];
		expect(dash.nextUpEntries()).toEqual([]);
	});
});

describe("live leaderboard (golf/F1) — quiet line + expandable board", () => {
	it("golf: leader on the line, your Norwegians' live position, full board on expand", () => {
		const html = dash.liveGolfItem({
			name: "Genesis Scottish Open", state: "in",
			top: [{ pos: "1", player: "Tom Kim", score: "-5" }, { pos: "2", player: "Rory McIlroy", score: "-5" }],
			tracked: [{ pos: "26", player: "Viktor Hovland", score: "-2" }],
		});
		expect(html).toContain("Genesis Scottish Open");
		expect(html).toContain("Tom Kim");          // leader
		expect(html).toContain("Viktor Hovland");     // your player's live position
		expect(html).toContain("-2");
		expect(html).toContain('data-live="golf"');
		expect(html).toContain("mine");               // tracked player highlighted in the board
	});
	it("golf: shows the projected cut and flags a Norwegian outside it", () => {
		const html = dash.liveGolfItem({
			name: "X Open", state: "in",
			top: [{ pos: "1", player: "A Player", score: "-5" }],
			tracked: [{ pos: "95", player: "Kristoffer Reitan", score: "+1", out: true }],
			cut: { n: -1, label: "-1" },
		});
		expect(html).toContain("Antatt cut");
		expect(html).toContain("-1");
		expect(html).toContain("utenfor");   // Reitan flagged outside the cut
	});
	it("F1: session + leader on the line, running order on expand", () => {
		const html = dash.liveF1Item({ name: "Belgian GP", state: "in", session: "Race", top: [{ pos: "1", player: "Max Verstappen", team: "Red Bull" }] });
		expect(html).toContain("Belgian GP");
		expect(html).toContain("Race");
		expect(html).toContain("Max Verstappen");
		expect(html).toContain('data-live="f1"');
	});
});

describe("must-see selection follows the goal's priorities", () => {
	it("favorite, importance>=4, or Norwegian participation", () => {
		expect(dash.isMustSee({ isFavorite: true })).toBe(true);
		expect(dash.isMustSee({ importance: 4 })).toBe(true);
		expect(dash.isMustSee({ norwegian: true, norwegianPlayers: [{ name: "x" }] })).toBe(true);
		expect(dash.isMustSee({ importance: 2 })).toBe(false);
	});
});

// WP-02: loadData() must prefer the server's stable id (build-events.js hash)
// and only fall back to the old index-based synthesis for a payload from
// before that field existed. Uses its own sandbox so the stubbed fetch/response
// doesn't interfere with the shared `dash` instance used above.
describe("loadData: stable id from the server, index fallback for old payloads", () => {
	function sandboxWithEvents(events) {
		const sandbox = createClientSandbox();
		loadClientScript(sandbox, "shared-constants.js");
		loadClientScript(sandbox, "lens.js");
		loadClientScript(sandbox, "dashboard.js");
		loadClientScript(sandbox, "live.js");
		loadClientScript(sandbox, "detail.js");
		loadClientScript(sandbox, "followed.js");
		loadClientScript(sandbox, "chrome.js");
		sandbox.fetch = (url) => {
			const name = String(url).split("data/")[1]?.split("?")[0];
			if (name === "events.json") return Promise.resolve({ ok: true, json: () => Promise.resolve(events) });
			return Promise.resolve({ ok: false });
		};
		return sandbox.window.dashboard;
	}

	it("uses e.id from data when the server already sent one", async () => {
		const d = sandboxWithEvents([{ id: "abc123def456", sport: "football", title: "X", time: soon() }]);
		await d.loadData();
		expect(d.allEvents[0].id).toBe("abc123def456");
	});

	it("falls back to the index-based synthesis when a payload has no id (pre-WP-02)", async () => {
		const time = soon();
		const d = sandboxWithEvents([{ sport: "football", title: "Y", time }]);
		await d.loadData();
		expect(d.allEvents[0].id).toBe(`football|Y|${time}|0`);
	});

	it("keeps the live-score overlay keyed on the same id loadData assigned", async () => {
		// The live poller (pollFootballScores etc.) writes this.liveScores[matched.id]
		// using the SAME e.id set here — so whichever id source loadData picked
		// (server-sent or synthesized fallback), lookups by e.id must line up.
		const d = sandboxWithEvents([{ id: "liveid1", sport: "football", title: "Live match", time: soon() }]);
		await d.loadData();
		const id = d.allEvents[0].id;
		d.liveScores[id] = { home: 1, away: 0, state: "in" };
		const html = d.eventRow(d.allEvents[0]);
		expect(html).toContain("1–0"); // eventRow reads this.liveScores[e.id] and rendered the live score
	});
});

// WP-128: a just-finished multi-day event (endTime just past, start day in the past)
// stayed in the display window but kept its PAST start-day heading, which then sat
// ABOVE «I dag» (19.–20.07 the finished Corales/«Torsdag 16. juli» tronet øverst) —
// a break of DESIGN § Agendaen lov 1 ("Aldri passerte dager"). It must live under
// «I dag» instead; a past-day heading must never render. Tested on the pure grouping.
describe("agenda day grouping: no past-day heading above «I dag» (WP-128)", () => {
	const hoursAgo = (h) => new Date(Date.now() - h * 3600000).toISOString();
	const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();
	const inHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

	it("buckets a just-finished multi-day event (past start day) under «I dag», never its past start day", () => {
		dash._fullHorizon = false;
		dash.allEvents = [
			// Started 4 days ago, ended ~1h ago — still inside the 3h recently-finished
			// tail (so it's shown), but its start day is in the past.
			{ id: "corales", sport: "golf", title: "Corales Championship", time: daysAgo(4), endTime: hoursAgo(1) },
			{ id: "today1", sport: "football", title: "A vs B", homeTeam: "A", awayTeam: "B", time: inHours(2) },
		];
		const { groups } = dash.agendaDayGroups();
		const todayKey = dash.osloDayKey(new Date());
		// No heading may sit on a past day, and «I dag» is first (nothing above it).
		expect(groups.every((g) => g.key >= todayKey)).toBe(true);
		expect(groups[0].name).toBe("I dag");
		// The finished multi-day event lives under «I dag».
		const today = groups.find((g) => g.isToday);
		expect(today.events.some((e) => e.id === "corales")).toBe(true);
	});

	it("keeps «I dag» the first heading even when the only event is a past-start one", () => {
		dash._fullHorizon = false;
		dash.allEvents = [
			{ id: "solo", sport: "golf", title: "Some Championship", time: daysAgo(3), endTime: hoursAgo(2) },
		];
		const { groups } = dash.agendaDayGroups();
		expect(groups).toHaveLength(1);
		expect(groups[0].name).toBe("I dag");
		expect(groups[0].isToday).toBe(true);
	});
});

// WP-124: horizon consistency. The agenda hard-caps at 14 days; the new "Fremover"
// disclosure owns 14–42 days as quiet date · what · tournament rows (no channel), so
// web + iOS partition the horizon identically (iOS Uka caps at 14 d, Nyheter-FREMOVER
// owns beyond). Tested on the pure selection (forwardWindow) + row string, plus the
// render's hide-when-empty via a stubbed #fremover element.
describe("Fremover: the 14–42-day forward look (WP-124)", () => {
	const days = (n) => new Date(Date.now() + n * 86400000).toISOString();

	it("forwardWindow keeps only events beyond 14 days and within ~42 days", () => {
		dash.allEvents = [
			{ id: "near", sport: "football", title: "Nær", time: days(5) },    // < 14d → the agenda owns it
			{ id: "edge", sport: "football", title: "Innafor", time: days(20) }, // 14–42d
			{ id: "far", sport: "football", title: "Fjern", time: days(30) },   // 14–42d
			{ id: "beyond", sport: "football", title: "For langt", time: days(60) }, // > 42d
		];
		const ids = dash.forwardWindow().map((e) => e.id);
		expect(ids).toContain("edge");
		expect(ids).toContain("far");
		expect(ids).not.toContain("near");
		expect(ids).not.toContain("beyond");
	});

	it("forwardWindow is sorted earliest-first", () => {
		dash.allEvents = [
			{ id: "b", sport: "football", title: "B", time: days(30) },
			{ id: "a", sport: "football", title: "A", time: days(20) },
		];
		expect(dash.forwardWindow().map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("keeps a multi-day event that overlaps the window (isEventInWindow, never a manual time>= filter)", () => {
		dash.allEvents = [
			// Starts in 10 days (< 14d) but runs to day 25 — overlaps [14d, 42d].
			{ id: "grand-tour", sport: "cycling", title: "Rundtur", time: days(10), endTime: days(25) },
		];
		expect(dash.forwardWindow().map((e) => e.id)).toContain("grand-tour");
	});

	it("forwardRow shows date + title + tournament, and NEVER a channel this far out", () => {
		const html = dash.forwardRow({
			id: "x", sport: "football", title: "Sesongstart",
			tournament: "Eliteserien", time: days(20),
			streaming: [{ platform: "TV 2 Play", url: "https://tv2.no" }],
		});
		expect(html).toContain("Sesongstart");
		expect(html).toContain("Eliteserien");
		expect(html).toContain("fwd-date");
		// No viewing option is rendered at this horizon — a heads-up, not "watch here".
		expect(html).not.toContain("TV 2 Play");
		expect(html).not.toContain("ev-where");
	});

	it("forwardDateLabel gives a bare date (no clock) for single-day and a span for multi-day", () => {
		const single = dash.forwardDateLabel({ time: "2026-08-20T18:00:00Z" });
		expect(single).toContain("20.");
		expect(single).not.toContain(":"); // a date, never a clock
		const span = dash.forwardDateLabel({ time: "2026-08-20T10:00:00Z", endTime: "2026-08-27T20:00:00Z" });
		expect(span).toContain("–");
	});

	it("renderFremover hides the section entirely when nothing is booked beyond 14 days", () => {
		dash.allEvents = [{ id: "near", sport: "football", title: "Nær", time: days(5) }];
		const el = { hidden: false, innerHTML: "stale" };
		const prev = win.document.getElementById;
		win.document.getElementById = (id) => (id === "fremover" ? el : null);
		dash.renderFremover();
		win.document.getElementById = prev;
		expect(el.hidden).toBe(true);
		expect(el.innerHTML).toBe("");
	});

	it("renderFremover fills and shows the section when forvarsler exist", () => {
		dash.allEvents = [{ id: "far", sport: "football", title: "Sesongstart", tournament: "Eliteserien", time: days(20) }];
		const el = { hidden: true, innerHTML: "" };
		const prev = win.document.getElementById;
		win.document.getElementById = (id) => (id === "fremover" ? el : null);
		dash.renderFremover();
		win.document.getElementById = prev;
		expect(el.hidden).toBe(false);
		expect(el.innerHTML).toContain("Fremover");
		expect(el.innerHTML).toContain("Sesongstart");
	});
});

// WP-128: the live poller re-renders the whole agenda (innerHTML rebuild) every 60s,
// which used to collapse whatever row the reader had expanded. eventRow now reads the
// remembered-open set (this._agendaOpen) and bakes the open state back into the HTML,
// so a re-render re-opens it. Tested on the pure eventRow string.
describe("expanded agenda rows survive a live-poll re-render (WP-128)", () => {
	const soon = () => new Date(Date.now() + 3600000).toISOString();
	// Golf + venue → genuinely expandable (hasDetail true), with «Royal Portrush» in the detail.
	const ev = { id: "exp1", sport: "golf", title: "The Open", time: soon(), venue: "Royal Portrush" };

	it("renders aria-expanded=false with an empty, hidden detail when not remembered open", () => {
		dash._agendaOpen = new Set();
		const html = dash.eventRow(ev);
		expect(html).toContain('aria-expanded="false"');
		expect(html).toContain('class="ev-detail" hidden></div>'); // detail is empty + hidden
		expect(html).not.toContain("Royal Portrush");
	});

	it("bakes the open state back into the row when the id is remembered (survives the rebuild)", () => {
		dash._agendaOpen = new Set(["exp1"]);
		const html = dash.eventRow(ev);
		expect(html).toContain('aria-expanded="true"');
		expect(html).not.toContain('class="ev-detail" hidden'); // detail shown, not hidden
		expect(html).toContain("Royal Portrush");                // detail content present after the rebuild
	});

	it("isRowOpen reflects the remembered-open set", () => {
		dash._agendaOpen = new Set(["exp1"]);
		expect(dash.isRowOpen("exp1")).toBe(true);
		expect(dash.isRowOpen("nope")).toBe(false);
	});
});

// WP-128: «Neste opp» must not repeat an entity's next event when that same event
// already has its own visible agenda row in the window (renderAgenda records the
// shown ids). Without the set (before the first agenda render) it shows everything.
describe("«Neste opp» dedupes rows already visible in the agenda (WP-128)", () => {
	const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();

	it("drops a glance entry whose next event already has an agenda row in the window", () => {
		dash.covers = { alwaysTrack: {
			athletes: [{ name: "Casper Ruud", aliases: ["Ruud"], sport: "tennis" }],
			teams: [{ name: "Lyn", sport: "football" }],
		} };
		dash.allEvents = [
			{ id: "ruud-swiss", sport: "tennis", title: "Swiss Open (Casper Ruud)", time: inDays(3) },
			{ id: "lyn-match", sport: "football", title: "Strømsgodset – Lyn", homeTeam: "Strømsgodset", awayTeam: "Lyn", time: inDays(5) },
		];
		// Ruud's next event is already a visible agenda row; Lyn's is not.
		dash._agendaShownIds = new Set(["ruud-swiss"]);
		const rows = dash.nextUpEntries();
		expect(rows.map((r) => r.entry.name)).toEqual(["Lyn"]);
	});

	it("shows everything when no agenda has rendered yet (no shown-id set)", () => {
		dash.covers = { alwaysTrack: {
			athletes: [{ name: "Casper Ruud", aliases: ["Ruud"], sport: "tennis" }],
			teams: [],
		} };
		dash.allEvents = [{ id: "ruud-swiss", sport: "tennis", title: "Swiss Open (Casper Ruud)", time: inDays(3) }];
		dash._agendaShownIds = undefined;
		expect(dash.nextUpEntries().map((r) => r.entry.name)).toEqual(["Casper Ruud"]);
	});
});

// WP-126 — the ONE shared live definition (ssLiveState) + the "Direkte nå" line
// showing non-ESPN sports (a Tour stage / chess round / CS2 match), not just the
// ESPN-polled football/golf/F1.
describe("shared live state (ssLiveState)", () => {
	// Summer (CEST, UTC+2): Oslo 03:00 = 01:00Z, Oslo 14:00 = 12:00Z.
	const ssLiveState = () => win.ssLiveState;

	it("uses the sport default duration when there is no endTime", () => {
		const start = "2026-07-14T12:00:00Z";
		const e = { sport: "football", time: start }; // ~2h15 default
		const s = new Date(start).getTime();
		expect(win.ssLiveState(e, s + 60 * 60 * 1000)).toBe("direkte"); // 1h in
		expect(win.ssLiveState(e, s + 3 * 60 * 60 * 1000)).toBe(null); // 3h in → past default
		expect(win.ssLiveState(e, s - 60 * 1000)).toBe(null); // not started yet
	});

	it("a Tour de France stage mid-session is 'direkte'", () => {
		const e = { sport: "cycling", title: "Etappe 12", time: "2026-07-14T11:30:00Z", endTime: "2026-07-14T15:30:00Z" };
		expect(win.ssLiveState(e, new Date("2026-07-14T13:00:00Z").getTime())).toBe("direkte");
		expect(win.ssLiveState(e, new Date("2026-07-14T16:00:00Z").getTime())).toBe(null); // finished
	});

	it("a multi-day tournament is 'pågår' outside the daily window (03:00), 'direkte' inside (14:00)", () => {
		const e = { sport: "golf", title: "The Open", time: "2026-07-13T08:00:00Z", endTime: "2026-07-18T20:00:00Z" };
		expect(win.ssLiveState(e, new Date("2026-07-15T01:00:00Z").getTime())).toBe("pågår"); // Oslo 03:00
		expect(win.ssLiveState(e, new Date("2026-07-15T12:00:00Z").getTime())).toBe("direkte"); // Oslo 14:00
	});

	it("a finished single-session event is null", () => {
		const e = { sport: "tennis", title: "Semifinale", time: "2026-07-14T10:00:00Z", endTime: "2026-07-14T13:00:00Z" };
		expect(win.ssLiveState(e, new Date("2026-07-14T15:00:00Z").getTime())).toBe(null);
	});

	it("an authoritative in-progress status wins outright", () => {
		const e = { sport: "football", time: "2026-07-14T10:00:00Z", status: "STATUS_IN_PROGRESS" };
		// now is way past any default duration, but the status says live
		expect(win.ssLiveState(e, new Date("2026-07-14T20:00:00Z").getTime())).toBe("direkte");
	});
});

describe("the 'Direkte nå' line (live.js)", () => {
	it("directLiveEvents surfaces a non-ESPN sport (cycling) that is live now", () => {
		const now = new Date("2026-07-14T13:00:00Z").getTime();
		dash.allEvents = [
			{ id: "tdf-12", sport: "cycling", title: "Etappe 12", time: "2026-07-14T11:30:00Z", endTime: "2026-07-14T15:30:00Z", streaming: [{ platform: "TV 2 Play", url: "https://tv2.no" }] },
			{ id: "done", sport: "tennis", title: "Ferdig", time: "2026-07-14T08:00:00Z", endTime: "2026-07-14T10:00:00Z" },
			{ id: "later", sport: "football", title: "Senere", time: "2026-07-14T19:00:00Z" },
		];
		const live = dash.directLiveEvents(now);
		expect(live.map((e) => e.id)).toEqual(["tdf-12"]); // the cycling stage, not the finished/future ones
	});

	it("renders a calm live row with the event's title + channel", () => {
		const html = dash.liveEventRow({ id: "tdf-12", sport: "cycling", title: "Etappe 12", time: "2026-07-14T11:30:00Z", streaming: [{ platform: "TV 2 Play", url: "https://tv2.no" }] });
		expect(html).toContain("live-item");
		expect(html).toContain("Etappe 12");
		expect(html).toContain("TV 2 Play");
	});

	it("hasLiveEvents is true for a live non-ESPN event (drives the 60s tick)", () => {
		dash.allEvents = [{ id: "tdf-12", sport: "cycling", title: "Etappe 12", time: "2026-07-14T11:30:00Z", endTime: "2026-07-14T15:30:00Z" }];
		const realNow = Date.now;
		Date.now = () => new Date("2026-07-14T13:00:00Z").getTime();
		try {
			expect(dash.hasLiveEvents()).toBe(true);
		} finally {
			Date.now = realNow;
		}
	});
});

// ── RESULTAT-seksjonen (news-web.js, WP-171) ─────────────────────────────────
// The section now answers "hva skjedde" for every sport in recent-results.json,
// renders the goal scorers the fetcher already pays for, stays CAPPED (ro), and
// puts the remainder in one quiet «Vis alle» disclosure.
describe("Nyheter · RESULTAT (all sports, goal scorers, cap + disclosure)", () => {
	const results = {
		football: [
			{ homeTeam: "Molde", awayTeam: "SK Brann", homeScore: 1, awayScore: 2, date: "2026-07-18T16:00Z", league: "Eliteserien", goalScorers: [{ player: "Kristian Eriksen", team: "SK Brann", minute: "35'" }] },
			{ homeTeam: "Lyn", awayTeam: "KFUM", homeScore: 2, awayScore: 1, date: "2026-07-17T16:00Z", league: "OBOS-ligaen" },
			{ homeTeam: "Rosenborg", awayTeam: "Viking", homeScore: 0, awayScore: 0, date: "2026-07-16T16:00Z", league: "Eliteserien" },
			{ homeTeam: "Odd", awayTeam: "Sarpsborg", homeScore: 1, awayScore: 3, date: "2026-07-15T16:00Z", league: "Eliteserien" },
			{ homeTeam: "Tromsø", awayTeam: "Bodø/Glimt", homeScore: 0, awayScore: 2, date: "2026-07-14T16:00Z", league: "Eliteserien" },
		],
		golf: { pga: { tournamentName: "The Open", status: "final", topPlayers: [{ position: 1, player: "Ryan Fox", score: "-10" }], norwegianPlayers: [] } },
		f1: [{ raceName: "Belgian Grand Prix", date: "2026-07-17T11:30Z", circuit: "Spa", topDrivers: [{ position: 1, driver: "Kimi Antonelli" }] }],
	};

	function renderInto(recentResults) {
		let html = "";
		const el = { set innerHTML(v) { html = v; } };
		const realGet = win.document.getElementById;
		win.document.getElementById = (id) => (id === "nyheter" ? el : null);
		try {
			dash.recentResults = recentResults;
			dash.news = [];
			dash.renderNyheter();
		} finally {
			win.document.getElementById = realGet;
		}
		return html;
	}

	it("shows golf + F1 results alongside football, with goal scorers and minute", () => {
		const html = renderInto(results);
		expect(html).toContain("The Open");
		expect(html).toContain("Ryan Fox -10");
		expect(html).toContain("Belgian Grand Prix");
		expect(html).toContain("35&#039; Kristian Eriksen (SK Brann)"); // escaped apostrophe — escapeHtml, per the client-render rule
	});

	it("caps the visible rows and puts the rest behind a «Vis alle» disclosure", () => {
		const html = renderInto(results);
		const rowsBeforeDisclosure = html.split("<details")[0].split('class="rs-row"').length - 1;
		expect(rowsBeforeDisclosure).toBe(5);
		expect(html).toContain("Vis alle");
		expect(html.split('class="rs-row"').length - 1).toBe(7); // nothing dropped
	});

	it("escapes every data string in a result row (XSS)", () => {
		const html = dash.resultRow({
			sport: "football", title: '<img src=x onerror=alert(1)>', outcome: "1–<b>2</b>",
			meta: '"><script>bad()</script>', details: ["<i>90'</i> Ond"],
		});
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<b>");
		expect(html).toContain("&lt;img");
		expect(html).toContain("&lt;i&gt;90");
	});
});

// ── NYTT · type-tag (WP-175) ─────────────────────────────────────────────────
// The server's story-kind renders as a quiet grey tag in the row's type slot —
// but only for the four known types, and only when the server classified the
// pointer (absent otherwise, so the row looks exactly as before).
describe("Nyheter · NYTT type tag (WP-175)", () => {
	const soon = () => new Date().toISOString();

	it("renders the story-kind as a quiet grey tag when the pointer is classified", () => {
		const html = dash.newsRow({ title: "Arsenal sign keeper Rodriguez", link: "https://ex.com/a", source: "guardian-football", sport: "football", type: "overgang", publishedAt: soon() });
		expect(html).toContain('class="nw-type"');
		expect(html).toContain("Overgang");
	});

	it("shows NO type tag for an unclassified pointer (the slot stays empty)", () => {
		const html = dash.newsRow({ title: "Helgens kamper", link: "https://ex.com/b", source: "nrk-sport", sport: "general", publishedAt: soon() });
		expect(html).not.toContain("nw-type");
	});

	it("ignores an unknown/garbage type value (allowlist — it never reaches the DOM)", () => {
		const html = dash.newsRow({ title: "x", link: "https://ex.com/c", source: "s", sport: "football", type: '<script>alert(1)</script>' });
		expect(html).not.toContain("nw-type");
		expect(html).not.toContain("<script>");
	});
});
