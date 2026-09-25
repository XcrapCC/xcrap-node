/**
 * @xcrapcc/sdk — the official Node client for the XCrap API (https://xcrap.cc).
 *
 * XCrap turns an X/Twitter URL into structured data — or into markdown that is
 * ready to hand to a language model. There is no authentication of any kind:
 * construct a client and call a method.
 *
 * Zero runtime dependencies: this file uses the built-in `fetch`, so Node 18+
 * is the only requirement.
 *
 * @example
 * import { Xcrap } from '@xcrapcc/sdk';
 *
 * const xcrap = new Xcrap();
 * const tweet = await xcrap.tweet('https://x.com/jack/status/20');
 * console.log(tweet.text, xcrap.rateLimit.remaining);
 */

/** The SDK version, sent in the User-Agent. */
export const VERSION = '1.3.0';

/** The XCrap API. */
export const DEFAULT_BASE_URL = 'https://xcrap.cc';

/** Every response format the API speaks. */
export const FORMATS = Object.freeze(['json', 'markdown', 'yaml', 'csv', 'html']);

/** Statuses worth one retry: they mean "upstream hiccup", not "you asked wrong". */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/** Format aliases people actually type, mapped to what the API expects. */
const FORMAT_ALIASES = new Map([
  ['md', 'markdown'],
  ['yml', 'yaml'],
  ['text/markdown', 'markdown'],
  ['application/json', 'json'],
]);

// ── Errors ────────────────────────────────────────────────────────────────

/**
 * Base class for every error the API returns.
 *
 * Catch this to catch all of them; catch a subclass to handle one case. Every
 * subclass message ends with the action that resolves it, so an error surfaced
 * to a user or an agent is already actionable.
 */
export class XcrapError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, code?: string, reason?: string, hint?: string, documentation?: string,
   *          source?: string, url?: string, body?: unknown, cause?: unknown}} [details]
   */
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = new.target.name;
    /** HTTP status the API replied with, or 0 for a transport failure. */
    this.status = details.status ?? 0;
    /** Stable machine-readable code, e.g. `not_found`, `rate_limited`. */
    this.code = details.code ?? 'error';
    /** On a `not_found` for a post, why: `post_deleted`, `author_protected`… */
    this.reason = details.reason ?? null;
    /** The API's own one-line suggestion, when it sent one. */
    this.hint = details.hint ?? null;
    /** Link to the documentation page for this failure. */
    this.documentation = details.documentation ?? 'https://xcrap.cc/docs';
    /** Which upstream produced the failure, when the API said. */
    this.source = details.source ?? null;
    /** The request URL that failed. */
    this.url = details.url ?? null;
    /** The parsed error body, if there was one. */
    this.body = details.body ?? null;
  }
}

/** 400 — the request was malformed: a missing or unparseable parameter. */
export class XcrapBadRequest extends XcrapError {}

/** 404 — the post or account is deleted, suspended, private, or never existed. */
export class XcrapNotFound extends XcrapError {}

/**
 * 429 — the per-endpoint budget for your IP is spent.
 *
 * `retryAfter` is the number of seconds to wait; `resetAt` is when the window
 * rolls over. Sleep for `retryAfter` and the next call will succeed.
 */
export class XcrapRateLimited extends XcrapError {
  constructor(message, details = {}) {
    super(message, details);
    /** Seconds to wait before retrying, from the `retry-after` header. */
    this.retryAfter = details.retryAfter ?? null;
    /** Date the current window resets, from `x-ratelimit-reset`. */
    this.resetAt = details.resetAt ?? null;
    /** The endpoint budget that was exhausted, e.g. `{name, max, window_seconds}`. */
    this.budget = details.budget ?? null;
  }
}

/** 451 — the account asked to be excluded from XCrap. Nothing will make it work. */
export class XcrapOptedOut extends XcrapError {}

/** 5xx — every upstream refused or timed out. Usually transient; retry shortly. */
export class XcrapUpstreamError extends XcrapError {}

/** The request never produced a response: DNS, TLS, socket or timeout failure. */
export class XcrapConnectionError extends XcrapError {}

