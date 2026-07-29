// api-client.js: høflighetslaget (WP-244) — betingede forespørsler, takt per
// vert, ærlig User-Agent og robots.txt. Alt nettverk er mocket; ingen test her
// rører et ekte nett.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

// Fake HTTPS-transport. `vi.hoisted` fordi vi.mock-fabrikken heises over importene.
const net = vi.hoisted(() => ({ route: null, log: [] }));

vi.mock("https", () => {
	const get = (url, opts, cb) => {
		const request = new EventEmitter();
		request.setTimeout = () => {};
		request.destroy = () => {};
		net.log.push({ url, headers: opts.headers || {}, at: Date.now() });

		queueMicrotask(() => {
			const result = net.route(url, opts);
			if (!result) {
				request.emit("error", new Error(`ingen rute for ${url}`));
				return;
			}
			if (result.networkError) {
				request.emit("error", new Error(result.networkError));
				return;
			}
			const response = new EventEmitter();
			response.statusCode = result.status ?? 200;
			response.headers = result.headers ?? {};
			cb(response);
			if (result.body) response.emit("data", Buffer.from(result.body));
			response.emit("end");
		});

		return request;
	};
	return { default: { get }, get };
});

const {
	APIClient,
	RobotsDisallowedError,
	USER_AGENT,
	parseRobots,
	rulesForAgent,
	robotsVerdict,
	resetPolitenessState,
} = await import("../scripts/lib/api-client.js");

/** Sett ruteren: fn(url, opts) → { status, headers, body } | { networkError } */
function serve(fn) {
	net.route = fn;
}

const dataRequests = () => net.log.filter(r => !r.url.endsWith("/robots.txt"));
const robotsRequests = () => net.log.filter(r => r.url.endsWith("/robots.txt"));

/** Standardrute: robots.txt finnes ikke, alt annet er tom JSON. */
function serveOpen(extra = {}) {
	serve((url) => {
		if (url.endsWith("/robots.txt")) return { status: 404, body: "" };
		return { status: 200, headers: extra.headers || {}, body: extra.body ?? '{"ok":true}' };
	});
}

beforeEach(() => {
	resetPolitenessState();
	net.log.length = 0;
	net.route = () => ({ status: 404, body: "" });
	vi.spyOn(console, "warn").mockImplementation(() => {});
	vi.spyOn(console, "log").mockImplementation(() => {});
});

// --- 3. Ærlig User-Agent ------------------------------------------------

