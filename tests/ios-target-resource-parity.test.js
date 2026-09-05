// System coherence: the target TestFlight actually ships must bundle everything
// the Simulator app target bundles.
//
// `scripts/testflight-upload.js` archives `process.env.TF_SCHEME || "SportivistaDeviceDev"`,
// and nothing in .github/ sets TF_SCHEME — so **SportivistaDeviceDev is the app
// the owner installs**, while `Sportivista` is the Simulator/CI target and
// `SportivistaTests` is what the whole Swift suite asserts against.
//
// That split silently ate WP-186's club marks. `../docs/logos` was added to the
// app target, the widget and the test bundle, but never to DeviceDev. The 137
// PNGs still reached the phone — inside the embedded widget's `.appex` — but the
// APP process's `Bundle.main` is the `.app`, so `EntityIdentity.assetExists`
// answered false for every entity and the logo rung was dead on every build the
// owner ever installed. Every test stayed green throughout, because they run
// against the test bundle, which had the folder.
//
// A resource on the shipped target but not the Simulator one is fine (the eval
// corpus is deliberately device-only) — the containment is one-way.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const yml = fs.readFileSync(path.resolve(process.cwd(), "ios", "project.yml"), "utf-8");

/** The `- path:` entries inside one target's `sources:` block. */
function sourcePaths(target) {
	const lines = yml.split("\n");
	const start = lines.findIndex((l) => l === `  ${target}:`);
	expect(start, `target ${target} not found in ios/project.yml`).toBeGreaterThan(-1);
	// The target block runs to the next 2-space-indented key.
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^ {2}\S/.test(lines[i])) { end = i; break; }
	}
	const block = lines.slice(start, end);
	const sourcesAt = block.findIndex((l) => l.trim() === "sources:");
	expect(sourcesAt, `target ${target} has no sources: block`).toBeGreaterThan(-1);
	let sourcesEnd = block.length;
	for (let i = sourcesAt + 1; i < block.length; i++) {
		if (/^ {4}\S/.test(block[i])) { sourcesEnd = i; break; }
	}
	return block
		.slice(sourcesAt + 1, sourcesEnd)
		.map((l) => l.match(/^\s*- path:\s*(\S+)/))
		.filter(Boolean)
		.map((m) => m[1]);
}

describe("iOS target resource parity", () => {
	it("SportivistaDeviceDev bundles everything the Sportivista target bundles", () => {
		const shipped = new Set(sourcePaths("SportivistaDeviceDev"));
		for (const p of sourcePaths("Sportivista")) {
			expect(
				shipped.has(p),
				`ios/project.yml: '${p}' is on the Sportivista target but NOT on SportivistaDeviceDev — ` +
					`that is the target TestFlight archives, so the owner's app would ship without it.`
			).toBe(true);
		}
	});

	it("the club marks reach the SHIPPED app, not only the widget and the tests", () => {
		// The regression that motivated this file, pinned by name.
		for (const target of ["Sportivista", "SportivistaDeviceDev", "SportivistaWidgetExtension", "SportivistaTests"]) {
			expect(sourcePaths(target), `${target} must bundle ../docs/logos`).toContain("../docs/logos");
		}
	});

	it("TestFlight still archives the target this test guards", () => {
		// If the release lane ever switches scheme, the parity direction above
		// must be revisited — so pin the default the uploader falls back to.
		const uploader = fs.readFileSync(path.resolve(process.cwd(), "scripts", "testflight-upload.js"), "utf-8");
		expect(uploader).toMatch(/TF_SCHEME\s*\|\|\s*"SportivistaDeviceDev"/);
	});
});
