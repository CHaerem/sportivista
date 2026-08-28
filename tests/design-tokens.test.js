// design/tokens.json coherence gate (WP-97 · Design-biblioteket): the token
// library LOCKS today's shipped reality — it does not change it. This test
// verifies the same three surfaces the file itself claims to synchronise:
//   (a) tokens.json parses and has the expected shape
//   (b) docs/css/base.css custom properties match the token hex values per theme
//   (c) ios/Sportivista/DesignTokens.swift's semantic colour mappings match
//       the token's documented `ios` semantic name (source-grep, same style as
//       the HIG CI gate in tests/ios-dynamic-type-gate.test.js — this repo does
//       not compile Swift in CI, so coherence is verified via source text)
//   (d) DESIGN.md § Tokens prose table matches the token's hex values — DESIGN.md
//       is the prose fasit, tokens.json is the machine-readable one; they must agree
//
// Any drift on any of the three surfaces is a real product bug (a rebrand or a
// one-off CSS edit silently diverging from the documented contract) and must
// fail CI, not be "fixed" by this test.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, "design", "tokens.json"), "utf-8"));
const baseCss = fs.readFileSync(path.join(ROOT, "docs", "css", "base.css"), "utf-8");
const designTokensSwift = fs.readFileSync(
	path.join(ROOT, "ios", "Sportivista", "DesignTokens.swift"),
	"utf-8"
);
const designMd = fs.readFileSync(path.join(ROOT, "DESIGN.md"), "utf-8");

/** Read `key: { $value }` for a colour token in a given theme, tolerating $extensions.web == null. */
function colorValue(key, theme) {
	const t = tokens.color[key];
	if (!t) throw new Error(`no such color token: ${key}`);
	return t[theme].$value;
}

describe("design/tokens.json — shape", () => {
	it("parses and has the expected top-level groups", () => {
		for (const group of ["color", "typography", "spacing", "radius", "layout"]) {
			expect(tokens[group], group).toBeTruthy();
		}
	});

	it("every color token declares both a dark and a light $value", () => {
		for (const [name, t] of Object.entries(tokens.color)) {
			if (name.startsWith("$")) continue; // group-level metadata (e.g. $description), not a token
			expect(t.dark?.$value, `${name}.dark`).toBeTruthy();
			expect(t.light?.$value, `${name}.light`).toBeTruthy();
			expect(t.$type, `${name}.$type`).toBe("color");
		}
	});
});

describe("design/tokens.json ⇄ docs/css/base.css", () => {
	// base.css custom properties this test can verify directly against a hex/rgba
	// literal (skips tokens the file itself documents as web-absent, e.g. cell2 —
	// see each token's $extensions.sportivista.discrepancy). destructive joined the
	// web tokens in WP-148 (the «Fjern» action on rediger.html), so it is locked here.
	const cssVarByToken = {
		background: "--bg",
		groupedBackground: "--bg",
		cell: "--surface",
		label: "--fg",
		secondaryLabel: "--fg-2",
		tertiaryLabel: "--fg-3",
		separator: "--line",
		accent: "--accent",
		accentInk: "--accent-ink",
		live: "--live",
		destructive: "--destructive",
	};

	/** Extract `--var: value;` from a `:root { ... }` or `:root[data-theme="light"] { ... }` block. */
	function cssVarValue(cssVar, theme) {
		const block =
			theme === "dark"
				? baseCss.match(/:root\s*\{([^}]*)\}/s)?.[1]
				: baseCss.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/s)?.[1];
		expect(block, `${theme} :root block found in base.css`).toBeTruthy();
		const m = block.match(new RegExp(`${cssVar}:\\s*([^;]+);`));
		expect(m, `${cssVar} declared in ${theme} block`).toBeTruthy();
		return m[1].trim();
	}

	for (const theme of ["dark", "light"]) {
		for (const [token, cssVar] of Object.entries(cssVarByToken)) {
			it(`${theme}: ${token} (${cssVar}) matches base.css`, () => {
				expect(cssVarValue(cssVar, theme)).toBe(colorValue(token, theme));
			});
		}
	}
});

