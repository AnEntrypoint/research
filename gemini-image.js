#!/usr/bin/env -S bun --bun
// Generate an image via gemini.google.com over direct HTTP and save it.
// Usage: bun gemini-image.js "an oil painting of a frog astronaut" [-o out.png]
// Cookies come from gemini-creds.json (refresh with: bun refresh-gemini-auth.js).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const credsPath = path.join(__dirname, 'gemini-creds.json');
if (!fs.existsSync(credsPath)) { console.error('Missing gemini-creds.json. Run: bun refresh-gemini-auth.js'); process.exit(1); }
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
if (!creds.secure1psid) { console.error('gemini-creds.json missing secure1psid. Re-run refresh-gemini-auth.js'); process.exit(1); }

const args = process.argv.slice(2);
let outPath = null;
const filtered = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--out') { outPath = args[++i]; }
    else filtered.push(args[i]);
}
const userPrompt = filtered.join(' ').trim();
if (!userPrompt) { console.error('Usage: bun gemini-image.js "<prompt>" [-o out.png]'); process.exit(1); }

const prompt = `Generate an image: ${userPrompt}`;

const COMMON_HEADERS = {
    'cookie': creds.fullCookie || `__Secure-1PSID=${creds.secure1psid}${creds.secure1psidts ? '; __Secure-1PSIDTS=' + creds.secure1psidts : ''}`,
    'user-agent': creds.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'origin': 'https://gemini.google.com',
    'referer': 'https://gemini.google.com/',
    'sec-ch-ua': '"Google Chrome";v="131", "Not.A/Brand";v="8", "Chromium";v="131"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
};

function getNested(data, pathArr, def = null) {
    let cur = data;
    for (const k of pathArr) {
        if (cur == null) return def;
        if (typeof k === 'number') {
            if (!Array.isArray(cur) || k < -cur.length || k >= cur.length) return def;
            cur = cur[k];
        } else if (typeof k === 'string') {
            if (typeof cur !== 'object' || Array.isArray(cur) || !(k in cur)) return def;
            cur = cur[k];
        }
    }
    return cur == null ? def : cur;
}

async function getAccessToken() {
    const r = await fetch('https://gemini.google.com/app', { headers: COMMON_HEADERS });
    if (r.status >= 400) throw new Error(`init ${r.status}`);
    const html = await r.text();
    const m = (re) => { const x = html.match(re); return x ? x[1] : null; };
    const at = m(/"SNlM0e":\s*"([^"]+)"/);
    if (!at) throw new Error('SNlM0e not found — cookies likely expired. Run: bun refresh-gemini-auth.js');
    return {
        at,
        bl: m(/"cfb2h":\s*"([^"]+)"/),
        sid: m(/"FdrFJe":\s*"([^"]+)"/),
        hl: m(/"TuX5cc":\s*"([^"]+)"/) || 'en',
    };
}

function buildInnerReq(promptText, hl) {
    const inner = new Array(69).fill(null);
    inner[0] = [promptText, 0, null, null, null, null, 0];
    inner[1] = [hl];
    inner[2] = ['', '', '', null, null, null, null, null, null, ''];
    inner[6] = [1];
    inner[7] = 1;
    inner[10] = 1;
    inner[11] = 0;
    inner[17] = [[0]];
    inner[18] = 0;
    inner[27] = 1;
    inner[30] = [4];
    inner[41] = [1];
    inner[53] = 0;
    inner[59] = crypto.randomUUID().toUpperCase();
    inner[61] = [];
    inner[68] = 2;
    return inner;
}

function parseFrames(buffer) {
    const frames = [];
    let i = 0;
    if (buffer.startsWith(")]}'")) i = buffer.indexOf('\n') + 1;
    while (i < buffer.length) {
        while (i < buffer.length && /\s/.test(buffer[i])) i++;
        const m = buffer.slice(i).match(/^(\d+)\n/);
        if (!m) break;
        const len = parseInt(m[1], 10);
        const start = i + m[1].length;
        if (start + len > buffer.length) break;
        frames.push(buffer.slice(start, start + len).trim());
        i = start + len;
    }
    return frames;
}

