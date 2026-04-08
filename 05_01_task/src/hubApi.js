/**
 * Hub API wrapper for the radiomonitoring task.
 *
 * Handles rate-limiting via a configurable delay between calls,
 * and retries on rate-limit response code -9999.
 */

import { VERIFY_URL, TASK, HUB_CALL_DELAY_MS } from "./taskConfig.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MAX_RETRIES = 4;
const RETRY_DELAY_MS = 5_000;

let lastCallAt = 0;

const post = async (apikey, answer, retries = MAX_RETRIES) => {
  // Enforce minimum gap between calls
  const wait = HUB_CALL_DELAY_MS - (Date.now() - lastCallAt);
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
    console.warn(`[hubApi] Rate limited — retrying in ${RETRY_DELAY_MS}ms (${retries} left)`);
    await sleep(RETRY_DELAY_MS);
    lastCallAt = 0;
    return post(apikey, answer, retries - 1);
  }

  return data;
};

/** Step 1: Initialise the radio-monitoring session. */
export const startSession = (apikey) => post(apikey, { action: "start" });

/** Step 2: Fetch the next captured signal. */
export const listenSignal = (apikey) => post(apikey, { action: "listen" });

/**
 * Step 3: Transmit the final intelligence report.
 * @param {string} apikey
 * @param {{ cityName: string, cityArea: string, warehousesCount: number, phoneNumber: string }} report
 */
export const transmitReport = (apikey, { cityName, cityArea, warehousesCount, phoneNumber }) =>
  post(apikey, { action: "transmit", cityName, cityArea, warehousesCount, phoneNumber });
