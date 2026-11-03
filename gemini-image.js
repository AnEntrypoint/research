#!/usr/bin/env -S bun --bun

const path = require('path');

const args = process.argv.slice(2);
const options = { outPath: null, credsPath: path.join(__dirname, 'gemini-creds.json'), check: false, http: {} };
const valueFlags = new Set(['-o', '--out', '--creds', '--browser-version', '--curl-impersonate', '--proxy', '--timeout']);
const words = [];
for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (valueFlags.has(arg)) {
        const value = args[++i];
        if (arg === '-o' || arg === '--out') options.outPath = value;
        else if (arg === '--creds') options.credsPath = path.resolve(value);
        else if (arg === '--browser-version') options.http.browserVersion = value;
        else if (arg === '--curl-impersonate') options.http.binaryPath = path.resolve(value);
        else if (arg === '--proxy') options.http.proxy = value;
        else if (arg === '--timeout') options.http.timeoutMs = Number(value);
        continue;
    }
    if (arg === '--debug') { options.http.debug = true; continue; }
    if (arg === '--check') { options.check = true; continue; }
    if (arg === '-h' || arg === '--help') {
        console.log('Usage: bun gemini-image.js "<prompt>" [-o out.png] [--creds file] [--check]');
        process.exit(0);
    }
    words.push(arg);
}
const prompt = words.join(' ').trim();
if (!prompt && !options.check) {
    console.error('Usage: bun gemini-image.js "<prompt>" [-o out.png] [--creds file] [--check]');
    process.exit(1);
}

const run = async () => {
    const client = await import('./gemini-client.mjs');
    if (options.check) {
        const session = await client.checkGeminiSession({ credsPath: options.credsPath, ...options.http });
        console.error(`Signed in: hl=${session.hl} bl=${session.bl || '?'} f.sid=${session.hasSessionId ? 'yes' : 'no'}`);
        return null;
    }
    return client.generateGeminiImage({ prompt, outPath: options.outPath, credsPath: options.credsPath, ...options.http });
};

run()
    .then((result) => {
        if (!result) return;
        console.error(`Saved: ${result.path} (${result.bytes} bytes)`);
        console.log(result.path);
    })
    .catch((error) => {
        console.error(`Error: ${error.message}`);
        process.exitCode = 1;
    });
