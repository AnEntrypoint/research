#!/usr/bin/env -S bun --bun
// Refresh creds.json by extracting ALL cookies (including HttpOnly cf_clearance)
// and the browser's User-Agent from Chrome via playwriter.
//
// Requires: Chrome open with playwriter extension ACTIVE on a claude.ai tab.
//
// Two ways to run:
//   1. CLI:  bun refresh-auth.js          (uses npx playwriter execute)
//   2. From Claude Code: ask Claude to run the MCP one-liner below.
//
// MCP one-liner (paste into Claude Code):
//   use mcp__playwriter_latest__execute with:
//     code: "await page.goto('https://claude.ai/new',{waitUntil:'domcontentloaded',timeout:15000}); const cks=await context.cookies('https://claude.ai'); const ua=await page.evaluate(()=>navigator.userAgent); const orgMatch=cks.find(c=>c.name==='lastActiveOrg'); const fullCookie=cks.map(c=>c.name+'='+c.value).join('; '); const creds={orgId:orgMatch?.value,userAgent:ua,fullCookie,deviceId:cks.find(c=>c.name==='anthropic-device-id')?.value,userId:cks.find(c=>c.name==='ajs_user_id')?.value}; require('fs').writeFileSync('C:/dev/research/creds.json',JSON.stringify(creds,null,2)); console.log('REFRESHED:org='+creds.orgId+' ua='+ua.slice(0,40)+' cookies='+cks.length);"

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const credsPath = path.join(__dirname, 'creds.json');

const pwCode = [
  `await page.goto('https://claude.ai/new',{waitUntil:'domcontentloaded',timeout:15000});`,
  `const cks=await context.cookies('https://claude.ai');`,
  `const ua=await page.evaluate(()=>navigator.userAgent);`,
  `const orgMatch=cks.find(c=>c.name==='lastActiveOrg');`,
  `const fullCookie=cks.map(c=>c.name+'='+c.value).join('; ');`,
  `const creds={orgId:orgMatch?.value,userAgent:ua,fullCookie,`,
  `  deviceId:cks.find(c=>c.name==='anthropic-device-id')?.value,`,
  `  userId:cks.find(c=>c.name==='ajs_user_id')?.value};`,
  `require('fs').writeFileSync(${JSON.stringify(credsPath)},JSON.stringify(creds,null,2));`,
  `console.log('REFRESHED:org='+creds.orgId+' cookies='+cks.length+' ua='+ua.slice(0,40));`,
].join(' ');

console.log('Extracting cookies from Chrome...');

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
  console.log('Org:', creds.orgId);
  console.log('User-Agent:', creds.userAgent?.slice(0, 60));
  console.log('Cookie count:', creds.fullCookie?.split(';').length);
  console.log('Has cf_clearance:', creds.fullCookie?.includes('cf_clearance'));
} else {
  console.error('Failed. Make sure Chrome is open with the playwriter extension active on a claude.ai tab.');
  console.error(out.slice(0, 500));
  process.exit(1);
}
