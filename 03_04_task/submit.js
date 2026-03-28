/**
 * S03E04 — submit tools to hub / check result
 *
 * Usage:
 *   node submit.js <ngrok-url>       register tools and trigger agent
 *   node submit.js check             check verification result
 *
 * Example:
 *   node submit.js https://abc123.ngrok-free.app
 *   node submit.js check
 */

import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_ENV = path.join(__dirname, "..", ".env");

if (existsSync(ROOT_ENV)) {
  try { process.loadEnvFile(ROOT_ENV); } catch { /* node < 20.12 */ }
}

const HUB_APIKEY = process.env.HUB_APIKEY ?? "";
const HUB_URL = "https://hub.ag3nts.org/verify";

if (!HUB_APIKEY) {
  console.error("Error: HUB_APIKEY not set in .env");
  process.exit(1);
}

const [,, arg] = process.argv;

// ─── Check mode ───────────────────────────────────────────────────────────────
if (arg === "check") {
  console.log("Checking verification result…");
  const resp = await fetch(HUB_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey: HUB_APIKEY,
      task: "negotiations",
      answer: { action: "check" },
    }),
  });
  const data = await resp.json();
  console.log("Result:", JSON.stringify(data, null, 2));
  process.exit(0);
}

// ─── Submit mode ──────────────────────────────────────────────────────────────
const ngrokUrl = arg?.replace(/\/$/, "");

if (!ngrokUrl || !ngrokUrl.startsWith("http")) {
  console.error("Usage: node submit.js <ngrok-url>  OR  node submit.js check");
  console.error("Example: node submit.js https://abc123.ngrok-free.app");
  process.exit(1);
}

const toolUrl = `${ngrokUrl}/search`;

const payload = {
  apikey: HUB_APIKEY,
  task: "negotiations",
  answer: {
    tools: [
      {
        URL: toolUrl,
        description:
          "Find cities that sell a specific item. " +
          "Send item description in natural language in 'params'. " +
          "Returns comma-separated city names that have the item. " +
          "Call once per item. Example params: 'turbina wiatrowa 400W 48V', 'inwerter DC/AC 48V 3000W'.",
      },
    ],
  },
};

console.log("Submitting tools to hub…");
console.log("Tool URL:", toolUrl);

const resp = await fetch(HUB_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const data = await resp.json();
console.log("Hub response:", JSON.stringify(data, null, 2));
console.log("\nAgent is now running. Wait 30-60s then run:");
console.log("  node submit.js check");
