/**
 * WP-185: country normalisation for the world registry (scripts/config/registry/*.json).
 *
 * The WP-161 seeds each spoke their source's own dialect into `country`:
 *   - FIDE  → 3-letter federation codes ("NOR", "GER", "ENG", "FID")
 *   - ESPN  → English display names ("Norway", "United States", "Czechia")
 *   - Wikidata (nb-preferred labels) → Norwegian names ("Norge", "Tyskland",
 *     "Kongeriket Nederlandene") with an English fallback when nb is missing
 *
 * Three dialects for one fact makes the field useless to a client: a flag can
 * only be derived from a STABLE code. This module is the one place that folds
 * them into **ISO 3166-1 alpha-2** (uppercase), plus the four UK home nations as
 * ISO 3166-2 subdivision codes (`GB-ENG`/`GB-SCT`/`GB-WLS`/`GB-NIR`) — sport is
 * one of the few domains where England and Scotland really are distinct
 * "countries" with their own flags, and dropping them to `GB` would put a Union
 * Jack on an England row.
 *
 * Deliberately a CURATED TABLE, not a heuristic: a fuzzy country matcher that
 * guesses wrong stamps the wrong flag on a person, which is worse than no flag
 * at all. Anything not in the table returns null and degrades gracefully (the
 * row keeps its sport glyph). That includes historical states — "Sovjetunionen",
 * "Jugoslavia", "Tsjekkoslovakia", "Øst-Tyskland", "Serbia og Montenegro" — and
 * FIDE's own stateless federation code "FID": they have no ISO code today, and
 * inventing a successor state for a person's registered federation is a
 * political claim we have no business making.
 */

/** ISO 3166-2 subdivision codes we treat as first-class "countries" (sport reality). */
export const HOME_NATIONS = ["GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR"];

/**
 * Raw source value (normalised: lowercased, diacritics stripped) → ISO code.
 * Covers every distinct `country` value present in the seeded registry plus the
 * common near-misses of each source dialect.
 */
