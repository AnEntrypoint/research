# research

Two CLI flows over direct HTTP, sharing the playwriter-extracted browser cookies:

1. **`research.js`** — fire a single Haiku prompt at claude.ai and stream the answer.
2. **`gemini-image.js`** — generate an image via gemini.google.com and save it as PNG.

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
