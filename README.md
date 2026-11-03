# research

Three CLI flows. All three use direct HTTP; the claude.ai and Gemini flows replay session cookies copied from the playwriter-connected browser over curl-impersonate (cuimp):

1. **`research.js`** — fire a single Haiku prompt at claude.ai and stream the answer.
2. **`research-from-repo.js`** — ingest one or more GitHub repos via gitingest.com and feed the combined digest into fable (rewrite.js's concise, no-tools completion mode).
3. **`gemini-image.js`** — generate an image on gemini.google.com over cuimp and save it as PNG.

## Requirements

- [Bun](https://bun.sh) or Node.js ≥18
- Chrome with the [playwriter extension](https://github.com/remorses/playwriter) active, and the `playwriter` CLI on PATH (`npm i -g playwriter`).
- Signed in to the relevant site in that Chrome: `claude.ai` for the first and second flows, and `gemini.google.com` when refreshing Gemini cookies (only needed once; `GEMINI_COOKIE` avoids the browser entirely).

## Claude.ai research

```sh
bun refresh-auth.js                                                # capture claude.ai cookies → creds.json
bun research.js "research all improvements for github.com/AnEntrypoint/gm"
bun retrieve.js --last-run                                         # full transcript of the last run
bun retrieve.js --latest | bun retrieve.js <conv-uuid> | bun retrieve.js --list 20
```

Optional env:
- `CLAUDE_MODEL` — default `claude-haiku-4-5-20251001`
- `THINK_BUDGET` — extended thinking tokens, default `10000` (set `0` to disable)

Re-run `bun refresh-auth.js` whenever you see 401/403.

## Repo-to-fable (gitingest + rewrite)

Ingests one or more repos through [gitingest.com](https://gitingest.com) (same fetch logic as `gitingest-batch.mjs`, shared via `gitingest-lib.mjs`) and sends the combined digest straight into fable — `rewrite.js`'s concise + thinking, no-tools completion mode — instead of a manual `--file` prompt.

```sh
bun research-from-repo.js https://github.com/octocat/Hello-World
bun research-from-repo.js https://github.com/octocat/Hello-World https://github.com/octocat/Spoon-Knife --prompt "Compare these two repos"
bun research-from-repo.js https://github.com/octocat/Hello-World --file instructions.txt
```

`gitingest-batch.mjs` still works standalone (`node gitingest-batch.mjs [-o combined.md] <repo-url> ...`) for saving raw digests to disk without invoking fable.

## Gemini image generation

Direct HTTP over curl-impersonate (cuimp) — the browser is only needed once, to capture the session cookies:

```sh
bun refresh-gemini-auth.js                                        # capture gemini.google.com cookies → gemini-creds.json
bun gemini-image.js "an oil painting of a frog astronaut"
bun gemini-image.js "a cyberpunk city" -o city.png
bun gemini-image.js --check                                       # verify the stored session
```

Atomic CLI — prints the absolute output path on stdout (status goes to stderr), so it pipes:

```sh
IMG=$(bun gemini-image.js "a red sports car")
open "$IMG"
```

Set `GEMINI_COOKIE` to skip both the browser and the creds file (e.g. in CI):

```sh
GEMINI_COOKIE='__Secure-1PSID=...; __Secure-1PSIDTS=...' bun gemini-image.js "a red sports car"
```

Re-run `refresh-gemini-auth.js` when the CLI reports stale cookies. Options: `--creds <file>`, `--browser-version <v>` (default 145), `--curl-impersonate <path>`, `--proxy <url>`, `--timeout <ms>`, `--debug`.

The HTTP logic lives in `gemini-client.mjs`; `gemini-client.test.mjs` covers frame parsing, image extraction and the full request→download pipeline. If the web API changes, `bun gemini-image.js "..." --browser` falls back to driving the playwriter browser through `gemini-browser.mjs`.

## creds files

`creds.json` (claude.ai session cookies) and `gemini-creds.json` (Gemini web session cookies for `gemini-image.js`, and optionally the API key for `gemini-transcribe.js`) are gitignored. Never commit them.
