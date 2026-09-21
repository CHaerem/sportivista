// WP-185: the row's per-ENTITY visual anchor (docs/js/entity-avatar.js) — the web
// half of the flag/monogram/sport-glyph ladder. Pinned here because all three
// rungs are user-visible promises: the right flag on a Norwegian, a READABLE
// monogram on a white-kitted club, and — the rung that matters most — an honest
// fall-through to the sport glyph when we simply don't know.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { createClientSandbox, loadClientScript } from "./helpers/load-client.js";

let S;
beforeAll(() => {
	S = createClientSandbox();
	loadClientScript(S, "shared-constants.js");
	loadClientScript(S, "sport-icons.js");
	loadClientScript(S, "entity-avatar.js");
});

describe("flag emoji from ISO country", () => {
	it("alpha-2 → the regional-indicator pair", () => {
		expect(S.ssFlagEmoji("NO")).toBe("🇳🇴");
		expect(S.ssFlagEmoji("de")).toBe("🇩🇪");
		expect(S.ssFlagEmoji("US")).toBe("🇺🇸");
	});

	it("the UK home nations get their OWN flags, never a Union Jack", () => {
		// England/Scotland/Wales are separate 'countries' in sport; GB would be wrong.
		expect(S.ssFlagEmoji("GB-ENG")).toBe("🏴󠁧󠁢󠁥󠁮󠁧󠁿");
		expect(S.ssFlagEmoji("GB-SCT")).toBe("🏴󠁧󠁢󠁳󠁣󠁴󠁿");
		expect(S.ssFlagEmoji("GB-WLS")).toBe("🏴󠁧󠁢󠁷󠁬󠁳󠁿");
		expect(S.ssFlagEmoji("GB")).toBe("🇬🇧");
	});

	it("degrades to nothing rather than to a wrong flag", () => {
		// Northern Ireland has no RGI emoji sequence — no flag beats a Union Jack.
		expect(S.ssFlagEmoji("GB-NIR")).toBe("");
		expect(S.ssFlagEmoji("")).toBe("");
		expect(S.ssFlagEmoji("Norge")).toBe("");
		expect(S.ssFlagEmoji(null)).toBe("");
	});
});

describe("monogram initials", () => {
	it("takes first + last word, Kontakter-style", () => {
		expect(S.ssMonogramInitials("Manchester City")).toBe("MC");
		expect(S.ssMonogramInitials("Aston Villa")).toBe("AV");
		expect(S.ssMonogramInitials("Rosenborg")).toBe("R");
	});

	it("drops club-form noise when a real word survives", () => {
		expect(S.ssMonogramInitials("AFC Bournemouth")).toBe("B");
		expect(S.ssMonogramInitials("Rosenborg BK")).toBe("R");
		expect(S.ssMonogramInitials("FC")).toBe("F"); // nothing survives → keep the word
	});

	it("never returns more than two characters", () => {
		for (const n of ["Borussia Mönchengladbach", "Real Sociedad de Fútbol", "1. FC Köln"]) {
			expect(S.ssMonogramInitials(n).length).toBeLessThanOrEqual(2);
		}
	});
});

describe("monogram ink is COMPUTED, never hardcoded white", () => {
	it("dark kit → white ink, white kit → black ink", () => {
		expect(S.ssInkOn({ primary: "#0a0a0a" })).toBe("#ffffff");
		expect(S.ssInkOn({ primary: "#ffffff" })).toBe("#000000");
	});

	it("a split kit is judged on the MEAN of both fills (the initials straddle it)", () => {
		expect(S.ssInkOn({ primary: "#ffffff", secondary: "#000000" })).toBe("#000000");
		expect(S.ssInkOn({ primary: "#e20520", secondary: "#003399" })).toBe("#ffffff");
	});

	it("the chosen ink always wins the WCAG contrast comparison", () => {
		for (const hex of ["#e20520", "#99c5ea", "#ffffff", "#000000", "#7f7f7f"]) {
			const ink = S.ssInkOn({ primary: hex });
			const l = S.ssLuminance(hex);
			const ratio = (x) => (Math.max(l, x) + 0.05) / (Math.min(l, x) + 0.05);
			expect(ratio(ink === "#ffffff" ? 1 : 0)).toBeGreaterThanOrEqual(ratio(ink === "#ffffff" ? 0 : 1));
		}
	});
});

