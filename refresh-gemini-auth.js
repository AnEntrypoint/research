#!/usr/bin/env -S bun --bun

const path = require('path');
const { runInBrowser } = require('./browser-run.js');

const valueFlags = new Set(['--creds', '--browser-version', '--curl-impersonate', '--proxy', '--timeout']);
const args = process.argv.slice(2);
const options = { credsPath: path.join(__dirname, 'gemini-creds.json'), http: {} };
for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
        const value = args[++i];
        if (value === undefined) {
            console.error(`Missing value for ${arg}`);
            process.exit(2);
        }
        if (arg === '--creds') options.credsPath = path.resolve(value);
        else if (arg === '--browser-version') options.http.browserVersion = value;
        else if (arg === '--curl-impersonate') options.http.binaryPath = path.resolve(value);
        else if (arg === '--proxy') options.http.proxy = value;
        else if (arg === '--timeout') options.http.timeoutMs = Number(value);
        continue;
    }
    if (arg === '--debug') { options.http.debug = true; continue; }
    if (arg === '-h' || arg === '--help') {
        console.log('Usage: bun refresh-gemini-auth.js [--creds file] [--browser-version v] [--curl-impersonate path] [--proxy url] [--timeout ms] [--debug]');
        process.exit(0);
    }
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
}

(async () => {
    const captured = runInBrowser(path.join(__dirname, 'gemini-browser.mjs'), 'captureGeminiCreds', { credsPath: options.credsPath });
    console.error(`Captured ${captured.path} (${captured.cookies} cookies, __Secure-1PSIDTS ${captured.hasPSIDTS ? 'yes' : 'no'})`);
    const { checkGeminiSession } = await import('./gemini-client.mjs');
    const session = await checkGeminiSession({ credsPath: options.credsPath, ...options.http });
    console.error(`Verified over cuimp (hl=${session.hl}, bl=${session.bl || '?'}, f.sid=${session.hasSessionId ? 'yes' : 'no'})`);
    console.log(captured.path);
})().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
});
