/**
 * Railway hub API client (hub.ag3nts.org/verify, task: railway).
 * Handles 503 retry and 429 rate limit. Used by app.js and railway-tool.js.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VERIFY_URL = "https://hub.ag3nts.org/verify";
const TASK = "railway";
const MIN_DELAY_MS = 2000;
const MAX_503_RETRIES = 10;
const INITIAL_BACKOFF_MS = 2000;

let lastRequestTime = 0;

function extractRateLimitWaitMs(headers, data = {}) {
  if (data.retry_after != null) {
    const sec = typeof data.retry_after === "number" ? data.retry_after : parseInt(String(data.retry_after), 10);
    if (Number.isFinite(sec)) return sec * 1000;
  }
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const sec = parseInt(retryAfter, 10);
    if (Number.isFinite(sec)) return sec * 1000;
  }
  const reset = headers.get("x-ratelimit-reset");
  if (reset) {
    const ts = parseInt(reset, 10);
    if (Number.isFinite(ts)) return Math.max(0, Math.ceil(ts * 1000 - Date.now()));
  }
  return 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForRateLimit(headers, data = {}) {
  const waitFromHeader = extractRateLimitWaitMs(headers, data);
  const elapsed = Date.now() - lastRequestTime;
  const minWait = Math.max(0, MIN_DELAY_MS - elapsed, waitFromHeader);
  if (minWait > 0) await sleep(minWait);
}

/**
 * POST to verify. Returns { status, data, headers }. Handles 503 and 429 internally.
 */
export async function callRailwayApi(apikey, answer) {
  const body = { apikey, task: TASK, answer };
  let lastErr;
  for (let attempt = 1; attempt <= MAX_503_RETRIES; attempt++) {
    await waitForRateLimit(new Headers(), {});
    lastRequestTime = Date.now();

    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (res.status === 503) {
      lastErr = new Error(`503 (attempt ${attempt}/${MAX_503_RETRIES})`);
      const retryAfter = extractRateLimitWaitMs(res.headers, data) || INITIAL_BACKOFF_MS * Math.pow(1.5, attempt - 1);
      await sleep(retryAfter);
      continue;
    }
    if (res.status === 429) {
      const waitMs = extractRateLimitWaitMs(res.headers, data) || 30_000;
      await sleep(waitMs);
      lastRequestTime = Date.now();
      continue;
    }

    await waitForRateLimit(res.headers, data);
    return { status: res.status, data, headers: res.headers };
  }
  throw lastErr || new Error("Max 503 retries exceeded");
}

export function hasFlag(data) {
  const str = typeof data?.message === "string" ? data.message : JSON.stringify(data ?? {});
  const m = str.match(/\{FLG:[^}]+\}/);
  return m ? m[0] : null;
}

export async function getApikeyFromEnv() {
  let apikey = process.env.HUB_APIKEY?.trim() ?? "";
  const envPath = path.join(ROOT, ".env");
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*HUB_APIKEY\s*=\s*(.+?)\s*$/);
      if (m) {
        apikey = m[1].replace(/^["']|["']$/g, "").trim();
        break;
      }
    }
  } catch {
    // ignore
  }
  return apikey;
}
