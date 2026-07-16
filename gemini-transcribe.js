#!/usr/bin/env -S bun --bun
// Transcribe audio via Gemini API (gemini-1.5-flash).
// Usage: bun gemini-transcribe.js <audio-file> [-o out.txt]
// API key comes from gemini-creds.json.

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
const ext = path.extname(audioFile).toLowerCase();
const mimeType = MIME_MAP[ext] || 'audio/mpeg';

const API_KEY = creds.apiKey;
const MODEL = 'gemini-1.5-flash';

async function uploadFile(filePath, mime) {
    const bytes = fs.readFileSync(filePath);
    const size = bytes.length;
    console.error(`Uploading ${path.basename(filePath)} (${size} bytes, ${mime})...`);

    // Resumable upload initiation
    const initRes = await fetch(
        `https://generativelanguage.googleapis.com/upload/v1beta/files?uploadType=resumable&key=${API_KEY}`,
        {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': String(size),
                'X-Goog-Upload-Header-Content-Type': mime,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ file: { display_name: path.basename(filePath) } }),
        }
    );
    if (!initRes.ok) throw new Error(`Upload init ${initRes.status}: ${await initRes.text()}`);
    const uploadUrl = initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('No upload URL returned');

    // Upload bytes
    const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
            'Content-Length': String(size),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
        },
        body: bytes,
    });
    if (!uploadRes.ok) throw new Error(`Upload ${uploadRes.status}: ${await uploadRes.text()}`);
    const data = await uploadRes.json();
    const fileUri = data.file?.uri;
    if (!fileUri) throw new Error('No file URI in upload response');
    console.error(`Uploaded: ${fileUri}`);
    return fileUri;
}

async function transcribe(fileUri, mime) {
    console.error('Requesting transcription...');
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { file_data: { mime_type: mime, file_uri: fileUri } },
                        { text: 'Please transcribe this audio exactly. Return only the transcription text, no commentary.' },
                    ]
                }]
            }),
        }
    );
    if (!res.ok) throw new Error(`generateContent ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`No text in response: ${JSON.stringify(data).slice(0, 400)}`);
    return text;
}

(async () => {
    const fileUri = await uploadFile(audioFile, mimeType);
    const transcription = await transcribe(fileUri, mimeType);
    if (outPath) {
        fs.writeFileSync(outPath, transcription, 'utf8');
        console.error(`Saved: ${outPath}`);
    } else {
        console.log(transcription);
    }
})().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
});
