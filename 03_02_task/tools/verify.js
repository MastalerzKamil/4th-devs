import { HUB_BASE, API_KEY, TASK } from "../config.js";

/**
 * Submit the discovered ECCS code to /verify.
 */
export async function toolSubmitAnswer(confirmation) {
  console.log(`[Submit] Sending confirmation: ${confirmation}`);
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { confirmation } }),
  });

  const data = await res.json().catch(async () => {
    const raw = await res.text().catch(() => "");
    return { error: `HTTP ${res.status}: ${raw.slice(0, 300)}` };
  });

  console.log(`[Submit] Response:`, JSON.stringify(data));
  return data;
}
