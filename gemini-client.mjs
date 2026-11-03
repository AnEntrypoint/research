// Gemini image generation over curl-impersonate (cuimp), replaying gemini.google.com's
// StreamGenerate request with cookies captured once from the playwriter browser.
//   bun refresh-gemini-auth.js
//   bun gemini-image.js "an oil painting of a frog astronaut" -o frog.png

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createCuimpHttp } from 'cuimp';

export const GEMINI_APP_URL = 'https://gemini.google.com/app';
export const STREAM_GENERATE_URL =
    'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate';
export const IMAGE_MODEL_ID = '56fdd199312815e2';
export const DEFAULT_BROWSER_VERSION = '145';
export const DEFAULT_TIMEOUT_MS = 240000;
export const DEFAULT_CREDS_FILE = 'gemini-creds.json';

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const IMAGE_HOST_MARKER = 'https://lh3.googleusercontent.com/gg-dl/';

export class GeminiError extends Error {
    constructor(message, { cause, status, code } = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = 'GeminiError';
        this.status = status;
        this.code = code;
    }
}

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };
const stderrLogger = Object.fromEntries(
    ['info', 'warn', 'error', 'debug'].map((level) => [level, (...args) => process.stderr.write(`gemini: ${args.join(' ')}\n`)]),
);

export function createGeminiHttp({
    browser = 'chrome',
    browserVersion = DEFAULT_BROWSER_VERSION,
    binaryPath,
    proxy,
    debug = false,
} = {}) {
    return createCuimpHttp({
        descriptor: { browser, version: browserVersion },
        logger: debug ? stderrLogger : silentLogger,
        ...(proxy ? { proxy } : {}),
        ...(binaryPath ? { path: binaryPath } : {}),
    });
}

export function cookieHeader(creds) {
    if (creds?.fullCookie) return creds.fullCookie;
    if (creds?.secure1psid) {
        return `__Secure-1PSID=${creds.secure1psid}` + (creds.secure1psidts ? `; __Secure-1PSIDTS=${creds.secure1psidts}` : '');
    }
    throw new GeminiError('No Gemini session found. Run: bun refresh-gemini-auth.js', { code: 'AUTH' });
}

export function credsFromEnv(env = process.env) {
    if (!env.GEMINI_COOKIE) return null;
    return { fullCookie: env.GEMINI_COOKIE, userAgent: env.GEMINI_USER_AGENT, secure1psid: '', secure1psidts: '' };
}

export async function loadCreds(credsPath = DEFAULT_CREDS_FILE) {
    try {
        return JSON.parse(await fs.readFile(credsPath, 'utf8'));
    } catch (error) {
        throw new GeminiError(`Could not read ${credsPath}. Run: bun refresh-gemini-auth.js`, { cause: error, code: 'AUTH' });
    }
}

export function parseAccessToken(html) {
    const pick = (re) => {
        const match = html.match(re);
        return match ? match[1] : null;
    };
    const at = pick(/"SNlM0e":\s*"([^"]+)"/);
    if (!at) {
        throw new GeminiError(
            'Gemini returned no session token; the stored cookies are stale or signed out. Run: bun refresh-gemini-auth.js',
            { code: 'AUTH' },
        );
    }
    return {
        at,
        bl: pick(/"cfb2h":\s*"([^"]+)"/),
        sid: pick(/"FdrFJe":\s*"([^"]+)"/),
        hl: pick(/"TuX5cc":\s*"([^"]+)"/) || 'en',
    };
}

export function buildModelHeader({ hl = 'en', sessionId = randomUUID().toUpperCase() } = {}) {
    return JSON.stringify([
        1, null, null, null, IMAGE_MODEL_ID, null, hl, 0,
        [4, 33, 22, 5, 6, 8, 16, 19, 20, 4, 33, 22, 5, 6, 8, 16, 19, 20],
        null, null, 2, null, null, 1, null, sessionId,
    ]);
}