const TABLE = {
	// --- UK home nations (sport-distinct) ---
	eng: "GB-ENG", england: "GB-ENG",
	sco: "GB-SCT", sct: "GB-SCT", scotland: "GB-SCT", skottland: "GB-SCT",
	wal: "GB-WLS", wls: "GB-WLS", wales: "GB-WLS",
	nir: "GB-NIR", "northern ireland": "GB-NIR", "nord-irland": "GB-NIR",
	gbr: "GB", "great britain": "GB", britain: "GB", "united kingdom": "GB",
	storbritannia: "GB", "sto": "GB",

	// --- Europe ---
	alb: "AL", albania: "AL",
	and: "AD", andorra: "AD",
	arm: "AM", armenia: "AM", armenja: "AM",
	aut: "AT", austria: "AT", osterrike: "AT",
	aze: "AZ", azerbaijan: "AZ", aserbajdsjan: "AZ",
	blr: "BY", belarus: "BY", hviterussland: "BY",
	bel: "BE", belgium: "BE", belgia: "BE",
	bih: "BA", "bosnia and herzegovina": "BA", "bosnia-herzegovina": "BA", "bosnia-hercegovina": "BA",
	bul: "BG", bulgaria: "BG",
	cro: "HR", croatia: "HR", kroatia: "HR",
	cyp: "CY", cyprus: "CY", kypros: "CY",
	cze: "CZ", czechia: "CZ", "czech republic": "CZ", tsjekkia: "CZ",
	den: "DK", denmark: "DK", danmark: "DK", "kongeriket danmark": "DK",
	est: "EE", estonia: "EE", estland: "EE",
	fin: "FI", finland: "FI",
	fra: "FR", france: "FR", frankrike: "FR",
	geo: "GE", georgia: "GE",
	ger: "DE", germany: "DE", tyskland: "DE", deutschland: "DE",
	gre: "GR", greece: "GR", hellas: "GR",
	grl: "GL", greenland: "GL", gronland: "GL",
	hun: "HU", hungary: "HU", ungarn: "HU",
	isl: "IS", iceland: "IS", island: "IS",
	// WP-251: ESPN's uefa.nations list spells Ireland "Republic of Ireland" (to
	// disambiguate it from Northern Ireland, which is GB-NIR above) and adds two
	// UEFA members with their own flags and their own football sides.
	irl: "IE", ireland: "IE", irland: "IE", "republic of ireland": "IE", "rep ireland": "IE",
	fro: "FO", fao: "FO", "faroe islands": "FO", faroyene: "FO",
	gib: "GI", gibraltar: "GI",
	isr: "IL", israel: "IL",
	ita: "IT", italy: "IT", italia: "IT",
	kos: "XK", kosovo: "XK",
	lat: "LV", latvia: "LV", latvia_: "LV",
	lie: "LI", liechtenstein: "LI",
	ltu: "LT", lithuania: "LT", litauen: "LT",
	lux: "LU", luxembourg: "LU", luxemburg: "LU",
	mlt: "MT", malta: "MT",
	mda: "MD", moldova: "MD",
	mon: "MC", monaco: "MC",
	mne: "ME", montenegro: "ME",
	ned: "NL", netherlands: "NL", nederland: "NL", "kongeriket nederlandene": "NL", holland: "NL",
	mkd: "MK", "north macedonia": "MK", "nord-makedonia": "MK", makedonia: "MK",
	nor: "NO", norway: "NO", norge: "NO",
	pol: "PL", poland: "PL", polen: "PL",
	por: "PT", portugal: "PT",
	rom: "RO", rou: "RO", romania: "RO", romania_: "RO", "romania (land)": "RO",
	rus: "RU", russia: "RU", russland: "RU",
	smr: "SM", "san marino": "SM",
	ser: "RS", srb: "RS", serbia: "RS",
	svk: "SK", slovakia: "SK",
	slo: "SI", svn: "SI", slovenia: "SI",
	esp: "ES", spain: "ES", spania: "ES",
	swe: "SE", sweden: "SE", sverige: "SE",
	sui: "CH", switzerland: "CH", sveits: "CH",
	tur: "TR", turkey: "TR", turkiye: "TR", tyrkia: "TR",
	ukr: "UA", ukraine: "UA", ukraina: "UA",

	// --- Americas ---
	arg: "AR", argentina: "AR",
	bah: "BS", bahamas: "BS",
	bra: "BR", brazil: "BR", brasil: "BR",
	can: "CA", canada: "CA",
	chi: "CL", chile: "CL",
	col: "CO", colombia: "CO",
	crc: "CR", "costa rica": "CR",
	cub: "CU", cuba: "CU", kuba: "CU",
	cuw: "CW", curacao: "CW",
	dma: "DM", dominica: "DM",
	dom: "DO", "dominican republic": "DO", "den dominikanske republikk": "DO",
	ecu: "EC", ecuador: "EC",
	esa: "SV", "el salvador": "SV",
	grn: "GD", grenada: "GD",
	gua: "GT", guatemala: "GT",
	hai: "HT", haiti: "HT",
	jam: "JM", jamaica: "JM",
	mex: "MX", mexico: "MX",
	pan: "PA", panama: "PA",
	par: "PY", paraguay: "PY",
	per: "PE", peru: "PE",
	lca: "LC", "saint lucia": "LC",
	tto: "TT", "trinidad and tobago": "TT", "trinidad og tobago": "TT",
	uru: "UY", uruguay: "UY",
	usa: "US", "united states": "US", "united states of america": "US", "usas": "US",
	ven: "VE", venezuela: "VE",

	// --- Africa ---
	alg: "DZ", algeria: "DZ", algerie: "DZ",
	ang: "AO", angola: "AO",
	bot: "BW", botswana: "BW",
	bur: "BF", "burkina faso": "BF",
	bdi: "BI", burundi: "BI",
	cmr: "CM", cameroon: "CM", kamerun: "CM",
	cpv: "CV", "cape verde": "CV", "kapp verde": "CV",
	cod: "CD", "congo dr": "CD", "dr congo": "CD", "den demokratiske republikken kongo": "CD",
	cgo: "CG", congo: "CG", kongo: "CG", "republikken kongo": "CG",
	civ: "CI", "ivory coast": "CI", elfenbenskysten: "CI", "cote d'ivoire": "CI",
	egy: "EG", egypt: "EG",
	gnq: "GQ", "equatorial guinea": "GQ", "ekvatorial-guinea": "GQ",
	eri: "ER", eritrea: "ER",
	eth: "ET", ethiopia: "ET", etiopia: "ET",
	gha: "GH", ghana: "GH",
	gui: "GN", guinea: "GN",
	ken: "KE", kenya: "KE",
	mar: "MA", morocco: "MA", marokko: "MA",
	mri: "MU", mauritius: "MU",
	nam: "NA", namibia: "NA",
	ngr: "NG", nga: "NG", nigeria: "NG",
	sen: "SN", senegal: "SN",
	rsa: "ZA", "south africa": "ZA", "sor-afrika": "ZA",
	tog: "TG", togo: "TG",
	tun: "TN", tunisia: "TN",
	uga: "UG", uganda: "UG",

	// --- Asia & Oceania ---
	bhr: "BH", bahrain: "BH",
	chn: "CN", china: "CN", kina: "CN",
	ind: "IN", india: "IN",
	ina: "ID", indonesia: "ID",
	iri: "IR", iran: "IR",
	irq: "IQ", iraq: "IQ", irak: "IQ",
	jpn: "JP", japan: "JP",
	jor: "JO", jordan: "JO",
	kaz: "KZ", kazakhstan: "KZ", kasakhstan: "KZ",
	kuw: "KW", kuwait: "KW",
	prk: "KP", "north korea": "KP", "nord-korea": "KP",
	kor: "KR", "south korea": "KR", "sor-korea": "KR",
	pak: "PK", pakistan: "PK",
	phi: "PH", philippines: "PH", filippinene: "PH",
	qat: "QA", qatar: "QA",
	ksa: "SA", "saudi arabia": "SA", "saudi-arabia": "SA",
	sgp: "SG", singapore: "SG",
	tha: "TH", thailand: "TH",
	uae: "AE", "united arab emirates": "AE", "de forente arabiske emirater": "AE",
	uzb: "UZ", uzbekistan: "UZ", usbekistan: "UZ",
	vie: "VN", vietnam: "VN",
	aus: "AU", australia: "AU",
	nzl: "NZ", "new zealand": "NZ", "new zealand ": "NZ",
};

/** Lowercase + strip diacritics/punctuation so "Türkiye" and "Sør-Afrika" hit the table. */
function normalizeKey(raw) {
	return String(raw || "")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/ø/gi, "o")
		.replace(/æ/gi, "a")
		.replace(/å/gi, "a")
		.toLowerCase()
		.replace(/[.]/g, "")
		.trim();
}

/**
 * A raw source country value → ISO 3166-1 alpha-2 (or a `GB-XXX` home nation),
 * or **null** when the table has no confident answer (historical states, FIDE's
 * stateless "FID", anything unrecognised). Already-ISO input passes through.
 */
export function toIsoCountry(raw) {
	const key = normalizeKey(raw);
	if (!key) return null;
	if (TABLE[key]) return TABLE[key];
	const upper = String(raw || "").trim().toUpperCase();
	if (/^[A-Z]{2}$/.test(upper)) return upper;              // already ISO alpha-2
	if (HOME_NATIONS.includes(upper)) return upper;          // already a home nation
	return null;
}

/** True when `code` is a value this project accepts in a registry `country` field. */
export function isIsoCountry(code) {
	return typeof code === "string" && (/^[A-Z]{2}$/.test(code) || HOME_NATIONS.includes(code));
}
