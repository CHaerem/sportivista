import https from "https";
import zlib from "zlib";

/**
 * Høflighetslaget (WP-244)
 * ------------------------
 * `APIClient` er ikke en skraper — den skal oppføre seg som en veloppdragen,
 * identifiserbar leser hos tredjeparts-kilder:
 *
 *   1. Betingede forespørsler (ETag / Last-Modified → If-None-Match /
 *      If-Modified-Since). Et `304 Not Modified` returnerer cachet innhold
 *      uten ny nedlasting og uten ny parsing.
 *   2. Takt per VERT, håndhevet inne i klienten (ikke i fetcherne), og delt
 *      på tvers av alle klient-instanser i prosessen — fetcherne kjøres i
 *      parallell (`Promise.allSettled` i scripts/fetch/index.js), så per-
 *      instans-takt ville ikke hindret at én vert ble hamret.
 *   3. Ærlig, sporbar User-Agent med kontakt-URL.
 *   4. robots.txt hentes og caches per vert, og `Disallow` respekteres for
 *      stiene vi faktisk henter. Feiler robots-henting → fail-open.
 *
 * Kontrakten mot fetcherne er uendret: `fetchJSON(url, options)` returnerer
 * fortsatt parset JSON og kaster ved feil.
 */

/**
 * Ærlig identitet: navngir prosjektet og gir en kontaktvei som faktisk går til
 * et menneske. Kilder som lurer på hvem vi er skal kunne finne oss på ett søk.
 */
export const USER_AGENT =
	"Sportivista/2.0 (+https://sportivista.com; kontakt: https://github.com/CHaerem/sportivista/issues)";

/** Produkt-tokenet robots.txt-grupper matches mot (RFC 9309 «product token»). */
export const USER_AGENT_TOKEN = "Sportivista";

/** Default minste avstand mellom to forespørsler til SAMME vert. */
export const DEFAULT_HOST_INTERVAL_MS = 250;

/** Hvor lenge en robots.txt gjenbrukes før den hentes på nytt. */
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Vert-spesifikk policy — kildens EGNE publiserte vilkår, der de finnes.
 *
 * `robotsExempt` er ikke en snarvei rundt robots.txt: den dekker stier der
 * kilden selv publiserer API-vilkår som uttrykkelig tillater programmatisk
 * bruk. robots.txt regulerer crawlere; et dokumentert API regulerer API-
 * klienter, og vi er det siste. Unntaket betales med kildens egen, strengere
 * takt (`intervalMs`).
 */
