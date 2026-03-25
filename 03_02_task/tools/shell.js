import { HUB_BASE, API_KEY } from "../config.js";
import { sleep } from "../utils.js";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 8000;

/**
 * Execute a shell command on the remote VM.
 * Handles rate-limits and bans by waiting and retrying.
 */
export async function toolExecuteCommand(cmd) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[VM${attempt > 1 ? ` retry ${attempt}` : ""}] $ ${cmd}`);

    let res;
    try {
      res = await fetch(`${HUB_BASE}/api/shell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: API_KEY, cmd }),
      });
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        console.log(`  [Network error, waiting ${RETRY_DELAY_MS / 1000}s] ${err.message}`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return { error: `Network error: ${err.message}` };
    }

    // Rate limit / temporary ban — parse wait time if available
    if (res.status === 429 || res.status === 503) {
      const body = await res.text().catch(() => "");
      const waitMatch = body.match(/(\d+)\s*s/);
      const waitMs = waitMatch ? parseInt(waitMatch[1], 10) * 1000 + 1000 : RETRY_DELAY_MS;
      console.log(`  [Rate limit / ban, waiting ${waitMs / 1000}s] ${body.slice(0, 120)}`);
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const waitMatch = body.match(/(\d+)\s*s/);
      if (waitMatch && attempt < MAX_RETRIES) {
        const waitMs = parseInt(waitMatch[1], 10) * 1000 + 1000;
        console.log(`  [Ban detected, waiting ${waitMs / 1000}s] ${body.slice(0, 120)}`);
        await sleep(waitMs);
        continue;
      }
      return { error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }

    return res.json().catch(async () => {
      const raw = await res.text().catch(() => "");
      return { error: `Invalid JSON: ${raw.slice(0, 200)}` };
    });
  }

  return { error: `Exhausted ${MAX_RETRIES} retries for command: ${cmd}` };
}
