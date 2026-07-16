# research

Three CLI flows over direct HTTP, sharing the playwriter-extracted browser cookies:

1. **`research.js`** — fire a single Haiku prompt at claude.ai and stream the answer.
2. **`research-from-repo.js`** — ingest one or more GitHub repos via gitingest.com and feed the combined digest into fable (rewrite.js's concise, no-tools completion mode).
3. **`gemini-image.js`** — generate an image via gemini.google.com and save it as PNG.

## Requirements

- [Bun](https://bun.sh) or Node.js ≥18
- Chrome with the [playwriter extension](https://github.com/remorses/playwriter) active and signed in to the relevant tab (`claude.ai` for the first flow, `gemini.google.com` for the second).

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

```sh
bun refresh-gemini-auth.js                                          # capture gemini.google.com cookies → gemini-creds.json
bun gemini-image.js "an oil painting of a frog astronaut"
bun gemini-image.js "a cyberpunk city" -o city.png
```

Atomic CLI — prints the absolute output path on stdout (status goes to stderr), so it pipes:

```sh
IMG=$(bun gemini-image.js "a red sports car")
open "$IMG"
```

Re-run `bun refresh-gemini-auth.js` whenever you see "SNlM0e not found" / 401.

## creds files

`creds.json` (claude.ai) and `gemini-creds.json` (gemini.google.com) are gitignored — they hold session cookies. Never commit them.