describe("design/tokens.json ⇄ ios/Sportivista/DesignTokens.swift", () => {
	// Semantic-colour source grep: each entry maps a token to the Swift line that
	// must be present verbatim (the UIColor case name the token documents as
	// `$extensions.sportivista.ios`, or the literal hex pair for accent/live/destructive).
	const semanticChecks = [
		{ token: "background", needle: "static let background = Color(uiColor: .systemGroupedBackground)" },
		{ token: "groupedBackground", needle: "static let groupedBackground = Color(uiColor: .systemGroupedBackground)" },
		{ token: "cell", needle: "static let cell = Color(uiColor: .secondarySystemGroupedBackground)" },
		{ token: "cell2", needle: "static let cell2 = Color(uiColor: .tertiarySystemBackground)" },
		{ token: "label", needle: "static let label = Color(uiColor: .label)" },
		{ token: "secondaryLabel", needle: "static let secondaryLabel = Color(uiColor: .secondaryLabel)" },
		{ token: "tertiaryLabel", needle: "static let tertiaryLabel = Color(uiColor: .tertiaryLabel)" },
		{ token: "separator", needle: "static let separator = Color(uiColor: .separator)" },
	];

	for (const { token, needle } of semanticChecks) {
		it(`${token}: DesignTokens.swift declares the documented semantic mapping`, () => {
			expect(
				designTokensSwift.includes(needle),
				`expected DesignTokens.swift to contain:\n  ${needle}`
			).toBe(true);
		});
	}

	// accent / live / destructive carry explicit hex (not a system colour) — verify
	// the literal 0xRRGGBB pairs match tokens.json's dark/light $value.
	const explicitHexChecks = [
		{ token: "accent", swiftName: "accent" },
		{ token: "live", swiftName: "live" },
		{ token: "destructive", swiftName: "destructive" },
	];

	function hexPairFor(swiftName) {
		const re = new RegExp(
			`static let ${swiftName} = Color\\.sportivista\\(dark: Color\\(hex: 0x([0-9A-Fa-f]{6})\\), light: Color\\(hex: 0x([0-9A-Fa-f]{6})\\)\\)`
		);
		const m = designTokensSwift.match(re);
		expect(m, `${swiftName} hex pair found in DesignTokens.swift`).toBeTruthy();
		return { dark: `#${m[1].toUpperCase()}`, light: `#${m[2].toUpperCase()}` };
	}

	for (const { token, swiftName } of explicitHexChecks) {
		it(`${token}: DesignTokens.swift hex literals match tokens.json`, () => {
			const { dark, light } = hexPairFor(swiftName);
			expect(dark).toBe(colorValue(token, "dark"));
			expect(light).toBe(colorValue(token, "light"));
		});
	}

	// tertiaryLabel joined the token enum in WP-98 (previously views called
	// Color(uiColor: .tertiaryLabel) directly, bypassing the token layer — see
	// tokens.json's tertiaryLabel $description for the history). Assert the gap
	// stays closed: the enum declares it, and both known call sites (found via
	// the WP-97 audit) now route through SportivistaTokens.tertiaryLabel rather
	// than the raw UIColor.
	it("tertiaryLabel: DesignTokens.swift declares the token (WP-98 — no longer bypassed)", () => {
		expect(designTokensSwift.includes("static let tertiaryLabel = Color(uiColor: .tertiaryLabel)")).toBe(true);
	});

	for (const file of [
		path.join(ROOT, "ios", "Sportivista", "Agenda", "AgendaView.swift"),
		path.join(ROOT, "ios", "Sportivista", "Profile", "DegView.swift"),
	]) {
		it(`tertiaryLabel: ${path.relative(ROOT, file)} uses the token, not the raw UIColor`, () => {
			const src = fs.readFileSync(file, "utf-8");
			expect(src.includes("Color(uiColor: .tertiaryLabel)"), "no direct UIColor call left").toBe(false);
			expect(src.includes("SportivistaTokens.tertiaryLabel"), "migrated to the token").toBe(true);
		});
	}

	// Spacing scale: verify SportivistaSpacing literals match tokens.json.spacing.
	const spacingChecks = [
		["xs", "4"],
		["s", "8"],
		["m", "12"],
		["l", "16"],
		["xl", "24"],
		["xxl", "32"],
	];
	for (const [key, cgFloat] of spacingChecks) {
		it(`spacing.${key}: DesignTokens.swift SportivistaSpacing matches tokens.json`, () => {
			const re = new RegExp(`static let ${key}: CGFloat = ${cgFloat}\\b`);
			expect(designTokensSwift.match(re), `SportivistaSpacing.${key} == ${cgFloat}`).toBeTruthy();
			expect(tokens.spacing[key].$value).toBe(`${cgFloat}px`);
		});
	}
});

