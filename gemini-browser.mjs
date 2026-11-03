import fs from 'node:fs/promises';

const GEMINI_APP_URL = 'https://gemini.google.com/app';

async function readCookies(context, page, url) {
    if (typeof context.getExistingCDPSession === 'function') {
        const session = await context.getExistingCDPSession(page);
        const { cookies } = await session.send('Network.getCookies', { urls: [url] });
        return cookies;
    }
    return context.cookies(url);
}

export async function captureGeminiCreds({ context, credsPath }) {
    const page = await context.newPage();
    try {
        await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const cookies = await readCookies(context, page, GEMINI_APP_URL);
        const value = (name) => cookies.find((cookie) => cookie.name === name)?.value;
        if (!value('__Secure-1PSID')) {
            throw new Error('Not signed in to gemini.google.com in this browser. Sign in at gemini.google.com in the playwriter-connected Chrome, then re-run.');
        }
        let existing = {};
        try {
            existing = JSON.parse(await fs.readFile(credsPath, 'utf8'));
        } catch {}
        const creds = {
            ...existing,
            secure1psid: value('__Secure-1PSID'),
            secure1psidts: value('__Secure-1PSIDTS'),
            userAgent: await page.evaluate(() => navigator.userAgent),
            fullCookie: cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; '),
        };
        await fs.writeFile(credsPath, JSON.stringify(creds, null, 2));
        return { path: credsPath, cookies: cookies.length, hasPSIDTS: Boolean(creds.secure1psidts) };
    } finally {
        await page.close().catch(() => {});
    }
}