/** Map a status onto the error class that carries the right advice. */
function errorClassFor(status) {
  if (status === 400) return XcrapBadRequest;
  if (status === 404) return XcrapNotFound;
  if (status === 429) return XcrapRateLimited;
  if (status === 451) return XcrapOptedOut;
  if (status >= 500) return XcrapUpstreamError;
  return XcrapError;
}

/** The "and here is what to do about it" half of every error message. */
const ADVICE = {
  400: 'Check the parameter against the API reference at https://xcrap.cc/docs — a tweet needs a URL or numeric id, a user needs a bare handle.',
  404: 'The post or account is deleted, suspended, protected, or never existed. Verify the URL in a browser; retrying will not help.',
  429: 'Wait for retryAfter seconds (the error carries it) before calling again, or spread calls out — budgets are per endpoint per IP.',
  451: 'This account opted out of XCrap. Do not retry; use a different account or ask them to opt back in at https://xcrap.cc/opt-out.',
  500: 'This is a fault on the XCrap side. It has been reported automatically; retry in a minute.',
  502: 'Every upstream source refused. This is usually transient — retry in a minute, or pass fresh: true to skip a poisoned cache entry.',
  503: 'The service is temporarily unavailable. Retry in a minute with backoff.',
  504: 'The upstream source did not answer in time. Retry in a minute; a large thread or timeline can be slow.',
};

// ── Helpers ───────────────────────────────────────────────────────────────

function normaliseFormat(value) {
  if (value == null) return null;
  const key = String(value).trim().toLowerCase();
  if (FORMATS.includes(key)) return key;
  const alias = FORMAT_ALIASES.get(key);
  if (alias) return alias;
  throw new XcrapBadRequest(
    `Unknown format ${JSON.stringify(value)}. Use one of: ${FORMATS.join(', ')}.`,
    { status: 400, code: 'bad_request' },
  );
}

/**
 * Resolve the `format` and `markdown` options into a single format value.
 * `markdown: true` is sugar for `format: 'markdown'`; an explicit format wins.
 */
function resolveFormat({ format, markdown } = {}) {
  const explicit = normaliseFormat(format);
  if (explicit) return explicit;
  if (markdown === true) return 'markdown';
  return null; // let the server default to JSON
}

/** `x-ratelimit-reset` is a unix timestamp here and a delta elsewhere; accept both. */
function toResetDate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  // Anything below ~2001 as an epoch is really "seconds from now".
  const epochSeconds = number < 1_000_000_000 ? Math.floor(Date.now() / 1000) + number : number;
  return new Date(epochSeconds * 1000);
}

/**
 * Pull the rate-limit trio out of a response.
 * @returns {import('../index.js').RateLimit|null}
 */
function readRateLimit(headers) {
  const limit = headers.get('x-ratelimit-limit') ?? headers.get('ratelimit-limit');
  const remaining = headers.get('x-ratelimit-remaining') ?? headers.get('ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset') ?? headers.get('ratelimit-reset');
  if (limit == null && remaining == null && reset == null) return null;
  return {
    limit: limit == null ? null : Number(limit),
    remaining: remaining == null ? null : Number(remaining),
    reset: reset == null ? null : Number(reset),
    resetAt: toResetDate(reset),
  };
}

/**
 * What the last response said about itself.
 *
 * Which upstream answered is deliberately not among it: the API stopped
 * publishing that, because it describes how the service is built rather than
 * anything about the post, and it is a map for whoever wants to block it.
 */
