// WP-242: scripts/lib/provenance.js — den mekaniske migreringen fra flat
// evidence til per-faktum-proveniens. Kjernen som testes her er
// LOOKALIKE-VERNET (franceletour.com må ALDRI migreres til A.S.O.-kilden
// letour) og konservatismen: bare det som beviselig kan knyttes til en
// registrert autoritet stemples — resten beholder sin flate evidence.
// Enhetstestene bruker små inline-fixturer; en avsluttende blokk kjører mot de
// EKTE konfigfilene så kartet, registeret og lib-en aldri driver fra hverandre.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { basisForRole, urlBelongsToSource, findCompetition, deriveProvenance } from "../scripts/lib/provenance.js";

// ── Inline-fixturer ─────────────────────────────────────────────────────────

const SOURCES = [
	{ id: "letour", url: "https://www.letour.fr", endpoints: ["https://www.letourfemmes.fr"], role: "primary", authorityFor: ["cycling:tour-de-france", "cycling:tour-de-france-femmes"] },
	{ id: "tv2", url: "https://www.tv2.no", endpoints: ["https://hjelp.tv2.no", "https://play.tv2.no"], role: "official-broadcaster", authorityFor: [] },
	{ id: "fc-barcelona", url: "https://www.fcbarcelona.com", role: "primary", authorityFor: ["football:fc-barcelona"] },
	{ id: "blast", url: "https://blast.tv", role: "primary", authorityFor: ["esports:blast"] },
	{ id: "wikipedia", url: "https://en.wikipedia.org", role: "encyclopedic", authorityFor: [] },
];

const AUTHORITY = {
	competitions: [
		{
			id: "cycling:tour-de-france",
			name: "Tour de France",
			sport: "cycling",
			match: ["tour de france"],
			time: { sourceIds: ["letour"] },
			channel: { options: [{ sourceId: "tv2", platform: "TV 2" }] },
			lookalikes: ["franceletour.com"],
		},
		{
			id: "cycling:tour-de-france-femmes",
			name: "Tour de France Femmes",
			sport: "cycling",
			match: ["tour de france femmes"],
			time: { sourceIds: ["letour"] },
			channel: { options: [{ sourceId: "tv2", platform: "TV 2" }] },
		},
		{
			id: "esports:blast",
			name: "BLAST",
			sport: "esports",
			match: ["blast"],
			time: { sourceIds: ["blast"] },
			channel: { options: [{ sourceId: "blast", platform: "BLAST.tv" }] },
		},
	],
};

const CFG = { sources: SOURCES, authority: AUTHORITY };

const tdfEvent = (overrides = {}) => ({
	sport: "cycling",
	tournament: "Tour de France 2026",
	title: "Etappe 12",
	time: "2026-07-16T11:30:00Z",
	source: "ai-research",
	confidence: "medium",
	researchedAt: "2026-07-04T17:33:56Z",
	streaming: [{ platform: "TV 2 Play", url: "https://play.tv2.no/sport" }],
	evidence: ["https://www.letour.fr/en/stage-12", "https://en.wikipedia.org/wiki/2026_Tour_de_France"],
	...overrides,
});

describe("basisForRole — rolledoktrinen oversatt til basis-enum", () => {
	it("arrangør/liga og forbund skaper faktumet", () => {
		expect(basisForRole("primary")).toBe("primary");
		expect(basisForRole("federation")).toBe("primary");
	});
	it("kringkasteren er offisiell; alt annet er annenhånds", () => {
		expect(basisForRole("official-broadcaster")).toBe("official");
		expect(basisForRole("aggregator")).toBe("secondary");
		expect(basisForRole("encyclopedic")).toBe("secondary");
		expect(basisForRole("media")).toBe("secondary");
	});
});

