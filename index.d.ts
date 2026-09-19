/**
 * Type declarations for @xcrapcc/sdk.
 *
 * The response shapes below mirror `src/modules/shape.js` in the XCrap server,
 * which is the single source of truth for the API contract.
 */

// ── Response shapes ───────────────────────────────────────────────────────

/** Engagement counts. Any of them can be null when the upstream withheld it. */
export interface TweetMetrics {
  likes: number | null;
  retweets: number | null;
  replies: number | null;
  quotes: number | null;
  bookmarks: number | null;
  views: number | null;
}

/** Profile counters. */
export interface UserMetrics {
  posts: number | null;
  followers: number | null;
  following: number | null;
  likes: number | null;
  media: number | null;
}

/** An X account. */
export interface User {
  id: string | null;
  screen_name: string;
  name: string;
  /** Canonical profile URL, or null when the handle is unknown. */
  url: string | null;
  description: string;
  location: string | null;
  website: string | null;
  avatar_url: string | null;
  banner_url: string | null;
  /** Join date, as X formats it. */
  joined: string | null;
  verified: boolean;
  /** `blue`, `business`, `government`, `individual`, … */
  verified_type: string | null;
  /** True when the account is protected (followers-only). */
  protected: boolean;
  metrics: UserMetrics;
}

/** One downloadable rendition of a video or gif, best quality first. */
export interface MediaVariant {
  url: string;
  /** `mp4` is directly downloadable; `m3u8` is an HLS playlist. */
  container: 'mp4' | 'm3u8' | string;
  bitrate: number | null;
  codec: string | null;
}

/** One attachment on a post. */
export interface MediaItem {
  id: string | null;
  type: 'photo' | 'video' | 'gif' | string;
  /** Direct URL to the best rendition (originals for photos). */
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  /** Video/gif duration in seconds. */
  duration: number | null;
  /** Media type, e.g. `image/jpeg` or `video/mp4`. */
  format: string | null;
  /** Author-written alt text. */
  alt_text: string | null;
  variants: MediaVariant[];
}

/** A media item as returned by `/v1/media`, with its index and download link. */
export interface MediaListItem extends MediaItem {
  index: number;
  download_url: string;
}

/** The `/v1/media` payload. */
export interface MediaList {
  tweet_id: string;
  tweet_url: string;
  author: string | null;
  count: number;
  media: MediaListItem[];
}

export interface PollOption {
  label: string;
  votes: number;
  /** Share of the vote, rounded to one decimal. */
  percent: number | null;
}

export interface Poll {
  total_votes: number;
  ends_at: string | null;
  options: PollOption[];
}

/** A link, mention or hashtag with its character span in `text`. */
export interface Entity {
  type: 'url' | 'mention' | 'hashtag' | string;
  text: string;
  url: string;
  indices: [number, number] | number[] | null;
}

/** A post. Every field is always present; unknown values are null. */
export interface Tweet {
  id: string;
  url: string;
  text: string;
  /** BCP-47-ish language code from X. */
  lang: string | null;
  /** Creation date, as X formats it. */
  created_at: string | null;
  /** Creation time as a Unix timestamp in seconds. */
  created_timestamp: number | null;
  author: User | null;
  metrics: TweetMetrics;
  media: MediaItem[];
  poll: Poll | null;
  /** The quoted post, when this post quotes another. */
  quote: Tweet | null;
  /** Handle this post replies to. */
  replying_to: string | null;
  /** URL of the post this replies to. */
  replying_to_status: string | null;
  /** Community Note text, when one is attached. */
  community_note: string | null;
  possibly_sensitive: boolean;
  /** What X shows readers about how this post may be seen; null almost always. */
  visibility: Visibility | null;
  /** Present only when asked for with `signals: true`. */
  signals?: Signals;
  /** True for long-form posts (formerly "note tweets"). */
  is_note_tweet: boolean;
  entities: Entity[];
  /** Posting client, e.g. "Twitter for iPhone". */
  client: string | null;
  provider: string | null;
}

/** An unrolled thread. */
export interface Thread {
  root_id: string;
  author: User | null;
  count: number;
  /** True when the thread was longer than `maxTweets`. */
  truncated: boolean;
  tweets: Tweet[];
}

/** One page of an account's posts. */
export interface Timeline {
  handle: string;
  count: number;
  /** Pass back as `cursor` for the next page; null when the timeline ends. */
  next_cursor: string | null;
  tweets: Tweet[];
}

/** One page of search results. */
export interface SearchResult {
  query: string;
  feed: 'latest' | 'top' | 'photos' | 'videos';
  since: string | null;
  until: string | null;
  count: number;
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
  tweets: Tweet[];
}

