#!/usr/bin/env -S bun --bun
// CLI research tool — creates a claude.ai conversation and runs a prompt via direct HTTP.
// Cookies come from creds.json (refresh with: bun refresh-auth.js).
//
// Usage: node research.js "your prompt"     or    node research.js --file prompt.txt
// Env:   CLAUDE_MODEL  (default: claude-haiku-4-5-20251001)

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { createConversation, sendCompletion } = require('./api.js');

const args = process.argv.slice(2);
let prompt;
const fileIdx = args.indexOf('--file');
if (fileIdx !== -1 && args[fileIdx + 1]) {
  prompt = fs.readFileSync(args[fileIdx + 1], 'utf8').trim();
} else {
  prompt = args.join(' ');
}
if (!prompt) { console.error('Usage: node research.js "prompt"  OR  node research.js --file prompt.txt'); process.exit(1); }

const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

console.error(`Model: ${model}`);
console.error(`Prompt: ${prompt.slice(0, 200)}${prompt.length > 200 ? '...' : ''}\n`);

(async () => {
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
    });
    if (think) { console.error('--- Thinking ---'); console.error(think); console.error('---\n'); }
    if (text) console.log(text);
    else console.error('(no text response — may still be generating; retrieve later with: node retrieve.js', convId, ')');
  } catch (e) {
    console.error('Completion failed:', e.message);
    console.error(`Conversation exists — retrieve later: node retrieve.js ${convId}`);
    process.exit(1);
  }
})();
