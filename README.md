# research

Three CLI flows. The claude.ai and gitingest flows use direct HTTP with cookies copied from the playwriter-connected browser. The Gemini flow drives that browser directly:

1. **`research.js`** — fire a single Haiku prompt at claude.ai and stream the answer.
2. **`research-from-repo.js`** — ingest one or more GitHub repos via gitingest.com and feed the combined digest into fable (rewrite.js's concise, no-tools completion mode).
3. **`gemini-image.js`** — generate an image on gemini.google.com in the local browser and save it as PNG.

## Requirements

- [Bun](https://bun.sh) or Node.js ≥18
- Chrome with the [playwriter extension](https://github.com/remorses/playwriter) active, and the `playwriter` CLI on PATH (`npm i -g playwriter`).
- Signed in to the relevant site in that Chrome: `claude.ai` for the first and second flows, `gemini.google.com` for the third.

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

No cookies to extract or refresh: the prompt is typed into the gemini.google.com tab of the playwriter browser, and the generated image is downloaded from that page.

```sh
bun gemini-image.js "an oil painting of a frog astronaut"
bun gemini-image.js "a cyberpunk city" -o city.png
```

Atomic CLI — prints the absolute output path on stdout (status goes to stderr), so it pipes:

```sh
IMG=$(bun gemini-image.js "a red sports car")
open "$IMG"
```

The browser logic lives in `gemini-browser.mjs`, which an agent can also load directly through `playwriter` execute: `const { generateGeminiImage } = await import('<abs path>/gemini-browser.mjs')`. If Gemini says it is signed out, sign in at gemini.google.com in that Chrome and re-run. Gemini's page layout can change; the selectors are all in `gemini-browser.mjs`.

## creds files

`creds.json` (claude.ai session cookies) and `gemini-creds.json` (Gemini API key for `gemini-transcribe.js`) are gitignored. Never commit them.