describe("design/tokens.json ⇄ DESIGN.md § Tokens (prose fasit)", () => {
	// DESIGN.md's colour table is `| token | rolle | mørk | lys |` markdown rows.
	// Verify each documented hex pair matches tokens.json (skip rows the table
	// doesn't literally give a hex for, e.g. `live`/`good` share one row).
	const rows = [
		{ token: "background", md: "background" },
		{ token: "groupedBackground", md: "groupedBackground" },
		{ token: "cell", md: "cell" },
		{ token: "cell2", md: "cell2" },
		{ token: "label", md: "label" },
		{ token: "tertiaryLabel", md: "tertiaryLabel" },
		{ token: "accent", md: "accent" },
		{ token: "destructive", md: "destructive" },
	];

	function mdRowHexes(mdToken) {
		const re = new RegExp(
			"\\|\\s*(?:\\*\\*)?`" + mdToken + "`(?:\\*\\*)?\\s*\\|[^|]*\\|\\s*`([^`]+)`\\s*\\|\\s*`([^`]+)`\\s*\\|"
		);
		const m = designMd.match(re);
		expect(m, `DESIGN.md § Tokens row for \`${mdToken}\` found`).toBeTruthy();
		return { dark: m[1], light: m[2] };
	}

	for (const { token, md } of rows) {
		it(`${token}: DESIGN.md § Farge row matches tokens.json`, () => {
			const { dark, light } = mdRowHexes(md);
			expect(dark).toBe(colorValue(token, "dark"));
			expect(light).toBe(colorValue(token, "light"));
		});
	}

	it("DESIGN.md § Tokens references design/tokens.json as the machine-readable fasit", () => {
		expect(designMd.includes("design/tokens.json")).toBe(true);
	});
});

describe("red-proof: this suite fails on a real value drift (see PR description for the mutate/revert transcript)", () => {
	// This is not a live mutation test (that would need a scratch copy of
	// base.css + DesignTokens.swift + DESIGN.md re-required mid-suite, which
	// vitest's ESM module cache makes brittle). Instead it asserts the exact
	// invariant whose violation the suite above is built to catch: token hex
	// equality across all three surfaces for the accent colour, the one token
	// every surface renders identically today. If this passes while any of the
	// three sources is hand-edited to a different hex, the suite above already
	// caught it in its own per-surface assertions (each is independently red on
	// a mismatch, per the PR's documented mutate/run/revert proof).
	it("accent hex is identical across tokens.json, base.css, DesignTokens.swift and DESIGN.md", () => {
		const fromTokens = { dark: colorValue("accent", "dark"), light: colorValue("accent", "light") };
		const cssBlockDark = baseCss.match(/:root\s*\{([^}]*)\}/s)[1];
		const cssBlockLight = baseCss.match(/:root\[data-theme="light"\]\s*\{([^}]*)\}/s)[1];
		const fromCss = {
			dark: cssBlockDark.match(/--accent:\s*([^;]+);/)[1].trim(),
			light: cssBlockLight.match(/--accent:\s*([^;]+);/)[1].trim(),
		};
		const swiftMatch = designTokensSwift.match(
			/static let accent = Color\.sportivista\(dark: Color\(hex: 0x([0-9A-Fa-f]{6})\), light: Color\(hex: 0x([0-9A-Fa-f]{6})\)\)/
		);
		const fromSwift = { dark: `#${swiftMatch[1].toUpperCase()}`, light: `#${swiftMatch[2].toUpperCase()}` };
		const mdMatch = designMd.match(
			/\|\s*\*\*`accent`\*\*[^|]*\|[^|]*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/
		);
		const fromMd = { dark: mdMatch[1], light: mdMatch[2] };

		expect(fromCss).toEqual(fromTokens);
		expect(fromSwift).toEqual(fromTokens);
		expect(fromMd).toEqual(fromTokens);
	});
});

// ---------------------------------------------------------------------------
// WP-183 — the display font (DESIGN.md § Display-font).
//
// The font is a TOKEN, so the same "this file locks shipped reality" rule that
// governs colour applies here: tokens.json names the family/files/weights, and
// this block proves the SHIPPED assets and both platforms' wiring agree with it.
// Crucially it verifies the two properties the choice was made on — TABULAR
// digits and æøå — mechanically, in the actual font file, rather than trusting
// a vendor feature list.
// ---------------------------------------------------------------------------