describe("urlBelongsToSource — eksakt vert, aldri fuzzy", () => {
	const letour = SOURCES[0];
	it("treffer kildens egen vert og registrerte endpoints", () => {
		expect(urlBelongsToSource("https://www.letour.fr/en/stage-12", letour)).toBe(true);
		expect(urlBelongsToSource("https://www.letourfemmes.fr/en/", letour)).toBe(true);
	});
	it("treffer under-/overdomene i begge retninger (hjelp.tv2.no ↔ tv2.no)", () => {
		expect(urlBelongsToSource("https://hjelp.tv2.no/sport/tour-de-france", SOURCES[1])).toBe(true);
		expect(urlBelongsToSource("https://sport.tv2.no/sykkel", SOURCES[1])).toBe(true);
	});
	it("LOOKALIKE-VERNET: franceletour.com hører ALDRI til letour", () => {
		expect(urlBelongsToSource("https://www.franceletour.com/etape-14", letour)).toBe(false);
		expect(urlBelongsToSource("https://letour-france.com/x", letour)).toBe(false);
	});
	it("tåler søppel-URLer", () => {
		expect(urlBelongsToSource("ikke en url", letour)).toBe(false);
		expect(urlBelongsToSource("", letour)).toBe(false);
	});
});

describe("findCompetition — sport-gated substring med lengste-treff-regel", () => {
	it("finner konkurransen via tournament", () => {
		expect(findCompetition(tdfEvent(), AUTHORITY).id).toBe("cycling:tour-de-france");
	});
	it("LENGSTE mønster vinner: Femmes-etapper går til femmes-oppføringen", () => {
		const ev = tdfEvent({ tournament: "Tour de France Femmes 2026" });
		expect(findCompetition(ev, AUTHORITY).id).toBe("cycling:tour-de-france-femmes");
	});
	it("sport må stemme — «blast» i en fotballtittel matcher ikke esports-oppføringen", () => {
		const ev = tdfEvent({ sport: "football", tournament: "Blast fra fortiden cup" });
		expect(findCompetition(ev, AUTHORITY)).toBeNull();
	});
});