export function buildInnerRequest(prompt, hl = 'en', { uuid = randomUUID().toUpperCase(), context } = {}) {
    const inner = new Array(99).fill(null);
    inner[0] = [prompt, 0, null, null, null, null, 0];
    inner[1] = [hl];
    inner[2] = ['', '', '', null, null, null, null, null, null, ''];
    inner[3] = context ?? '!' + randomBytes(1200 + Math.floor(Math.random() * 400)).toString('base64url');
    inner[4] = randomBytes(16).toString('hex');
    inner[6] = [0];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4, 16, 19];
    inner[49] = 0;
    inner[53] = 0;
    inner[59] = uuid;
    inner[61] = [];
    inner[68] = 1;
    inner[79] = 1;
    inner[91] = 1;
    inner[96] = 0;
    inner[98] = 1;
    return inner;
}

export function parseFrames(text) {
    const frames = [];
    let i = text.startsWith(")]}'") ? text.indexOf('\n') + 1 : 0;
    while (i < text.length) {
        while (i < text.length && /\s/.test(text[i])) i += 1;
        const lengthMatch = text.slice(i).match(/^(\d+)\n/);
        if (!lengthMatch) break;
        const start = i + lengthMatch[1].length;
        if (start + Number(lengthMatch[1]) > text.length) break;
        frames.push(text.slice(start, start + Number(lengthMatch[1])).trim());
        i = start + Number(lengthMatch[1]);
    }
    return frames;
}

function walkStrings(node, visit, depth = 0) {
    if (depth > 30 || node == null) return;
    if (typeof node === 'string') {
        if (visit(node) !== false) {
            const trimmed = node.trim();
            if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.length > 20) {
                try {
                    walkStrings(JSON.parse(trimmed), visit, depth + 1);
                } catch {}
            }
        }
        return;
    }
    if (Array.isArray(node)) {
        for (const value of node) walkStrings(value, visit, depth + 1);
    } else if (typeof node === 'object') {
        for (const value of Object.values(node)) walkStrings(value, visit, depth + 1);
    }
}

