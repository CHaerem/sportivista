#!/usr/bin/env node
/**
 * WP-186: seed REAL club crests — but only the provably free ones.
 * `npm run seed:logos [sport ...]`
 *
 * The pipeline, end to end:
 *
 *   registry entity ──(external.wikidata, or a CONSERVATIVE name resolve)──▶ QID
 *          │
 *          ├─ Wikidata P154 "logo image" ─▶ a Commons file name
 *          │
 *          ├─ Commons `imageinfo` (extmetadata) ─▶ scripts/lib/logo-license.js
 *          │        ▲ the FAIL-CLOSED gate: only CC0 / PD (incl. PD-textlogo) /
 *          │          CC BY / CC BY-SA pass. Unknown, missing, non-free, fair
 *          │          use, NC, ND — rejected, and the row keeps its monogram.
 *          │
 *          └─ the ~96 px PNG rendition ─▶ docs/logos/<entity-id>.png (CHECKED IN)
 *
 * Three properties this file exists to guarantee:
 *
 *  1. **No hotlinking, ever.** The asset is downloaded here and committed to the
 *     repo; the web loads it from our own origin and iOS from its bundle. A
 *     client NEVER talks to Commons or a CDN (null-infra + privacy, and grep-
 *     provable). This script is the ONLY thing in the repo that fetches an image.
 *  2. **Never modify a free mark.** We take Commons' own scaled rendition and
 *     store it as-is. No recolouring, no cropping, no masking, no background
 *     plate baked in — CC BY-SA is share-alike and a derivative would inherit
 *     its terms, and a recoloured crest is a wrong crest regardless of licence.
 *     Scaling is not a derivative in any sense we care about; colour is untouched.
 *  3. **Conservative identity.** A wrong QID ships the WRONG club's crest, which
 *     is worse than no crest. Name resolution therefore demands an EXACT
 *     normalised match against the entity's name or an alias, plus a sport
 *     agreement check, and abstains whenever two candidates both qualify.
 *
 * MANUAL/RARE by design, like the WP-161 seeds: it hits Wikidata + Commons and is
 * run by a human or an agent, never by the hourly pipeline.
 */

import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { configDirPath } from "../lib/helpers.js";
import { serializeRegistry } from "./seed-lib.js";
import { classifyLicense, plainText } from "../lib/logo-license.js";
import { readLogoPolicy, isLogoAllowed } from "../lib/logo-policy.js";

const USER_AGENT = "Sportivista/2.0 (https://github.com/CHaerem/Sportivista; free-logo seeder)";
const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** The rendition width we ship. A 24 pt avatar at @3x is 72 px; 96 px covers it
 *  with headroom and still costs ~2–6 kB per club. */
export const LOGO_WIDTH = 96;

/** Only these entity types can own a crest. Athletes deliberately cannot — a
 *  person's picture is a portrait-rights question, not a logo one (and WP-186's
 *  ikke-mål bars player photos outright). */
const LOGO_TYPES = new Set(["team", "league", "tournament"]);

/** Wikidata sport QIDs, for the "is this candidate even the right sport" gate. */
const SPORT_QIDS = {
	football: ["Q2736"],
	handball: ["Q8418"],
	cycling: ["Q3609", "Q53121"],
	f1: ["Q1968", "Q5389"],
	tennis: ["Q847"],
	chess: ["Q718"],
	esports: ["Q300920", "Q30642387"],
	athletics: ["Q542"],
	biathlon: ["Q177275"],
	"cross-country": ["Q216048"],
	alpine: ["Q184742"],
	nordic: ["Q212434"],
	"ski jumping": ["Q216363"],
	golf: ["Q5377"],
};

// ── pure helpers (unit-tested; no network) ──────────────────────────────────

/** Club-form tokens that carry no identity — same idea as the monogram's list,
 *  extended with the long forms Wikidata labels like to spell out. */
