// claude.ai credentials for api.js, read from the browser playwriter controls.
import fs from 'node:fs/promises';

const CLAUDE_URL = 'https://claude.ai/new';

async function findOrOpenClaudePage(context) {
    const open = context.pages().find(p => p.url().startsWith('https://claude.ai/'));
    if (open) return open;
    const page = await context.newPage();
    await page.goto(CLAUDE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return page;
}

export async function refreshClaudeCreds({ context, credsPath }) {
    const page = await findOrOpenClaudePage(context);
    const cookies = await context.cookies('https://claude.ai');
    const value = name => cookies.find(c => c.name === name)?.value;
    if (!value('sessionKey')) throw new Error('Not signed in to claude.ai in this browser. Sign in at claude.ai in the playwriter-connected Chrome, then re-run.');
    const creds = {
        orgId: value('lastActiveOrg'),
        userAgent: await page.evaluate(() => navigator.userAgent),
        fullCookie: cookies.map(c => `${c.name}=${c.value}`).join('; '),
        deviceId: value('anthropic-device-id'),
        userId: value('ajs_user_id'),
    };
    await fs.writeFile(credsPath, JSON.stringify(creds, null, 2));
    return { path: credsPath, orgId: creds.orgId, cookies: cookies.length, hasCfClearance: cookies.some(c => c.name === 'cf_clearance') };
}