export function extractGeneratedImageUrls(frames) {
    const urls = new Set();
    for (const frame of frames) {
        let parsed;
        try {
            parsed = JSON.parse(frame);
        } catch {
            continue;
        }
        walkStrings(parsed, (value) => {
            const match = value.slice(value.indexOf(IMAGE_HOST_MARKER)).match(/^https:\/\/lh3\.googleusercontent\.com\/gg-dl\/[^\s"\\]+/);
            if (match) urls.add(match[0]);
        });
    }
    return [...urls];
}

export function extractResponseText(frames) {
    const candidates = [];
    for (const frame of frames) {
        let parsed;
        try {
            parsed = JSON.parse(frame);
        } catch {
            continue;
        }
        for (const row of Array.isArray(parsed) ? parsed : [parsed]) {
            if (typeof row?.[2] !== 'string') continue;
            try {
                const text = JSON.parse(row[2])?.[4]?.[0]?.[1]?.[0];
                if (typeof text === 'string' && text.trim()) candidates.push(text.trim());
            } catch {}
        }
    }
    if (candidates.length) return candidates.at(-1);
    const fallback = [];
    for (const frame of frames) {
        let parsed;
        try {
            parsed = JSON.parse(frame);
        } catch {
            continue;
        }
        walkStrings(parsed, (value) => {
            const text = value.trim();
            if (text.length > 8 && !/^[a-z_]+$/.test(text) && !/^\d+$/.test(text) && !text.startsWith('http')) fallback.push(text);
        });
    }
    return fallback.at(-1) ?? null;
}

export async function fetchAccessToken(http, cookie, timeoutMs = DEFAULT_TIMEOUT_MS) {
    let response;
    try {
        response = await http.get(GEMINI_APP_URL, {
            headers: { accept: HTML_ACCEPT, cookie },
            timeout: Math.min(timeoutMs, 60000),
        });
    } catch (error) {
        throw new GeminiError(`Could not reach gemini.google.com: ${error.message}`, { cause: error });
    }
    if (response.status >= 400) {
        throw new GeminiError(`Gemini returned HTTP ${response.status} while loading the session`, { status: response.status });
    }
    return parseAccessToken(response.rawBody.toString('utf8'));
}

export async function downloadImage(http, url, cookie, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const response = await http.get(url, {
        headers: {
            cookie,
            referer: 'https://gemini.google.com/',
            accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
        timeout: timeoutMs,
    });
    if (response.status >= 400) {
        throw new GeminiError(`Image download failed with HTTP ${response.status}`, { status: response.status });
    }
    return response.rawBody;
}

function streamUrl(token, uuid) {
    const params = new URLSearchParams({
        hl: token.hl,
        _reqid: String(Math.floor(Math.random() * 900000) + 10000),
        rt: 'c',
    });
    if (token.bl) params.set('bl', token.bl);
    if (token.sid) params.set('f.sid', token.sid);
    return `${STREAM_GENERATE_URL}?${params}`;
}

export async function checkGeminiSession({ creds, credsPath, http, timeoutMs = DEFAULT_TIMEOUT_MS, ...httpOptions } = {}) {
    const ownHttp = !http;
    const client = http ?? createGeminiHttp(httpOptions);
    try {
        const effectiveCreds = creds ?? credsFromEnv() ?? (await loadCreds(credsPath));
        const token = await fetchAccessToken(client, cookieHeader(effectiveCreds), timeoutMs);
        return { signedIn: true, hl: token.hl, bl: token.bl, hasSessionId: Boolean(token.sid) };
    } finally {
        if (ownHttp) client.destroy?.();
    }
}

export async function generateGeminiImage({
    prompt,
    outPath,
    creds,
    credsPath,
    http,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...httpOptions
} = {}) {
    if (!prompt) throw new GeminiError('A prompt is required');
    const ownHttp = !http;
    const client = http ?? createGeminiHttp(httpOptions);
    try {
        const effectiveCreds = creds ?? credsFromEnv() ?? (await loadCreds(credsPath));
        const cookie = cookieHeader(effectiveCreds);
        const token = await fetchAccessToken(client, cookie, timeoutMs);
        const uuid = randomUUID().toUpperCase();
        const inner = buildInnerRequest(`Generate an image: ${prompt}`, token.hl, { uuid });
        const body = `f.req=${encodeURIComponent(JSON.stringify([null, JSON.stringify(inner)]))}&at=${encodeURIComponent(token.at)}`;
        const response = await client.request({
            url: streamUrl(token, uuid),
            method: 'POST',
            headers: {
                accept: '*/*',
                'accept-language': 'en-US,en;q=0.9',
                cookie,
                origin: 'https://gemini.google.com',
                referer: 'https://gemini.google.com/',
                'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
                'x-same-domain': '1',
                'x-goog-ext-525001261-jspb': buildModelHeader({ hl: token.hl }),
                'x-goog-ext-73010989-jspb': '[0]',
                'x-goog-ext-73010990-jspb': '[0,0,0]',
                'x-goog-ext-525005358-jspb': JSON.stringify([uuid, 1]),
            },
            data: body,
            timeout: timeoutMs,
        });
        if (response.status >= 400) {
            throw new GeminiError(`Gemini rejected the request with HTTP ${response.status}`, { status: response.status });
        }
        const frames = parseFrames(response.rawBody.toString('utf8'));
        const urls = extractGeneratedImageUrls(frames);
        if (!urls.length) {
            const said = extractResponseText(frames);
            throw new GeminiError(said ? `Gemini answered without an image: ${said}` : 'Gemini answered without an image');
        }
        const bytes = await downloadImage(client, urls[0], cookie, timeoutMs);
        const dest = path.resolve(outPath || `gemini-image-${Date.now()}.png`);
        await fs.writeFile(dest, bytes);
        return { path: dest, bytes: bytes.length, images: urls };
    } finally {
        if (ownHttp) client.destroy?.();
    }
}
