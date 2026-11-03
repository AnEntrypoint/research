#!/usr/bin/env -S bun --bun

const fs = require('fs');
const path = require('path');

const credsPath = path.join(__dirname, 'gemini-creds.json');
if (!fs.existsSync(credsPath)) { console.error('Missing gemini-creds.json'); process.exit(1); }
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
if (!creds.apiKey) { console.error('gemini-creds.json missing apiKey'); process.exit(1); }

const args = process.argv.slice(2);
let outPath = null;
const filtered = [];
for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o' || args[i] === '--out') { outPath = args[++i]; }
    else filtered.push(args[i]);
}
const audioFile = filtered[0];
if (!audioFile) { console.error('Usage: bun gemini-transcribe.js <audio-file> [-o out.txt]'); process.exit(1); }
if (!fs.existsSync(audioFile)) { console.error(`File not found: ${audioFile}`); process.exit(1); }

const MIME_MAP = {
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.webm': 'audio/webm',
    '.aac': 'audio/aac',
};
const mimeType = MIME_MAP[path.extname(audioFile).toLowerCase()] || 'audio/mpeg';
const API_KEY = creds.apiKey;
const MODEL = 'gemini-1.5-flash';
const TIMEOUT_MS = 240000;

const textOf = (response) => (response.rawBody || Buffer.alloc(0)).toString('utf8');

async function uploadFile(http, filePath, mime) {
    const size = fs.statSync(filePath).size;
    console.error(`Uploading ${path.basename(filePath)} (${size} bytes, ${mime})...`);
    const init = await http.request({
        url: `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${API_KEY}`,
        method: 'POST',
        headers: {
            'X-Goog-Upload-Protocol': 'resumable',
            'X-Goog-Upload-Command': 'start',
            'X-Goog-Upload-Header-Content-Length': String(size),
            'X-Goog-Upload-Header-Content-Type': mime,
            'Content-Type': 'application/json',
        },
        data: JSON.stringify({ file: { display_name: path.basename(filePath) } }),
        timeout: TIMEOUT_MS,
    });
    if (init.status >= 400) throw new Error(`Upload init ${init.status}: ${textOf(init)}`);
    const uploadUrl = init.headers['x-goog-upload-url'];
    if (!uploadUrl) throw new Error('No upload URL returned');
    const upload = await http.request({
        url: uploadUrl,
        method: 'POST',
        headers: {
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        extraCurlArgs: ['--data-binary', `@${filePath}`],
        timeout: TIMEOUT_MS,
    });
    if (upload.status >= 400) throw new Error(`Upload ${upload.status}: ${textOf(upload)}`);
    const fileUri = JSON.parse(textOf(upload)).file?.uri;
    if (!fileUri) throw new Error('No file URI in upload response');
    console.error(`Uploaded: ${fileUri}`);
    return fileUri;
}

async function transcribe(http, fileUri, mime) {
    console.error('Requesting transcription...');
    const response = await http.request({
        url: `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        data: JSON.stringify({
            contents: [{
                parts: [
                    { file_data: { mime_type: mime, file_uri: fileUri } },
                    { text: 'Please transcribe this audio exactly. Return only the transcription text, no commentary.' },
                ],
            }],
        }),
        timeout: TIMEOUT_MS,
    });
    if (response.status >= 400) throw new Error(`generateContent ${response.status}: ${textOf(response)}`);
    const text = JSON.parse(textOf(response)).candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`No text in response: ${textOf(response).slice(0, 400)}`);
    return text;
}

(async () => {
    const { createGeminiHttp } = await import('./gemini-client.mjs');
    const http = createGeminiHttp();
    try {
        const fileUri = await uploadFile(http, audioFile, mimeType);
        const transcription = await transcribe(http, fileUri, mimeType);
        if (outPath) {
            fs.writeFileSync(outPath, transcription, 'utf8');
            console.error(`Saved: ${outPath}`);
        } else {
            console.log(transcription);
        }
    } finally {
        http.destroy?.();
    }
})().catch((e) => {
    console.error('Error:', e.message);
    process.exit(1);
});
