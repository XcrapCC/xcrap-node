# Thread archiver (Node)

Reads a text file of post links (one per line) and saves each thread as Markdown in
`archive/<handle>-<id>.md`. Threads already in the folder are skipped, so you can
run it again whenever you add links.

When XCrap says you are going too fast, the script waits the number of seconds it
was told (`retryAfter`) and tries again, up to 5 times. Brief network trouble is
retried the same way.

## Setup

```bash
npm install
```

No keys or environment variables are needed.

## Run

```bash
node archive.js urls.txt archive
```

Both arguments are optional (`urls.txt` and `archive` are the defaults).
`urls.txt` looks like this; lines starting with `#` are ignored:

```text
# Threads worth keeping
https://x.com/jack/status/20
https://twitter.com/someone/status/1234567890123456789
```

## Example output

```text
$ node archive.js urls.txt archive
+ archive/jack-20.md
x https://x.com/jack/status/1111111111111111111: deleted, private or never existed
? not a link is not a post link, skipping

Done: 1 saved, 0 already there, 2 failed.
```

With a large list you may see a pause like
`  someone/1234567890123456789: waiting 38s before trying again...`. That is the
rate limit being respected; leave it running.

`archive/jack-20.md`:

```markdown
# Thread by jack (@jack)

1 post

---

### 1/1

**2006-03-21 20:50 UTC** · [permalink](https://x.com/jack/status/20)

just setting up my twttr
```

The script exits with `1` if any link failed, which makes it easy to use in cron
or CI.
