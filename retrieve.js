#!/usr/bin/env -S bun --bun
// Retrieve claude.ai conversations via direct HTTP.
// Usage: node retrieve.js <conv-uuid>     — fetch full conversation
//        node retrieve.js --latest        — fetch most recent conversation
//        node retrieve.js --list [N]      — list N most recent conversations
//        node retrieve.js --last-run      — fetch conversation from last research.js run

const fs = require('fs');
const path = require('path');
const { getConversation, listConversations } = require('./api.js');

const arg = process.argv[2];
if (!arg) { console.error('Usage: node retrieve.js <conv-uuid> | --latest | --last-run | --list [N]'); process.exit(1); }

function printConversation(conv) {
  console.error(`Conversation: ${conv.uuid}`);
  console.error(`Name: ${conv.name || '(untitled)'}`);
  console.error(`Model: ${conv.model}`);
  console.error(`Created: ${conv.created_at}\n`);

  for (const msg of conv.chat_messages || []) {
    const role = msg.sender === 'human' ? 'USER' : 'ASSISTANT';
    console.log(`--- ${role} ---`);
    for (const block of msg.content || []) {
      if (block.type === 'text' && block.text?.trim()) console.log(block.text);
      else if (block.type === 'thinking' && block.thinking) { console.log('[Thinking]'); console.log(block.thinking); console.log('[/Thinking]'); }
      else if (block.type === 'tool_use') console.log(`[Tool: ${block.name}] ${JSON.stringify(block.input).substring(0, 200)}`);
      else if (block.type === 'tool_result') console.log(`[Tool Result] ${JSON.stringify(block.content).substring(0, 200)}`);
    }
    console.log();
  }
}

(async () => {
  try {
    if (arg === '--list') {
      const n = parseInt(process.argv[3] || '10', 10);
      const data = await listConversations(n);
      for (const c of data) {
        const date = new Date(c.created_at).toLocaleString();
        console.log(`${c.uuid}  ${date}  [${c.model}]  ${c.name || '(untitled)'}`);
      }
    } else {
      let convId = arg;
      if (arg === '--latest') {
        const list = await listConversations(1);
        convId = list[0]?.uuid;
        if (!convId) { console.error('No conversations found'); process.exit(1); }
      } else if (arg === '--last-run') {
        const lastRunPath = path.join(__dirname, '.last-run');
        if (!fs.existsSync(lastRunPath)) { console.error('No last run found. Run research.js first.'); process.exit(1); }
        convId = fs.readFileSync(lastRunPath, 'utf8').trim();
      }
      const conv = await getConversation(convId);
      printConversation(conv);
    }
  } catch (e) {
    console.error('Error:', e.message);
    if (/40[13]/.test(e.message)) console.error('Session expired. Run: bun refresh-auth.js');
    process.exit(1);
  }
})();
