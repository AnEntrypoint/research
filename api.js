const fs = require('fs');
const path = require('path');

const credsPath = path.join(__dirname, 'creds.json');
if (!fs.existsSync(credsPath)) throw new Error('Missing creds.json. Run: bun refresh-auth.js');
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
if (!creds.fullCookie) throw new Error('creds.json has no fullCookie. Re-run refresh-auth.js.');

const { Session, initTLS } = require('./node_modules/node-tls-client');

const BASE = 'https://claude.ai';
const ORG_ID = creds.orgId;

// Chrome 131 TLS fingerprint matches Cloudflare's bot-detection expectations.
// Headers must align with chrome_131 clientIdentifier (UA, sec-ch-ua).
const BASE_HEADERS = {
  'content-type': 'application/json',
  'accept': 'application/json, text/event-stream',
  'cookie': creds.fullCookie,
  'origin': BASE,
  'referer': BASE + '/new',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="131", "Not.A/Brand";v="8", "Chromium";v="131"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'anthropic-client-platform': 'web_claude_ai',
};

let _session = null;

async function getSession() {
  if (!_session) {
    await initTLS();
    _session = new Session({ clientIdentifier: 'chrome_131', followRedirects: true });
  }
  return _session;
}

async function request(pathSuffix, opts = {}) {
  const s = await getSession();
  const url = BASE + pathSuffix;
  const headers = { ...BASE_HEADERS, ...(opts.headers || {}) };
  const method = (opts.method || 'GET').toLowerCase();
  const res = await s[method](url, { headers, body: opts.body });
  const bodyText = await res.text();
  return {
    ok: res.status < 400,
    status: res.status,
    headers: { get: (k) => res.headers?.[k.toLowerCase()] },
    text: () => Promise.resolve(bodyText),
    json: () => Promise.resolve(JSON.parse(bodyText)),
  };
}

async function createConversation(model) {
  const res = await request(`/api/organizations/${ORG_ID}/chat_conversations`, {
    method: 'POST',
    body: JSON.stringify({ name: '', model, include_conversation_preferences: true, compass_mode: 'advanced', is_temporary: true, project_uuid: null }),
  });
  if (!res.ok) throw new Error(`createConversation ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()).uuid;
}

async function sendCompletion(convId, { prompt, model, humanMessageUuid, assistantMessageUuid, onDelta } = {}) {
  const payload = JSON.stringify({
    prompt, timezone: 'Africa/Johannesburg', locale: 'en-US', model,
    personalized_styles: [{ type: 'default', key: 'Default', name: 'Normal', nameKey: 'normal_style_name', prompt: 'Normal\n', summary: 'Default responses from Claude', summaryKey: 'normal_style_summary', isDefault: true }],
    tools: [{ type: 'web_search_v0', name: 'web_search' }],
    turn_message_uuids: { human_message_uuid: humanMessageUuid, assistant_message_uuid: assistantMessageUuid },
    attachments: [], files: [], sync_sources: [], rendering_mode: 'messages',
  });

  const s = await getSession();
  const res = await s.post(`${BASE}/api/organizations/${ORG_ID}/chat_conversations/${convId}/completion`, {
    headers: { ...BASE_HEADERS, 'accept': 'text/event-stream' },
    body: payload,
  });
  if (res.status >= 400) {
    const body = await res.text();
    throw new Error(`completion ${res.status}: ${body.slice(0, 300)}`);
  }
  const body = await res.text();
  let text = '', think = '';
  for (const l of body.split('\n')) {
    if (!l.startsWith('data: ')) continue;
    const raw = l.slice(6).trim(); if (!raw) continue;
    try {
      const e = JSON.parse(raw);
      if (e.type === 'content_block_delta') {
        if (e.delta?.type === 'thinking_delta') { think += e.delta.thinking || ''; onDelta?.('think', e.delta.thinking || ''); }
        else if (e.delta?.type === 'text_delta') { text += e.delta.text || ''; onDelta?.('text', e.delta.text || ''); }
      }
    } catch {}
  }
  return { text, think };
}

async function getConversation(convId) {
  const res = await request(`/api/organizations/${ORG_ID}/chat_conversations/${convId}?tree=True&rendering_mode=messages`);
  if (!res.ok) throw new Error(`getConversation ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function listConversations(limit = 20) {
  const res = await request(`/api/organizations/${ORG_ID}/chat_conversations?limit=${limit}`);
  if (!res.ok) throw new Error(`listConversations ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { request, createConversation, sendCompletion, getConversation, listConversations, ORG_ID, creds };