function readMeta(headers, format) {
  const tokens = headers.get('x-markdown-tokens');
  return {
    format,
    cache: headers.get('x-xcrap-cache'),
    markdownTokens: tokens == null ? null : Number(tokens),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── The client ────────────────────────────────────────────────────────────

/**
 * A client for one XCrap deployment.
 *
 * The instance is stateless apart from `rateLimit` and `lastMeta`, which are
 * refreshed after every call, so one client can be shared across a process.
 */
export class Xcrap {
  /** Response cache for `cache`: url → { value, meta, expires }. */
  #cache = new Map();

  /**
   * @param {{baseUrl?: string, timeout?: number, retries?: number,
   *          retryDelay?: number, userAgent?: string, headers?: Record<string,string>,
   *          fetch?: typeof globalThis.fetch}} [options]
   * @param {string} [options.baseUrl=https://xcrap.cc] API origin. Only change
   *   it to route requests through a proxy you control.
   * @param {number} [options.timeout=30000] Per-request timeout in milliseconds.
   * @param {number} [options.retries=1] Retries for 502/503/504 and transport
   *   failures. A 4xx is never retried.
   * @param {number} [options.retryDelay=500] Backoff before the retry, in ms.
   * @param {string} [options.userAgent] Replaces the default descriptive agent.
   * @param {Record<string,string>} [options.headers] Extra headers on every request.
   * @param {typeof globalThis.fetch} [options.fetch] Inject a fetch implementation
   *   (for tests or a proxy agent). Defaults to the global one.
   * @param {number} [options.cache=0] Keep successful GET responses in memory for
   *   this many milliseconds, so repeating a call costs no request and no rate
   *   limit. 0 turns it off. `fresh: true` always skips it.
   */
  constructor(options = {}) {
    const {
      baseUrl = DEFAULT_BASE_URL,
      timeout = 30_000,
      retries = 1,
      retryDelay = 500,
      userAgent,
      headers = {},
      fetch: fetchImpl,
      cache = 0,
    } = options;

    /** @type {string} Base URL without a trailing slash. */
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    /** @type {number} */
    this.timeout = timeout;
    /** @type {number} */
    this.retries = retries;
    /** @type {number} */
    this.retryDelay = retryDelay;
    /** @type {string} */
    this.userAgent =
      userAgent ?? `xcrap-node-sdk/${VERSION} (+https://xcrap.cc; Node/${process.versions.node})`;
    /** @type {Record<string,string>} */
    this.headers = headers;
    /** @type {typeof globalThis.fetch} */
    this.fetch = fetchImpl ?? globalThis.fetch;
    /** @type {number} Milliseconds a response stays in the in-memory cache; 0 is off. */
    this.cacheTtl = Math.max(Number(cache) || 0, 0);

    if (typeof this.fetch !== 'function') {
      throw new XcrapError(
        'No fetch implementation found. Use Node 18 or newer, or pass one as `fetch` to the constructor.',
      );
    }

    /**
     * Rate-limit state from the most recent response.
     * @type {import('../index.js').RateLimit|null}
     */
    this.rateLimit = null;
    /**
     * Provenance of the most recent response: which upstream answered, whether
     * it was cached, and the markdown token estimate.
     * @type {import('../index.js').ResponseMeta|null}
     */
    this.lastMeta = null;
  }

  // ── transport ───────────────────────────────────────────────────────────

  /**
   * Build an absolute URL for a path plus query, dropping empty values.
   * @param {string} path
   * @param {Record<string, unknown>} [query]
   * @returns {string}
   */
  buildUrl(path, query = {}) {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value == null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  /** @private Perform one HTTP round trip, with retry for 5xx and transport errors. */
  async #send(url, { method = 'GET', body = null, accept, signal } = {}) {
    const headers = {
      'user-agent': this.userAgent,
      accept: accept ?? 'application/json',
      ...this.headers,
    };
    if (body != null) headers['content-type'] = 'application/json';

    let lastError = null;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      let response;
      try {
        response = await this.fetch(url, {
          method,
          headers,
          body: body == null ? undefined : JSON.stringify(body),
          signal: signal ?? AbortSignal.timeout(this.timeout),
        });
      } catch (cause) {
        lastError = new XcrapConnectionError(
          `Could not reach ${this.baseUrl}: ${cause?.message ?? cause}. ` +
            'Check your network connection and try again.',
          { code: 'connection_failed', url, cause },
        );
        // A transport failure is safe to retry — nothing was delivered.
        if (attempt < this.retries) {
          await sleep(this.retryDelay * (attempt + 1));
          continue;
        }
        throw lastError;
      }

      this.rateLimit = readRateLimit(response.headers) ?? this.rateLimit;

      // 4xx means the caller is wrong; retrying changes nothing. Never retry it.
      if (RETRYABLE_STATUSES.has(response.status) && attempt < this.retries) {
        await sleep(this.retryDelay * (attempt + 1));
        continue;
      }
      return response;
    }
    /* c8 ignore next */
    throw lastError ?? new XcrapError('Request failed with no response.', { url });
  }

  /** @private Turn a non-OK response into the right typed error and throw it. */
  async #raise(response, url) {
    const text = await response.text().catch(() => '');
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const info = payload?.error ?? {};
    const status = response.status;
    const advice = ADVICE[status] ?? ADVICE[500];
    const fallback = text.slice(0, 200) || 'Request failed';
    const message = `${status} ${info.code ?? response.statusText}: ${info.message ?? fallback} — ${advice}`;

    const Class = errorClassFor(status);
    const details = {
      status,
      code: info.code ?? 'error',
      reason: info.reason ?? null,
      hint: info.hint ?? null,
      documentation: info.documentation ?? 'https://xcrap.cc/docs',
      url,
      body: payload ?? text ?? null,
    };

    if (Class === XcrapRateLimited) {
      const header = response.headers.get('retry-after');
      details.retryAfter = Number(header ?? info.retry_after_seconds ?? 60);
      details.resetAt = this.rateLimit?.resetAt ?? null;
      details.budget = info.endpoint_budget ?? null;
    }
    throw new Class(message, details);
  }

  /**
   * @private Issue a request and decode it in the negotiated format.
   * JSON comes back parsed; every other format comes back as a string.
   */
  async #request(path, { query = {}, method = 'GET', body = null, options = {} } = {}) {
    const format = resolveFormat(options);
    const url = this.buildUrl(path, {
      ...query,
      ...(format ? { format } : {}),
      ...(options.fresh ? { fresh: '1' } : {}),
    });

    const cacheable = method === 'GET' && this.cacheTtl > 0 && !options.fresh;
    if (cacheable) {
      const hit = this.#cache.get(url);
      if (hit && hit.expires > Date.now()) {
        this.lastMeta = { ...hit.meta, cache: 'client' };
        return structuredClone(hit.value);
      }
      if (hit) this.#cache.delete(url);
    }

    const response = await this.#send(url, {
      method,
      body,
      accept: format && format !== 'json' ? '*/*' : 'application/json',
      signal: options.signal,
    });

    if (!response.ok) await this.#raise(response, url);

    this.lastMeta = readMeta(response.headers, format ?? 'json');
    const value = format && format !== 'json' ? await response.text() : await response.json();
    if (!cacheable) return value;

    this.#cache.set(url, { value, meta: this.lastMeta, expires: Date.now() + this.cacheTtl });
    // A bounded cache: the oldest entry goes once there are more than 500.
    if (this.#cache.size > 500) this.#cache.delete(this.#cache.keys().next().value);
    return structuredClone(value);
  }

  /** Empty the in-memory response cache (see the `cache` constructor option). */
  clearCache() {
    this.#cache.clear();
  }

  // ── endpoints ───────────────────────────────────────────────────────────

  /**
   * Fetch a single post.
   *
   * @param {string} url A post URL (x.com, twitter.com, an fx/vx mirror) or a
   *   bare numeric id.
   * @param {import('../index.js').ReadOptions} [options]
   * @param {boolean} [options.markdown] Return LLM-ready markdown instead of JSON.
   * @param {'json'|'markdown'|'yaml'|'csv'|'html'} [options.format] Explicit format;
   *   wins over `markdown`.
   * @param {boolean} [options.fresh] Bypass the five-day cache and refetch.
   * @param {boolean} [options.signals] Add `signals`: the post's age, whether it
   *   is inside For You's 48-hour window, whether the author may qualify for
   *   X's new-author slot, and engagement ratios. Facts, not a ranking score.
   * @param {AbortSignal} [options.signal] Cancel the request.
   * @returns {Promise<import('../index.js').Tweet|string>} The post: text, author,
   *   metrics, media, poll, quote and entities — or a string
   *   when a non-JSON format was asked for.
   * @throws {XcrapNotFound} deleted, private or nonexistent post; `reason` says
   *   which when X does
   * @throws {XcrapOptedOut} the author opted out of XCrap
   * @throws {XcrapRateLimited} 45 requests per minute per IP exceeded
   */
  tweet(url, options = {}) {
    return this.#request('/v1/tweet', { query: { url, signals: options.signals ? 'true' : undefined }, options });
  }

  /**
   * Unroll a thread from any post in it.
   *
   * @param {string} url Any post belonging to the thread.
   * @param {import('../index.js').ThreadOptions} [options]
   * @param {number} [options.maxTweets=25] Posts to return, 1–100.
   * @param {boolean} [options.markdown] Return markdown instead of JSON.
   * @param {'json'|'markdown'|'yaml'|'csv'|'html'} [options.format]
   * @param {boolean} [options.fresh] Bypass the cache.
   * @returns {Promise<import('../index.js').Thread|string>} `root_id`, `author`,
   *   `count`, `truncated` and the ordered `tweets`.
   * @throws {XcrapRateLimited} 15 requests per minute per IP exceeded
   */
  thread(url, options = {}) {
    const maxTweets = options.maxTweets ?? options.max_tweets;
    return this.#request('/v1/thread', {
      query: { url, max_tweets: maxTweets },
      options,
    });
  }

  /**
   * Fetch a profile.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').ReadOptions} [options]
   * @returns {Promise<import('../index.js').User|string>} Profile with bio, avatar,
   *   banner, join date, verification and follower/following/post metrics.
   * @throws {XcrapNotFound} suspended or nonexistent account
   * @throws {XcrapOptedOut} the account opted out of XCrap
   */
  user(handle, options = {}) {
    return this.#request('/v1/user', { query: { handle }, options });
  }

  /**
   * Fetch one page of an account's posts, newest first.
   *
   * Paging is cursor-based: pass the `next_cursor` you were given to get the
   * following page. `userTweetsIterator` does that loop for you.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').TimelineOptions} [options]
   * @param {number} [options.count=20] Posts per page, 1–100.
   * @param {string} [options.cursor] `next_cursor` from a previous page.
   * @param {boolean} [options.excludeReplies=true] Drop replies to other people.
   * @param {boolean} [options.mediaOnly=false] Only posts carrying media.
   * @returns {Promise<import('../index.js').Timeline|string>} `handle`, `count`,
   *   `next_cursor` and `tweets`.
   * @throws {XcrapRateLimited} 15 requests per minute per IP exceeded
   */
  userTweets(handle, options = {}) {
    return this.#request('/v1/user/tweets', {
      query: {
        handle,
        count: options.count,
        cursor: options.cursor,
        exclude_replies: options.excludeReplies === undefined ? undefined : String(options.excludeReplies),
        media_only: options.mediaOnly === undefined ? undefined : String(options.mediaOnly),
      },
      options,
    });
  }

  /**
   * Walk every page of an account's posts, yielding one post at a time.
   *
   * Stops when the API stops handing back a cursor, or when `limit` posts have
   * been yielded. JSON only — a paged markdown stream would not be parseable.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').TimelineOptions & {limit?: number}} [options]
   * @param {number} [options.limit=Infinity] Stop after this many posts.
   * @yields {import('../index.js').Tweet}
   */
  async *userTweetsIterator(handle, options = {}) {
    const { limit = Infinity, ...rest } = options;
    let cursor = options.cursor ?? undefined;
    let yielded = 0;

    while (yielded < limit) {
      const page = await this.userTweets(handle, { ...rest, cursor, format: 'json' });
      for (const tweet of page.tweets ?? []) {
        yield tweet;
        yielded += 1;
        if (yielded >= limit) return;
      }
      if (!page.next_cursor || !(page.tweets ?? []).length) return;
      cursor = page.next_cursor;
    }
  }

  /**
   * Current trending topics.
   *
   * @param {import('../index.js').TrendsOptions} [options]
   * @param {number} [options.count=20] Trends to return, 1–50.
   * @returns {Promise<import('../index.js').TrendsResult|string>} `count` and a
   *   `trends` array of `{rank, name, context, posts, url}`.
   */
  trends(options = {}) {
    return this.#request('/v1/trends', { query: { count: options.count }, options });
  }

  /**
   * List every downloadable file attached to a post.
   *
   * @param {string} url A post URL or numeric id.
   * @param {import('../index.js').ReadOptions} [options]
   * @returns {Promise<import('../index.js').MediaList|string>} `tweet_id`,
   *   `tweet_url`, `author`, `count` and a `media` array where each item carries
   *   its `index`, `variants` and a ready-made `download_url`.
   * @throws {XcrapNotFound} the post has no media
   */
  media(url, options = {}) {
    return this.#request('/v1/media', { query: { url }, options });
  }

  /**
   * Download one media file's bytes.
   *
   * XCrap streams the file straight through from X; nothing is stored. Write the
   * returned bytes to disk with `fs.writeFile(result.filename, result.bytes)`.
   *
   * @param {string} url A post URL or numeric id.
   * @param {{index?: number, quality?: 'best'|'worst', signal?: AbortSignal}} [options]
   * @param {number} [options.index=0] Which attachment, in post order.
   * @param {'best'|'worst'} [options.quality='best'] Video rendition to pick.
   * @returns {Promise<{filename: string, contentType: string, contentLength: number|null,
   *   bytes: Uint8Array}>} The file, its suggested name and its media type.
   * @throws {XcrapNotFound} no media, or the index is out of range
   */
  async downloadMedia(url, options = {}) {
    const target = this.buildUrl('/v1/media/download', {
      url,
      index: options.index ?? 0,
      quality: options.quality ?? 'best',
    });
    const response = await this.#send(target, { accept: '*/*', signal: options.signal });
    if (!response.ok) await this.#raise(response, target);

    this.lastMeta = readMeta(response.headers, 'binary');
    const disposition = response.headers.get('content-disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const length = response.headers.get('content-length');

    return {
      filename: match ? match[1] : 'xcrap-download',
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: length == null ? null : Number(length),
      bytes: new Uint8Array(await response.arrayBuffer()),
    };
  }

  /**
   * Resolve up to 50 posts in one call.
   *
   * Failures are per item: one dead link returns 49 results and one error entry
   * rather than failing the batch. Bulk uses a cheaper upstream, so posts come
   * back with less detail than `tweet()` gives.
   *
   * @param {string[]} urls Post URLs or ids, at most 50.
   * @param {import('../index.js').ReadOptions & {method?: 'GET'|'POST'}} [options]
   * @param {'GET'|'POST'} [options.method=POST] POST sends a JSON body; GET puts
   *   the urls in the query string.
   * @returns {Promise<import('../index.js').BulkResult|string>} `requested`,
   *   `succeeded`, `failed` and a `results` array of `{ok, input, tweet|error}`.
   * @throws {XcrapBadRequest} empty list, or more than 50 urls
   * @throws {XcrapRateLimited} 6 requests per 5 minutes per IP exceeded
   */
  bulk(urls, options = {}) {
    const list = Array.from(urls ?? []);
    if (list.length === 0) {
      throw new XcrapBadRequest('bulk() needs at least one URL. Pass an array of post URLs or ids.', {
        status: 400,
        code: 'bad_request',
      });
    }
    if (list.length > 50) {
      throw new XcrapBadRequest(
        `bulk() accepts at most 50 URLs; you passed ${list.length}. Split the list into chunks of 50.`,
        { status: 400, code: 'bad_request' },
      );
    }
    if ((options.method ?? 'POST').toUpperCase() === 'GET') {
      return this.#request('/v1/bulk', { query: { url: list }, options });
    }
    return this.#request('/v1/bulk', { method: 'POST', body: { urls: list }, options });
  }

  /**
   * Full-text search over X posts, with X's own search operators.
   *
   * @param {string} query What to search for, e.g. `from:nasa mars`.
   * @param {import('../index.js').SearchOptions} [options]
   * @param {'latest'|'top'|'photos'|'videos'} [options.feed='latest']
   * @param {string|Date} [options.since] Oldest post to match.
   * @param {string|Date} [options.until] Newest post to match.
   * @param {string} [options.cursor] `next_cursor` from a previous page.
   * @returns {Promise<import('../index.js').SearchResult|string>} `query`,
   *   `feed`, `count`, `next_cursor` and the matching `tweets`.
   * @throws {XcrapBadRequest} empty query, unknown feed or unreadable date
   * @throws {XcrapRateLimited} 10 requests per 15 minutes per IP exceeded
   * @throws {XcrapUpstreamError} 503: search capacity is used up for now
   */
  search(query, options = {}) {
    const asDate = (value) => (value instanceof Date ? value.toISOString() : value);
    return this.#request('/v1/search', {
      query: {
        q: query,
        feed: options.feed,
        since: asDate(options.since),
        until: asDate(options.until),
        cursor: options.cursor,
      },
      options,
    });
  }

  /**
   * The direct replies to a post: the single page X serves, with no paging.
   *
   * @param {string} url The post's URL or numeric id.
   * @param {import('../index.js').RepliesOptions} [options]
   * @param {'top'|'recent'} [options.sort='top'] Most liked first, or newest first.
   * @returns {Promise<import('../index.js').Replies|string>} The post, `count`
   *   and the `replies`.
   * @throws {XcrapNotFound} deleted, private or nonexistent post
   * @throws {XcrapRateLimited} 15 requests per minute per IP exceeded
   */
  replies(url, options = {}) {
    return this.#request('/v1/replies', {
      query: { url, sort: options.sort },
      options,
    });
  }

  /**
   * One page of the accounts following an account.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').UserListOptions} [options]
   * @param {string} [options.cursor] `next_cursor` from a previous page.
   * @returns {Promise<import('../index.js').UserList|string>} `handle`,
   *   `relation`, `count`, `next_cursor` and the `users`.
   * @throws {XcrapRateLimited} 15 requests per minute per IP exceeded
   */
  followers(handle, options = {}) {
    return this.#request('/v1/user/followers', { query: { handle, cursor: options.cursor }, options });
  }

  /**
   * One page of the accounts an account follows.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').UserListOptions} [options]
   * @param {string} [options.cursor] `next_cursor` from a previous page.
   * @returns {Promise<import('../index.js').UserList|string>}
   * @throws {XcrapRateLimited} 15 requests per minute per IP exceeded
   */
  following(handle, options = {}) {
    return this.#request('/v1/user/following', { query: { handle, cursor: options.cursor }, options });
  }

  /**
   * An account's posts in bulk: up to 1,000 in one call, newest first,
   * optionally inside a date window.
   *
   * @param {string} handle A bare handle, `@handle`, or a profile URL.
   * @param {import('../index.js').HistoryOptions} [options]
   * @param {number} [options.maxPosts=200] Stop after this many posts, 1–1000.
   * @param {string|Date} [options.since] Oldest post to include.
   * @param {string|Date} [options.until] Newest post to include.
   * @param {boolean} [options.includeReplies=false] Include replies to other accounts.
   * @param {boolean} [options.includeReposts=false] Include posts the account reposted.
   * @returns {Promise<import('../index.js').AccountHistory|string>} `count`,
   *   `truncated`, the window and the `tweets`.
   * @throws {XcrapBadRequest} a date that cannot be read, or since after until
   * @throws {XcrapRateLimited} 4 requests per 5 minutes per IP exceeded
   */
  userHistory(handle, options = {}) {
    const asDate = (value) => (value instanceof Date ? value.toISOString() : value);
    return this.#request('/v1/user/history', {
      query: {
        handle,
        max_posts: options.maxPosts ?? options.max_posts,
        since: asDate(options.since),
        until: asDate(options.until),
        include_replies: options.includeReplies === undefined ? undefined : String(options.includeReplies),
        include_reposts: options.includeReposts === undefined ? undefined : String(options.includeReposts),
      },
      options,
    });
  }

}

export default Xcrap;
