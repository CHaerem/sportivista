// System coherence: the agent prompts reference files that exist, and their
// output contracts stay in sync with what the pipeline and client expect.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const read = (f) => fs.readFileSync(path.resolve(process.cwd(), "scripts", "agents", f), "utf-8");

describe("agent prompts", () => {
	it("all three prompt files exist", () => {
		for (const f of ["research.md", "verify.md", "editorial.md"]) {
			expect(fs.existsSync(path.resolve("scripts", "agents", f)), f).toBe(true);
		}
	});

	it("research prompt covers the full contract", () => {
		const p = read("research.md");
		expect(p).toContain("interests.json");
		expect(p).toContain("tracked.json");
		expect(p).toContain("events.json");
		expect(p).toContain("research-log.json");
		expect(p).toContain('"ai-research"');
		expect(p).toContain("validate-events.js");
		// Coverage & correctness package contracts
		expect(p).toContain("coverage-gaps.json");
		expect(p).toContain("calibration.json");
		expect(p).toContain("tv-listings.json");
		expect(p).toContain("norwegian-rights");
		expect(p).toContain("fact-check");
		expect(p).toContain("rubrics/research-rubric.md");
		// WP-165: the demand signal (public coverage-request issues) must be a
		// documented input the horizon scan prioritises — but never auto-adds.
		expect(p).toContain("demand");
		expect(p).toContain("coverage-request");
		expect(fs.existsSync(path.resolve("scripts", "agents", "rubrics", "research-rubric.md"))).toBe(true);
	});

	it("verify prompt covers the full contract", () => {
		const p = read("verify.md");
		expect(p).toContain("verificationStatus");
		expect(p).toContain("verify-log.json");
		expect(p).toContain("calibration-ledger.jsonl");
		expect(p).toContain("norwegian-rights");
	});

	it("WP-04: research and verify document the canonical norwegianPlayers/participants form", () => {
		for (const f of ["research.md", "verify.md"]) {
			const p = read(f);
			expect(p, `${f} should document norwegianPlayers/participants`).toContain("norwegianPlayers");
			expect(p, `${f} should document norwegianPlayers/participants`).toContain("participants");
			// The contract is object-shaped ({ "name": ... }), never a bare string/null —
			// pin the example so the prose can't silently drift back to the old polymorphism.
			expect(p, `${f} should show the canonical { "name": ... } object form`).toMatch(/\{\s*"name":/);
			expect(p.toLowerCase(), `${f} should call out canonical/never-a-string form`).toMatch(/never a bare string|canonical/);
		}
	});

	it("WP-241/242: autoritet-først og proveniens per faktum er promptede kontrakter", () => {
		const research = read("research.md");
		const verify = read("verify.md");
		// Research slår opp autoritetskartet og går til skaperen av faktumet først.
		expect(research).toContain("authority.json");
		expect(research).toContain("sources.json");
		expect(research).toContain('"provenance"');
		expect(research).toContain('"basis"');
		// Verify sjekker kanalen mot kringkasterens EGEN kilde og stempler proveniens.
		expect(verify).toContain("authority.json");
		expect(verify).toContain("provenance.streaming");
		expect(verify).toContain("provenance.time");
		// Lookalike-advarselen står i BEGGE, med opphavseksempelet navngitt —
		// registeret er sannheten om hvilket domene som ER arrangøren.
		for (const [name, p] of [["research.md", research], ["verify.md", verify]]) {
			expect(p.toLowerCase(), `${name} mangler lookalike-advarselen`).toContain("lookalike");
			expect(p, `${name} bør navngi franceletour-eksempelet`).toContain("franceletour.com");
		}
	});

	it("scout prompt exists with escalation cap and log contract", () => {
		const p = read("scout.md");
		expect(p).toContain("scout-log.json");
		expect(p).toContain("max 2 escalations");
		expect(p).toContain("gh workflow run research-agent.yml");
	});

	it("editorial produces only the one block type the calm page renders", () => {
		const p = read("editorial.md");
		const dashboardJs = fs.readFileSync(path.resolve("docs", "js", "dashboard.js"), "utf-8");
		// The calm dashboard shows a single quiet headline line — nothing else.
		expect(p).toContain("headline");
		expect(dashboardJs, "dashboard.js should read the headline block").toContain("'headline'");
		// Editorial must NOT promise rich blocks the calm page can't show.
		for (const gone of ["match-result", "match-preview", "event-schedule", "golf-status"]) {
			expect(p, `editorial.md should no longer document ${gone}`).not.toContain(gone);
		}
	});

	it("prompts never permit editing interests.json", () => {
		for (const f of ["research.md", "verify.md"]) {
			expect(read(f).toLowerCase()).toContain("never modify");
		}
	});

	it("every skill referenced in any prompt exists, and x-sources is wired in", () => {
		const agentsDir = path.resolve("scripts", "agents");
		const prompts = fs.readdirSync(agentsDir).filter((f) => f.endsWith(".md"));
		expect(prompts.length).toBeGreaterThan(3);
		for (const f of prompts) {
			const refs = [...read(f).matchAll(/\.claude\/skills\/[\w-]+\/SKILL\.md/g)].map((m) => m[0]);
			for (const ref of refs) {
				expect(fs.existsSync(path.resolve(ref)), `${f} references missing ${ref}`).toBe(true);
			}
		}
		expect(read("research.md")).toContain(".claude/skills/x-sources/SKILL.md");
		expect(read("verify.md")).toContain(".claude/skills/x-sources/SKILL.md");
	});

	it("the source-quirks learning loop is wired: read by the correctness agents, written by verify", () => {
		const ref = ".claude/skills/source-quirks/SKILL.md";
		expect(fs.existsSync(path.resolve(ref)), "source-quirks skill missing").toBe(true);
		// Read by every agent that trusts a source's dates/status/coverage.
		for (const f of ["research.md", "verify.md", "coverage-critic.md"]) {
			expect(read(f), `${f} should reference source-quirks`).toContain(ref);
		}
		// verify is the writer: it must instruct appending a durable quirk.
		expect(read("verify.md").toLowerCase()).toContain("append an entry");
	});

	it("skills have valid frontmatter (name + description)", () => {
		const skillsDir = path.resolve(".claude", "skills");
		const dirs = fs
			.readdirSync(skillsDir, { withFileTypes: true })
			.filter((d) => d.isDirectory()) // ignore .DS_Store and stray files
			.map((d) => d.name);
		expect(dirs.length).toBeGreaterThan(0);
		for (const dir of dirs) {
			const skill = fs.readFileSync(path.join(skillsDir, dir, "SKILL.md"), "utf-8");
			expect(skill.startsWith("---"), `${dir}/SKILL.md missing frontmatter`).toBe(true);
			expect(skill).toMatch(/name:\s*\S+/);
			expect(skill).toMatch(/description:\s*\S+/);
		}
	});
});
