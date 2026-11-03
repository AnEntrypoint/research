#!/usr/bin/env -S bun --bun
// Generate an image on gemini.google.com in the browser playwriter controls and save it as PNG.
// Usage: bun gemini-image.js "an oil painting of a frog astronaut" [-o out.png]
// Needs Chrome with the playwriter extension active and signed in to gemini.google.com.

const path = require('path');
const { runInBrowser } = require('./browser-run.js');

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

try {
    const { path: saved, bytes } = runInBrowser(path.join(__dirname, 'gemini-browser.mjs'), 'generateGeminiImage', { prompt, outPath: dest });
    console.error(`Saved: ${saved} (${bytes} bytes)`);
    console.log(saved);
} catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
}