/** The direct replies to a post: the single page X serves, no paging. */
export interface Replies {
  tweet_id: string;
  tweet_url: string;
  /** `top` is most liked first, `recent` is newest first. */
  sort: 'top' | 'recent';
  count: number;
  /** The post the replies are under. */
  tweet: Tweet;
  replies: Tweet[];
}

/** One page of an account's followers, or of the accounts it follows. */
export interface UserList {
  handle: string;
  relation: 'followers' | 'following';
  count: number;
  /** Pass back as `cursor` for the next page; null on the last page. */
  next_cursor: string | null;
  users: User[];
}

/** An account's posts in bulk. */
export interface AccountHistory {
  handle: string;
  count: number;
  include_replies: boolean;
  include_reposts: boolean;
  since: string | null;
  until: string | null;
  /** True when the walk stopped before the timeline or the window ran out. */
  truncated: boolean;
  /**
   * Why it stopped: `max_posts` reached, the date `window` passed, the
   * `end_of_timeline` X serves, the `page_limit`, or an `upstream_error`
   * part way (the posts collected until then are still returned).
   */
  stop_reason: 'max_posts' | 'window' | 'end_of_timeline' | 'page_limit' | 'upstream_error';
  newest: string | null;
  oldest: string | null;
  tweets: Tweet[];
}

export interface Trend {
  rank: number;
  name: string | null;
  /** Label X attaches, e.g. "Politics · Trending". */
  context: string | null;
  posts: number | null;
  url: string;
}

export interface TrendsResult {
  count: number;
  trends: Trend[];
}

/** A successful entry in a bulk response. */
export interface BulkSuccess {
  ok: true;
  input: string;
  tweet: Tweet;
}

/** A failed entry in a bulk response. */
export interface BulkFailure {
  ok: false;
  input: string;
  error: { status: number; message: string };
}

export type BulkItem = BulkSuccess | BulkFailure;

export interface BulkResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: BulkItem[];
}

/** Options for `tweet()`. */
export interface TweetOptions extends ReadOptions {
  /** Add `signals` to the post: descriptive facts about its reach, not a score. */
  signals?: boolean;
}

/**
 * Facts about a post's reach from public data (`signals: true`). Not a ranking
 * score and not a prediction.
 */
export interface Signals {
  age_seconds: number | null;
  /** Under 48 hours old, the window For You draws from. */
  in_for_you_window: boolean | null;
  /** X's reserved slot for authors with at most 1,000 followers. Home impressions are not public, so never more than "possibly". */
  new_author_slot: 'possibly_eligible' | 'not_eligible' | 'unknown';
  engagement_mix: {
    replies_per_like: number | null;
    quotes_per_like: number | null;
    reposts_per_like: number | null;
    likes_per_view: number | null;
  };
}

/** Why a post cannot be read, when X says. */
export type UnavailableReason =
  | 'post_deleted'
  | 'author_protected'
  | 'author_suspended'
  | 'withheld'
  | 'removed_by_x'
  | 'age_restricted'
  | 'unavailable';

/** X's notice and restrictions on a post it has limited. */
export interface Visibility {
  /** X's notice on the post, in X's words. */
  notice: string | null;
  notice_url: string | null;
  /** X labels the post as shown less widely. */
  reach_limited: boolean;
  /** Actions X has turned off on this post, e.g. `reply`, `repost`. */
  limited_actions: string[];
  /** Country codes where the post is withheld. */
  withheld_in: string[] | null;
}

/** The body of any non-2xx response, in whichever format was asked for. */
export interface ErrorPayload {
  error: {
    status: number;
    code: string;
    /** On a `not_found` for a post: why it cannot be read. */
    reason?: UnavailableReason;
    message: string;
    hint?: string;
    documentation?: string;
    source?: string;
    retry_after_seconds?: number;
    endpoint_budget?: { name: string; max: number; window_seconds: number };
  };
}

// ── Client types ──────────────────────────────────────────────────────────

/** Rate-limit state read from the last response's headers. */
export interface RateLimit {
  /** Requests allowed in the window for that endpoint. */
  limit: number | null;
  /** Requests left in the current window. */
  remaining: number | null;
  /** Raw `x-ratelimit-reset` value (Unix seconds). */
  reset: number | null;
  /** `reset` as a Date. */
  resetAt: Date | null;
}

