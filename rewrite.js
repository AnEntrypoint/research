#!/usr/bin/env -S bun --bun
// CLI rewrite tool — claude.ai conversation with thinking + concise style, no research/tools.
// Usage: node rewrite.js "your prompt"     or    node rewrite.js --file prompt.txt
// Env:   CLAUDE_MODEL  (default: claude-opus-4-5-20250929)

const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');
const { createConversation, sendCompletion, STYLE_CONCISE } = require('./api.js');

const args = process.argv.slice(2);
let prompt;
const fileIdx = args.indexOf('--file');
if (fileIdx !== -1 && args[fileIdx + 1]) {
  prompt = fs.readFileSync(args[fileIdx + 1], 'utf8').trim();
} else {
  prompt = args.join(' ');
}
if (!prompt) { console.error('Usage: node rewrite.js "prompt"  OR  node rewrite.js --file prompt.txt'); process.exit(1); }

const model = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

console.error(`Model: ${model} (concise + thinking, no tools)`);
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
})();
