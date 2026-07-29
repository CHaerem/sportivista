// WP-240: sources.json is the KILDEREGISTER — hvem skaper faktumet, hva sier
// vilkårene om automatisert tilgang, og har rettighetshaveren tatt DSM art. 4-
// forbehold. Denne koherenstesten er dens CI-kontrakt (à la catalog-schema.test.js
// og registry-schema.test.js): registeret valideres mot sources.schema.json med den
// samme lille avhengighetsfrie validatoren som gir github.dev autofullføring, pluss
// de invariantene skjemaspråket ikke kan uttrykke — unike kebab-id-er, sortering,
// «en primærkilde MÅ være autoritativ for noe», og ærlighetsregelen om at en påstand
// om vilkår alltid har en kilde-URL.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { validateAgainstSchema } from "../scripts/lib/validate-schema.js";

const configDir = path.resolve(process.cwd(), "scripts", "config");
const register = JSON.parse(fs.readFileSync(path.join(configDir, "sources.json"), "utf-8"));
const schema = JSON.parse(fs.readFileSync(path.join(configDir, "sources.schema.json"), "utf-8"));

const validate = (data) => validateAgainstSchema(data, schema, schema);
const sources = register.sources;

// Vertene hver kilde dekker: `url` + alle `endpoints`, uten "www.".
const hostOf = (u) => {
	try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};
const registeredHosts = new Set(
	sources.flatMap((s) => [s.url, ...(s.endpoints || [])].map(hostOf).filter(Boolean))
);
// Et domene er dekket av et eksakt treff eller av samme registrerbare domene i
// begge retninger: en registrert forelder dekker et underdomene (tv2.no dekker
// hjelp.tv2.no), og et registrert underdomene dekker det bare domenet
// (en.wikipedia.org dekker "wikipedia.org", som er slik kalibreringsledgeren
// skriver den samme kilden).
const isCovered = (domain) => {
	const d = domain.replace(/^www\./, "").toLowerCase();
	return [...registeredHosts].some((h) => d === h || d.endsWith(`.${h}`) || h.endsWith(`.${d}`));
};

// FRYST seed-liste, mekanisk utledet 29.07.2026: hvert domene med ≥2 forekomster i
// docs/data/events.json (evidence + verificationSources) eller i
// docs/data/calibration-ledger.jsonl — 110 distinkte domener totalt, 62 med ≥2 bruk.
// Listen er fryst med vilje i stedet for å regnes på nytt: docs/data/ skrives om hver
// time av den statiske pipelinen, og en test som drev med dataene ville blitt rød av
// datadrift alene (og satt selv-reparasjonssløyfene i gang på et ikke-problem).
const SEEDED_DOMAINS_2026_07_29 = [
	"cyclingstage.com", "en.wikipedia.org", "fotball.no", "nrk.no", "hltv.org",
	"kommunikasjon.ntb.no", "eliteserien.no", "letourfemmes.fr", "formula1.com",
	"hjelp.tv2.no", "cyclingnews.com", "liquipedia.net", "info.tv2.no",
	"cyclinguptodate.com", "nettavisen.no", "vg.no", "uefa.com", "hbomax.com",
	"atptour.com", "tvkampen.com", "fcbarcelona.com", "nbcsports.com", "manutd.com",
	"obos-ligaen.no", "nmfriidrett2026.no", "obosligaenkamper.com", "tv2.no",
	"grandchesstour.org", "chess.com", "pgatour.com", "ntb.no", "idlprocycling.com",
	"diamondleague.com", "espn.com", "oddspodden.com", "en.brujulabike.com",
	"beinsports.com", "racingnews365.com", "postnorddanmarkrundt.dk",
	"domestiquecycling.com", "foxsports.com", "worldofspeed.org", "wikipedia.org",
	"swissopengstaad.ch", "britishathletics.org.uk", "metlifestadium.com",
	"flobikes.com", "procyclingstats.com", "france24.com", "blast.tv", "sofascore.com",
	"digisport.ro", "nordlys.no", "unoxteam.com", "cyclismactu.net", "til.no",
	"en.chessbase.com", "bcfc.com", "esportsworldcup.com", "europeantour.com",
	"media.wbdsports.com", "golferen.no",
];

