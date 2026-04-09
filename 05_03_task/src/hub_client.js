const VERIFY_URL = "https://hub.ag3nts.org/verify";
const TASK = "shellaccess";

/**
 * Execute a shell command on the remote server via hub API.
 * @param {string} apikey
 * @param {string} cmd
 */
export async function executeCommand(apikey, cmd) {
  const body = { apikey, task: TASK, answer: { cmd } };
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
    data = { raw: text.slice(0, 2000) };
  }

  return { ok: res.ok, status: res.status, data, rawText: text };
}

/**
 * Try to decrypt a hint that might be base64 or ROT13 encoded.
 * @param {string | null | undefined} hint
 * @returns {string | null}
 */
export function decryptHint(hint) {
  if (!hint || typeof hint !== "string") return null;

  const trimmed = hint.trim();

  // Try base64 decode (must produce printable ASCII/UTF-8)
  try {
    const decoded = Buffer.from(trimmed, "base64").toString("utf8");
    if (
      decoded.length > 3 &&
      decoded.length < trimmed.length * 2 &&
      /^[\x20-\x7E\r\n\t]+$/.test(decoded)
    ) {
      return decoded;
    }
  } catch {
    // not base64
  }

  // Try ROT13
  const rot13 = trimmed.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  if (rot13 !== trimmed) return rot13;

  // Return as-is
  return trimmed;
}

/**
 * Extract the text output from hub response data.
 * @param {unknown} data
 * @returns {string}
 */
export function extractOutput(data) {
  if (!data) return "(no output)";
  if (typeof data === "string") return data;
  if (typeof data !== "object") return String(data);

  const d = /** @type {Record<string, unknown>} */ (data);
  // Prefer 'output' (actual command output) over 'message' (status string)
  const msg = d.output ?? d.result ?? d.reply ?? d.raw ?? d.message;
  if (typeof msg === "string") return msg;

  return JSON.stringify(data).slice(0, 2000);
}

/**
 * Extract flag from hub response.
 * @param {unknown} data
 * @returns {string | null}
 */
export function extractFlag(data) {
  const str = typeof data === "string" ? data : JSON.stringify(data ?? {});
  // Match {FLG:...}, FLG{...}, {{FLG...}}
  const m =
    str.match(/\{FLG:[^}]+\}/) ??
    str.match(/FLG\{[^}]+\}/i) ??
    str.match(/\{\{FLG[^}]*\}\}/);
  return m ? m[0] : null;
}
