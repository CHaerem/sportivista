// entity-avatar.js — WP-185: the per-ENTITY visual anchor on an agenda row (web
// twin of ios/Sportivista/Models/EntityIdentity.swift + EntityAvatarView).
//
// The owner's finding (21.07): "appen er litt for anonym og kjedelig … vi mangler
// blant annet logoer/flagg". The row was pure text; the WP-108/WP-154 glyph names
// the SPORT, never the entity. So each row now carries ONE quiet anchor for the
// entity it is about — and it is built from metadata we own, with NO image
// requests anywhere (null-infra + privacy + no trademark exposure):
//
//   0. LOGO   — (WP-186) the club's REAL mark, when the pipeline has one with
//               complete provenance. The asset is CHECKED IN under docs/logos/
//               and served from our own origin: this file never points at
//               Commons, ESPN or any CDN, so the no-external-request property
//               below still holds byte for byte. Shown UNMODIFIED — no recolour,
//               no crop, no mask, no tint (share-alike + mark integrity).
//   1. FLAG   — athletes and national teams, derived from the registry's ISO
//               country code. An emoji: zero assets, zero rights, and it scales
//               with the user's text size for free.
//   2. MONOGRAM — clubs/orgs: a small rounded avatar split diagonally between the
//               club's two registered colours with 1–2 initials on top, drawn
//               LOCALLY in CSS (the Kontakter/Kalender idiom). NEVER a crest —
//               club crests are trademarks (PLAN.md WP-185 ikke-mål).
//   3. SPORT GLYPH — the honest fallback whenever neither is known. No empty hole,
//               no invented colour: the row simply looks like it did before.
//
// Calm rules (DESIGN.md § Entitets-avatar):
//   • at most ONE coloured avatar surface per row;
//   • the avatar is the ENTITY's colours, never a new accent — amber stays the
//     product's single accent token and is never used here;
//   • the monogram's ink is COMPUTED from the fill's luminance (WCAG relative
//     luminance), never hardcoded white — half our clubs are light-kitted.