describe("User-Agent", () => {
	it("sender en ærlig, sporbar UA på både data- og robots-forespørsler", async () => {
		serveOpen();
		const client = new APIClient({ minHostIntervalMs: 0 });
		await client.fetchJSON("https://example.test/data.json");

		expect(USER_AGENT).toMatch(/^Sportivista\//);
		expect(USER_AGENT).toMatch(/https:\/\//); // kontakt-URL, ikke bare et navn
		for (const request of net.log) {
			expect(request.headers["User-Agent"]).toBe(USER_AGENT);
		}
	});

	it("lar kalleren overstyre UA per forespørsel (fetcher-kontrakten er uendret)", async () => {
		serveOpen();
		const client = new APIClient({ minHostIntervalMs: 0 });
		await client.fetchJSON("https://example.test/data.json", { headers: { "User-Agent": "Egen/1.0" } });
		expect(dataRequests()[0].headers["User-Agent"]).toBe("Egen/1.0");
	});
});

// --- 1. Betingede forespørsler ------------------------------------------

describe("betingede forespørsler", () => {
	it("sender If-None-Match og gjenbruker cachet svar på 304", async () => {
		let calls = 0;
		serve((url, opts) => {
			if (url.endsWith("/robots.txt")) return { status: 404, body: "" };
			calls++;
			if (calls === 1) {
				return { status: 200, headers: { etag: 'W/"v1"' }, body: '{"n":1}' };
			}
			// Betinget: kilden slipper å sende kroppen på nytt.
			expect(opts.headers["If-None-Match"]).toBe('W/"v1"');
			return { status: 304, headers: { etag: 'W/"v1"' }, body: "" };
		});

		const client = new APIClient({ minHostIntervalMs: 0, cacheTimeout: 0 });
		const first = await client.fetchJSON("https://example.test/data.json");
		const second = await client.fetchJSON("https://example.test/data.json");

		expect(first).toEqual({ n: 1 });
		expect(second).toBe(first); // samme objekt ⇒ ingen ny parsing
		expect(client.stats.notModified).toBe(1);
		expect(calls).toBe(2);
	});

	it("sender If-Modified-Since når kilden bare ga Last-Modified", async () => {
		const lastModified = "Wed, 29 Jul 2026 06:00:00 GMT";
		let calls = 0;
		serve((url, opts) => {
			if (url.endsWith("/robots.txt")) return { status: 404, body: "" };
			calls++;
			if (calls === 1) return { status: 200, headers: { "last-modified": lastModified }, body: '{"n":1}' };
			expect(opts.headers["If-Modified-Since"]).toBe(lastModified);
			return { status: 304, body: "" };
		});

		const client = new APIClient({ minHostIntervalMs: 0, cacheTimeout: 0 });
		await client.fetchJSON("https://example.test/data.json");
		const second = await client.fetchJSON("https://example.test/data.json");
		expect(second).toEqual({ n: 1 });
		expect(client.stats.notModified).toBe(1);
	});

	it("treffer cachen uten nettverk innenfor cacheTimeout", async () => {
		serveOpen({ body: '{"n":1}' });
		const client = new APIClient({ minHostIntervalMs: 0, cacheTimeout: 60000 });
		await client.fetchJSON("https://example.test/data.json");
		await client.fetchJSON("https://example.test/data.json");
		expect(dataRequests()).toHaveLength(1);
		expect(client.stats.cacheHits).toBe(1);
	});

	it("faller tilbake på gammelt cachet svar når kilden feiler", async () => {
		let calls = 0;
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 404, body: "" };
			calls++;
			return calls === 1 ? { status: 200, body: '{"n":1}' } : { status: 500, body: "boom" };
		});
		const client = new APIClient({ minHostIntervalMs: 0, cacheTimeout: 0, retries: 0 });
		await client.fetchJSON("https://example.test/data.json");
		expect(await client.fetchJSON("https://example.test/data.json")).toEqual({ n: 1 });
	});
});

// --- 2. Takt per vert ---------------------------------------------------

describe("takt per vert", () => {
	it("serialiserer parallelle forespørsler til samme vert", async () => {
		serveOpen();
		const client = new APIClient({ minHostIntervalMs: 60 });

		await Promise.all([
			client.fetchJSON("https://example.test/a.json"),
			client.fetchJSON("https://example.test/b.json"),
			client.fetchJSON("https://example.test/c.json"),
		]);

		const times = dataRequests().map(r => r.at);
		expect(times).toHaveLength(3);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(50);
		expect(times[2] - times[1]).toBeGreaterThanOrEqual(50);
		expect(client.stats.throttledMs).toBeGreaterThan(0);
	});

	it("deler takten mellom klient-instanser (fetcherne kjører parallelt)", async () => {
		serveOpen();
		const a = new APIClient({ minHostIntervalMs: 60 });
		const b = new APIClient({ minHostIntervalMs: 60 });

		await Promise.all([
			a.fetchJSON("https://example.test/a.json"),
			b.fetchJSON("https://example.test/b.json"),
		]);

		const times = dataRequests().map(r => r.at);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(50);
	});

	it("køer ikke ulike verter bak hverandre", async () => {
		serveOpen();
		const client = new APIClient({ minHostIntervalMs: 400 });
		const started = Date.now();
		await Promise.all([
			client.fetchJSON("https://en.test/a.json"),
			client.fetchJSON("https://to.test/a.json"),
		]);
		expect(Date.now() - started).toBeLessThan(300);
	});

	it("lar takten settes per vert", async () => {
		serveOpen();
		const client = new APIClient({ minHostIntervalMs: 0, hostIntervals: { "treg.test": 60 } });
		await client.fetchJSON("https://treg.test/a.json");
		await client.fetchJSON("https://treg.test/b.json");
		const times = dataRequests().map(r => r.at);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(50);
	});

	it("hever takten når robots.txt oppgir Crawl-delay", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nCrawl-delay: 0.06\n" };
			return { status: 200, body: "{}" };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });
		await client.fetchJSON("https://example.test/a.json");
		await client.fetchJSON("https://example.test/b.json");
		const times = dataRequests().map(r => r.at);
		expect(times[1] - times[0]).toBeGreaterThanOrEqual(50);
	});
});

