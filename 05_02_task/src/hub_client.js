const VERIFY_URL = "https://hub.ag3nts.org/verify";
const TASK = "phonecall";

/**
 * @param {string} apikey
 * @param {Record<string, unknown>} answer
 */
export async function verifyPhonecall(apikey, answer) {
  const body = { apikey, task: TASK, answer };
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { parseError: true, raw: text.slice(0, 500), httpStatus: res.status };
  }

  return { ok: res.ok, status: res.status, data };
}

export function summarizeHubData(data) {
  if (!data || typeof data !== "object") return String(data);
  const copy = { ...data };
  if (typeof copy.audio === "string") copy.audio = `[base64 ${copy.audio.length} chars]`;
  if (typeof copy.attachment === "string") copy.attachment = `[base64 ${copy.attachment.length} chars]`;
  return JSON.stringify(copy, null, 2);
}