/** What the last response said about itself. */
export interface ResponseMeta {
  format: string;
  /** `x-xcrap-cache`: hit, miss or bypass. */
  cache: string | null;
  /** `x-markdown-tokens`: estimated tokens, markdown responses only. */
  markdownTokens: number | null;
}

export type Format = 'json' | 'markdown' | 'yaml' | 'csv' | 'html';

/** Options accepted by every read method. */
export interface ReadOptions {
  /** Shorthand for `format: 'markdown'`. */
  markdown?: boolean;
  /** Response format; wins over `markdown`. */
  format?: Format;
  /** Bypass the cache and refetch from upstream. */
  fresh?: boolean;
  /** Cancel the request. */
  signal?: AbortSignal;
}

export interface ThreadOptions extends ReadOptions {
  /** Posts to return, 1–100. Default 25. */
  maxTweets?: number;
}

export interface TimelineOptions extends ReadOptions {
  /** Posts per page, 1–100. Default 20. */
  count?: number;
  /** `next_cursor` from a previous page. */
  cursor?: string;
  /** Drop replies to other accounts. Default true. */
  excludeReplies?: boolean;
  /** Only posts carrying media. Default false. */
  mediaOnly?: boolean;
}

export interface SearchOptions extends ReadOptions {
  /** `latest` (default), `top`, `photos` or `videos`. */
  feed?: 'latest' | 'top' | 'photos' | 'videos';
  /** Oldest post to match. */
  since?: string | Date;
  /** Newest post to match. */
  until?: string | Date;
  /** `next_cursor` from a previous page. */
  cursor?: string;
}

export interface RepliesOptions extends ReadOptions {
  /** `top` (default) or `recent`. */
  sort?: 'top' | 'recent';
}

export interface UserListOptions extends ReadOptions {
  /** `next_cursor` from a previous page. */
  cursor?: string;
}

export interface HistoryOptions extends Omit<ReadOptions, 'format'> {
  /** Stop after this many posts, 1–1000. Default 200. */
  maxPosts?: number;
  /** Oldest post to include. */
  since?: string | Date;
  /** Newest post to include. */
  until?: string | Date;
  /** Include replies to other accounts. Default false. */
  includeReplies?: boolean;
  /** Include posts the account reposted. Default false. */
  includeReposts?: boolean;
  /** Response format; `ndjson` returns one post per line as a string. */
  format?: Format | 'ndjson';
}

export interface TrendsOptions extends ReadOptions {
  /** Trends to return, 1–50. Default 20. */
  count?: number;
}

export interface BulkOptions extends ReadOptions {
  /** POST (default) sends a JSON body; GET puts the urls in the query string. */
  method?: 'GET' | 'POST';
}

export interface DownloadOptions {
  /** Which attachment, in post order. Default 0. */
  index?: number;
  /** Video rendition to pick. Default `best`. */
  quality?: 'best' | 'worst';
  signal?: AbortSignal;
}

export interface DownloadResult {
  /** Suggested filename from `content-disposition`. */
  filename: string;
  contentType: string;
  contentLength: number | null;
  bytes: Uint8Array;
}

export interface XcrapOptions {
  /** Deployment to talk to. Default `https://xcrap.cc`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Default 30000. */
  timeout?: number;
  /** Retries for 502/503/504 and transport failures. Default 1. A 4xx is never retried. */
  retries?: number;
  /** Backoff before a retry, in milliseconds. Default 500. */
  retryDelay?: number;
  /** Replaces the default descriptive User-Agent. */
  userAgent?: string;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  /** Inject a fetch implementation. Defaults to the global one. */
  fetch?: typeof globalThis.fetch;
  /**
   * Keep successful GET responses in memory for this many milliseconds, so a
   * repeated call costs no request and no rate limit. Default 0 (off).
   */
  cache?: number;
}

// ── Errors ────────────────────────────────────────────────────────────────

export interface XcrapErrorDetails {
  status?: number;
  code?: string;
  reason?: UnavailableReason | null;
  hint?: string;
  documentation?: string;
  source?: string;
  url?: string;
  body?: unknown;
  cause?: unknown;
}

/** Base class for every error the SDK throws. */
export class XcrapError extends Error {
  constructor(message: string, details?: XcrapErrorDetails);
  status: number;
  code: string;
  /** On a `not_found` for a post: why it cannot be read. Null otherwise. */
  reason: UnavailableReason | null;
  hint: string | null;
  documentation: string;
  source: string | null;
  url: string | null;
  body: unknown;
}