// --- 4. robots.txt ------------------------------------------------------

describe("robots.txt", () => {
	it("blokkerer en sti som er Disallow-et, uten å sende forespørselen", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow: /privat/\n" };
			return { status: 200, body: "{}" };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });

		await expect(client.fetchJSON("https://example.test/privat/data.json")).rejects.toBeInstanceOf(RobotsDisallowedError);
		expect(dataRequests()).toHaveLength(0);
		expect(client.stats.robotsBlocked).toBe(1);
	});

	it("slipper gjennom stier som ikke er blokkert", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow: /privat/\n" };
			return { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });
		expect(await client.fetchJSON("https://example.test/apent/data.json")).toEqual({ ok: true });
	});

	it("gir ikke gammelt cachet innhold når robots blokkerer", async () => {
		let robots = "User-agent: *\nDisallow:\n";
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: robots };
			return { status: 200, body: '{"n":1}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0, cacheTimeout: 0 });
		await client.fetchJSON("https://example.test/data.json");

		resetPolitenessState(); // kilden endrer robots.txt
		robots = "User-agent: *\nDisallow: /data.json\n";
		await expect(client.fetchJSON("https://example.test/data.json")).rejects.toBeInstanceOf(RobotsDisallowedError);
	});

	it("fail-open når robots.txt feiler på nettverket", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { networkError: "ECONNRESET" };
			return { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });
		expect(await client.fetchJSON("https://example.test/data.json")).toEqual({ ok: true });
	});

	it("fail-open når robots.txt svarer 403 (som ESPN gjør)", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 403, body: "<html>403</html>" };
			return { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });
		expect(await client.fetchJSON("https://site.api.espn.test/scoreboard")).toEqual({ ok: true });
	});

	it("henter robots.txt bare én gang per vert, også ved parallelle kall", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow:\n" };
			return { status: 200, body: "{}" };
		});
		const client = new APIClient({ minHostIntervalMs: 0 });
		await Promise.all([
			client.fetchJSON("https://example.test/a.json"),
			client.fetchJSON("https://example.test/b.json"),
		]);
		await client.fetchJSON("https://example.test/c.json");
		expect(robotsRequests()).toHaveLength(1);
	});

	it("kan slås av eksplisitt", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow: /\n" };
			return { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0, respectRobots: false });
		expect(await client.fetchJSON("https://example.test/data.json")).toEqual({ ok: true });
		expect(robotsRequests()).toHaveLength(0);
	});
});

// --- Kildenes egne API-vilkår ------------------------------------------

describe("dokumenterte API-vilkår slår crawler-robots", () => {
	it("henter Liquipedias api.php selv om robots.txt Disallow-er den for crawlere", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 200, body: "User-agent: *\nDisallow: /counterstrike/api.php\n" };
			return { status: 200, body: '{"parse":{}}' };
		});
		const client = new APIClient();
		const data = await client.fetchJSON("https://liquipedia.net/counterstrike/api.php?action=parse&page=Liquipedia:Matches");
		expect(data).toEqual({ parse: {} });
		expect(client.stats.robotsBlocked).toBe(0);
	});

	it("henter Lichess' /api/ selv om robots.txt Disallow-er den for crawlere", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) {
				return { status: 200, body: "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /study/search\n" };
			}
			return { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient();
		expect(await client.fetchJSON("https://lichess.org/api/broadcast/top")).toEqual({ ok: true });
	});

	it("unntaket gjelder bare de dokumenterte stiene — resten av verten er fortsatt bundet", async () => {
		serve((url) => {
			if (url.endsWith("/robots.txt")) {
				return { status: 200, body: "User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /study/search\n" };
			}
			return { status: 200, body: "{}" };
		});
		const client = new APIClient();
		await expect(client.fetchJSON("https://lichess.org/study/search?q=x")).rejects.toBeInstanceOf(RobotsDisallowedError);
	});
});

// --- robots-parsing (ren logikk) ---------------------------------------

