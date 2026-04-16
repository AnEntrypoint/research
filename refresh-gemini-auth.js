#!/usr/bin/env -S bun --bun
// Refresh gemini-creds.json by extracting __Secure-1PSID and __Secure-1PSIDTS
// cookies from Chrome via playwriter.
//
// Requires: Chrome open with playwriter extension ACTIVE on a gemini.google.com tab.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const credsPath = path.join(__dirname, 'gemini-creds.json');

const pwCode = [
    `await page.goto('https://gemini.google.com/app',{waitUntil:'domcontentloaded',timeout:20000});`,
    `const cks=await context.cookies('https://gemini.google.com');`,
    `const ua=await page.evaluate(()=>navigator.userAgent);`,
    `const psid=cks.find(c=>c.name==='__Secure-1PSID')?.value;`,
    `const psidts=cks.find(c=>c.name==='__Secure-1PSIDTS')?.value;`,
    `const fullCookie=cks.map(c=>c.name+'='+c.value).join('; ');`,
    `const creds={secure1psid:psid,secure1psidts:psidts,userAgent:ua,fullCookie};`,
    `require('fs').writeFileSync(${JSON.stringify(credsPath)},JSON.stringify(creds,null,2));`,
    `console.log('REFRESHED:psid='+(psid?psid.slice(0,12)+'...':'MISSING')+' psidts='+(psidts?'yes':'no')+' cookies='+cks.length);`,
].join(' ');

console.log('Extracting Gemini cookies from Chrome...');

const pwBin = [
    'C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\playwriter\\bin.js',
    path.join(__dirname, 'node_modules', 'playwriter', 'bin.js'),
].find(p => fs.existsSync(p));

const r = pwBin
    ? spawnSync(process.execPath, [pwBin, 'execute', pwCode], { encoding: 'utf8', timeout: 30000 })
    : spawnSync('npx', ['playwriter@latest', 'execute', pwCode], { encoding: 'utf8', timeout: 30000 });

const out = (r.stdout || '') + (r.stderr || '');
if (out.includes('REFRESHED:')) {
    const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
    console.log('Credentials refreshed.');
    console.log('PSID:', creds.secure1psid?.slice(0, 12) + '...');
    console.log('Has 1PSIDTS:', !!creds.secure1psidts);
    console.log('User-Agent:', creds.userAgent?.slice(0, 60));
} else {
    console.error('Failed. Make sure Chrome is open with the playwriter extension active on a gemini.google.com tab.');
    console.error(out.slice(0, 800));
    process.exit(1);
}