describe("deriveProvenance — konservativ mekanisk migrering", () => {
	it("stempler tid fra kartets registrerte tidsautoritet (letour.fr → basis primary)", () => {
		const p = deriveProvenance(tdfEvent(), CFG);
		expect(p.time).toMatchObject({
			sourceId: "letour",
			url: "https://www.letour.fr/en/stage-12",
			basis: "primary",
			retrievedAt: "2026-07-04T17:33:56Z",
		});
		expect(p.time.note).toMatch(/migrert/);
	});

	it("stempler kanal kun når plattformen matcher kart-opsjonen OG kringkasterens egen URL finnes i evidensen", () => {
		const ev = tdfEvent({ evidence: ["https://www.letour.fr/en/stage-12", "https://hjelp.tv2.no/sport/tour-de-france"] });
		const p = deriveProvenance(ev, CFG);
		expect(p.streaming).toMatchObject({ sourceId: "tv2", basis: "official", url: "https://hjelp.tv2.no/sport/tour-de-france" });
	});

	it("ingen kanalstempel når plattformen ikke matcher opsjonen", () => {
		const ev = tdfEvent({
			streaming: [{ platform: "Eurosport" }],
			evidence: ["https://www.letour.fr/x", "https://hjelp.tv2.no/y"],
		});
		expect(deriveProvenance(ev, CFG).streaming).toBeUndefined();
	});

	it("LOOKALIKE-VERNET ende-til-ende: kun franceletour.com + wiki i evidensen ⇒ ingenting migreres", () => {
		const ev = tdfEvent({ evidence: ["https://www.franceletour.com/etape-14", "https://en.wikipedia.org/wiki/2026_Tour_de_France"] });
		expect(deriveProvenance(ev, CFG)).toBeNull();
	});

	it("faller tilbake til en sport-autoritativ primærkilde når kartet mangler oppføring (klubbens egen side)", () => {
		const ev = tdfEvent({
			sport: "football",
			tournament: "Treningskamp",
			title: "Barcelona – Como",
			streaming: [],
			evidence: ["https://www.fcbarcelona.com/en/football/first-team/news/kickoff"],
		});
		const p = deriveProvenance(ev, CFG);
		expect(p.time).toMatchObject({ sourceId: "fc-barcelona", basis: "primary" });
	});

	it("selv-strømmende arrangør får basis primary på kanalen (BLAST på BLAST.tv)", () => {
		const ev = tdfEvent({
			sport: "esports",
			tournament: "BLAST Bounty 2026",
			streaming: [{ platform: "BLAST.tv (gratis offisiell strøm)" }],
			evidence: ["https://blast.tv/counter-strike/schedule"],
		});
		const p = deriveProvenance(ev, CFG);
		expect(p.streaming).toMatchObject({ sourceId: "blast", basis: "primary" });
	});

	it("verifiedAt foretrekkes som retrievedAt, og verificationSources telles som kandidat-URLer", () => {
		const ev = tdfEvent({
			evidence: ["https://en.wikipedia.org/wiki/2026_Tour_de_France"],
			verifiedAt: "2026-07-10T09:30:00Z",
			verificationSources: ["https://www.letour.fr/en/stage-12"],
		});
		const p = deriveProvenance(ev, CFG);
		expect(p.time).toMatchObject({ sourceId: "letour", retrievedAt: "2026-07-10T09:30:00Z" });
	});

	it("rører ALDRI eksplisitt agent-skrevet proveniens", () => {
		const ev = tdfEvent({ provenance: { time: { sourceId: "letour", url: "https://www.letour.fr/x", basis: "primary" } } });
		expect(deriveProvenance(ev, CFG)).toBeNull();
	});

	it("gjelder kun ai-research-events, og tåler manglende konfig/evidens (fail-soft)", () => {
		expect(deriveProvenance(tdfEvent({ source: "espn" }), CFG)).toBeNull();
		expect(deriveProvenance(tdfEvent({ evidence: [] }), CFG)).toBeNull();
		expect(deriveProvenance(tdfEvent(), {})).toBeNull();
		expect(deriveProvenance(tdfEvent(), { sources: [], authority: AUTHORITY })).toBeNull();
	});

	it("er deterministisk: samme event + samme konfig ⇒ identisk stempel", () => {
		const a = deriveProvenance(tdfEvent(), CFG);
		const b = deriveProvenance(tdfEvent(), CFG);
		expect(a).toEqual(b);
	});
});

// ── Mot de EKTE konfigfilene: kartet, registeret og lib-en i samme kontrakt ──

describe("deriveProvenance mot ekte authority.json + sources.json", () => {
	const configDir = path.resolve(process.cwd(), "scripts", "config");
	const realAuthority = JSON.parse(fs.readFileSync(path.join(configDir, "authority.json"), "utf-8"));
	const realSources = JSON.parse(fs.readFileSync(path.join(configDir, "sources.json"), "utf-8"));
	const realCfg = { sources: realSources.sources, authority: realAuthority };

	it("en TdF-etappe med letour.fr-evidens får A.S.O. som tidsbasis", () => {
		const p = deriveProvenance(tdfEvent(), realCfg);
		expect(p.time).toMatchObject({ sourceId: "letour", basis: "primary" });
	});

	it("franceletour.com migreres aldri, heller ikke mot det ekte registeret", () => {
		const ev = tdfEvent({ evidence: ["https://www.franceletour.com/etape-14"], streaming: [] });
		expect(deriveProvenance(ev, realCfg)).toBeNull();
	});

	it("hjelp.tv2.no-evidens på en TdF-etappe gir TV 2 som offisiell kanalbasis", () => {
		const ev = tdfEvent({ evidence: ["https://hjelp.tv2.no/hovedkategori/sport/tour-de-france"] });
		const p = deriveProvenance(ev, realCfg);
		expect(p.streaming).toMatchObject({ sourceId: "tv2", basis: "official" });
	});
});
