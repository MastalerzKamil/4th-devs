import { VERIFY_URL, TASK, FOOD_URL } from "./taskConfig.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Minimum delay between API calls to avoid rate-limiting
const CALL_DELAY_MS = Number(process.env.HUB_CALL_DELAY_MS ?? 1500);
// Max retries on rate-limit (-9999) response
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

let lastCallAt = 0;
const call = async (apikey, answer, retries = MAX_RETRIES) => {
  const now = Date.now();
  const wait = CALL_DELAY_MS - (now - lastCallAt);
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();

  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey, task: TASK, answer }),
  });
  const data = await res.json().catch(() => ({}));

  // Retry on rate limit
  if (data?.code === -9999 && retries > 0) {
    process.stderr.write(`[hub] Rate limited — waiting ${RETRY_DELAY_MS}ms then retrying (${retries} retries left)\n`);
    await sleep(RETRY_DELAY_MS);
    lastCallAt = 0;  // reset so next call goes immediately after the wait
    return call(apikey, answer, retries - 1);
  }

  return { httpOk: res.ok, status: res.status, data };
};

export const getHelp = (apikey) => call(apikey, { tool: "help" });

export const getFoodRequirements = async () => {
  const res = await fetch(FOOD_URL);
  if (!res.ok) throw new Error(`Failed to fetch food requirements: ${res.status}`);
  return res.json();
};

export const queryDatabase = (apikey, query) =>
  call(apikey, { tool: "database", query });

export const getOrders = (apikey) =>
  call(apikey, { tool: "orders", action: "get" });

export const createOrder = (apikey, { title, creatorID, destination, signature }) =>
  call(apikey, { tool: "orders", action: "create", title, creatorID, destination, signature });

export const appendItems = (apikey, { id, items }) =>
  call(apikey, { tool: "orders", action: "append", id, items });

/**
 * Generate SHA1 signature for an order.
 * Requires login + birthday from the users table and the numeric destination code.
 */
export const generateSignature = (apikey, { login, birthday, destination }) =>
  call(apikey, { tool: "signatureGenerator", action: "generate", login, birthday, destination });

export const resetState = (apikey) => call(apikey, { tool: "reset" });

export const callDone = (apikey) => call(apikey, { tool: "done" });
