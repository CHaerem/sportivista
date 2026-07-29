#!/usr/bin/env node
/**
 * Takes a screenshot of the dashboard for visual validation.
 *
 * Usage:
 *   node scripts/screenshot.js [output-path] [--width=480] [--full-page]
 *
 * Defaults:
 *   output: docs/data/screenshot.png
 *   width: 480 (matches dashboard max-width)
 *
 * The autopilot uses this to visually validate UI changes:
 *   1. Take "before" screenshot
 *   2. Make changes
 *   3. Take "after" screenshot
 *   4. Read both with the Read tool (Claude sees images)
 *   5. Compare and evaluate the visual result
 *
 * Requires: playwright (installed via `npx playwright install chromium`)
 * Exit code 0 always — visual validation is best-effort, never blocks.
 */

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { createServer } from "http";
import { rootDataPath } from "./lib/helpers.js";

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith("--"));
const positional = args.filter((a) => !a.startsWith("--"));

const outputPath = path.resolve(positional[0] || path.join(rootDataPath(), "screenshot.png"));
const width = parseInt(flags.find((f) => f.startsWith("--width="))?.split("=")[1] || "480", 10);
const fullPage = flags.includes("--full-page");
const colorScheme = flags.includes("--dark") ? "dark" : "light"; // --dark renders the OLED theme

const docsDir = path.resolve(process.cwd(), "docs");

function startServer() {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			// Strip query strings (dashboard uses ?t=... for cache busting)
			const urlPath = (req.url || "/").split("?")[0];

			// Serve a TOKENLESS iCloud config so the board renders for QA.
			//
			// The dashboard is whole-web-behind-login (eier-beslutning 21.07), and the
			// gate's own documented escape is "no apiToken → open page (local dev /
			// stripped build)" — see ssBootGate in index.html and gate-boot.js. This
			// harness has to take it: the real web token is origin-locked to
			// sportivista.com / chaerem.github.io, so a screenshot served from
			// 127.0.0.1 can NEVER authenticate. Without this, visual-qa photographed
			// nothing but an AUTHENTICATION_FAILED sign-in card, run after run, and
			// could not check a single layout rule — the visual-qa → ui-fix loop was
			// dead. The override lives HERE, in the test harness, precisely so no new
			// bypass ships in the client: production still gates normally.
			if (urlPath === "/js/icloud-config.js") {
				res.writeHead(200, { "Content-Type": "text/javascript" });
				res.end("window.SPORTIVISTA_ICLOUD = { containerIdentifier: 'iCloud.app.sportivista.ios', apiToken: '', environment: 'production', zoneName: 'SportivistaProfile' };\n");
				return;
			}

			const safePath = path.join(docsDir, urlPath === "/" ? "index.html" : urlPath);
			if (!safePath.startsWith(docsDir)) {
				res.writeHead(403);
				res.end();
				return;
			}
			try {
				const content = fs.readFileSync(safePath);
				const ext = path.extname(safePath);
				const mimeTypes = {
					".html": "text/html", ".js": "text/javascript", ".css": "text/css",
					".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
				};
				res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
				res.end(content);
			} catch {
				res.writeHead(404);
				res.end("Not found");
			}
		});
		server.listen(0, "127.0.0.1", () => resolve(server));
	});
}

function runPlaywright(url) {
	return new Promise((resolve, reject) => {
		const tmpScript = path.join(rootDataPath(), ".screenshot-runner.cjs");
		fs.writeFileSync(tmpScript, `
const { chromium } = require('playwright');
(async () => {
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: ${width}, height: 900 },
		deviceScaleFactor: 2,
		colorScheme: ${JSON.stringify(colorScheme)},
	});
	await page.goto(${JSON.stringify(url)}, { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
	await page.waitForTimeout(3000);
	await page.screenshot({ path: ${JSON.stringify(outputPath)}, fullPage: ${fullPage} });
	await browser.close();
	console.log('Screenshot saved to ${outputPath}');
})();
`);

		const child = spawn("node", [tmpScript], { stdio: "inherit" });
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error("Playwright timed out"));
		}, 45000);

		child.on("close", (code) => {
			clearTimeout(timeout);
			try { fs.unlinkSync(tmpScript); } catch {}
			if (code === 0) resolve();
			else reject(new Error(`Playwright exited with code ${code}`));
		});

		child.on("error", (err) => {
			clearTimeout(timeout);
			try { fs.unlinkSync(tmpScript); } catch {}
			reject(err);
		});
	});
}

async function main() {
	const server = await startServer();
	const port = server.address().port;
	const url = `http://127.0.0.1:${port}/`;

	try {
		await runPlaywright(url);
	} finally {
		server.close();
	}
}

main().catch((err) => {
	console.error("Screenshot failed:", err.message);
	console.error("Visual validation is best-effort — this does not block the pipeline.");
	process.exit(0);
});
