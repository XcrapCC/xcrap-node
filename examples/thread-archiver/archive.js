// Save every thread from a list of X links as Markdown files in archive/.
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  Xcrap,
  XcrapConnectionError,
  XcrapError,
  XcrapNotFound,
  XcrapOptedOut,
  XcrapRateLimited,
} from '@xcrapcc/sdk';

const inputFile = process.argv[2] ?? 'urls.txt';
const outDir = process.argv[3] ?? 'archive';
const MAX_ATTEMPTS = 5;
const STATUS_LINK = /(?:x|twitter)\.com\/(\w{1,15})\/status\/(\d+)/i;

const xcrap = new Xcrap();
const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));
const exists = (file) => access(file).then(() => true, () => false);

/** Run `task`, waiting out rate limits and brief network trouble before retrying. */
async function withRetry(task, label) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      const retryable = error instanceof XcrapRateLimited || error instanceof XcrapConnectionError;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw error;
      const wait = error instanceof XcrapRateLimited ? error.retryAfter ?? 60 : 5 * attempt;
      console.log(`  ${label}: waiting ${wait}s before trying again...`);
      await sleep(wait);
    }
  }
}

async function main() {
  const lines = (await readFile(inputFile, 'utf8')).split('\n').map((line) => line.trim());
  const urls = lines.filter((line) => line && !line.startsWith('#'));
  await mkdir(outDir, { recursive: true });

  const summary = { saved: 0, skipped: 0, failed: 0 };
  for (const url of urls) {
    const match = url.match(STATUS_LINK);
    if (!match) {
      console.log(`? ${url} is not a post link, skipping`);
      summary.failed += 1;
      continue;
    }
    const [, handle, id] = match;
    const file = join(outDir, `${handle}-${id}.md`);
    if (await exists(file)) {
      console.log(`= ${file} already archived`);
      summary.skipped += 1;
      continue;
    }

    try {
      const markdown = await withRetry(() => xcrap.thread(url, { markdown: true, maxTweets: 100 }), `${handle}/${id}`);
      await writeFile(file, markdown);
      console.log(`+ ${file}`);
      summary.saved += 1;
    } catch (error) {
      summary.failed += 1;
      if (error instanceof XcrapNotFound) console.log(`x ${url}: deleted, private or never existed`);
      else if (error instanceof XcrapOptedOut) console.log(`x ${url}: the account opted out`);
      else if (error instanceof XcrapError) console.log(`x ${url}: failed (${error.status || 'network error'}), try again later`);
      else throw error;
    }
  }

  console.log(`\nDone: ${summary.saved} saved, ${summary.skipped} already there, ${summary.failed} failed.`);
  return summary.failed ? 1 : 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => { console.error(error.message); process.exitCode = 2; },
);
