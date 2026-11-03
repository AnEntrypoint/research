// Gemini image generation driven through a Playwright BrowserContext (the browser playwriter controls).
// Loaded by gemini-image.js via the playwriter CLI, or directly by an agent's playwriter execute:
//   const { generateGeminiImage } = await import('<abs path>/gemini-browser.mjs')

import fs from 'node:fs/promises';
import path from 'node:path';

const GEMINI_APP_URL = 'https://gemini.google.com/app';
const IMAGE_MIN_WIDTH = 256;
const GENERATE_TIMEOUT_MS = 240000;
const PROMPT_TIMEOUT_MS = 20000;
const SIGNED_OUT_GRACE_MS = 1500;
const POLL_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isVisible = locator => locator.isVisible().catch(() => false);

async function findOrOpenGeminiPage(context) {
    const open = context.pages().find(p => p.url().startsWith('https://gemini.google.com/'));
    if (open) return open;
    const page = await context.newPage();
    await page.goto(GEMINI_APP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    return page;
}

async function promptBox(page) {
    const signIn = page.getByRole('button', { name: 'Sign in' }).first();
    const box = page.getByRole('textbox', { name: /enter a prompt/i }).first();
    const deadline = Date.now() + PROMPT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (await isVisible(signIn)) throw new Error('Gemini is signed out in this browser. Sign in at gemini.google.com in the playwriter-connected Chrome, then re-run.');
        if (await isVisible(box)) {
            await sleep(SIGNED_OUT_GRACE_MS);
            if (!(await isVisible(signIn))) return box;
        }
        await sleep(POLL_MS / 2);
    }
    throw new Error(`Gemini prompt box not found at ${page.url()}`);
}

function generatedImageSrcs(page) {
    return page.locator('img[src*="googleusercontent.com"]').evaluateAll(
        (imgs, minWidth) => imgs.filter(img => img.complete && img.naturalWidth >= minWidth).map(img => img.src),
        IMAGE_MIN_WIDTH,
    );
}

async function waitForNewImage(page, before) {
    const deadline = Date.now() + GENERATE_TIMEOUT_MS;
    while (Date.now() < deadline) {
        await sleep(POLL_MS);
        const fresh = (await generatedImageSrcs(page)).filter(src => !before.has(src));
        const generating = await isVisible(page.getByRole('button', { name: /stop response/i }).first());
        if (fresh.length && !generating) return fresh[0];
    }
    throw new Error('Timed out waiting for Gemini to finish an image');
}

async function downloadImage(page, src) {
    const base64 = await page.evaluate(async url => {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        let binary = '';
        for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(binary);
    }, src).catch(() => null);
    if (base64) return Buffer.from(base64, 'base64');
    return page.locator(`img[src=${JSON.stringify(src)}]`).first().screenshot({ type: 'png' });
}

export async function generateGeminiImage({ context, prompt, outPath }) {
    const page = await findOrOpenGeminiPage(context);
    const box = await promptBox(page);
    const before = new Set(await generatedImageSrcs(page));
    await box.click();
    await page.keyboard.insertText(`Generate an image: ${prompt}`);
    await page.keyboard.press('Enter');
    const src = await waitForNewImage(page, before);
    const dest = path.resolve(outPath || `gemini-image-${Date.now()}.png`);
    const bytes = await downloadImage(page, src);
    await fs.writeFile(dest, bytes);
    return { path: dest, bytes: bytes.length };
}