describe("the identity ladder: flag → monogram → nothing (sport glyph)", () => {
	const club = { id: "arsenal", name: "Arsenal", type: "team", colors: { primary: "#e20520", secondary: "#003399" } };
	const national = { id: "norge", name: "Norge", type: "team", national: true, country: "NO", colors: { primary: "#c8102e" } };
	const athlete = { id: "magnus-carlsen", name: "Magnus Carlsen", type: "athlete", country: "NO" };

	it("an athlete with a country flies a flag", () => {
		expect(S.ssEntityIdentity(athlete)).toEqual({ kind: "flag", flag: "🇳🇴" });
	});

	it("a national team flies a flag even though it also has kit colours", () => {
		expect(S.ssEntityIdentity(national)).toEqual({ kind: "flag", flag: "🇳🇴" });
	});

	it("a club wears a monogram", () => {
		expect(S.ssEntityIdentity(club)).toEqual({
			kind: "monogram", initials: "A", primary: "#e20520", secondary: "#003399", ink: "#ffffff",
		});
	});

	it("a CLUB carrying a country (Wikidata P17) must NOT fly that country's flag", () => {
		// The real trap: every Norwegian handball club has country "NO" in the
		// registry. Only `national: true` earns a flag.
		const nkClub = { id: "elverum", name: "Elverum Håndball", type: "team", country: "NO" };
		expect(S.ssEntityIdentity(nkClub)).toBeNull();
	});

	it("no metadata at all → null, so the caller keeps the sport glyph", () => {
		expect(S.ssEntityIdentity({ id: "x", name: "Ukjent FK", type: "team" })).toBeNull();
		expect(S.ssEntityIdentity(null)).toBeNull();
		expect(S.ssEntityAvatar(null)).toBe("");
	});

	it("a malformed colour is refused rather than injected into the style attribute", () => {
		const evil = { id: "x", name: "Evil FC", type: "team", colors: { primary: "red;background:url(javascript:1)" } };
		expect(S.ssEntityIdentity(evil)).toBeNull();
	});
});

describe("the rendered cell", () => {
	it("is decorative — the title/meta already names the entity for VoiceOver", () => {
		const flag = S.ssEntityAvatar({ kind: "flag", flag: "🇳🇴" });
		expect(flag).toContain('aria-hidden="true"');
		expect(flag).toContain("ev-avatar ev-flag");
	});

	it("hands the monogram its two fills + computed ink as CSS custom properties", () => {
		const html = S.ssEntityAvatar(S.ssEntityIdentity({ id: "a", name: "Arsenal", type: "team", colors: { primary: "#e20520", secondary: "#003399" } }));
		expect(html).toContain("--av-a:#e20520");
		expect(html).toContain("--av-b:#003399");
		expect(html).toContain("--av-ink:#ffffff");
		expect(html).toContain(">A<");
	});
});