/** Minimal sfnt (TrueType) reader — just enough to answer "does this glyph
 *  exist", "how wide is it" and "what is this face called". Deliberately
 *  dependency-free: pulling a font library into devDependencies to assert three
 *  facts would cost more than it proves. Handles cmap format 4 and 12. */
function readTrueType(file) {
	const buf = fs.readFileSync(file);
	const numTables = buf.readUInt16BE(4);
	const tables = {};
	for (let i = 0; i < numTables; i++) {
		const rec = 12 + i * 16;
		tables[buf.toString("ascii", rec, rec + 4)] = {
			offset: buf.readUInt32BE(rec + 8),
			length: buf.readUInt32BE(rec + 12),
		};
	}
	const unitsPerEm = buf.readUInt16BE(tables.head.offset + 18);
	const numberOfHMetrics = buf.readUInt16BE(tables.hhea.offset + 34);

	// cmap → { codepoint: glyphId }, preferring the Windows Unicode subtables.
	const cmapBase = tables.cmap.offset;
	const subtables = [];
	for (let i = 0; i < buf.readUInt16BE(cmapBase + 2); i++) {
		const rec = cmapBase + 4 + i * 8;
		subtables.push({
			platformID: buf.readUInt16BE(rec),
			encodingID: buf.readUInt16BE(rec + 2),
			offset: cmapBase + buf.readUInt32BE(rec + 4),
		});
	}
	const codeToGlyph = new Map();
	const parseSubtable = (off) => {
		const format = buf.readUInt16BE(off);
		if (format === 4) {
			const segCountX2 = buf.readUInt16BE(off + 6);
			const endBase = off + 14;
			const startBase = endBase + segCountX2 + 2;
			const deltaBase = startBase + segCountX2;
			const rangeBase = deltaBase + segCountX2;
			for (let s = 0; s < segCountX2 / 2; s++) {
				const end = buf.readUInt16BE(endBase + s * 2);
				const start = buf.readUInt16BE(startBase + s * 2);
				const delta = buf.readInt16BE(deltaBase + s * 2);
				const rangeOffset = buf.readUInt16BE(rangeBase + s * 2);
				if (start === 0xffff) continue;
				for (let c = start; c <= end; c++) {
					let glyph;
					if (rangeOffset === 0) {
						glyph = (c + delta) & 0xffff;
					} else {
						glyph = buf.readUInt16BE(rangeBase + s * 2 + rangeOffset + (c - start) * 2);
						if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
					}
					if (glyph !== 0 && !codeToGlyph.has(c)) codeToGlyph.set(c, glyph);
				}
			}
			return;
		}
		if (format === 12) {
			const nGroups = buf.readUInt32BE(off + 12);
			for (let g = 0; g < nGroups; g++) {
				const rec = off + 16 + g * 12;
				const start = buf.readUInt32BE(rec);
				const end = buf.readUInt32BE(rec + 4);
				const startGlyph = buf.readUInt32BE(rec + 8);
				for (let c = start; c <= end; c++) {
					if (!codeToGlyph.has(c)) codeToGlyph.set(c, startGlyph + (c - start));
				}
			}
		}
	};
	for (const sub of subtables) {
		if (sub.platformID === 3 && (sub.encodingID === 1 || sub.encodingID === 10)) {
			parseSubtable(sub.offset);
		}
	}
	if (codeToGlyph.size === 0) subtables.forEach((sub) => parseSubtable(sub.offset));

	// name table ID 6 = PostScript name (the string UIFont(name:) is given).
	const nameBase = tables.name.offset;
	const stringOffset = nameBase + buf.readUInt16BE(nameBase + 4);
	let postScriptName = null;
	for (let i = 0; i < buf.readUInt16BE(nameBase + 2); i++) {
		const rec = nameBase + 6 + i * 12;
		if (buf.readUInt16BE(rec + 6) !== 6) continue;
		const platformID = buf.readUInt16BE(rec);
		const len = buf.readUInt16BE(rec + 8);
		const off = stringOffset + buf.readUInt16BE(rec + 10);
		const raw = Buffer.from(buf.subarray(off, off + len));
		postScriptName = platformID === 3 ? raw.swap16().toString("utf16le") : raw.toString("latin1");
		break;
	}

	return {
		unitsPerEm,
		postScriptName,
		has: (ch) => codeToGlyph.has(ch.codePointAt(0)),
		advance(ch) {
			const glyph = codeToGlyph.get(ch.codePointAt(0));
			if (glyph === undefined) return null;
			return buf.readUInt16BE(tables.hmtx.offset + Math.min(glyph, numberOfHMetrics - 1) * 4);
		},
	};
}

