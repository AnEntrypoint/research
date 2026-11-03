#!/usr/bin/env -S bun --bun
// Alternate research flow — ingest one or more repos via gitingest.com, then feed the
// combined digest into fable (rewrite.js's concise + thinking, no-tools completion).
// Usage: node research-from-repo.js <repo-url> [repo-url ...] [--prompt "instruction"] [--file prompt.txt]
// Env:   CLAUDE_MODEL  (default: claude-haiku-4-5-20251001)

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { createConversation, sendCompletion, STYLE_CONCISE } = require('./api.js');

const DEFAULT_INSTRUCTION = 'Summarize and rewrite the following repository digest concisely, preserving key structure and technical detail.';
const WARN_DIGEST_BYTES = 2_000_000; // ~500k tokens ballpark; warn, never truncate silently

async function main() {
  const { ingestOne } = await import('./gitingest-lib.mjs');

  const args = process.argv.slice(2);
  const repos = [];
  let instruction = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt') {
      instruction = args[++i];
    } else if (args[i] === '--file') {
      instruction = fs.readFileSync(args[++i], 'utf8').trim();
    } else {
      repos.push(args[i]);
    }
  }

  if (repos.length === 0) {
    console.error('Usage: node research-from-repo.js <repo-url> [repo-url ...] [--prompt "instruction"] [--file prompt.txt]');
    process.exit(1);
  }
  if (!instruction) instruction = DEFAULT_INSTRUCTION;

  const digestParts = [];
  for (const repoUrl of repos) {
    try {
      console.error(`Ingesting ${repoUrl} ...`);
      const text = await ingestOne(repoUrl);
      digestParts.push(`# ${repoUrl}\n\n${text}`);
      console.error(`  -> collected (${text.length} chars)`);
    } catch (err) {
      console.error(`  ! ${err.message}`);
    }
  }

  if (digestParts.length === 0) {
    console.error('All repo ingests failed — nothing to send to fable.');
    process.exit(1);
  }

  const digest = digestParts.join('\n\n---\n\n');
  const prompt = `${instruction}\n\n${digest}`;
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > WARN_DIGEST_BYTES) {
    console.error(`Warning: combined digest is ${(promptBytes / 1e6).toFixed(1)} MB — this may exceed the model's context window.`);
  }

  const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
  console.error(`Model: ${model} (concise + thinking, no tools)`);
  console.error(`Repos: ${repos.join(', ')}`);
  console.error(`Prompt: ${promptBytes} bytes\n`);

  let convId;
  try {
    convId = await createConversation(model);
  } catch (e) {
    console.error('Create failed:', e.message);
    if (/40[13]/.test(e.message)) console.error('Session expired. Run: bun refresh-auth.js');
    process.exit(1);
  }
  console.error(`Conversation: ${convId}`);
  fs.writeFileSync(path.join(__dirname, '.last-run'), convId);

  try {
    const { text, think } = await sendCompletion(convId, {
      prompt, model,
      humanMessageUuid: randomUUID(),
      assistantMessageUuid: randomUUID(),
      style: STYLE_CONCISE,
      tools: [],
      paprikaMode: 'extended',
    });
    if (think) { console.error('--- Thinking ---'); console.error(think); console.error('---\n'); }
    if (text) console.log(text);
    else console.error('(no text response — may still be generating; retrieve later with: node retrieve.js', convId, ')');
  } catch (e) {
    console.error('Completion failed:', e.message);
    console.error(`Conversation exists — retrieve later: node retrieve.js ${convId}`);
    process.exit(1);
  }
}

main();