describe("the CSS contract the markup depends on", () => {
	const css = fs.readFileSync(path.resolve(process.cwd(), "docs", "css", "cards.css"), "utf-8");

	it("the identity column holds exactly one 24px cell (DESIGN § Entitets-avatar)", () => {
		expect(css).toMatch(/grid-template-columns: 14px var\(--time-col\) 24px 1fr auto;/);
		expect(css).toMatch(/\.ev-avatar \{[^}]*width: 24px; height: 24px;/);
	});

	it("the monogram is drawn locally — a gradient, never an image request", () => {
		expect(css).toMatch(/\.ev-mono \{[^}]*linear-gradient\(135deg, var\(--av-a\)/);
		expect(css).not.toMatch(/\.ev-(mono|flag|avatar)[^}]*url\(/);
	});

	it("club colours are always taken down a notch — harder in dark", () => {
		expect(css).toMatch(/\.ev-mono \{[^}]*filter: saturate\(0\.85\) brightness\(0\.92\);/);
		expect(css).toMatch(/:root\[data-theme="light"\] \.ev-mono \{ filter: saturate\(0\.9\); \}/);
	});
});

describe("the agenda row picks ONE anchor and degrades gracefully", () => {
	let dash;
	beforeAll(() => {
		const box = createClientSandbox();
		loadClientScript(box, "shared-constants.js");
		loadClientScript(box, "lens.js");
		loadClientScript(box, "sport-icons.js");
		loadClientScript(box, "entity-avatar.js");
		loadClientScript(box, "dashboard.js");
		loadClientScript(box, "live.js");
		loadClientScript(box, "detail.js");
		loadClientScript(box, "followed.js");
		loadClientScript(box, "chrome.js");
		dash = box.window.dashboard;
		dash.entities = [
			{ id: "arsenal", name: "Arsenal", aliases: ["Arsenal FC"], sport: "football", type: "team", colors: { primary: "#e20520", secondary: "#003399" } },
			{ id: "atletico-madrid", name: "Atlético Madrid", aliases: ["Atlético"], sport: "football", type: "team", colors: { primary: "#ca3624", secondary: "#000000" } },
			{ id: "norge", name: "Norge", aliases: ["Norway"], sport: "football", type: "team", national: true, country: "NO", colors: { primary: "#c8102e" } },
			{ id: "magnus-carlsen", name: "Magnus Carlsen", aliases: [], sport: "chess", type: "athlete", country: "NO" },
			{ id: "elverum", name: "Elverum Håndball", aliases: [], sport: "handball", type: "team", country: "NO" },
		];
		dash._identityIndex = null;
	});

	const soon = () => new Date(Date.now() + 3600000).toISOString();

	it("a club match wears the home club's monogram — and only ONE avatar in the row", () => {
		const html = dash.eventRow({ id: "a", sport: "football", homeTeam: "Arsenal FC", awayTeam: "Chelsea", title: "Arsenal vs Chelsea", time: soon() });
		expect(html).toContain("ev-mono");
		expect(html).toContain("--av-a:#e20520");
		expect((html.match(/ev-avatar/g) || []).length).toBe(1);
		expect(html).not.toContain("ev-sport");   // the glyph steps aside for the avatar
	});

	it("a national-team row flies the flag", () => {
		const html = dash.eventRow({ id: "b", sport: "football", homeTeam: "Norge", awayTeam: "Italia", title: "Norge – Italia", time: soon() });
		expect(html).toContain("ev-flag");
		expect(html).toContain("🇳🇴");
	});

	it("an athlete event resolves through the participant", () => {
		const html = dash.eventRow({ id: "c", sport: "chess", title: "Norway Chess runde 4", time: soon(), participants: [{ name: "Magnus Carlsen" }] });
		expect(html).toContain("ev-flag");
	});

	it("the server's stamped entity id wins over the name — when it genuinely names the team", () => {
		const e = { id: "d", sport: "football", homeTeam: "Arsenal FC", homeTeamEntityId: "arsenal", title: "X", time: soon() };
		expect(dash.rowEntity(e).id).toBe("arsenal");
	});

	it("but a stamped id that does NOT name the team is refused — no wrong crest", () => {
		// The Copa del Rey misidentification (visual-qa 21.09): a tiny club absent
		// from the registry word-overlaps a famous club's generic qualifier
		// ("Atlético") and gets stamped its id. The honest sport-glyph fallback
		// beats a crest that names the wrong team, so rowEntity refuses it.
		const e = { id: "d2", sport: "football", homeTeam: "Atlético Calatayud", homeTeamEntityId: "atletico-madrid", title: "X", time: soon() };
		expect(dash.rowEntity(e)).toBeNull();
	});

	it("falls through to the AWAY side — for a Norwegian fan that is often the point", () => {
		// "Universitatea Cluj – Brann": the home club is a stranger, the away club
		// is the reason the row is on the board at all.
		const e = { id: "g", sport: "football", homeTeam: "Universitatea Cluj", awayTeam: "Arsenal", title: "Cluj – Arsenal", time: soon() };
		expect(dash.rowEntity(e).id).toBe("arsenal");
	});

	it("an unknown entity keeps the WP-154 sport glyph — never an empty hole", () => {
		const html = dash.eventRow({ id: "e", sport: "cycling", title: "Etappe 9", time: soon() });
		expect(html).toContain("ev-sport");
		expect(html).not.toContain("ev-avatar");
	});

	it("a club with a country but no `national` keeps the sport glyph (no wrong flag)", () => {
		const html = dash.eventRow({ id: "f", sport: "handball", homeTeam: "Elverum Håndball", awayTeam: "Kolstad", title: "Elverum – Kolstad", time: soon() });
		expect(html).toContain("ev-sport");
		expect(html).not.toContain("🇳🇴");
	});

	it("the lookup is built ONCE and only over entities that carry identity (no per-row scan)", () => {
		const idx = dash.identityIndex();
		expect(dash.identityIndex()).toBe(idx);             // memoised
		expect(idx.byId.has("elverum")).toBe(false);        // no identity → not indexed
		expect(idx.byId.has("arsenal")).toBe(true);
		expect(idx.byName.get("norway").id).toBe("norge");  // aliases resolve too
	});
});

describe("amber stays the single accent (DESIGN § Forbudsliste)", () => {
	it("no avatar rule reaches for the accent token", () => {
		const css = fs.readFileSync(path.resolve(process.cwd(), "docs", "css", "cards.css"), "utf-8");
		// One entry per `selector { … }` rule, matched on its own — a block split
		// would swallow the neighbouring chevron rule (which legitimately uses amber).
		const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
			.filter(([, selector]) => /\.ev-(avatar|mono|flag)/.test(selector));
		expect(rules.length).toBeGreaterThan(0);
		for (const [, selector, body] of rules) expect(body, selector.trim()).not.toMatch(/var\(--accent\)/);
	});
});

// ── WP-186: the REAL club mark, the new top rung ────────────────────────────

describe("WP-186: the logo rung", () => {
	const free = {
		file: "rosenborg.png",
		source: "wikimedia-commons",
		basis: "free-license",
		license: "Public domain",
		sourceUrl: "https://commons.wikimedia.org/wiki/File:Rosenborg.svg",
	};
	const editorial = {
		file: "arsenal.png",
		source: "espn",
		basis: "editorial-use",
		sourceUrl: "https://a.espncdn.com/i/teamlogos/soccer/500/359.png",
	};

	it("a real mark OUTRANKS the monogram", () => {
		const club = { id: "arsenal", name: "Arsenal", type: "team", colors: { primary: "#e20520" }, logo: editorial };
		expect(S.ssEntityIdentity(club)).toEqual({ kind: "logo", src: "logos/arsenal.png", name: "Arsenal" });
	});

	it("both bases render — the client does not re-litigate the policy", () => {
		// build-entities already applied scripts/config/logo-policy.json; if a mark
		// reached the client at all, it is one we decided to ship.
		expect(S.ssEntityIdentity({ id: "rosenborg", name: "Rosenborg", type: "team", logo: free }).kind).toBe("logo");
	});

	it("a mark without PROVENANCE is ignored — the row degrades to the WP-185 ladder", () => {
		const noBasis = { id: "x", name: "Klubb", type: "team", colors: { primary: "#112233" }, logo: { file: "x.png", source: "espn", sourceUrl: "u" } };
		expect(S.ssEntityIdentity(noBasis).kind).toBe("monogram");
		const noSource = { id: "x", name: "Klubb", type: "team", logo: { file: "x.png", basis: "editorial-use", sourceUrl: "u" } };
		expect(S.ssEntityIdentity(noSource)).toBeNull();
	});

	it("REFUSES anything that is not a bare local asset name — no URL can reach src", () => {
		// A stale cache or a tampered response must not be able to point the page at
		// a third party; the no-external-request property is not negotiable.
		for (const file of ["https://a.espncdn.com/x.png", "//evil.example/x.png", "../../secret.png", "/etc/passwd.png", "Arsenal.PNG", "x.svg", "javascript:alert(1).png"]) {
			expect(S.ssEntityLogoSrc({ logo: { ...editorial, file } })).toBe("");
		}
		expect(S.ssEntityLogoSrc({ logo: editorial })).toBe("logos/arsenal.png");
	});

	it("renders a lazy, decorative <img> with NO tint, crop or plate", () => {
		const html = S.ssEntityAvatar({ kind: "logo", src: "logos/arsenal.png", name: "Arsenal" });
		expect(html).toContain('class="ev-avatar ev-logo"');
		expect(html).toContain('src="logos/arsenal.png"');
		expect(html).toContain('loading="lazy"');
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain('alt=""');
	});

	it("the logo stylesheet only SIZES the mark — it never modifies it", () => {
		const css = fs.readFileSync(path.resolve(process.cwd(), "docs", "css", "entity-logo.css"), "utf-8");
		const logoRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, sel]) => /\.ev-logo/.test(sel));
		expect(logoRules.length).toBeGreaterThan(0);
		const body = logoRules.map(([, , b]) => b).join("\n");
		expect(body).toMatch(/object-fit: contain/);
		// A recolour/crop/mask of a CC BY-SA mark would be a derivative; of ANY club
		// mark it would simply be the wrong mark.
		expect(body).not.toMatch(/\bfilter:|mix-blend-mode|object-fit: cover|border-radius|clip-path|background/);
		// And no rule here may reach off-origin for an image.
		expect(css).not.toMatch(/url\(/);
	});
});