/** 400 — malformed request. */
export class XcrapBadRequest extends XcrapError {}
/** 404 — deleted, suspended, private or nonexistent. */
export class XcrapNotFound extends XcrapError {}
/** 451 — the account opted out of XCrap. */
export class XcrapOptedOut extends XcrapError {}
/** 5xx — every upstream refused or timed out. */
export class XcrapUpstreamError extends XcrapError {}
/** No response at all: DNS, TLS, socket or timeout failure. */
export class XcrapConnectionError extends XcrapError {}

/** 429 — the per-endpoint budget for your IP is spent. */
export class XcrapRateLimited extends XcrapError {
  /** Seconds to wait before retrying. */
  retryAfter: number | null;
  /** When the window resets. */
  resetAt: Date | null;
  /** The exhausted budget. */
  budget: { name: string; max: number; window_seconds: number } | null;
}

// ── Client ────────────────────────────────────────────────────────────────

export const VERSION: string;
export const DEFAULT_BASE_URL: string;
export const FORMATS: readonly Format[];

/** A client for one XCrap deployment. */
export class Xcrap {
  constructor(options?: XcrapOptions);

  baseUrl: string;
  timeout: number;
  retries: number;
  retryDelay: number;
  userAgent: string;
  headers: Record<string, string>;
  fetch: typeof globalThis.fetch;

  /** Rate-limit state from the most recent response. */
  rateLimit: RateLimit | null;
  /** Provenance of the most recent response. */
  lastMeta: ResponseMeta | null;

  /** Build an absolute URL for a path plus query. */
  buildUrl(path: string, query?: Record<string, unknown>): string;

  /** Fetch a single post. */
  tweet(url: string, options?: TweetOptions & { format?: 'json' }): Promise<Tweet>;
  tweet(url: string, options: TweetOptions): Promise<Tweet | string>;

  /** Unroll a thread from any post in it. */
  thread(url: string, options?: ThreadOptions & { format?: 'json' }): Promise<Thread>;
  thread(url: string, options: ThreadOptions): Promise<Thread | string>;

  /** Fetch a profile. */
  user(handle: string, options?: ReadOptions & { format?: 'json' }): Promise<User>;
  user(handle: string, options: ReadOptions): Promise<User | string>;

  /** Fetch one page of an account's posts, newest first. */
  userTweets(handle: string, options?: TimelineOptions & { format?: 'json' }): Promise<Timeline>;
  userTweets(handle: string, options: TimelineOptions): Promise<Timeline | string>;

  /** Walk every page of an account's posts, yielding one post at a time. */
  userTweetsIterator(
    handle: string,
    options?: TimelineOptions & { limit?: number },
  ): AsyncGenerator<Tweet, void, unknown>;

  /** Empty the in-memory response cache (see the `cache` option). */
  clearCache(): void;

  /** Full-text search over X posts, with X's own operators. */
  search(query: string, options?: SearchOptions & { format?: 'json' }): Promise<SearchResult>;
  search(query: string, options: SearchOptions): Promise<SearchResult | string>;

  /** One page of the direct replies to a post. */
  replies(url: string, options?: RepliesOptions & { format?: 'json' }): Promise<Replies>;
  replies(url: string, options: RepliesOptions): Promise<Replies | string>;

  /** One page of the accounts following an account. */
  followers(handle: string, options?: UserListOptions & { format?: 'json' }): Promise<UserList>;
  followers(handle: string, options: UserListOptions): Promise<UserList | string>;

  /** One page of the accounts an account follows. */
  following(handle: string, options?: UserListOptions & { format?: 'json' }): Promise<UserList>;
  following(handle: string, options: UserListOptions): Promise<UserList | string>;

  /** An account's posts in bulk, up to 1,000 per call. */
  userHistory(handle: string, options?: HistoryOptions & { format?: 'json' }): Promise<AccountHistory>;
  userHistory(handle: string, options: HistoryOptions): Promise<AccountHistory | string>;

  /** Current trending topics. */
  trends(options?: TrendsOptions & { format?: 'json' }): Promise<TrendsResult>;
  trends(options: TrendsOptions): Promise<TrendsResult | string>;

  /** List every downloadable file attached to a post. */
  media(url: string, options?: ReadOptions & { format?: 'json' }): Promise<MediaList>;
  media(url: string, options: ReadOptions): Promise<MediaList | string>;

  /** Download one media file's bytes. */
  downloadMedia(url: string, options?: DownloadOptions): Promise<DownloadResult>;

  /** Resolve up to 50 posts in one call. */
  bulk(urls: string[], options?: BulkOptions & { format?: 'json' }): Promise<BulkResult>;
  bulk(urls: string[], options: BulkOptions): Promise<BulkResult | string>;

}

export default Xcrap;
