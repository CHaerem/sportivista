// calibration-gate.js (WP-245): kalibreringen binder kildevalget — en kilde med
// målt reliabilitet < RELIABILITY_FLOOR kan aldri stå som eneste grunnlag.
import { describe, it, expect } from "vitest";
import {
	RELIABILITY_FLOOR,
	isDistrusted,
	urlReliability,
	factDistrusted,
	soleDistrustedBasis,
} from "../scripts/lib/calibration-gate.js";

// Speiler formene fra docs/data/calibration.json og scripts/config/sources.json.
const calibration = {
	sources: {
		"cyclingstage.com": { checks: 17, agreed: 9, reliability: 0.53 },
		"wikipedia.org": { checks: 10, agreed: 10, reliability: 1 },
		"viaplay.no": { checks: 2, agreed: 1, reliability: null }, // < 5 sjekker — holdt tilbake
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
const cfg = { calibration, sources };

const future = new Date(Date.now() + 86400000).toISOString();
const aiEvent = (over = {}) => ({
	sport: "cycling",
	title: "Etappe 14",
	time: future,
	source: "ai-research",
	confidence: "high",
	evidence: [],
	...over,
});

describe("isDistrusted", () => {
	it("only a MEASURED value below the floor binds", () => {
		expect(isDistrusted(0.53)).toBe(true);
		expect(isDistrusted(RELIABILITY_FLOOR)).toBe(false); // strengt under, ikke lik
		expect(isDistrusted(1)).toBe(false);
		expect(isDistrusted(null)).toBe(false); // for få sjekker = ukjent, aldri «dårlig»
		expect(isDistrusted(undefined)).toBe(false);
	});
});

describe("urlReliability", () => {
	it("resolves a direct host match, ignoring www", () => {
		expect(urlReliability("https://www.cyclingstage.com/tour-2026/", cfg)).toEqual({
			key: "cyclingstage.com",
			reliability: 0.53,
		});
	});

	it("resolves a true subdomain to the parent key", () => {
		expect(urlReliability("https://en.wikipedia.org/wiki/Tour", cfg)).toEqual({
			key: "wikipedia.org",
			reliability: 1,
		});
	});

	it("resolves via the register's calibrationKey first — a multi-host source maps to ONE measured key", () => {
		// letour.fr matcher ingen kalibreringsnøkkel direkte; registeret kobler den
		// til den målte søsterverten letourfemmes.fr (WP-240s calibrationKey).
		expect(urlReliability("https://www.letour.fr/etappe-14", cfg)).toEqual({
			key: "letourfemmes.fr",
			reliability: 0.33,
		});
	});

	it("returns null for unmeasured hosts, unparsable entries and lookalike-adjacent domains", () => {
		expect(urlReliability("https://ukjentkilde.no/sak", cfg)).toBeNull();
		expect(urlReliability("ikke en url", cfg)).toBeNull();
		// notcyclingstage.com er et ANNET domene — aldri fuzzy match (lookalike-vernet)
		expect(urlReliability("https://notcyclingstage.com/x", cfg)).toBeNull();
	});

	it("is inert without calibration data (fail-soft)", () => {
		expect(urlReliability("https://www.cyclingstage.com/x", {})).toBeNull();
	});
});

describe("factDistrusted", () => {
	it("judges a provenance fact by its sourceId via the register", () => {
		expect(factDistrusted({ sourceId: "letour", url: "https://www.letour.fr/x" }, cfg)).toBe(true);
	});

	it("falls back to the fact's own URL for an unregistered sourceId", () => {
		expect(factDistrusted({ sourceId: "ukjent", url: "https://www.cyclingstage.com/x" }, cfg)).toBe(true);
		expect(factDistrusted({ sourceId: "ukjent", url: "https://en.wikipedia.org/x" }, cfg)).toBe(false);
	});

	it("is false without calibration or without a fact", () => {
		expect(factDistrusted({ sourceId: "letour" }, {})).toBe(false);
		expect(factDistrusted(null, cfg)).toBe(false);
	});
});

describe("soleDistrustedBasis", () => {
	it("fires when EVERY evidence URL resolves to a distrusted source — also 2+ URLs from the same host", () => {
		const ev = aiEvent({
			evidence: ["https://www.cyclingstage.com/etappe-14/", "https://www.cyclingstage.com/startliste/"],
		});
		expect(soleDistrustedBasis(ev, cfg)).toEqual(["cyclingstage.com"]);
	});

	it("a trusted source blocks — that is what corroboration is", () => {
		const ev = aiEvent({
			evidence: ["https://www.cyclingstage.com/etappe-14/", "https://en.wikipedia.org/wiki/Tour"],
		});
		expect(soleDistrustedBasis(ev, cfg)).toBeNull();
	});

	it("an UNMEASURED source blocks — unknown means unmeasured, not bad", () => {
		expect(
			soleDistrustedBasis(aiEvent({ evidence: ["https://www.cyclingstage.com/x", "https://ukjentkilde.no/sak"] }), cfg)
		).toBeNull();
		// reliability: null (for få sjekker) mistros heller aldri
		expect(
			soleDistrustedBasis(aiEvent({ evidence: ["https://www.cyclingstage.com/x", "https://viaplay.no/sport"] }), cfg)
		).toBeNull();
	});

	it("an unparsable entry blocks — this is not a URL validator", () => {
		expect(
			soleDistrustedBasis(aiEvent({ evidence: ["https://www.cyclingstage.com/x", "ikke en url"] }), cfg)
		).toBeNull();
	});

	it("counts verificationSources as basis too", () => {
		const corroborated = aiEvent({
			evidence: ["https://www.cyclingstage.com/x"],
			verificationSources: ["https://en.wikipedia.org/wiki/Tour"],
		});
		expect(soleDistrustedBasis(corroborated, cfg)).toBeNull();
		const uncorroborated = aiEvent({
			evidence: [],
			verificationSources: ["https://www.cyclingstage.com/x"],
		});
		expect(soleDistrustedBasis(uncorroborated, cfg)).toEqual(["cyclingstage.com"]);
	});

	it("never judges non-ai-research events or events without evidence", () => {
		expect(soleDistrustedBasis({ source: "espn", evidence: ["https://www.cyclingstage.com/x"] }, cfg)).toBeNull();
		expect(soleDistrustedBasis(aiEvent(), cfg)).toBeNull();
	});

	it("collects every distrusted key when the basis spans several distrusted sources", () => {
		const ev = aiEvent({
			evidence: ["https://www.cyclingstage.com/x", "https://www.letour.fr/etappe-14"],
		});
		expect(soleDistrustedBasis(ev, cfg)).toEqual(["cyclingstage.com", "letourfemmes.fr"]);
	});
});
