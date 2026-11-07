import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
    GEMINI_APP_URL,
    GeminiError,
    IMAGE_MODEL_ID,
    generateGeminiImage,
    buildInnerRequest,
    buildModelHeader,
    cookieHeader,
    credsFromEnv,
    extractGeneratedImageUrls,
    extractResponseText,
    parseAccessToken,
    parseFrames,
} from './gemini-client.mjs';

const IMAGE_URL = 'https://lh3.googleusercontent.com/gg-dl/AHiVA1nN7hEDYS8lxYc8azzw-MASMOO2RuLzUH-YCZWd4nc4bmW';

function lengthFramed(...frames) {
    return ")]}'\n\n" + frames.map((frame) => `${frame.length + 1}\n${frame}\n`).join('');
}

function frameFor(inner) {
    return JSON.stringify([['wrb.fr', null, JSON.stringify(inner), null, null, null, 'generic']]);
}

function responseWithImage() {
    const media = [null, null, null, [null, 1, 'watermarked.jpg', IMAGE_URL, null, null, null, [1793693656, 1], null, 'image/jpeg']];
    const richContent = [null, null, null, null, null, null, null, [[[media]]]];
    const candidate = ['rc_candidate', ['<Image alt="a blue ceramic mug"/>'], null, null, null, null, null, null, [1], 'en', null, null, richContent];
    return frameFor([null, ['c_conversation', 'r_reply'], { 44: true, 46: ['c_conversation', ''] }, null, [[candidate]]]);
}

function responseWithText(message) {
    const candidate = ['rc_candidate', [message], null, null, null, null, null, null, [1]];
    return frameFor([null, ['c_conversation', 'r_reply'], { 44: true }, null, [[candidate]]]);
}

test('parseFrames reads length-prefixed frames and drops a partial tail', () => {
    const frames = parseFrames(lengthFramed('[1]', '[2,3]') + '99\n[partial');
    assert.deepEqual(frames, ['[1]', '[2,3]']);
});

test('extractGeneratedImageUrls finds a URL inside nested JSON string frames', () => {
    const frames = parseFrames(lengthFramed(responseWithImage()));
    assert.deepEqual(extractGeneratedImageUrls(frames), [IMAGE_URL]);
});

test('extractResponseText returns the assistant text from a text-only reply', () => {
    const frames = parseFrames(lengthFramed(responseWithText('I can help with something else.')));
    assert.equal(extractResponseText(frames), 'I can help with something else.');
});

test('buildInnerRequest produces the current 99-field shape', () => {
    const inner = buildInnerRequest('Generate an image: a frog', 'en', { uuid: 'UUID-1', context: '!ctx' });
    assert.equal(inner.length, 99);
    assert.deepEqual(inner[0], ['Generate an image: a frog', 0, null, null, null, null, 0]);
    assert.deepEqual(inner[1], ['en']);
    assert.equal(inner[3], '!ctx');
    assert.match(inner[4], /^[0-9a-f]{32}$/);
    assert.deepEqual(inner[6], [0]);
    assert.equal(inner[7], 1);
    assert.deepEqual(inner[17], [[0]]);
    assert.deepEqual(inner[30], [4, 16, 19]);
    assert.equal(inner[59], 'UUID-1');
    assert.equal(inner[68], 1);
    assert.equal(inner[79], 1);
    assert.equal(inner[98], 1);
});

test('buildInnerRequest starts a new chat with no conversation metadata', () => {
    const inner = buildInnerRequest('x', 'en', { uuid: 'A' });
    assert.equal(inner[2], null);
});

test('buildInnerRequest generates a unique fake context token by default', () => {
    const a = buildInnerRequest('x', 'en', { uuid: 'A' });
    const b = buildInnerRequest('x', 'en', { uuid: 'B' });
    assert.match(a[3], /^![A-Za-z0-9_-]{1000,}$/);
    assert.notEqual(a[3], b[3]);
});

test('buildModelHeader selects the image-capable model', () => {
    const header = JSON.parse(buildModelHeader({ hl: 'en', sessionId: 'SESSION' }));
    assert.equal(header[4], IMAGE_MODEL_ID);
    assert.equal(header[6], 'en');
    assert.equal(header[16], 'SESSION');
});

test('cookieHeader prefers fullCookie, then builds from PSID cookies', () => {
    assert.equal(cookieHeader({ fullCookie: 'a=1; b=2', secure1psid: 'x' }), 'a=1; b=2');
    assert.equal(cookieHeader({ secure1psid: 'psid', secure1psidts: 'ts' }), '__Secure-1PSID=psid; __Secure-1PSIDTS=ts');
    assert.throws(() => cookieHeader({}), GeminiError);
});

test('credsFromEnv reads GEMINI_COOKIE', () => {
    assert.equal(credsFromEnv({ GEMINI_COOKIE: 'SID=1' }).fullCookie, 'SID=1');
    assert.equal(credsFromEnv({}), null);
});

test('parseAccessToken reads the session tokens and rejects a signed-out page', () => {
    const token = parseAccessToken('{"SNlM0e":"at-1","cfb2h":"bl-1","FdrFJe":"sid-1","TuX5cc":"en"}');
    assert.deepEqual(token, { at: 'at-1', bl: 'bl-1', sid: 'sid-1', hl: 'en' });
    assert.throws(() => parseAccessToken('<html></html>'), /refresh-gemini-auth/);
});

test('generateGeminiImage runs token, request, parse, download and write end to end', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gemini-client-'));
    const outPath = path.join(dir, 'mug.png');
    let requestConfig;
    const http = {
        async get(url) {
            if (url === GEMINI_APP_URL) {
                return { status: 200, rawBody: Buffer.from('{"SNlM0e":"at-1","cfb2h":"bl-1","FdrFJe":"sid-1","TuX5cc":"en"}') };
            }
            if (url === IMAGE_URL) return { status: 200, rawBody: Buffer.from([0x89, 0x50, 0x4e, 0x47]) };
            throw new Error(`unexpected GET ${url}`);
        },
        async request(config) {
            requestConfig = config;
            return { status: 200, rawBody: Buffer.from(lengthFramed(responseWithImage())) };
        },
    };
    const result = await generateGeminiImage({ prompt: 'a blue ceramic mug', outPath, http, creds: { fullCookie: 'SID=1' } });
    assert.equal(result.path, outPath);
    assert.equal(result.bytes, 4);
    assert.deepEqual([...await fs.readFile(outPath)], [0x89, 0x50, 0x4e, 0x47]);
    assert.match(requestConfig.url, /StreamGenerate\?/);
    assert.match(requestConfig.url, /f\.sid=sid-1/);
    assert.deepEqual(requestConfig.headers['x-goog-ext-525005358-jspb'].startsWith('['), true);
    assert.equal(JSON.parse(requestConfig.headers['x-goog-ext-525001261-jspb'])[16], 'sid-1');
    const body = new URLSearchParams(requestConfig.data);
    assert.equal(body.get('at'), 'at-1');
    assert.match(body.get('f.req'), /Generate an image: a blue ceramic mug/);
    await fs.rm(dir, { recursive: true, force: true });
});
