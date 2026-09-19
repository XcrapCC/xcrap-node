# XCrap Node SDK examples

Small, runnable projects built on [`@xcrapcc/sdk`](https://www.npmjs.com/package/@xcrapcc/sdk).
XCrap needs no API key, so each one works as soon as you install it.

| Example | What it does | Extra dependency |
| --- | --- | --- |
| [`cli/`](cli/) | `xcrap-cli tweet`, `thread`, `user`, `search` and `history` from your terminal, saving to CSV, Markdown or JSON | none |
| [`discord-bot/`](discord-bot/) | Turns X links into clean embeds and sends `!thread` as a Markdown file | `discord.js` v14 |
| [`telegram-bot/`](telegram-bot/) | `/tweet`, `/thread` and automatic link expansion | `grammy` |
| [`thread-archiver/`](thread-archiver/) | Saves a list of threads to `archive/<handle>-<id>.md`, waiting out rate limits | none |
| [`ai-summary/`](ai-summary/) | Builds a ready-to-send summary prompt from a thread, for any LLM | none |

## Running one

```bash
cd cli            # or any other folder
npm install
node xcrap-cli.js tweet https://x.com/jack/status/20
```

All examples need Node 18 or newer (the bots use `node --env-file`, so Node 20.6+).

## Good to know

- Every example handles the SDK's errors: `XcrapNotFound` (deleted or private),
  `XcrapRateLimited` (wait `retryAfter` seconds), `XcrapOptedOut` and
  `XcrapConnectionError`.
- Budgets are per endpoint, per IP. The full table is at <https://xcrap.cc/docs>.
- Bot tokens and AI keys are read from environment variables only. Copy
  `.env.example` to `.env` and fill it in; never commit `.env`.
