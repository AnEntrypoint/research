#!/usr/bin/env -S bun --bun
// Generate an image on gemini.google.com in the browser playwriter controls and save it as PNG.
// Usage: bun gemini-image.js "an oil painting of a frog astronaut" [-o out.png]
// Needs Chrome with the playwriter extension active and signed in to gemini.google.com.

const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
let outPath = null;
const words = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--out') outPath = args[++i];
    else words.push(args[i]);
}
const prompt = words.join(' ').trim();
if (!prompt) { console.error('Usage: bun gemini-image.js "<prompt>" [-o out.png]'); process.exit(1); }

const dest = path.resolve(outPath || `gemini-image-${Date.now()}.png`);
const moduleUrl = pathToFileURL(path.join(__dirname, 'gemini-browser.mjs')).href;

function playwriter(cliArgs, timeout) {
    const env = { ...process.env, PLAYWRITER_EXEC_TIMEOUT: '300000' };
    if (process.platform !== 'win32') return spawnSync('playwriter', cliArgs, { encoding: 'utf8', timeout, env });
    const line = ['playwriter', ...cliArgs.map(a => `"${a.replace(/"/g, '\\"')}"`)].join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], { encoding: 'utf8', timeout, env, windowsVerbatimArguments: true });
}

const output = r => `${r.stdout || ''}${r.stderr || ''}`;

const created = playwriter(['session', 'new'], 60000);
const sessionId = output(created).split(/\r?\n/).map(s => s.trim()).filter(s => /^[\w-]+$/.test(s)).pop();
if (!sessionId) { console.error(`Could not start a playwriter session:\n${output(created).trim()}`); process.exit(1); }

let exitCode = 0;
try {
    const code = `const m = await import(${JSON.stringify(moduleUrl)}); try { console.log('GEMINI_RESULT ' + JSON.stringify(await m.generateGeminiImage({ context, prompt: ${JSON.stringify(prompt)}, outPath: ${JSON.stringify(dest)} }))); } catch (e) { console.log('GEMINI_ERROR ' + e.message); }`;
    const text = output(playwriter(['-s', sessionId, '-e', code], 330000));
    const ok = text.match(/GEMINI_RESULT (.+)/);
    const err = text.match(/GEMINI_ERROR (.+)/);
    if (!ok) throw new Error(err ? err[1] : `playwriter returned no result:\n${text.trim()}`);
    const { path: saved, bytes } = JSON.parse(ok[1]);
    console.error(`Saved: ${saved} (${bytes} bytes)`);
    console.log(saved);
} catch (e) {
    console.error(`Error: ${e.message}`);
    exitCode = 1;
} finally {
    playwriter(['session', 'delete', sessionId], 30000);
}
process.exitCode = exitCode;