const HOST_POLICY = {
	"lichess.org": {
		// Lichess driver et offentlig, dokumentert API (https://lichess.org/api)
		// som er ment for programmatisk bruk. robots.txt har `Disallow: /api/`
		// — rettet mot søkemotorer som ellers ville indeksert API-svar, ikke mot
		// API-klienter. Vi holder en konservativ takt på 1 req/s; sjakk-fetcheren
		// gjør én forespørsel per kjøring.
		intervalMs: 1000,
		robotsExempt: [/^\/api\//],
		reason: "Lichess' offentlige API (https://lichess.org/api)"
	},
	"liquipedia.net": {
		// Liquipedias API-vilkår: «action=parse» ≤ 1 request / 30 sekunder,
		// egen identifiserende User-Agent med kontaktinfo, og gzip.
		// https://liquipedia.net/api-terms-of-use
		intervalMs: 30000,
		// robots.txt har `Disallow: /<wiki>/api.php` for crawlere, mens API-
		// vilkårene over eksplisitt beskriver hvordan man SKAL bruke nettopp
		// den stien. Esports-fetcheren gjør én parse-forespørsel per kjøring.
		robotsExempt: [/^\/[^/]+\/api\.php$/],
		reason: "Liquipedia API Terms of Use (https://liquipedia.net/api-terms-of-use)"
	}
};

/**
 * Delt tilstand PER VERT for hele prosessen: takt-kø, robots-cache og
 * crawl-delay. Delt fordi høflighet er en egenskap ved verten, ikke ved
 * hvilken klient-instans som tilfeldigvis ringer.
 */
const hostRegistry = new Map();

function hostState(host) {
	let state = hostRegistry.get(host);
	if (!state) {
		state = { nextSlot: 0, robots: null, robotsPromise: null, crawlDelayMs: 0, exemptLogged: false };
		hostRegistry.set(host, state);
	}
	return state;
}

/** Nullstill delt vert-tilstand (takt-kø + robots-cache). Brukes av tester. */
export function resetPolitenessState() {
	hostRegistry.clear();
}

/** Kastes når robots.txt forbyr stien. Egen type så den ikke drukner i vanlige feil. */
export class RobotsDisallowedError extends Error {
	constructor(url, rule) {
		super(`robots.txt disallows ${url}${rule ? ` (Disallow: ${rule})` : ""}`);
		this.name = "RobotsDisallowedError";
		this.url = url;
		this.rule = rule;
	}
}

/** Decompress a response body Buffer per its Content-Encoding (identity → unchanged). */
function decodeBody(buffer, contentEncoding) {
	const enc = (contentEncoding || "").toLowerCase();
	if (!buffer.length) return buffer;
	try {
		if (enc === "gzip") return zlib.gunzipSync(buffer);
		if (enc === "deflate") return zlib.inflateSync(buffer);
		if (enc === "br") return zlib.brotliDecompressSync(buffer);
	} catch {
		// Fall back to the raw bytes if decompression fails.
	}
	return buffer;
}

// --- robots.txt ---------------------------------------------------------

/**
 * Parse robots.txt til grupper. Sammenhengende `User-agent:`-linjer deler
 * regelsett (RFC 9309). Kommentarer og ukjente felt ignoreres.
 * @returns {Array<{agents: string[], rules: Array<{allow: boolean, path: string}>, crawlDelay: number|null}>}
 */
export function parseRobots(text) {
	const groups = [];
	let current = null;
	let inAgentRun = false;

	for (const rawLine of String(text || "").split(/\r?\n/)) {
		const line = rawLine.replace(/#.*$/, "").trim();
		if (!line) continue;

		const sep = line.indexOf(":");
		if (sep < 0) continue;

		const field = line.slice(0, sep).trim().toLowerCase();
		const value = line.slice(sep + 1).trim();

		if (field === "user-agent") {
			if (!inAgentRun || !current) {
				current = { agents: [], rules: [], crawlDelay: null };
				groups.push(current);
				inAgentRun = true;
			}
			current.agents.push(value.toLowerCase());
			continue;
		}

		if (!current) continue; // regel før noen user-agent — ignorer
		inAgentRun = false;

		if (field === "allow" || field === "disallow") {
			current.rules.push({ allow: field === "allow", path: value });
		} else if (field === "crawl-delay") {
			const seconds = Number.parseFloat(value);
			if (Number.isFinite(seconds) && seconds > 0) current.crawlDelay = seconds;
		}
	}

	return groups;
}

/**
 * Velg reglene som gjelder for vårt produkt-token: en eksakt gruppe hvis den
 * finnes, ellers `*`. Ingen treff → tom liste (alt tillatt).
 */
export function rulesForAgent(groups, token = USER_AGENT_TOKEN) {
	const wanted = String(token || "").toLowerCase();
	const exact = groups.filter(g => g.agents.includes(wanted));
	const matched = exact.length > 0 ? exact : groups.filter(g => g.agents.includes("*"));
	return {
		rules: matched.flatMap(g => g.rules),
		crawlDelay: matched.reduce((max, g) => Math.max(max, g.crawlDelay || 0), 0) || null
	};
}

/** robots-sti-mønster → RegExp. Støtter `*` (jokertegn) og `$` (slutt-anker). */
function robotsPathRegex(pattern) {
	let body = pattern;
	let anchorEnd = false;
	if (body.endsWith("$")) {
		anchorEnd = true;
		body = body.slice(0, -1);
	}
	const escaped = body
		.split("*")
		.map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join(".*");
	return new RegExp(`^${escaped}${anchorEnd ? "$" : ""}`);
}

/**
 * Avgjør om `target` (pathname + search) er tillatt.
 * Mest spesifikke (lengste) mønster vinner; ved lik lengde vinner Allow.
 */
export function robotsVerdict(rules, target) {
	let best = null;

	for (const rule of rules) {
		if (!rule.path) continue; // tom `Disallow:` betyr «alt tillatt»
		let regex;
		try {
			regex = robotsPathRegex(rule.path);
		} catch {
			continue; // ulovlig mønster — ignorer heller enn å felle henting
		}
		if (!regex.test(target)) continue;

		const length = rule.path.replace(/\$$/, "").length;
		if (!best || length > best.length || (length === best.length && rule.allow)) {
			best = { length, rule };
		}
	}

	return best ? { allowed: best.rule.allow, rule: best.rule.path } : { allowed: true, rule: null };
}

// --- klienten -----------------------------------------------------------

export class APIClient {
	constructor(options = {}) {
		this.defaultHeaders = {
			"User-Agent": options.userAgent || USER_AGENT,
			...options.headers
		};
		this.retries = options.retries ?? 2;
		this.retryDelay = options.retryDelay ?? 500;
		this.timeout = options.timeout ?? 10000;
		this.cache = new Map();
		this.cacheTimeout = options.cacheTimeout ?? 60000;

		// Takt per vert
		this.minHostIntervalMs = options.minHostIntervalMs ?? DEFAULT_HOST_INTERVAL_MS;
		this.hostIntervals = options.hostIntervals || {};

		// robots.txt
		this.respectRobots = options.respectRobots !== false;
		this.robotsAgent = options.robotsAgent || USER_AGENT_TOKEN;
		this.robotsTimeout = options.robotsTimeout ?? 4000;

		// Enkel, ærlig regnskapsføring — hva sparte vi kilden for?
		this.stats = { requests: 0, cacheHits: 0, notModified: 0, robotsBlocked: 0, throttledMs: 0 };
	}

	async fetchJSON(url, options = {}) {
		const cacheKey = url;
		const cached = this.cache.get(cacheKey);

		if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
			this.stats.cacheHits++;
			return cached.data;
		}

		const headers = { ...this.defaultHeaders, ...options.headers };

		// Betinget forespørsel: la kilden svare «uendret» i stedet for å sende
		// hele kroppen på nytt.
		if (cached?.etag) headers["If-None-Match"] = cached.etag;
		if (cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;

		const retries = options.retries ?? this.retries;
		const retryDelay = options.retryDelay ?? this.retryDelay;

		try {
			const response = await this.request(url, { headers, retries, retryDelay, timeout: options.timeout });

			if (response.statusCode === 304 && cached) {
				// Uendret: gjenbruk cachet objekt — ingen ny parsing, ingen ny nedlasting.
				cached.timestamp = Date.now();
				if (response.headers.etag) cached.etag = response.headers.etag;
				this.stats.notModified++;
				return cached.data;
			}

			if (response.statusCode >= 400) {
				throw new Error(`HTTP ${response.statusCode}: ${response.body.substring(0, 100)}`);
			}

			let data;
			try {
				data = JSON.parse(response.body);
			} catch {
				throw new Error(`Invalid JSON response from ${url}`);
			}

			this.cache.set(cacheKey, {
				data,
				timestamp: Date.now(),
				etag: response.headers.etag || null,
				lastModified: response.headers["last-modified"] || null
			});
			return data;
		} catch (error) {
			// Et robots-avslag skal være entydig og synlig — ikke maskeres av
			// et gammelt cachet svar.
			if (error instanceof RobotsDisallowedError) throw error;
			if (cached) {
				console.warn(`Using stale cache for ${url} due to error:`, error.message);
				return cached.data;
			}
			throw error;
		}
	}

	/**
	 * Bakoverkompatibel lav-nivå-inngang: parset JSON, kaster på HTTP ≥ 400.
	 * Går gjennom robots-sjekk og takt som alt annet.
	 */
	async makeRequest(url, options = {}) {
		const response = await this.request(url, options);
		if (response.statusCode >= 400) {
			throw new Error(`HTTP ${response.statusCode}: ${response.body.substring(0, 100)}`);
		}
		try {
			return JSON.parse(response.body);
		} catch {
			throw new Error(`Invalid JSON response from ${url}`);
		}
	}

	/**
	 * Én logisk forespørsel: robots-sjekk → takt per vert → HTTP med retry.
	 * @returns {Promise<{statusCode: number, headers: object, body: string}>}
	 */
	async request(url, options = {}) {
		await this.assertRobotsAllows(url);
		await this.takeHostSlot(url);
		return this.requestWithRetry(url, options);
	}

	async requestWithRetry(url, options) {
		const retries = options.retries ?? this.retries;
		const retryDelay = options.retryDelay ?? this.retryDelay;

		const retry = async () => {
			await this.delay(retryDelay);
			await this.takeHostSlot(url); // en ny forespørsel er en ny forespørsel
			return this.requestWithRetry(url, { ...options, retries: retries - 1, retryDelay: retryDelay * 2 });
		};

		let response;
		try {
			response = await this.requestOnce(url, options);
		} catch (error) {
			if (retries > 0) return retry();
			throw error;
		}

		if (response.statusCode >= 500 && retries > 0) return retry();
		return response;
	}

	/** Rå HTTPS-forespørsel — ingen retry, ingen cache, ingen takt. */
	requestOnce(url, options = {}) {
		return new Promise((resolve, reject) => {
			// Advertise gzip so APIs that require it (e.g. Liquipedia returns 406
			// otherwise) work; caller headers can still override.
			const headers = {
				"Accept-Encoding": "gzip, deflate, br",
				...this.defaultHeaders,
				...options.headers
			};
			const timeout = options.timeout ?? this.timeout;
			let settled = false;
			const finish = (fn, value) => {
				if (settled) return;
				settled = true;
				fn(value);
			};

			this.stats.requests++;

			const request = https.get(url, { headers }, (response) => {
				const chunks = [];
				response.on("data", chunk => chunks.push(chunk));
				response.on("end", () => {
					// Collect as bytes and decompress — string concat corrupts both
					// gzipped bodies and multibyte UTF-8 split across chunk boundaries.
					const body = decodeBody(
						Buffer.concat(chunks),
						response.headers["content-encoding"]
					).toString("utf8");
					finish(resolve, {
						statusCode: response.statusCode,
						headers: response.headers || {},
						body
					});
				});
				response.on("error", error => finish(reject, error));
			});

			request.on("error", error => finish(reject, error));
			request.setTimeout(timeout, () => {
				request.destroy();
				finish(reject, new Error(`Request timeout after ${timeout}ms`));
			});
		});
	}

	// --- takt per vert ---

	/** Gjeldende minsteavstand for verten: policy/konfig, hevet av crawl-delay. */
	hostInterval(host) {
		const configured =
			this.hostIntervals[host] ??
			HOST_POLICY[host]?.intervalMs ??
			this.minHostIntervalMs;
		const crawlDelay = hostRegistry.get(host)?.crawlDelayMs || 0;
		return Math.max(configured, crawlDelay);
	}

	/**
	 * Reserver neste ledige tidsluke hos verten og vent på den.
	 * Reservasjonen skjer synkront (ingen await før `nextSlot` settes), så
	 * parallelle kall køes riktig i stedet for å kappes om samme luke.
	 */
	async takeHostSlot(url) {
		let host;
		try {
			host = new URL(url).host;
		} catch {
			return 0;
		}

		const interval = this.hostInterval(host);
		if (interval <= 0) return 0;

		const state = hostState(host);
		const now = Date.now();
		const start = Math.max(now, state.nextSlot);
		state.nextSlot = start + interval;

		const wait = start - now;
		if (wait > 0) {
			this.stats.throttledMs += wait;
			await this.delay(wait);
		}
		return wait;
	}

	// --- robots.txt ---

	/** Kaster `RobotsDisallowedError` hvis robots.txt forbyr stien. */
	async assertRobotsAllows(url) {
		if (!this.respectRobots) return;

		let target;
		try {
			target = new URL(url);
		} catch {
			return; // ugyldig URL — la HTTP-laget feile på vanlig vis
		}
		if (target.protocol !== "https:") return;

		const policy = HOST_POLICY[target.hostname];
		if (policy?.robotsExempt?.some(pattern => pattern.test(target.pathname))) {
			const state = hostState(target.host);
			if (!state.exemptLogged) {
				state.exemptLogged = true;
				console.log(`robots: ${target.hostname}${target.pathname} dekkes av kildens egne API-vilkår — ${policy.reason}`);
			}
			return;
		}

		const robots = await this.loadRobots(target);
		if (!robots || robots.groups.length === 0) return; // fail-open

		const { rules } = rulesForAgent(robots.groups, this.robotsAgent);
		const verdict = robotsVerdict(rules, `${target.pathname}${target.search}`);
		if (!verdict.allowed) {
			this.stats.robotsBlocked++;
			console.warn(`robots.txt hos ${target.host} forbyr ${target.pathname} (Disallow: ${verdict.rule}) — hopper over`);
			throw new RobotsDisallowedError(url, verdict.rule);
		}
	}

	/** Hent + cache robots.txt per vert. Én henting per vert per prosess. */
	loadRobots(target) {
		const state = hostState(target.host);
		if (state.robots && Date.now() - state.robots.fetchedAt < ROBOTS_TTL_MS) {
			return Promise.resolve(state.robots);
		}
		if (!state.robotsPromise) {
			state.robotsPromise = this.fetchRobots(target, state).finally(() => {
				state.robotsPromise = null;
			});
		}
		return state.robotsPromise;
	}

	async fetchRobots(target, state) {
		const url = `${target.protocol}//${target.host}/robots.txt`;
		let groups = [];

		try {
			// Bevisst UTENOM takt-køen: robots.txt er én liten forespørsel per
			// vert per prosess, og det er filen som gir oss lov til resten. Å la
			// den bruke en tidsluke ville forsinket den ekte forespørselen.
			const response = await this.requestOnce(url, {
				headers: { Accept: "text/plain" },
				timeout: this.robotsTimeout
			});
			if (response.statusCode >= 200 && response.statusCode < 300 && response.body) {
				groups = parseRobots(response.body);
			}
			// 4xx/5xx (ESPN svarer f.eks. 403 på /robots.txt) → ingen regler → fail-open.
		} catch (error) {
			// Nett-feil/timeout skal ALDRI felle pipelinen — vi henter som før.
			console.warn(`robots.txt kunne ikke hentes fra ${target.host} (${error.message}) — fortsetter`);
			groups = [];
		}

		const { crawlDelay } = rulesForAgent(groups, this.robotsAgent);
		state.crawlDelayMs = crawlDelay ? crawlDelay * 1000 : 0;
		state.robots = { groups, fetchedAt: Date.now() };
		return state.robots;
	}

	delay(ms) {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	clearCache() {
		this.cache.clear();
	}
}