describe("WP-183 display font (DESIGN.md § Display-font)", () => {
	const display = tokens.typography.fontStack.display;

	it("tokens.json declares the face on exactly the three sanctioned surfaces", () => {
		expect(display.surfaces).toEqual(["wordmark", "agenda time column", "share cards"]);
		expect(display.licence).toMatch(/Open Font License/);
	});

	it("every declared asset — and its licence — is checked in", () => {
		for (const rel of [...display.webFiles, ...display.iosFiles]) {
			const file = path.join(ROOT, rel);
			expect(fs.existsSync(file), rel).toBe(true);
			expect(fs.statSync(file).size, rel).toBeGreaterThan(0);
		}
		expect(fs.existsSync(path.join(ROOT, "docs", "fonts", "OFL.txt"))).toBe(true);
		expect(fs.existsSync(path.join(ROOT, "design", "brand", "fonts", "OFL.txt"))).toBe(true);
	});

	it("the web files are real woff2 and stay small (subset, self-hosted, no CDN)", () => {
		let total = 0;
		for (const rel of display.webFiles) {
			const buf = fs.readFileSync(path.join(ROOT, rel));
			expect(buf.toString("ascii", 0, 4), `${rel} signature`).toBe("wOF2");
			total += buf.length;
		}
		expect(total).toBeLessThan(60 * 1024);
	});

	for (const rel of [
		"design/brand/fonts/SpaceGrotesk-Medium-subset.ttf",
		"design/brand/fonts/SpaceGrotesk-SemiBold-subset.ttf",
		"design/brand/fonts/SpaceGrotesk-Bold-subset.ttf",
	]) {
		describe(rel, () => {
			const font = readTrueType(path.join(ROOT, rel));

			it("has TRUE tabular figures — all ten digits share one advance", () => {
				const widths = new Set("0123456789".split("").map((d) => font.advance(d)));
				expect(widths.has(null), "a digit is missing from the subset").toBe(false);
				expect([...widths], "digit advances").toHaveLength(1);
			});

			it("carries æ ø å (the UI is Norwegian) and the wordmark's own glyphs", () => {
				for (const ch of "æøåÆØÅ") expect(font.has(ch), ch).toBe(true);
				for (const ch of "SPORTIVISTA:") expect(font.has(ch), ch).toBe(true);
			});

			it("its PostScript name is one DesignTokens.swift actually asks for", () => {
				expect(display.postScriptNames).toContain(font.postScriptName);
				expect(designTokensSwift).toContain(`"${font.postScriptName}"`);
			});
		});
	}

	it("base.css declares --display and one self-hosted @font-face per web weight", () => {
		expect(baseCss).toMatch(/--display:\s*"Space Grotesk Subset",\s*var\(--font\)/);
		for (const rel of display.webFiles) {
			expect(baseCss, rel).toContain(`url("../fonts/${path.basename(rel)}")`);
		}
		// No CDN, ever (DESIGN.md § Display-font + the null-infrastructure rule).
		expect(baseCss).not.toMatch(/@import\s+url\(|fonts\.googleapis|fonts\.gstatic/);
		// Every @font-face carries font-display: swap — text stays visible while
		// the face loads (and falls back to the system stack if it never does).
		const faces = baseCss.match(/@font-face\s*\{[^}]*\}/gs) || [];
		expect(faces).toHaveLength(display.webFiles.length);
		for (const face of faces) expect(face).toMatch(/font-display:\s*swap;/);
	});

	it("the three surfaces — and only they — use var(--display) on web", () => {
		const layoutCss = fs.readFileSync(path.join(ROOT, "docs", "css", "layout.css"), "utf-8");
		const cardsCss = fs.readFileSync(path.join(ROOT, "docs", "css", "cards.css"), "utf-8");
		const shareCard = fs.readFileSync(path.join(ROOT, "docs", "js", "share-card.js"), "utf-8");
		expect(layoutCss).toMatch(/\.wordmark\s*\{[^}]*font-family:\s*var\(--display\)/s);
		expect(layoutCss).toMatch(/\.wordmark-colon\s*\{[^}]*font-family:\s*var\(--display\)/s);
		expect(cardsCss).toMatch(/\.ev-time\s*\{[^}]*font-family:\s*var\(--display\)/s);
		expect(shareCard).toContain('"Space Grotesk Subset"');
		// Body copy stays on the system font — the token swap must not creep.
		expect(baseCss).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font\)/s);
		const uses = [layoutCss, cardsCss].flatMap((css) => css.match(/font-family:\s*var\(--display\)/g) || []);
		expect(uses, "a fourth web surface adopted the display face").toHaveLength(3);
	});

	it("BRAND.md's lock holds: the colon is one weight step heavier than the wordmark", () => {
		const layoutCss = fs.readFileSync(path.join(ROOT, "docs", "css", "layout.css"), "utf-8");
		const wordmark = Number(layoutCss.match(/\.wordmark\s*\{[^}]*font-weight:\s*(\d+)/s)[1]);
		const colon = Number(layoutCss.match(/\.wordmark-colon\s*\{[^}]*font-weight:\s*(\d+)/s)[1]);
		expect(colon).toBeGreaterThan(wordmark);
		expect(display.weights.semibold).toBe(wordmark);
		expect(display.weights.bold).toBe(colon);
	});

	it("iOS bundles the face and registers it (UIAppFonts) in every target that renders it", () => {
		const projectYml = fs.readFileSync(path.join(ROOT, "ios", "project.yml"), "utf-8");
		for (const rel of display.iosFiles) expect(projectYml, rel).toContain(`../${rel}`);
		// App, device build AND the widget each register their own fonts — an
		// extension does not inherit the host app's UIAppFonts.
		expect((projectYml.match(/UIAppFonts:/g) || []).length).toBe(3);
		// Dynamic Type is kept via UIFontMetrics, not a fixed point size.
		expect(designTokensSwift).toContain("UIFontMetrics(forTextStyle: uiStyle).scaledFont(for: face)");
	});
});

