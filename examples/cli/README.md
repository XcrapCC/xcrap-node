# xcrap-cli (Node)

Read public X posts, threads, profiles and searches from your terminal, and export
an account's history to CSV, Markdown or JSON. No dependencies beyond the SDK.

## Setup

```bash
npm install
npm link          # optional: puts `xcrap-cli` on your PATH
```

No keys or environment variables are needed.

## Usage

```bash
node xcrap-cli.js tweet https://x.com/jack/status/20
node xcrap-cli.js thread https://x.com/jack/status/20 --max 50
node xcrap-cli.js user jack --json
node xcrap-cli.js search "from:nasa mars" --feed top --since 2026-01-01
node xcrap-cli.js history nasa --max 200 --since 2026-01-01 --out nasa.csv
```

| Flag | Works with | Meaning |
| --- | --- | --- |
| `--json` | all | Print JSON instead of Markdown |
| `--max N` | `thread`, `history` | Posts to fetch (thread 1–100, history 1–1000) |
| `--since`, `--until` | `search`, `history` | Date window, e.g. `2026-01-01` |
| `--feed` | `search` | `latest`, `top`, `photos` or `videos` |
| `--replies` | `history` | Include replies to other accounts |
| `--out FILE` | `history` | Save to `.csv`, `.md` or `.json` (format follows the extension) |

Exit codes: `0` success, `1` the API said no (not found, rate limited...), `2` bad usage.

## Example output

```text
$ node xcrap-cli.js tweet https://x.com/jack/status/20
# jack (@jack)

**2006-03-21 20:50 UTC** · [permalink](https://x.com/jack/status/20)

just setting up my twttr

308,160 likes · 124,652 reposts · 18,016 replies · 7,149 quotes · 21,381 bookmarks

$ node xcrap-cli.js history nasa --max 5 --out nasa.md
Saved to nasa.md

$ node xcrap-cli.js tweet https://x.com/jack/status/1111111111111111111
Not found: the post or account is deleted, private, suspended or never existed.
```

If you hit a rate limit, the tool tells you how long to wait:
`Slow down a little: try again in 42 seconds.`