const NAME_NOISE = new Set([
	"fc", "afc", "cf", "ac", "sc", "bk", "fk", "if", "il", "sk", "ik", "hk", "kfum",
	"club", "klubb", "football", "association", "fotballklubb", "ballklub", "ballklubb",
	"esports", "esport", "gaming", "team", "the",
]);

/** Canonical comparison form: diacritics folded, punctuation dropped, club-form
 *  noise removed, tokens sorted out of the way of word order. */
/** Letters NFD cannot decompose — ø/æ/ł/ð/þ are their own code points, and
 *  dropping them silently ("Bodø" → "bod") would break the exact-match rule. */
const LETTER_FOLDS = { ø: "o", æ: "ae", å: "a", ð: "d", þ: "th", ł: "l", đ: "d", ß: "ss", œ: "oe" };

export function normalizeName(name) {
	const tokens = String(name || "")
		.toLowerCase()
		.replace(/[øæåðþłđßœ]/g, (c) => LETTER_FOLDS[c])
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		// Dots and apostrophes CLOSE up rather than split: "F.C." must become the
		// noise token "fc", not two orphan letters that survive the filter.
		.replace(/['’.]/g, "")
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	const real = tokens.filter((t) => !NAME_NOISE.has(t));
	return (real.length ? real : tokens).join(" ");
}

/**
 * Pick the ONE Wikidata candidate that is unambiguously this entity, or null.
 *
 * @param {{name:string, aliases?:string[], sport?:string}} entity
 * @param {Array<{id:string, labels:string[], sports:string[]}>} candidates
 *
 * Rules, all fail-closed:
 *   • a candidate must match the entity's name or an alias EXACTLY once
 *     normalised — no fuzzy scoring, no "closest" fallback;
 *   • if the candidate declares a sport (P641) it must include the entity's
 *     sport — this is what stops "Real Madrid" the multi-sport club, or a
 *     same-named handball club, from taking a football row;
 *   • two survivors ⇒ null. Ambiguity resolves to the monogram, never a coin flip.
 */
export function pickCandidate(entity, candidates) {
	const wanted = new Set([entity.name, ...(entity.aliases || [])].map(normalizeName).filter(Boolean));
	const sports = SPORT_QIDS[entity.sport] || null;
	const matches = (candidates || []).filter((c) => {
		const named = (c.labels || []).some((l) => wanted.has(normalizeName(l)));
		if (!named) return false;
		if (sports && c.sports && c.sports.length && !c.sports.some((s) => sports.includes(s))) return false;
		return true;
	});
	if (matches.length !== 1) return null;
	return matches[0].id;
}

/** The checked-in asset name for an entity — its stable registry id. */
export function logoFileName(entityId) {
	return `${entityId}.png`;
}

/**
 * The mark sources THIS script can produce. Anything else in the registry was
 * placed by a human and cannot be re-derived by a seed run.
 */
const SEEDABLE_SOURCES = new Set(["wikimedia-commons", "espn"]);

/**
 * WP-251 — may a re-seed DROP this existing mark because it found no free
 * candidate for the entity?
 *
 * Only if the seed could put it back. The free pass used to clear `e.logo` for
 * every entity Commons had no P154 for, and the editorial pass then re-filled it
 * from ESPN — which silently destroyed the one source that has no automated
 * path back: `club-official`, the club's own published mark, fetched by hand
 * exactly because neither Commons nor ESPN had one (FK Lyn Oslo — the owner's
 * club). A re-seed deleted the record AND `pruneOrphans` deleted the asset, so
 * the mark was gone for good and nothing said so.
 *
 * This does NOT weaken the policy switch: a `club-official` mark rests on
 * `editorial-use`, so the free-only branch below still drops it, and
 * `isLogoAllowed` still gates it at publish time in build-entities.js. The
 * owner's switch stays the one thing that decides what ships.
 */
export function isSeedReplaceable(logo) {
	return !logo || SEEDABLE_SOURCES.has(logo.source);
}

/**
 * WP-186 (eierbeslutning 22.07) — the EDITORIAL source. ESPN is the provider
 * whose fixtures/teams we already consume, and the registry already carries its
 * `espnId` from the WP-161 seeding, so the mark and the data agree by
 * construction. Only sports whose logo path is VERIFIED are listed: F1's teams
 * endpoint carries no `logos` at all, so F1 keeps its monogram rather than
 * getting a guessed URL. Fetched HERE, at seed time, into a checked-in asset —
 * the client never touches this host.
 */
const ESPN_LOGO_PATHS = { football: "soccer" };

/** The build-time source URL for an ESPN mark (the 500 px master we scale from). */
export function espnLogoUrl(sport, espnId) {
	const seg = ESPN_LOGO_PATHS[sport];
	if (!seg || !espnId) return null;
	return `https://a.espncdn.com/i/teamlogos/${seg}/500/${espnId}.png`;
}

/** ESPN's own image service does the scaling; alpha preserved, colours untouched. */
function espnScaledUrl(masterUrl) {
	const p = masterUrl.replace("https://a.espncdn.com", "");
	// Width only — NEVER a crop or a forced aspect. A cropped crest is a modified
	// crest, which WP-186 bars on both the share-alike and the mark-integrity side.
	return `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(p)}&w=${LOGO_WIDTH}&transparent=true`;
}

/** PNG magic. The gate is fail-closed on FORMAT too: whatever Commons hands
 *  back, we ship it only if it really is a PNG (a JPEG "logo" is a boxed,
 *  matte-white rendition that would look wrong on true black anyway). */
export function isPng(buffer) {
	const magic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
	return !!buffer && buffer.length > 8 && magic.every((b, i) => buffer[i] === b);
}

// ── network layer ───────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wikidata/Commons are free endpoints run on donations; the esports file alone
 * asks ~2 600 questions. So the client is deliberately polite: a small fixed gap
 * between calls, and an exponential back-off that RESPECTS a 429 instead of
 * hammering through it (a seed run that gets us blocked is worse than a slow one).
 */
async function getJson(url, attempt = 0) {
	await sleep(120);
	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
	if (res.status === 429 || res.status >= 500) {
		if (attempt >= 5) throw new Error(`${res.status} etter ${attempt} forsøk — ${url}`);
		const retryAfter = Number(res.headers.get("retry-after"));
		await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt);
		return getJson(url, attempt + 1);
	}
	if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
	return res.json();
}

function chunk(arr, n) {
	const out = [];
	for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
	return out;
}

/** wbsearchentities in two languages — Wikidata labels Norwegian clubs in nb. */
async function searchCandidates(name) {
	const seen = new Map();
	for (const lang of ["en", "nb"]) {
		const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(name)}&language=${lang}&uselang=${lang}&type=item&limit=10&format=json&origin=*`;
		let data;
		try {
			data = await getJson(url);
		} catch {
			continue;
		}
		for (const hit of data.search || []) {
			const entry = seen.get(hit.id) || { id: hit.id, labels: [] };
			if (hit.label) entry.labels.push(hit.label);
			if (hit.match && hit.match.text) entry.labels.push(hit.match.text);
			if (hit.aliases) entry.labels.push(...hit.aliases);
			seen.set(hit.id, entry);
		}
	}
	return [...seen.values()];
}

/** Claims + labels + aliases for up to 50 QIDs in one call. */
async function fetchEntities(ids) {
	const out = new Map();
	for (const batch of chunk(ids, 50)) {
		const url = `${WIKIDATA_API}?action=wbgetentities&ids=${batch.join("|")}&props=claims|labels|aliases&languages=en|nb|no&format=json`;
		const data = await getJson(url);
		for (const [id, ent] of Object.entries(data.entities || {})) {
			if (ent.missing !== undefined) continue;
			const claim = (p) => (ent.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
			out.set(id, {
				id,
				labels: [
					...Object.values(ent.labels || {}).map((l) => l.value),
					...Object.values(ent.aliases || {}).flat().map((a) => a.value),
				],
				sports: claim("P641").map((v) => v.id).filter(Boolean),
				logos: claim("P154").filter((v) => typeof v === "string"),
			});
		}
	}
	return out;
}

/** Commons imageinfo + a ~96 px rendition URL for up to 50 files at a time. */
async function fetchImageInfo(files) {
	const out = new Map();
	for (const batch of chunk(files, 50)) {
		const titles = batch.map((f) => `File:${f}`).join("|");
		const url = `${COMMONS_API}?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=extmetadata|url|mime|size&iiurlwidth=${LOGO_WIDTH}&format=json`;
		const data = await getJson(url);
		const norm = new Map((data.query?.normalized || []).map((n) => [n.to, n.from]));
		for (const page of Object.values(data.query?.pages || {})) {
			const original = norm.get(page.title) || page.title;
			out.set(original.replace(/^File:/, ""), page.imageinfo?.[0] || null);
		}
	}
	return out;
}

async function download(url) {
	const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok) throw new Error(`${res.status} — ${url}`);
	return Buffer.from(await res.arrayBuffer());
}

// ── the run ─────────────────────────────────────────────────────────────────

function registryFiles(dir, only) {
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".json"))
		.filter((f) => !only.length || only.includes(f.replace(/\.json$/, "")));
}

/**
 * The attribution manifest that ships WITH the assets — the source of truth for
 * the "Merker og kilder" surface on web and in the app (WP-186 content point 4).
 * CC BY / CC BY-SA REQUIRE credit; the editorial marks get the sober line
 * instead: they belong to their clubs and are shown to identify them. No claim
 * of affiliation, sponsorship or endorsement is made anywhere — that claim is
 * precisely what trademark law does protect against.
 */
function writeAttribution(outDir, policy, logos) {
	const body = {
		generated: "scripts/seed-registry/logos.js",
		policy,
		notice:
			"Klubbmerker tilhører sine respektive klubber og vises utelukkende for å identifisere dem. Sportivista er ikke tilknyttet, sponset av eller godkjent av klubbene.",
		logos,
	};
	fs.writeFileSync(path.join(outDir, "ATTRIBUTION.json"), `${JSON.stringify(body, null, 2)}\n`);
}

/** Every shipped mark across the WHOLE registry, sorted for a stable diff. */
function collectAttribution(registryDir) {
	const out = [];
	for (const file of fs.readdirSync(registryDir).filter((f) => f.endsWith(".json"))) {
		const parsed = JSON.parse(fs.readFileSync(path.join(registryDir, file), "utf8"));
		for (const e of parsed.entities || []) {
			if (e.logo) out.push({ id: e.id, name: e.name, sport: e.sport, ...e.logo });
		}
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Delete checked-in PNGs no registry record points at any more. */
function pruneOrphans(outDir, keep, log) {
	let n = 0;
	for (const f of fs.readdirSync(outDir)) {
		if (!f.endsWith(".png") || keep.has(f)) continue;
		fs.unlinkSync(path.join(outDir, f));
		n++;
	}
	if (n) log(`   ryddet ${n} foreldreløse asset(s)`);
}

export async function seedLogos({ sports = [], logoDir, dryRun = false, log = console.log } = {}) {
	const dir = path.join(configDirPath(), "registry");
	const outDir = logoDir || path.join(process.cwd(), "docs", "logos");
	const policy = readLogoPolicy(configDirPath());
	log(`logo-policy: ${policy}`);
	const stats = [];
	const attribution = [];
	const rejections = new Map();
	const note = (reason) => rejections.set(reason, (rejections.get(reason) || 0) + 1);

	if (!dryRun) fs.mkdirSync(outDir, { recursive: true });

	for (const file of registryFiles(dir, sports)) {
		const full = path.join(dir, file);
		const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
		const entities = parsed.entities || parsed;
		// NATIONAL teams are deliberately excluded: WP-185 chose the flag as the
		// truer anchor for a country, and a federation crest would quietly demote
		// it on "Norge – Sverige". The ladder's order (logo → flag) therefore never
		// has to arbitrate; the two rungs address disjoint sets.
		const targets = entities.filter((e) => LOGO_TYPES.has(e.type) && e.national !== true);
		const sportKey = file.replace(/\.json$/, "");
		if (!targets.length) {
			stats.push({ file: sportKey, candidates: 0, resolved: 0, withLogo: 0, free: 0, bytes: 0 });
			continue;
		}
		log(`\n── ${sportKey}: ${targets.length} lag/organisasjoner`);

		// 1. QID per entity — the stored one, else a conservative name resolve.
		const qids = new Map();
		const needResolve = [];
		for (const e of targets) {
			if (e.external?.wikidata) qids.set(e.id, e.external.wikidata);
			else needResolve.push(e);
		}
		for (const e of needResolve) {
			const cands = await searchCandidates(e.name);
			if (!cands.length) {
				note("ingen Wikidata-treff");
				continue;
			}
			const detailed = await fetchEntities(cands.map((c) => c.id));
			const enriched = cands.map((c) => {
				const d = detailed.get(c.id);
				return { id: c.id, labels: [...c.labels, ...(d?.labels || [])], sports: d?.sports || [] };
			});
			const picked = pickCandidate(e, enriched);
			if (!picked) {
				note("ingen entydig Wikidata-match");
				continue;
			}
			qids.set(e.id, picked);
			// Persist the resolve: the NEXT run (and any human auditing this) sees
			// exactly which Wikidata item a crest came from, instead of re-deriving
			// it — and a wrong one can be corrected by hand, once, in the registry.
			e.external = { ...(e.external || {}), wikidata: picked };
		}
		log(`   QID: ${qids.size}/${targets.length}`);

		// 2. P154 for every resolved QID.
		const details = await fetchEntities([...new Set(qids.values())]);
		const wanted = new Map(); // entity id → commons file
		for (const e of targets) {
			const qid = qids.get(e.id);
			const logo = qid && details.get(qid)?.logos?.[0];
			if (!logo) {
				if (qid) note("QID uten P154 (logo image)");
				continue;
			}
			wanted.set(e.id, logo);
		}
		log(`   P154: ${wanted.size}`);

		// 3. The licence gate + the asset.
		const info = await fetchImageInfo([...new Set(wanted.values())]);
		let free = 0;
		let bytes = 0;
		for (const e of targets) {
			const commonsFile = wanted.get(e.id);
			if (!commonsFile) {
				if (e.logo && isSeedReplaceable(e.logo)) delete e.logo;
				continue;
			}
			const ii = info.get(commonsFile) || null;
			const verdict = classifyLicense(ii);
			if (!verdict.ok) {
				note(verdict.reason);
				if (e.logo && isSeedReplaceable(e.logo)) delete e.logo;
				continue;
			}
			const thumb = ii.thumburl || ii.url;
			if (!thumb) {
				note("ingen rendition-URL");
				continue;
			}
			let buf;
			try {
				buf = await download(thumb);
			} catch (err) {
				note(`nedlasting feilet (${err.message.slice(0, 40)})`);
				continue;
			}
			if (!isPng(buf)) {
				note("rendition er ikke PNG");
				continue;
			}
			const fileName = logoFileName(e.id);
			if (!dryRun) fs.writeFileSync(path.join(outDir, fileName), buf);
			e.logo = {
				file: fileName,
				source: "wikimedia-commons",
				basis: "free-license",
				license: verdict.license,
				licenseId: verdict.licenseId,
				...(verdict.licenseUrl ? { licenseUrl: verdict.licenseUrl } : {}),
				...(verdict.attribution ? { attribution: verdict.attribution } : {}),
				sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(commonsFile.replace(/ /g, "_"))}`,
				...(verdict.trademarked ? { trademarked: true } : {}),
			};
			free++;
			bytes += buf.length;
		}
		log(`   FRIE: ${free} (${(bytes / 1024).toFixed(1)} kB)`);

		// 4. The EDITORIAL pass — only under the `editorial` policy, and only for
		//    the gaps the free pass left. Free marks always keep precedence: a
		//    provably-free crest is strictly better ground to stand on.
		let editorial = 0;
		let editorialBytes = 0;
		if (policy === "editorial") {
			for (const e of targets) {
				if (e.logo) continue;
				const master = espnLogoUrl(e.sport, e.external?.espnId);
				if (!master) {
					note("ingen editorial-kilde (mangler espnId / sport uten ESPN-logo)");
					continue;
				}
				let buf;
				try {
					buf = await download(espnScaledUrl(master));
				} catch {
					note("ESPN-merke ikke tilgjengelig");
					continue;
				}
				if (!isPng(buf)) {
					note("ESPN-rendition er ikke PNG");
					continue;
				}
				const fileName = logoFileName(e.id);
				if (!dryRun) fs.writeFileSync(path.join(outDir, fileName), buf);
				e.logo = { file: fileName, source: "espn", basis: "editorial-use", sourceUrl: master };
				editorial++;
				editorialBytes += buf.length;
			}
			log(`   EDITORIAL: ${editorial} (${(editorialBytes / 1024).toFixed(1)} kB)`);
		} else {
			// free-only: a previously shipped editorial mark is dropped, mechanically.
			for (const e of targets) {
				if (e.logo && !isLogoAllowed(e.logo, policy)) delete e.logo;
			}
		}

		for (const e of targets) if (e.logo) attribution.push({ id: e.id, name: e.name, sport: e.sport, ...e.logo });
		stats.push({
			file: sportKey,
			candidates: targets.length,
			resolved: qids.size,
			withLogo: wanted.size,
			free,
			editorial,
			bytes: bytes + editorialBytes,
		});

		if (!dryRun) fs.writeFileSync(full, serializeRegistry(parsed, entities));
	}

	if (!dryRun) {
		// The manifest is rebuilt from EVERY registry file, not just the ones this
		// run touched — re-seeding one sport must not silently un-credit the rest,
		// and an uncredited CC BY-SA mark is a licence breach, not a cosmetic bug.
		const all = collectAttribution(dir);
		writeAttribution(outDir, policy, all);
		// Assets whose registry record is gone (a rejected licence, a policy flip
		// back to free-only) must not linger in the repo or the app bundle.
		pruneOrphans(outDir, new Set(all.map((a) => a.file)), log);
	}

	log("\n═══ DEKNING (målt) ═══");
	for (const s of stats) {
		const shipped = s.free + s.editorial;
		const pct = s.candidates ? ((100 * shipped) / s.candidates).toFixed(0) : "0";
		log(
			`  ${s.file.padEnd(12)} ${String(shipped).padStart(4)}/${String(s.candidates).padEnd(5)} (${pct}%)  · fri ${s.free} · editorial ${s.editorial} · QID ${s.resolved} · P154 ${s.withLogo} · ${(s.bytes / 1024).toFixed(1)} kB`
		);
	}
	const tot = stats.reduce(
		(a, s) => ({ free: a.free + s.free, ed: a.ed + s.editorial, cand: a.cand + s.candidates, bytes: a.bytes + s.bytes }),
		{ free: 0, ed: 0, cand: 0, bytes: 0 }
	);
	log(
		`  ${"TOTALT".padEnd(12)} ${tot.free + tot.ed}/${tot.cand} (${((100 * (tot.free + tot.ed)) / (tot.cand || 1)).toFixed(1)}%) · fri ${tot.free} · editorial ${tot.ed} · ${(tot.bytes / 1024).toFixed(1)} kB`
	);
	log("\n═══ AVVIST (hvorfor) ═══");
	for (const [reason, n] of [...rejections].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(5)}  ${reason}`);

	return { stats, attribution, rejections: Object.fromEntries(rejections) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
	seedLogos({ sports: process.argv.slice(2).filter((a) => !a.startsWith("--")), dryRun: process.argv.includes("--dry-run") }).catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

export { plainText };