// The misidentification guard (visual-qa 21.09): a tiny club whose name merely
// CONTAINS a famous club's generic qualifier ("Atlético Calatayud") must not
// inherit that club's crest. A wrong crest lies faster than any text, so the
// honest sport-glyph fallback is strictly better.
describe("ssEntityMatchesName: a generic-qualifier overlap is refused", () => {
	const atletico = { id: "atletico-madrid", name: "Atlético Madrid", aliases: ["Atlético"] };
	const sporting = { id: "sporting-cp", name: "Sporting CP", aliases: ["Sporting"] };
	const bayern = { id: "bayern-munich", name: "Bayern Munich", aliases: ["Bayern"] };
	const mainz = { id: "mainz", name: "Mainz", aliases: [] };
	const inter = { id: "internazionale", name: "Internazionale", aliases: ["Inter Milan"] };

	it("rejects the Copa del Rey false crests the review caught", () => {
		expect(S.ssEntityMatchesName(atletico, "Atlético Calatayud")).toBe(false);
		expect(S.ssEntityMatchesName(atletico, "Atlético Pinatarense")).toBe(false);
		expect(S.ssEntityMatchesName(atletico, "Atlético Melilla")).toBe(false);
		expect(S.ssEntityMatchesName(atletico, "Atlético Unión Güímar")).toBe(false);
		expect(S.ssEntityMatchesName(sporting, "Sporting Hortaleza")).toBe(false);
		expect(S.ssEntityMatchesName(sporting, "Sporting de Alcázar")).toBe(false);
	});

	it("keeps the real club and its legitimate short-name aliases", () => {
		// exact name / alias always wins — the actual Atlético Madrid keeps its crest
		expect(S.ssEntityMatchesName(atletico, "Atlético Madrid")).toBe(true);
		expect(S.ssEntityMatchesName(atletico, "Atlético")).toBe(true);
		expect(S.ssEntityMatchesName(sporting, "Sporting CP")).toBe(true);
		// distinctive-token overlap keeps spelling/abbreviation variants
		expect(S.ssEntityMatchesName(bayern, "Bayern München")).toBe(true);
		expect(S.ssEntityMatchesName(mainz, "Mainz 05")).toBe(true);
		expect(S.ssEntityMatchesName(inter, "Inter")).toBe(true);
	});

	it("is null-safe and empty-safe", () => {
		expect(S.ssEntityMatchesName(null, "Anything")).toBe(false);
		expect(S.ssEntityMatchesName(atletico, "")).toBe(false);
		expect(S.ssEntityMatchesName(atletico, null)).toBe(false);
	});
});
