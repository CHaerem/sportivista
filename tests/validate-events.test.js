// validate-events.js: catches malformed events, enforces the AI-research contract.
import { describe, it, expect } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

function runValidate(events) {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ss-validate-"));
	fs.writeFileSync(path.join(dataDir, "events.json"), JSON.stringify(events));
	let exitCode = 0;
	try {
		execFileSync("node", ["scripts/validate-events.js"], {
			env: { ...process.env, SPORTSYNC_DATA_DIR: dataDir },
			stdio: "pipe",
		});
	} catch (err) {
		exitCode = err.status;
	}
	fs.rmSync(dataDir, { recursive: true, force: true });
	return exitCode;
}

const future = new Date(Date.now() + 86400000).toISOString();

describe("validate-events", () => {
	it("passes valid events", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: future }])).toBe(0);
	});

	it("fails on missing time", () => {
		expect(runValidate([{ sport: "golf", title: "Open" }])).toBe(1);
	});

	it("fails on invalid time format", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: "not-a-date" }])).toBe(1);
	});

	it("fails on out-of-range importance", () => {
		expect(runValidate([{ sport: "golf", title: "Open", time: future, importance: 9 }])).toBe(1);
	});

	it("fails on ai-research event without valid confidence", () => {
		expect(runValidate([{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research" }])).toBe(1);
	});

	it("fails on high-confidence ai-research event with fewer than 2 evidence URLs", () => {
		expect(
			runValidate([{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research", confidence: "high", evidence: ["https://a.no"] }])
		).toBe(1);
	});

	it("passes high-confidence ai-research event with 2+ evidence URLs", () => {
		expect(
			runValidate([
				{ sport: "biathlon", title: "Sprint", time: future, source: "ai-research", confidence: "high", evidence: ["https://a.no", "https://b.no"] },
			])
		).toBe(0);
	});
});

// ── WP-246: the landing-page gap must be COUNTED, not invisible ─────────────

import { validateEvents, loadEventSchema } from "../scripts/validate-events.js";

describe("landing-page-only channel URLs are a counted warning (WP-246)", () => {
	const schema = loadEventSchema();
	const soon = new Date(Date.now() + 2 * 86400000).toISOString();
	const farOut = new Date(Date.now() + 30 * 86400000).toISOString();
	const check = (events) => validateEvents(events, schema);

	it("counts a near-term event whose only channel URL is a service front page", () => {
		const r = check([
			{ sport: "football", title: "Brann – Rosenborg", time: soon, streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }] },
		]);
		expect(r.streamingLandingOnly).toBe(1);
		expect(r.errors).toBe(0); // a warning, never a build-breaking error
	});
	it("does NOT count an event that has a real deep link alongside the landing one", () => {
		const r = check([
			{
				sport: "cycling", title: "Etappe 5", time: soon,
				streaming: [
					{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" },
					{ platform: "TV 2 Play", url: "https://play.tv2.no/sport/sykkel/arctic-race-of-norway", urlKind: "deep" },
				],
			},
		]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("does NOT count a channel with no URL at all — that is a different (already honest) gap", () => {
		const r = check([{ sport: "chess", title: "Runde 3", time: soon, streaming: [{ platform: "Chess.com" }] }]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("only looks at the near term (the next 7 days), like the streaming-missing warning", () => {
		const r = check([
			{ sport: "football", title: "Langt frem", time: farOut, streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport", urlKind: "landing" }] },
		]);
		expect(r.streamingLandingOnly).toBe(0);
	});
	it("counts static-pipeline events too, not just ai-research (that is where most of them come from)", () => {
		const landing = { platform: "Viaplay", url: "https://viaplay.no/no-no/sport", urlKind: "landing" };
		const r = check([
			{ sport: "f1", title: "Belgian GP", time: soon, streaming: [landing] },
			{ sport: "football", title: "Brann – Molde", time: soon, streaming: [landing], source: "ai-research", confidence: "medium" },
		]);
		expect(r.streamingLandingOnly).toBe(2);
		expect(r.errors).toBe(0);
	});
	it("accepts urlKind through the formal schema (no shape drift, backward compatible without it)", () => {
		const r = check([
			{ sport: "f1", title: "Med felt", time: soon, streaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport", urlKind: "landing" }] },
			{ sport: "f1", title: "Uten felt", time: soon, streaming: [{ platform: "Viaplay", url: "https://viaplay.no/no-no/sport" }] },
		]);
		expect(r.errors).toBe(0);
		expect(check([{ sport: "f1", title: "Ugyldig", time: soon, streaming: [{ platform: "Viaplay", urlKind: "kanskje" }] }]).errors).toBeGreaterThan(0);
	});
});

// ── WP-242: høy tillit krever primær/offisiell basis — TELT, ikke usynlig ────

describe("basis-kontrakten er et telt varsel for høytillits-events (WP-242)", () => {
	const schema = loadEventSchema();
	const soon = new Date(Date.now() + 2 * 86400000).toISOString();
	const check = (events) => validateEvents(events, schema);
	const high = (overrides = {}) => ({
		sport: "cycling",
		title: "Etappe 1",
		time: soon,
		source: "ai-research",
		confidence: "high",
		evidence: ["https://www.letour.fr/a", "https://www.tv2.no/b"],
		streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport" }],
		...overrides,
	});

	it("teller et høytillits-event UTEN proveniens som svakt på både tid og kanal — men aldri som feil", () => {
		const r = check([high()]);
		expect(r.timeBasisWeak).toBe(1);
		expect(r.channelBasisWeak).toBe(1);
		expect(r.errors).toBe(0); // varsel, ikke pipeline-fellende — WP-246-mønsteret
	});

	it("primær tidsbasis + kringkasterens egen kanalbasis ⇒ null svake", () => {
		const r = check([
			high({
				provenance: {
					time: { sourceId: "letour", url: "https://www.letour.fr/a", basis: "primary" },
					streaming: { sourceId: "tv2", url: "https://hjelp.tv2.no/b", basis: "official" },
				},
			}),
		]);
		expect(r.timeBasisWeak).toBe(0);
		expect(r.channelBasisWeak).toBe(0);
		expect(r.errors).toBe(0);
	});

	it("offisiell basis for tid godtas også (arrangør-nær offisiell publisering)", () => {
		const r = check([
			high({
				streaming: [],
				provenance: { time: { sourceId: "nrk", url: "https://nrk.no/a", basis: "official" } },
			}),
		]);
		expect(r.timeBasisWeak).toBe(0);
	});

	it("secondary basis teller som svak — det er nettopp cyclingstage-klassen", () => {
		const r = check([
			high({
				provenance: {
					time: { sourceId: "cyclingstage", url: "https://www.cyclingstage.com/x", basis: "secondary" },
					streaming: { sourceId: "wikipedia", url: "https://en.wikipedia.org/y", basis: "secondary" },
				},
			}),
		]);
		expect(r.timeBasisWeak).toBe(1);
		expect(r.channelBasisWeak).toBe(1);
	});

	it("et event uten streaming teller ikke som svak kanal (ingenting å basere)", () => {
		const r = check([high({ streaming: [] })]);
		expect(r.timeBasisWeak).toBe(1);
		expect(r.channelBasisWeak).toBe(0);
	});

	it("kontrakten gjelder kun høy tillit — medium teller ikke", () => {
		const r = check([high({ confidence: "medium", evidence: ["https://a.no"] })]);
		expect(r.timeBasisWeak).toBe(0);
		expect(r.channelBasisWeak).toBe(0);
	});

	it("skjemaet godtar proveniens-formen og fanger brudd (basis-enum, ukjente felter, manglende sourceId)", () => {
		const ok = high({
			provenance: {
				time: { sourceId: "letour", url: "https://www.letour.fr/a", basis: "primary", retrievedAt: soon, note: "migrert mekanisk fra evidence (WP-242)" },
			},
		});
		expect(check([ok]).errors).toBe(0);
		const badBasis = high({ provenance: { time: { sourceId: "letour", url: "https://x.no", basis: "vibes" } } });
		expect(check([badBasis]).errors).toBeGreaterThan(0);
		const unknownProp = high({ provenance: { time: { sourceId: "letour", url: "https://x.no", basis: "primary", surprise: 1 } } });
		expect(check([unknownProp]).errors).toBeGreaterThan(0);
		const missingSource = high({ provenance: { time: { url: "https://x.no", basis: "primary" } } });
		expect(check([missingSource]).errors).toBeGreaterThan(0);
	});

	it("bakoverkompatibilitet: flat evidence uten provenance validerer fortsatt med null feil", () => {
		const legacy = high(); // ingen provenance i det hele tatt
		expect(check([legacy]).errors).toBe(0);
	});
});

// ── Summary↔streaming coherence: the grader-mandated mechanical assert ───────
// The research grader flagged 6+ runs running that no mechanical check owned the
// class where a summary's designated-viewing clause names a channel the
// structured streaming[] omits (Toppidrettsveka: streaming[]=NRK, prose said
// «Vises på VG+ Sport»; the Brann/Lillestrøm returlegg wrong-channel bug).

import { summaryChannelMismatches } from "../scripts/validate-events.js";

describe("summary↔streaming coherence is a counted warning", () => {
	const schema = loadEventSchema();
	const soon = new Date(Date.now() + 2 * 86400000).toISOString();
	const check = (events) => validateEvents(events, schema);

	it("flags the Toppidrettsveka class: viewing clause names VG+ Sport but streaming[] only has NRK", () => {
		const r = check([
			{
				sport: "cross-country", title: "Toppidrettsveka: Distanse", time: soon,
				streaming: [{ platform: "NRK", url: "https://tv.nrk.no/direkte" }],
				summary: "Distanse på Hitra. Vises på VG+ Sport (VGTV) — krever abonnement.",
			},
		]);
		expect(r.summaryChannelMismatch).toBe(1);
		expect(r.errors).toBe(0); // a warning, never a build-breaking error
		expect(summaryChannelMismatches({
			sport: "cross-country", title: "x", time: soon,
			streaming: [{ platform: "NRK" }],
			summary: "Vises på VG+ Sport (VGTV) — krever abonnement.",
		})).toEqual(["VG+ Sport"]);
	});

	it("does NOT flag when the clause names channels that ARE all in streaming[] (the fixed Toppidrettsveka)", () => {
		const r = check([
			{
				sport: "cross-country", title: "Toppidrettsveka: Distanse", time: soon,
				streaming: [{ platform: "NRK" }, { platform: "VG+ Sport" }],
				summary: "Distanse på Hitra. Vises gratis på NRK (TV/nett), og på VG+ Sport (VGTV) med abonnement.",
			},
		]);
		expect(r.summaryChannelMismatch).toBe(0);
	});

	it("does NOT flag a secondary channel mentioned OUTSIDE the viewing clause (primary + secondary line)", () => {
		const r = check([
			{
				sport: "football", title: "Bayern – Stuttgart", time: soon,
				streaming: [{ platform: "Viaplay" }],
				summary: "Bundesliga-åpning. Norsk visning: Viaplay. Enkeltkamper også via TV 2 Play «Mer fotball».",
			},
		]);
		expect(r.summaryChannelMismatch).toBe(0);
	});

	it("does NOT flag when streaming[] is empty — that is the separate streaming-missing gap, not a contradiction", () => {
		const r = check([
			{ sport: "football", title: "Ukjent kanal", time: soon, streaming: [], summary: "Vises på TV 2 Play." },
		]);
		expect(r.summaryChannelMismatch).toBe(0);
	});

	it("respects the negation guard: «Vises på NRK, ikke på TV 2» is not a TV 2 designation", () => {
		const r = check([
			{
				sport: "biathlon", title: "Sprint", time: soon,
				streaming: [{ platform: "NRK" }],
				summary: "Sprint. Vises på NRK, ikke på TV 2.",
			},
		]);
		expect(r.summaryChannelMismatch).toBe(0);
	});

	it("catches a co-channel the clause designates but streaming[] omits (HBO Max/Eurosport → Eurosport missing)", () => {
		expect(summaryChannelMismatches({
			sport: "cycling", title: "Vuelta", time: soon,
			streaming: [{ platform: "HBO Max (Sport)" }],
			summary: "Norsk visning HBO Max (Sport)/Eurosport.",
		})).toEqual(["Eurosport"]);
	});
});

// ── WP-245: kalibreringen binder kildevalget ────────────────────────────────
import { RELIABILITY_FLOOR } from "../scripts/lib/calibration-gate.js";

describe("calibration contract (WP-245)", () => {
	const schema = loadEventSchema();
	const soon = new Date(Date.now() + 86400000).toISOString();
	const calibration = {
		sources: {
			"cyclingstage.com": { checks: 17, agreed: 9, reliability: 0.53 },
			"wikipedia.org": { checks: 10, agreed: 10, reliability: 1 },
			"letourfemmes.fr": { checks: 6, agreed: 2, reliability: 0.33 },
		},
	};
	const sources = [
		{
			id: "letour",
			url: "https://www.letour.fr",
			endpoints: ["https://www.letour.fr", "https://www.letourfemmes.fr"],
			role: "primary",
			calibrationKey: "letourfemmes.fr",
		},
	];
	const check = (events, opts) => validateEvents(events, schema, opts);
	const ev = (over = {}) => ({
		sport: "cycling", title: "Etappe 14", time: soon, source: "ai-research",
		confidence: "high",
		evidence: ["https://www.cyclingstage.com/etappe-14/", "https://www.cyclingstage.com/startliste/"],
		...over,
	});

	it("hard-errors a high-confidence event resting solely on distrusted sources", () => {
		const r = check([ev()], { calibration, sources });
		expect(r.errors).toBe(1);
		expect(r.messages.some((m) => m.includes("WP-245") && m.includes("cyclingstage.com"))).toBe(true);
	});

	it("passes when a trusted source corroborates", () => {
		const r = check(
			[ev({ evidence: ["https://www.cyclingstage.com/x", "https://en.wikipedia.org/wiki/Tour"] })],
			{ calibration, sources }
		);
		expect(r.errors).toBe(0);
	});

	it("never judges medium confidence — medium is the honest label for a weak basis", () => {
		const r = check([ev({ confidence: "medium" })], { calibration, sources });
		expect(r.errors).toBe(0);
	});

	it("is inert without calibration data (fail-soft)", () => {
		expect(check([ev()]).errors).toBe(0);
		expect(RELIABILITY_FLOOR).toBeGreaterThan(0.53); // porten dekker det kanoniske tilfellet
	});

	it("a distrusted source never counts as strong basis in the WP-242 weak-basis counters", () => {
		const withProvenance = ev({
			evidence: ["https://www.letour.fr/etappe-14", "https://en.wikipedia.org/wiki/Tour"],
			provenance: { time: { sourceId: "letour", url: "https://www.letour.fr/etappe-14", basis: "primary" } },
		});
		expect(check([withProvenance]).timeBasisWeak).toBe(0); // uten kalibrering: primary = strong
		expect(check([withProvenance], { calibration, sources }).timeBasisWeak).toBe(1); // med: mistrodd ⇒ weak
	});
});