// Every `var(--x)` in docs/css must actually RESOLVE. An undefined custom property
// makes the whole declaration invalid, so it fails SILENTLY — the element just
// renders without that background/colour, and nothing in CI notices.
//
// This is not hypothetical: cards.css shipped four `var(--cell)` references while
// base.css names the cell surface `--surface` (DESIGN.md § Tokens calls it "cell" in
// prose — the mapping table above encodes exactly that split). The floating
// assistant FAB therefore had NO background at all and the agenda rows showed
// through it, against its own comment («umiskjennelig som en KNAPP»). The value
// gates above all passed, because every token they check was defined correctly —
// the bug was a name that pointed at nothing.
describe("docs/css — every var(--…) resolves to a defined custom property", () => {
	const CSS_DIR = path.join(ROOT, "docs", "css");
	const cssFiles = fs.readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));

	/** `--x: value` declarations — wherever they are declared (`:root`, a theme block, a rule). */
	function declaredIn(text) {
		return new Set((text.match(/(--[a-zA-Z0-9-]+)\s*:/g) || []).map((m) => m.replace(/\s*:$/, "")));
	}

	// Declared anywhere in docs/css …
	const declared = new Set();
	for (const f of cssFiles) {
		for (const name of declaredIn(fs.readFileSync(path.join(CSS_DIR, f), "utf-8"))) declared.add(name);
	}
	// … or set at RUNTIME from JS as an inline style (a legitimate per-element token,
	// e.g. entity-avatar.js's `--av-a/--av-b/--av-ink` crest colours).
	const JS_DIR = path.join(ROOT, "docs", "js");
	for (const f of fs.readdirSync(JS_DIR).filter((n) => n.endsWith(".js"))) {
		for (const name of declaredIn(fs.readFileSync(path.join(JS_DIR, f), "utf-8"))) declared.add(name);
	}

	for (const file of cssFiles) {
		it(`${file} references no undefined token`, () => {
			const css = fs.readFileSync(path.join(CSS_DIR, file), "utf-8");
			const undefinedRefs = [];
			// `var(--x)` and `var(--x, fallback)` — a fallback still means the NAME
			// must exist, otherwise the author silently relies on the fallback.
			for (const m of css.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
				if (!declared.has(m[1])) undefinedRefs.push(m[1]);
			}
			expect([...new Set(undefinedRefs)], `undefined custom properties in ${file}`).toEqual([]);
		});
	}
});
