#!/usr/bin/env -S bun --bun
// Capture gemini.google.com session cookies from the playwriter-connected browser into
// gemini-creds.json. Needs Chrome with the playwriter extension active and signed in to
// gemini.google.com. Re-run when gemini-image.js reports stale cookies.
// Usage: bun refresh-gemini-auth.js [--creds gemini-creds.json]

const path = require('path');
const { runInBrowser } = require('./browser-run.js');

const args = process.argv.slice(2);
const flagIndex = args.findIndex((arg) => arg === '--creds');
const credsPath = path.resolve(flagIndex === -1 ? path.join(__dirname, 'gemini-creds.json') : args[flagIndex + 1]);

try {
    const result = runInBrowser(path.join(__dirname, 'gemini-browser.mjs'), 'captureGeminiCreds', { credsPath });
    console.error(`Refreshed ${result.path} (${result.cookies} cookies, __Secure-1PSIDTS ${result.hasPSIDTS ? 'yes' : 'no'})`);
    console.log(result.path);
} catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
}