function findGeneratedImages(envelope) {
    // envelope is parsed JSON from a frame: typically [[ "wrb.fr", "rpc_id", "<json-string>", ...], ...]
    const out = [];
    if (!Array.isArray(envelope)) return out;
    for (const row of envelope) {
        if (!Array.isArray(row) || row[0] !== 'wrb.fr') continue;
        const inner = row[2];
        if (typeof inner !== 'string') continue;
        let parsed;
        try { parsed = JSON.parse(inner); } catch { continue; }
        // Walk candidates: response shape is [batch, ...candidates...]
        // Per parser: candidate_data[12][7][0] = list of generated images, each has [0,3,3] = url
        const candidates = collectCandidates(parsed);
        for (const cand of candidates) {
            const lists = [
                getNested(cand, [12, 7, 0], []) || [],
                getNested(cand, [12, 0, '8', 0], []) || [],
            ];
            for (const list of lists) {
                if (!Array.isArray(list)) continue;
                for (const img of list) {
                    const url = getNested(img, [0, 3, 3]);
                    const alt = getNested(img, [0, 3, 2], '');
                    if (url) out.push({ url, alt });
                }
            }
        }
    }
    return out;
}

function collectCandidates(parsed) {
    // Candidate arrays appear under parsed[4] = [[rid,[cand,cand,...]], ...] in normal flow,
    // but to be robust, scan all arrays of length>=13 with index [12] being array.
    const found = [];
    const seen = new Set();
    function walk(node, depth) {
        if (depth > 10 || node == null) return;
        if (Array.isArray(node)) {
            // Heuristic: candidate has index 1 = [text], index 12 = media bag
            if (node.length >= 13 && Array.isArray(node[1]) && (Array.isArray(node[12]) || node[12] === null)) {
                if (!seen.has(node)) { seen.add(node); found.push(node); }
            }
            for (const v of node) walk(v, depth + 1);
        } else if (typeof node === 'object') {
            for (const v of Object.values(node)) walk(v, depth + 1);
        }
    }
    walk(parsed, 0);
    return found;
}

async function downloadImage(url) {
    const headers = {
        'cookie': COMMON_HEADERS.cookie,
        'user-agent': COMMON_HEADERS['user-agent'],
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'referer': 'https://gemini.google.com/',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
    };
    let r = await fetch(url, { headers, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
        const next = r.headers.get('location');
        if (next) r = await fetch(next, { headers, redirect: 'follow' });
    }
    if (r.status >= 400) throw new Error(`image download ${r.status} (url: ${url.slice(0,80)}...)`);
    return Buffer.from(await r.arrayBuffer());
}

(async () => {
    console.error(`Prompt: ${userPrompt}`);
    console.error('Initializing session...');
    const { at, bl, sid, hl } = await getAccessToken();
    console.error(`  bl=${bl?.slice(0, 16) || '?'} sid=${sid?.slice(0, 12) || '?'}`);

    const inner = buildInnerReq(prompt, hl);
    const fReq = JSON.stringify([null, JSON.stringify(inner)]);
    const body = `f.req=${encodeURIComponent(fReq)}&at=${encodeURIComponent(at)}`;

    const reqid = Math.floor(Math.random() * 90000) + 10000;
    const params = new URLSearchParams({ hl, _reqid: String(reqid), rt: 'c' });
    if (bl) params.set('bl', bl);
    if (sid) params.set('f.sid', sid);

    const url = `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?${params}`;

    console.error('Submitting prompt...');
    const r = await fetch(url, {
        method: 'POST',
        headers: {
            ...COMMON_HEADERS,
            'content-type': 'application/x-www-form-urlencoded;charset=utf-8',
            'x-same-domain': '1',
            'x-goog-ext-525001261-jspb': '[1,null,null,null,null,null,null,null,[4]]',
            'x-goog-ext-73010989-jspb': '[0]',
            'x-goog-ext-525005358-jspb': `["${inner[59]}",1]`,
        },
        body,
    });
    if (r.status >= 400) {
        const t = await r.text();
        throw new Error(`StreamGenerate ${r.status}: ${t.slice(0, 400)}`);
    }
    const buffer = await r.text();
    console.error(`  body: ${buffer.length} bytes`);

    const frames = parseFrames(buffer);
    console.error(`  ${frames.length} frame(s) received`);

    const images = [];
    for (const frame of frames) {
        let envelope;
        try { envelope = JSON.parse(frame); } catch { continue; }
        const found = findGeneratedImages(envelope);
        images.push(...found);
    }

    if (!images.length) {
        console.error('No generated images found in response.');
        for (let i = 0; i < frames.length; i++) console.error(`Frame ${i} (${frames[i].length}):`, frames[i].slice(0, 800));
        process.exit(2);
    }

    const img = images[0];
    console.error(`Generated: ${img.url.slice(0, 80)}...`);
    const bytes = await downloadImage(img.url);
    const dest = outPath || `gemini-image-${Date.now()}.png`;
    fs.writeFileSync(dest, bytes);
    console.error(`Saved: ${dest} (${bytes.length} bytes${images.length > 1 ? `; ${images.length - 1} more available` : ''})`);
    console.log(path.resolve(dest));
})().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
