#!/usr/bin/env -S bun --bun
// Capture claude.ai cookies and user agent from the playwriter-connected browser into creds.json.
// Usage: bun refresh-auth.js
// Needs Chrome with the playwriter extension active and signed in to claude.ai.

const path = require('path');
const { runInBrowser } = require('./browser-run.js');

try {
    const r = runInBrowser(path.join(__dirname, 'claude-browser.mjs'), 'refreshClaudeCreds', { credsPath: path.join(__dirname, 'creds.json') });
    console.error(`Refreshed ${r.path} (org ${r.orgId}, ${r.cookies} cookies, cf_clearance ${r.hasCfClearance ? 'yes' : 'no'})`);
    console.log(r.path);
} catch (e) {
    console.error(`Error: ${e.message}`);
    process.exitCode = 1;
}