// Vertene den STATISKE PIPELINEN faktisk henter — utledet fra scripts/fetch/*.js,
// scripts/config/sports-config.js, scripts/fetch-rss.js, scripts/fetch-standings.js,
// scripts/fetch-results.js, scripts/lib/tvkampen-scraper.js og
// scripts/lib/pgatour-scraper.js. Disse har ingen unnskyldning for å mangle:
// vi henter dem selv, hver time.
const FETCHED_HOSTS = [
	"site.api.espn.com", "sports.core.api.espn.com", "a.espncdn.com", "espn.com",
	"lichess.org", "liquipedia.net", "fotball.no", "tvkampen.com", "pgatour.com",
	"nrk.no", "tv2.no", "aftenposten.no", "feeds.bbci.co.uk", "theguardian.com",
	"autosport.com", "en.chessbase.com", "hltv.org", "cyclingnews.com",
	"viaplay.no", "hbomax.com", "discoveryplus.no", "eurosport.no",
	"twitch.tv", "kick.com", "chess24.com", "play.tv2.no",
];

describe("sources.json mot sources.schema.json", () => {
	it("registeret validerer med null feil", () => {
		expect(validate(register)).toEqual([]);
	});

	it("validatoren fanger faktisk brudd (så kontrakten har tenner)", () => {
		const bad = (mutate) => {
			const clone = JSON.parse(JSON.stringify(register));
			mutate(clone);
			return validate(clone).length;
		};
		expect(bad((r) => (r.sources[0].role = "vibes"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].status = "maybe"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].id = "Not Kebab"))).toBeGreaterThan(0);
		expect(bad((r) => delete r.sources[0].terms)).toBeGreaterThan(0);
		expect(bad((r) => delete r.sources[0].tdmReservation)).toBeGreaterThan(0);
		expect(bad((r) => delete r.sources[0].robots)).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].terms.automatedAccess = "probably fine"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].tdmReservation.status = "dunno"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].robots.allowsOurPaths = "yes"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].facts = ["vibes"]))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].terms.reviewedAt = "i går"))).toBeGreaterThan(0);
		expect(bad((r) => (r.sources[0].surprise = true))).toBeGreaterThan(0);
		expect(bad((r) => delete r.sources)).toBeGreaterThan(0);
	});
});

describe("sources.json — identitet og determinisme", () => {
	it("id-ene er unike", () => {
		const ids = sources.map((s) => s.id);
		expect(ids.length).toBe(new Set(ids).size);
	});

	it("kildene er sortert på id (en re-seed gir ren diff)", () => {
		const ids = sources.map((s) => s.id);
		expect(ids).toEqual([...ids].sort());
	});

	it("hver rolle og status er en gyldig enum-verdi", () => {
		const roles = schema.definitions.source.properties.role.enum;
		const statuses = schema.definitions.source.properties.status.enum;
		for (const s of sources) {
			expect(roles, s.id).toContain(s.role);
			expect(statuses, s.id).toContain(s.status);
		}
	});

	it("alle url-er og endepunkter er absolutte https-URL-er", () => {
		for (const s of sources) {
			for (const u of [s.url, ...(s.endpoints || [])]) {
				expect(u.startsWith("https://"), `${s.id}: ${u}`).toBe(true);
				expect(hostOf(u), `${s.id}: ${u}`).toBeTruthy();
			}
		}
	});
});

describe("sources.json — rolledoktrinen", () => {
	it("en primærkilde er autoritativ for minst én ting (ellers er den ikke primær)", () => {
		for (const s of sources.filter((x) => x.role === "primary")) {
			expect(s.authorityFor.length, `${s.id} er primary uten authorityFor`).toBeGreaterThan(0);
		}
	});

	it("et forbund er også autoritativt for noe (samme begrunnelse)", () => {
		for (const s of sources.filter((x) => x.role === "federation")) {
			expect(s.authorityFor.length, `${s.id} er federation uten authorityFor`).toBeGreaterThan(0);
		}
	});

	it("en aggregator eller encyklopedi hevder ALDRI autoritet — det er hele poenget", () => {
		for (const s of sources.filter((x) => ["aggregator", "encyclopedic", "media"].includes(x.role))) {
			expect(s.authorityFor, `${s.id} (${s.role}) hevder autoritet`).toEqual([]);
		}
	});

	it("registeret har faktisk primærkilder å velge blant for de tunge sportene", () => {
		const authority = new Set(sources.filter((s) => ["primary", "federation"].includes(s.role)).flatMap((s) => s.authorityFor));
		const covered = (prefix) => [...authority].some((a) => a === prefix || a.startsWith(`${prefix}:`));
		for (const sport of ["cycling", "football", "f1", "golf", "tennis", "chess", "esports", "athletics", "biathlon"]) {
			expect(covered(sport), `ingen primær-/forbundskilde for ${sport}`).toBe(true);
		}
	});
});

