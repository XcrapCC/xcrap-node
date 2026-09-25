/**
 * Smoke test for @xcrapcc/sdk against a live XCrap server.
 *
 *   node --test test.js                        # hits https://xcrap.cc
 *
 * These are integration tests on purpose: the point of an SDK smoke test is to
 * prove the client and a real deployment still agree about the contract.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Xcrap,
  XcrapBadRequest,
  XcrapNotFound,
  XcrapConnectionError,
  VERSION,
  DEFAULT_BASE_URL,
} from './src/index.js';

const baseUrl = process.env.XCRAP_BASE_URL ?? DEFAULT_BASE_URL;
const TWEET = process.env.XCRAP_TEST_TWEET ?? 'https://x.com/jack/status/20';
const HANDLE = process.env.XCRAP_TEST_HANDLE ?? 'jack';

const xcrap = new Xcrap({ baseUrl, timeout: 45_000 });

test('constructor defaults and overrides', () => {
  assert.equal(new Xcrap().baseUrl, 'https://xcrap.cc');
  assert.equal(new Xcrap({ baseUrl: 'https://proxy.example.org/' }).baseUrl, 'https://proxy.example.org');
  assert.match(xcrap.userAgent, new RegExp(`xcrap-node-sdk/${VERSION}`));
});

test('buildUrl drops empty values and encodes the rest', () => {
  const url = xcrap.buildUrl('/v1/tweet', { url: TWEET, count: undefined, cursor: '' });
  assert.ok(url.startsWith(`${baseUrl}/v1/tweet?url=`));
  assert.ok(!url.includes('cursor'));
});

test('rate-limit headers are exposed after a call', async () => {
  await xcrap.tweet(TWEET);
  assert.ok(xcrap.rateLimit, 'rateLimit should be populated');
  assert.equal(typeof xcrap.rateLimit.limit, 'number');
  assert.equal(typeof xcrap.rateLimit.remaining, 'number');
  assert.ok(xcrap.rateLimit.resetAt instanceof Date);
  console.log(
    `  rate limit: ${xcrap.rateLimit.remaining}/${xcrap.rateLimit.limit} left, resets ${xcrap.rateLimit.resetAt.toISOString()}`,
  );
});

test('tweet() returns the canonical shape', async () => {
  const tweet = await xcrap.tweet(TWEET);
  assert.equal(typeof tweet.id, 'string');
  assert.equal(typeof tweet.text, 'string');
  assert.ok('metrics' in tweet && 'likes' in tweet.metrics);
  assert.ok(Array.isArray(tweet.media));
  assert.ok(tweet.author?.screen_name);
  console.log(`  tweet ${tweet.id} by @${tweet.author.screen_name}: ${JSON.stringify(tweet.text.slice(0, 40))}`);
  console.log(`  provenance: source=${xcrap.lastMeta.source} cache=${xcrap.lastMeta.cache}`);
});

test('markdown: true returns markdown plus a token estimate', async () => {
  const markdown = await xcrap.tweet(TWEET, { markdown: true });
  assert.equal(typeof markdown, 'string');
  assert.ok(markdown.length > 0);
  assert.equal(xcrap.lastMeta.format, 'markdown');
  assert.ok(xcrap.lastMeta.markdownTokens > 0);
  console.log(`  markdown: ${markdown.length} chars, ~${xcrap.lastMeta.markdownTokens} tokens`);
});

test('format: yaml returns a yaml string', async () => {
  const yaml = await xcrap.tweet(TWEET, { format: 'yaml' });
  assert.equal(typeof yaml, 'string');
  assert.match(yaml, /^id:/m);
});

test('user() returns a profile with metrics', async () => {
  const user = await xcrap.user(HANDLE);
  assert.equal(user.screen_name.toLowerCase(), HANDLE.toLowerCase());
  assert.equal(typeof user.metrics.followers, 'number');
  assert.equal(user.url, `https://x.com/${user.screen_name}`);
  console.log(`  @${user.screen_name}: ${user.metrics.followers.toLocaleString()} followers`);
});

test('userTweets() pages with a cursor', async () => {
  const page = await xcrap.userTweets(HANDLE, { count: 5 });
  assert.equal(page.handle.toLowerCase(), HANDLE.toLowerCase());
  assert.ok(Array.isArray(page.tweets));
  assert.ok(page.tweets.length <= 5);
  assert.ok(page.next_cursor === null || typeof page.next_cursor === 'string');
  console.log(`  timeline: ${page.count} posts, next_cursor ${page.next_cursor ? 'present' : 'null'}`);
});

test('userTweetsIterator() yields individual posts', async () => {
  const seen = [];
  for await (const tweet of xcrap.userTweetsIterator(HANDLE, { count: 5, limit: 3 })) {
    seen.push(tweet.id);
  }
  assert.ok(seen.length <= 3);
  console.log(`  iterated ${seen.length} posts`);
});

test('thread() unrolls and reports truncation', async () => {
  const thread = await xcrap.thread(TWEET, { maxTweets: 5 });
  assert.equal(typeof thread.root_id, 'string');
  assert.ok(Array.isArray(thread.tweets));
  assert.equal(thread.count, thread.tweets.length);
  assert.equal(typeof thread.truncated, 'boolean');
  console.log(`  thread ${thread.root_id}: ${thread.count} posts, truncated=${thread.truncated}`);
});

test('trends() returns a ranked list', async () => {
  const trends = await xcrap.trends({ count: 5 });
  assert.equal(typeof trends.count, 'number');
  assert.ok(Array.isArray(trends.trends));
  console.log(`  trends: ${trends.count} returned`);
});

test('media() lists attachments with download urls', async () => {
  const media = await xcrap.media(TWEET).catch((error) => error);
  if (media instanceof XcrapNotFound) {
    console.log('  media: this post has none (404 as expected)');
    return;
  }
  assert.equal(typeof media.tweet_id, 'string');
  assert.ok(Array.isArray(media.media));
  for (const item of media.media) assert.ok(item.download_url.includes('/v1/media/download'));
  console.log(`  media: ${media.count} item(s)`);
});

test('bulk() resolves several posts and reports per-item failures', async () => {
  const result = await xcrap.bulk([TWEET, 'https://x.com/jack/status/1111111111111111111']);
  assert.equal(result.requested, 2);
  assert.equal(result.succeeded + result.failed, 2);
  assert.ok(result.results.every((item) => 'ok' in item && 'input' in item));
  console.log(`  bulk: ${result.succeeded} ok, ${result.failed} failed`);
});

test('bulk() rejects an oversized list before touching the network', () => {
  assert.throws(() => xcrap.bulk(new Array(51).fill(TWEET)), XcrapBadRequest);
  assert.throws(() => xcrap.bulk([]), XcrapBadRequest);
});

test('a missing parameter raises XcrapBadRequest with advice', async () => {
  await assert.rejects(
    () => xcrap.tweet(''),
    (error) => {
      assert.ok(error instanceof XcrapBadRequest);
      assert.equal(error.status, 400);
      assert.equal(error.code, 'bad_request');
      assert.match(error.message, /Check the parameter/);
      console.log(`  400 -> ${error.message.slice(0, 90)}…`);
      return true;
    },
  );
});

test('a dead post raises XcrapNotFound with advice', async () => {
  await assert.rejects(
    () => xcrap.tweet('https://x.com/jack/status/1111111111111111111'),
    (error) => {
      assert.ok(error instanceof XcrapNotFound);
      assert.equal(error.status, 404);
      assert.match(error.message, /retrying will not help/);
      // Why, when X says; `unavailable` when it does not.
      assert.ok(['post_deleted', 'author_protected', 'author_suspended', 'withheld', 'removed_by_x', 'age_restricted', 'unavailable'].includes(error.reason), error.reason);
      console.log(`  404 -> ${error.message.slice(0, 90)}…`);
      return true;
    },
  );
});

test('an unreachable host raises XcrapConnectionError, not a bare TypeError', async () => {
  const broken = new Xcrap({ baseUrl: 'http://127.0.0.1:1', timeout: 2000, retries: 0 });
  await assert.rejects(() => broken.tweet(TWEET), XcrapConnectionError);
});

test('search, replies, followers, following and userHistory build the right requests', async () => {
  const seen = [];
  const stub = new Xcrap({
    baseUrl: 'http://example.invalid',
    retries: 0,
    fetch: async (url) => {
      seen.push(new URL(url));
      return new Response(JSON.stringify({ tweets: [], users: [], replies: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await stub.search('from:nasa mars', { feed: 'top', since: new Date('2026-01-01T00:00:00Z'), cursor: 'c1' });
  await stub.replies('https://x.com/jack/status/20', { sort: 'recent' });
  await stub.followers('jack', { cursor: 'f1' });
  await stub.following('@jack');
  await stub.userHistory('jack', { maxPosts: 50, includeReplies: true });

  assert.deepEqual(seen.map((url) => url.pathname), ['/v1/search', '/v1/replies', '/v1/user/followers', '/v1/user/following', '/v1/user/history']);
  const [search, replies, followers, , history] = seen.map((url) => url.searchParams);
  assert.equal(search.get('q'), 'from:nasa mars');
  assert.equal(search.get('feed'), 'top');
  assert.equal(search.get('since'), '2026-01-01T00:00:00.000Z');
  assert.equal(search.get('cursor'), 'c1');
  assert.equal(replies.get('sort'), 'recent');
  assert.equal(followers.get('cursor'), 'f1');
  assert.equal(history.get('max_posts'), '50');
  assert.equal(history.get('include_replies'), 'true');
});

test('search() returns a page of posts, or says capacity is spent', async () => {
  const page = await xcrap.search('from:nasa', { feed: 'latest' }).catch((error) => error);
  if (page instanceof Error) {
    assert.equal(page.status, 503, `search failed with ${page.status}: ${page.message}`);
    console.log('  search: 503, capacity spent or not configured on this deployment');
    return;
  }
  assert.ok(Array.isArray(page.tweets));
  assert.equal(page.count, page.tweets.length);
  assert.equal(page.feed, 'latest');
  assert.ok(page.next_cursor === null || typeof page.next_cursor === 'string');
  console.log(`  search: ${page.count} posts, next_cursor ${page.next_cursor ? 'present' : 'null'}`);
});

test('a 4xx is never retried, a 503 is retried once', async () => {
  const calls = [];
  const stub = new Xcrap({
    baseUrl: 'http://example.invalid',
    retries: 1,
    retryDelay: 1,
    fetch: async (url) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const status = calls.length === 1 && path === '/v1/user' ? 503 : 404;
      return new Response(JSON.stringify({ error: { status, code: 'x', message: 'stub' } }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await assert.rejects(() => stub.user('naval'), XcrapNotFound); // 503 retried, then 404
  assert.equal(calls.length, 2, '503 should be retried exactly once');

  calls.length = 0;
  await assert.rejects(() => stub.tweet('x'), XcrapNotFound);
  assert.equal(calls.length, 1, '404 must never be retried');
});