/** ISO alpha-2 → the 🇳🇴-style regional-indicator pair. */
function ssRegionalIndicators(iso) {
	return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

// The UK home nations have no alpha-2 code but DO have RGI emoji flags built from
// tag sequences (🏴 + the subdivision letters + a cancel tag). Sport treats them as
// countries, so an England row must not fly a Union Jack. Northern Ireland has no
// RGI sequence — it deliberately falls back to no flag rather than a wrong one.
const SS_TAG_FLAGS = {
	'GB-ENG': 'gbeng',
	'GB-SCT': 'gbsct',
	'GB-WLS': 'gbwls',
};

/** ISO 3166 code (alpha-2, or GB-ENG/SCT/WLS) → flag emoji, or '' when unknown. */
function ssFlagEmoji(iso) {
	const code = String(iso || '').trim().toUpperCase();
	if (SS_TAG_FLAGS[code]) {
		const tags = [...SS_TAG_FLAGS[code]].map((c) => 0xe0000 + c.charCodeAt(0));
		return String.fromCodePoint(0x1f3f4, ...tags, 0xe007f);
	}
	if (/^[A-Z]{2}$/.test(code)) return ssRegionalIndicators(code);
	return '';
}

// Club-form tokens that carry no identity ("AFC Bournemouth" is "Bournemouth").
// Dropped only when at least one real word survives.
const SS_CLUB_NOISE = new Set(['fc', 'afc', 'cf', 'ac', 'sc', 'bk', 'fk', 'if', 'il', 'sk', 'ik', 'hk', 'kfum', 'club', 'klubb']);

// Generic club-type qualifiers (+ Romance stop-words) that do NOT identify a club
// on their own: dozens of distinct teams are "Atlético X" or "Sporting Y". They
// matter for the misidentification guard below, not for the monogram — a wrong
// crest inherited purely because a small club's name happens to contain the word
// "Atlético" is worse than the honest sport-glyph fallback (visual-qa 21.09).
const SS_GENERIC_CLUB_WORDS = new Set([
	'atletico', 'sporting', 'real', 'deportivo', 'union', 'racing', 'athletic',
	'de', 'del', 'la', 'el', 'los', 'las', 'di', 'do', 'da', 'of', 'the',
]);

/** NFD-fold to lowercase, accent-stripped — self-contained so this file stays
 *  usable stand-alone (it does not import shared-constants.js's ssNormalize). */
function ssAvatarNormalize(s) {
	return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** The DISTINCTIVE tokens of a name — dropping pure numbers, club-form noise
 *  (fc/afc/…) and generic qualifiers (atlético/sporting/…). "Atlético Madrid"
 *  → ["madrid"]; "Mainz 05" → ["mainz"]; "Sporting CP" → []. */
function ssDistinctiveTokens(name) {
	return ssAvatarNormalize(name)
		.replace(/[()[\]{}"'’.]/g, ' ')
		.split(/[\s\-–—/]+/)
		.map((w) => w.trim())
		.filter(Boolean)
		.filter((w) => !/^\d+$/.test(w))
		.filter((w) => !SS_CLUB_NOISE.has(w))
		.filter((w) => !SS_GENERIC_CLUB_WORDS.has(w));
}

/**
 * Does `entity` genuinely name `teamName`, or did it only word-overlap on a
 * generic qualifier? The server matcher stamps the most-specific registry entity
 * that overlaps a board string — but when a tiny club ("Atlético Calatayud") is
 * absent from the registry, its bare qualifier "Atlético" overlaps the only
 * candidate (Atlético Madrid) and hands the row that famous crest. A crest is
 * trusted wordlessly, so a wrong one misidentifies who is playing.
 *
 * The rule mirrors this file's fail-closed philosophy — trust nothing you can't
 * corroborate. An EXACT (accent/case-folded) match on the entity's name or any
 * alias always wins, so the real "Sporting CP" keeps its crest. A PARTIAL match
 * is trusted only when the two names share at least one DISTINCTIVE token —
 * "Bayern München"↔"Bayern", "Mainz 05"↔"Mainz", "Inter"↔"Internazionale" all
 * agree on a distinctive word and stay; "Atlético Calatayud"↔"Atlético Madrid"
 * agree on nothing but the generic qualifier and are rejected, so the row falls
 * back to the honest sport glyph.
 */
function ssEntityMatchesName(entity, teamName) {
	if (!entity) return false;
	const n = ssAvatarNormalize(teamName).trim();
	if (!n) return false;
	const terms = [entity.name, ...(entity.aliases || [])];
	for (const t of terms) {
		if (ssAvatarNormalize(t).trim() === n) return true; // exact term match
	}
	const want = new Set(ssDistinctiveTokens(teamName));
	if (!want.size) return false; // nothing distinctive to agree on — don't guess a crest
	for (const t of terms) {
		for (const tok of ssDistinctiveTokens(t)) {
			if (want.has(tok)) return true; // shared distinctive token
		}
	}
	return false;
}

/** 1–2 uppercase initials for a monogram — the Kontakter rule (first + last word). */
function ssMonogramInitials(name) {
	const words = String(name || '')
		.replace(/[()[\]{}"'’.]/g, ' ')
		.split(/[\s\-–—/]+/)
		.filter(Boolean);
	const real = words.filter((w) => !SS_CLUB_NOISE.has(w.toLowerCase()));
	const use = real.length ? real : words;
	if (!use.length) return '';
	if (use.length === 1) return use[0].slice(0, 1).toUpperCase();
	return (use[0].slice(0, 1) + use[use.length - 1].slice(0, 1)).toUpperCase();
}

/** sRGB relative luminance (WCAG 2.x) of a `#rrggbb` colour, 0…1. */
function ssLuminance(hex) {
	const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
	if (!m) return 0;
	const n = parseInt(m[1], 16);
	const lin = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** WCAG contrast ratio between two luminances. */
function ssContrast(l1, l2) {
	const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
	return (hi + 0.05) / (lo + 0.05);
}

/**
 * The readable ink for text drawn on `colors` — black or white, whichever wins
 * on contrast. Computed against the MEAN luminance of the two fills, because the
 * initials straddle the diagonal split. Never hardcoded: a white-kitted club
 * (Rosenborg, Real Madrid) needs black ink, a dark one needs white.
 */
function ssInkOn(colors) {
	const a = ssLuminance(colors && colors.primary);
	const b = colors && colors.secondary ? ssLuminance(colors.secondary) : a;
	const l = (a + b) / 2;
	return ssContrast(l, 0) >= ssContrast(l, 1) ? '#000000' : '#ffffff';
}

/**
 * An entities.json entry → the row's identity, or null when we know nothing.
 *   { kind: 'flag', flag }
 *   { kind: 'monogram', initials, primary, secondary, ink }
 * The FLAG wins over the monogram: a national team carries both a country and
 * (from ESPN) kit colours, and a country's flag is the truer anchor. A CLUB with
 * a `country` but no `national` flag (Wikidata stamps P17 on Norwegian handball
 * clubs) must NOT fly that flag — hence the explicit `national` gate.
 */
/**
 * WP-186 — the checked-in asset path for an entity's real mark, or '' when it has
 * none we may show.
 *
 * The client mirrors the SERVER's fail-closed rule instead of trusting what it
 * was handed: `build-entities.js` already applied the logo policy, but a stale
 * cache or a tampered response must not be able to put an arbitrary URL in an
 * `src`. So the file name must be a bare, lowercase asset name — no scheme, no
 * host, no path, no traversal — and the record must carry its provenance
 * (`source` + `basis`) or it is ignored.
 */
function ssEntityLogoSrc(entity) {
	const logo = entity && entity.logo;
	if (!logo || typeof logo !== 'object') return '';
	if (!/^(free-license|editorial-use)$/.test(String(logo.basis || ''))) return '';
	if (!String(logo.source || '').trim()) return '';
	const file = String(logo.file || '');
	if (!/^[a-z0-9][a-z0-9-]*\.png$/.test(file)) return '';
	return `logos/${file}`;
}

function ssEntityIdentity(entity) {
	if (!entity) return null;
	// The mark wins when we have one — it is the entity's own identity, and the
	// whole point of WP-186. National teams never carry one (see the seeder): the
	// flag stays their anchor, so these two rungs never compete for the same row.
	const logoSrc = ssEntityLogoSrc(entity);
	if (logoSrc) return { kind: 'logo', src: logoSrc, name: String(entity.name || '') };
	const isNational = entity.type === 'athlete' || entity.national === true;
	if (isNational && entity.country) {
		const flag = ssFlagEmoji(entity.country);
		if (flag) return { kind: 'flag', flag };
	}
	const c = entity.colors;
	// Belt-and-braces: the two fills go into a `style` attribute, so only a
	// canonical `#rrggbb` is ever accepted (the schema enforces it server-side —
	// this makes a malformed cache incapable of injecting anything).
	const hex = (v) => (/^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : null);
	const primary = hex(c && c.primary);
	if (primary) {
		const secondary = hex(c.secondary) || primary;
		const initials = ssMonogramInitials(entity.name);
		if (initials) return { kind: 'monogram', initials, primary, secondary, ink: ssInkOn({ primary, secondary }) };
	}
	return null;
}

/**
 * The row cell for an identity — decorative (`aria-hidden`): the row's title and
 * meta already name the entity for assistive tech, so the avatar must not repeat
 * it. Returns '' for a null identity so the caller falls back to the sport glyph.
 */
function ssEntityAvatar(identity) {
	if (!identity) return '';
	if (identity.kind === 'logo') {
		// `loading="lazy"` keeps a long agenda from asking for 60 marks at once;
		// `alt=""` because the row already names the club for assistive tech. No
		// filter, no border-radius, no plate — the mark is shown as it is.
		return `<span class="ev-avatar ev-logo" aria-hidden="true"><img src="${ssAvatarEscape(identity.src)}" alt="" width="24" height="24" loading="lazy" decoding="async"></span>`;
	}
	if (identity.kind === 'flag') return `<span class="ev-avatar ev-flag" aria-hidden="true">${identity.flag}</span>`;
	const style = `--av-a:${identity.primary};--av-b:${identity.secondary};--av-ink:${identity.ink}`;
	return `<span class="ev-avatar ev-mono" style="${style}" aria-hidden="true">${ssAvatarEscape(identity.initials)}</span>`;
}

// Self-contained escaping: this file must stay usable stand-alone (the vm-sandbox
// unit tests load it without shared-constants.js), and every value it emits — the
// initials AND the two hex fills — is machine-derived, never free text.
function ssAvatarEscape(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

if (typeof window !== 'undefined') {
	window.ssEntityLogoSrc = ssEntityLogoSrc;
	window.ssFlagEmoji = ssFlagEmoji;
	window.ssMonogramInitials = ssMonogramInitials;
	window.ssInkOn = ssInkOn;
	window.ssEntityIdentity = ssEntityIdentity;
	window.ssEntityMatchesName = ssEntityMatchesName;
	window.ssEntityAvatar = ssEntityAvatar;
}
if (typeof module !== 'undefined' && module.exports) {
	module.exports = { ssFlagEmoji, ssMonogramInitials, ssInkOn, ssLuminance, ssEntityLogoSrc, ssEntityIdentity, ssEntityMatchesName, ssEntityAvatar };
}
