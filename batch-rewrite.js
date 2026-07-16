#!/usr/bin/env node
// Batch driver: 100-page chunks (3 source files each) -> rewrite via claude.ai
// Skips first 6 source files (3 user-skipped + 3 already done).
// Processes 3 chunks in parallel with stagger; retrieves via API after stream.

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { createConversation, sendCompletion, getConversation } = require('./api.js');

const SRC_DIR = 'C:/dev/srs-mccqe1/txtout';
const OUT_DIR = path.join(__dirname, 'rewrite-out');
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const PARALLEL = 3;
const STAGGER_MS = 8000;
const RETRIEVE_DELAY_MS = 30000;
const RETRIEVE_RETRIES = 6;
const RETRIEVE_INTERVAL_MS = 30000;

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const allFiles = fs.readdirSync(SRC_DIR)
  .filter(f => /^pages_\d+-\d+\.txt$/.test(f))
  .sort();
const remaining = allFiles.slice(6); // skip first 6 (3 user + 3 done)
const chunks = [];
for (let i = 0; i < remaining.length; i += 3) {
  chunks.push(remaining.slice(i, i + 3));
}
console.error(`Total source files: ${allFiles.length}, processing ${remaining.length} -> ${chunks.length} chunks`);

const PROMPT_PREFIX = 'Rewrite the following text concisely while preserving all key information, structure, and technical detail. Output the rewritten text as plain prose, no code blocks or artifact wrappers.\n\n';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function chunkLabel(files) {
  const first = files[0].match(/pages_(\d+)-/)[1];
  const last = files[files.length - 1].match(/-(\d+)\.txt$/)[1];
  return `pages_${first}-${last}`;
}

async function processChunk(files, idx) {
  const label = chunkLabel(files);
  const outPath = path.join(OUT_DIR, `${label}.rewrite.txt`);
  const metaPath = path.join(OUT_DIR, `${label}.meta.json`);
  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 800) {
    console.error(`[${idx}] ${label} already done, skipping`);
    return { label, status: 'skipped', size: fs.statSync(outPath).size };
  }

  let body = PROMPT_PREFIX;
  for (const f of files) body += fs.readFileSync(path.join(SRC_DIR, f), 'utf8') + '\n';

  console.error(`[${idx}] ${label} (${files.length} files, ${body.length} bytes) starting...`);
  let convId;
  try {
    convId = await createConversation(MODEL);
  } catch (e) {
    console.error(`[${idx}] ${label} createConv failed:`, e.message);
    return { label, status: 'create_failed', error: e.message };
  }
  fs.writeFileSync(metaPath, JSON.stringify({ label, files, convId, model: MODEL, started: new Date().toISOString() }, null, 2));
  console.error(`[${idx}] ${label} conv: ${convId}`);

  let inlineText = '';
  try {
    const r = await sendCompletion(convId, {
      prompt: body, model: MODEL,
      humanMessageUuid: randomUUID(),
      assistantMessageUuid: randomUUID(),
      style: { type: 'default', key: 'Concise', name: 'Concise', nameKey: 'concise_style_name', prompt: 'Concise\n', summary: 'Shorter responses without sacrificing accuracy', summaryKey: 'concise_style_summary', isDefault: true },
      tools: [],
      paprikaMode: 'extended',
    });
    inlineText = r.text || '';
  } catch (e) {
    console.error(`[${idx}] ${label} completion err:`, e.message);
  }

  let finalText = inlineText;
  if (finalText.length < 200) {
    console.error(`[${idx}] ${label} inline=${finalText.length}, retrieving...`);
    await sleep(RETRIEVE_DELAY_MS);
    for (let attempt = 0; attempt < RETRIEVE_RETRIES; attempt++) {
      try {
        const c = await getConversation(convId);
        let total = '';
        for (const m of c.chat_messages || []) {
          if (m.sender !== 'assistant') continue;
          for (const b of m.content || []) if (b.type === 'text') total += b.text;
        }
        if (total.length > 200) { finalText = total; break; }
        console.error(`[${idx}] ${label} retrieve attempt ${attempt + 1}: ${total.length} chars`);
      } catch (e) {
        console.error(`[${idx}] ${label} retrieve err:`, e.message);
      }
      await sleep(RETRIEVE_INTERVAL_MS);
    }
  }

  // Strip <thinking> and unwrap <antArtifact>
  finalText = finalText.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').replace(/<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g, '$1').trim();

  fs.writeFileSync(outPath, finalText);
  console.error(`[${idx}] ${label} done: ${finalText.length} bytes`);
  return { label, status: finalText.length > 200 ? 'ok' : 'empty', size: finalText.length, convId };
}

(async () => {
  const results = [];
  // Run in waves of PARALLEL with stagger inside each wave
  for (let i = 0; i < chunks.length; i += PARALLEL) {
    const wave = chunks.slice(i, i + PARALLEL);
    const promises = [];
    for (let j = 0; j < wave.length; j++) {
      const idx = i + j + 1;
      const p = (async () => {
        await sleep(j * STAGGER_MS);
        return processChunk(wave[j], idx);
      })();
      promises.push(p);
    }
    const waveResults = await Promise.all(promises);
    results.push(...waveResults);
    console.error(`\n=== Wave ${Math.floor(i / PARALLEL) + 1} done. Cumulative: ${results.length}/${chunks.length} ===\n`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'batch-summary.json'), JSON.stringify(results, null, 2));
  console.error('\nALL DONE');
  for (const r of results) console.error(`  ${r.label}: ${r.status} ${r.size || ''}`);
})();