describe("parseRobots / rulesForAgent / robotsVerdict", () => {
	const ROBOTS = `# kommentar
User-agent: GPTBot
User-agent: ClaudeBot
Disallow: /

User-agent: *
Allow: /
Disallow: /privat/
Disallow: /*.pdf$
Crawl-delay: 2

User-agent: Sportivista
Disallow: /bare-for-oss/
`;

	it("grupperer sammenhengende User-agent-linjer og leser Crawl-delay", () => {
		const groups = parseRobots(ROBOTS);
		expect(groups).toHaveLength(3);
		expect(groups[0].agents).toEqual(["gptbot", "claudebot"]);
		expect(groups[1].crawlDelay).toBe(2);
	});

	it("velger vår egen gruppe når den finnes, ellers *", () => {
		const groups = parseRobots(ROBOTS);
		expect(rulesForAgent(groups, "Sportivista").rules).toEqual([{ allow: false, path: "/bare-for-oss/" }]);
		expect(rulesForAgent(groups, "AnnenLeser").rules.map(r => r.path)).toEqual(["/", "/privat/", "/*.pdf$"]);
	});

	it("arver ikke reglene til bots vi ikke er", () => {
		const groups = parseRobots(ROBOTS);
		const { rules } = rulesForAgent(groups, "Sportivista");
		expect(robotsVerdict(rules, "/hva-som-helst").allowed).toBe(true);
	});

	it("lar lengste treff vinne, og Allow vinne ved lik lengde", () => {
		const rules = [
			{ allow: true, path: "/" },
			{ allow: false, path: "/api/" },
			{ allow: true, path: "/api/offentlig/" },
		];
		expect(robotsVerdict(rules, "/api/data").allowed).toBe(false);
		expect(robotsVerdict(rules, "/api/offentlig/data").allowed).toBe(true);
		expect(robotsVerdict(rules, "/annet").allowed).toBe(true);
		expect(robotsVerdict([{ allow: true, path: "/x" }, { allow: false, path: "/x" }], "/x").allowed).toBe(true);
	});

	it("støtter * og $ i mønstre", () => {
		const { rules } = rulesForAgent(parseRobots(ROBOTS), "AnnenLeser");
		expect(robotsVerdict(rules, "/doc/rapport.pdf").allowed).toBe(false);
		expect(robotsVerdict(rules, "/doc/rapport.pdf?v=2").allowed).toBe(true); // $ = slutt
	});

	it("tolker tom Disallow som «alt tillatt»", () => {
		const { rules } = rulesForAgent(parseRobots("User-agent: *\nDisallow:\n"), "Sportivista");
		expect(robotsVerdict(rules, "/hva-som-helst").allowed).toBe(true);
	});

	it("tåler tomt/ugyldig innhold", () => {
		expect(parseRobots("")).toEqual([]);
		expect(parseRobots(null)).toEqual([]);
		expect(parseRobots("Disallow: /uten-agent\n")).toEqual([]);
	});
});

// --- uendret grunnatferd ------------------------------------------------

describe("retry og feilhåndtering (uendret kontrakt)", () => {
	it("prøver på nytt ved 5xx og lykkes", async () => {
		let calls = 0;
		serve((url) => {
			if (url.endsWith("/robots.txt")) return { status: 404, body: "" };
			calls++;
			return calls === 1 ? { status: 503, body: "nei" } : { status: 200, body: '{"ok":true}' };
		});
		const client = new APIClient({ minHostIntervalMs: 0, retries: 1, retryDelay: 1 });
		expect(await client.fetchJSON("https://example.test/data.json")).toEqual({ ok: true });
		expect(calls).toBe(2);
	});

	it("kaster på ugyldig JSON", async () => {
		serve((url) => (url.endsWith("/robots.txt") ? { status: 404, body: "" } : { status: 200, body: "ikke json" }));
		const client = new APIClient({ minHostIntervalMs: 0, retries: 0 });
		await expect(client.fetchJSON("https://example.test/data.json")).rejects.toThrow(/Invalid JSON/);
	});

	it("kaster på 4xx", async () => {
		serve((url) => (url.endsWith("/robots.txt") ? { status: 404, body: "" } : { status: 404, body: "borte" }));
		const client = new APIClient({ minHostIntervalMs: 0, retries: 0 });
		await expect(client.fetchJSON("https://example.test/data.json")).rejects.toThrow(/HTTP 404/);
	});
});
