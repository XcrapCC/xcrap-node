#!/usr/bin/env node
// xcrap-cli: read public X posts, threads, profiles and searches from your terminal.
import { writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  Xcrap,
  XcrapBadRequest,
  XcrapConnectionError,
  XcrapError,
  XcrapNotFound,
  XcrapOptedOut,
  XcrapRateLimited,
} from '@xcrapcc/sdk';

const USAGE = `Usage:
  xcrap-cli tweet <url> [--json]
  xcrap-cli thread <url> [--max 50] [--json]
  xcrap-cli user <handle> [--json]
  xcrap-cli search "<query>" [--feed latest|top|photos|videos] [--since 2026-01-01] [--until 2026-02-01] [--json]
  xcrap-cli history <handle> [--max 200] [--since 2026-01-01] [--until 2026-02-01] [--replies] [--out posts.csv|.md|.json]

Output is Markdown unless you pass --json (or --out with a .json file).`;

const BOOLEAN_FLAGS = new Set(['json', 'replies', 'help']);

/** Split argv into positional words and --flags, with no dependency. */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split('=', 2);
    if (BOOLEAN_FLAGS.has(name)) flags[name] = true;
    else if (inline !== undefined) flags[name] = inline;
    else if (i + 1 < argv.length) flags[name] = argv[(i += 1)];
    else throw new Error(`--${name} needs a value.`);
  }
  return { positional, flags };
}

/** Pick the response format from the --out extension, or from --json. */
function formatFor(flags) {
  if (flags.out) {
    const ext = extname(flags.out).toLowerCase();
    const byExt = { '.csv': 'csv', '.md': 'markdown', '.json': 'json' };
    if (!byExt[ext]) throw new Error('--out must end in .csv, .md or .json.');
    return byExt[ext];
  }
  return flags.json ? 'json' : 'markdown';
}

const toText = (result) => (typeof result === 'string' ? result : JSON.stringify(result, null, 2));

async function run(xcrap, command, target, flags) {
  const format = formatFor(flags);
  const max = flags.max ? Number(flags.max) : undefined;
  switch (command) {
    case 'tweet':
      return xcrap.tweet(target, { format });
    case 'thread':
      return xcrap.thread(target, { format, maxTweets: max });
    case 'user':
      return xcrap.user(target, { format });
    case 'search':
      return xcrap.search(target, { format, feed: flags.feed, since: flags.since, until: flags.until });
    case 'history':
      return xcrap.userHistory(target, {
        format,
        maxPosts: max,
        since: flags.since,
        until: flags.until,
        includeReplies: flags.replies ? true : undefined,
      });
    default:
      throw new Error(`Unknown command "${command}".`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  const { positional, flags } = parsed;
  const [command, target] = positional;
  if (flags.help || !command || !target) {
    console.log(USAGE);
    return flags.help ? 0 : 2;
  }

  const xcrap = new Xcrap();
  try {
    const text = toText(await run(xcrap, command, target, flags));
    if (flags.out) {
      await writeFile(flags.out, text.endsWith('\n') ? text : `${text}\n`);
      console.error(`Saved to ${flags.out}`);
    } else {
      console.log(text);
    }
    return 0;
  } catch (error) {
    if (error instanceof XcrapNotFound) {
      console.error('Not found: the post or account is deleted, private, suspended or never existed.');
    } else if (error instanceof XcrapRateLimited) {
      console.error(`Slow down a little: try again in ${error.retryAfter} seconds.`);
    } else if (error instanceof XcrapOptedOut) {
      console.error('This account asked not to be available through XCrap.');
    } else if (error instanceof XcrapBadRequest) {
      console.error('That did not look right: check the link, handle or dates and try again.');
    } else if (error instanceof XcrapConnectionError) {
      console.error('Could not reach XCrap. Check your internet connection and try again.');
    } else if (error instanceof XcrapError) {
      console.error(`XCrap could not answer right now (${error.status}). Please retry in a minute.`);
    } else {
      console.error(`${error.message}\n\n${USAGE}`);
      return 2;
    }
    return 1;
  }
}

process.exitCode = await main();