describe("sources.json — ærlighetskontrakten", () => {
	it("en påstand om vilkår har alltid en kilde-URL (ingen udokumenterte konklusjoner)", () => {
		for (const s of sources) {
			if (s.terms.automatedAccess === "unknown") continue;
			expect(s.terms.url, `${s.id}: "${s.terms.automatedAccess}" uten terms.url`).toBeTruthy();
			expect(s.terms.url.startsWith("https://"), `${s.id}: terms.url må være https`).toBe(true);
			expect(s.terms.basis, `${s.id}: mangler terms.basis`).toBeTruthy();
		}
	});

	it("et 'unknown' hviler aldri på en påstått vilkårs-URL uten grunnlagstype", () => {
		for (const s of sources) {
			if (s.terms.automatedAccess !== "unknown") continue;
			expect(s.terms.basis, `${s.id}: unknown uten basis`).toBeTruthy();
		}
	});

	it("minst 10 kilder har VERIFISERT vilkår for automatisert tilgang, med kilde-URL", () => {
		const verified = sources.filter((s) => s.terms.automatedAccess !== "unknown" && s.terms.url);
		expect(verified.length).toBeGreaterThanOrEqual(10);
	});

	it("et registrert DSM art. 4-forbehold sier alltid HVORDAN det er uttrykt", () => {
		for (const s of sources.filter((x) => x.tdmReservation.status === "reserved")) {
			expect(s.tdmReservation.mechanism, `${s.id}: reserved uten mechanism`).toBeTruthy();
			expect(s.tdmReservation.evidence?.length, `${s.id}: reserved uten evidence`).toBeGreaterThan(0);
		}
	});

	it("hver kilde er faktisk gjennomgått — datoene er satt", () => {
		for (const s of sources) {
			expect(s.terms.reviewedAt, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(s.tdmReservation.checkedAt, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
			expect(s.robots.checkedAt, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
		expect(register.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});
});

describe("sources.json — dekning av det vi faktisk bruker", () => {
	it("hver vert den statiske pipelinen henter står i registeret", () => {
		const missing = FETCHED_HOSTS.filter((h) => !isCovered(h));
		expect(missing, `fetchede verter uten oppføring: ${missing.join(", ")}`).toEqual([]);
	});

	it("hvert domene med ≥2 bruk i evidens/kalibrering står i registeret", () => {
		const missing = SEEDED_DOMAINS_2026_07_29.filter((d) => !isCovered(d));
		expect(missing, `siterte domener uten oppføring: ${missing.join(", ")}`).toEqual([]);
	});

	it("registeret dokumenterer både det vi bruker og primærkildene vi bør bruke", () => {
		const inUse = sources.filter((s) => s.status === "in-use");
		const candidates = sources.filter((s) => s.status === "candidate");
		expect(inUse.length).toBeGreaterThanOrEqual(50);
		expect(candidates.length).toBeGreaterThanOrEqual(10);
		// Kandidatene finnes for å FLYTTE oss oppover i kjeden — de er primær/forbund.
		for (const s of candidates) {
			expect(["primary", "federation", "official-broadcaster"], `${s.id}`).toContain(s.role);
		}
	});

	it("calibrationKey peker på et domene kilden faktisk dekker (broen til WP-245)", () => {
		for (const s of sources.filter((x) => x.calibrationKey)) {
			expect(isCovered(s.calibrationKey), `${s.id}: calibrationKey "${s.calibrationKey}" hører ikke til kilden`).toBe(true);
		}
	});
});
