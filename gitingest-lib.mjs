// Shared gitingest.com fetch logic — used by gitingest-batch.mjs (CLI) and
// research-from-repo.js (fable flow). Sliding-window rate limit is per-module-instance,
// so both entry points share one throttle when they import this file in the same process.

export const EXCLUDE_PATTERN = "*.md,*test*,.*";
export const MAX_FILE_SIZE_KB = 5120; // bump if you need bigger files included
export const API_BASE = "https://gitingest.com";
export const RATE_LIMIT = 10; // requests per window, per gitingest.com's /api/ingest limit
export const RATE_WINDOW_MS = 60_000;

// Sliding-window throttle: only waits when the Nth-most-recent call was
// less than RATE_WINDOW_MS ago. No-op for small batches.
const callTimestamps = [];
async function throttle() {
  const now = Date.now();
  while (callTimestamps.length && now - callTimestamps[0] > RATE_WINDOW_MS) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= RATE_LIMIT) {
    const waitMs = RATE_WINDOW_MS - (now - callTimestamps[0]) + 100;
    console.error(`  (rate limit: waiting ${(waitMs / 1000).toFixed(1)}s)`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  callTimestamps.push(Date.now());
}

export async function ingestOne(repoUrl) {
  await throttle();
  const ingestRes = await fetch(`${API_BASE}/api/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_text: repoUrl,
      max_file_size: MAX_FILE_SIZE_KB,
      pattern_type: "exclude",
      pattern: EXCLUDE_PATTERN,
      token: "",
    }),
  });

  if (!ingestRes.ok) {
    throw new Error(`ingest failed for ${repoUrl}: ${ingestRes.status} ${await ingestRes.text()}`);
  }

  const data = await ingestRes.json();
  const digestUrl = data.digest_url;
  if (!digestUrl) {
    throw new Error(`no digest_url in response for ${repoUrl}: ${JSON.stringify(data)}`);
  }

  const downloadRes = await fetch(digestUrl);
  if (!downloadRes.ok) {
    throw new Error(`download failed for ${repoUrl}: ${downloadRes.status} ${await downloadRes.text()}`);
  }

  return downloadRes.text();
}

export function slugify(repoUrl) {
  return repoUrl.replace(/^https?:\/\//, "").replace(/[^\w.-]+/g, "_");
}
