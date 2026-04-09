/**
 * S05E03 — shellaccess task
 *
 * Agent in the loop: iteratively executes shell commands on a remote server
 * to find information about Rafał (date found, city, coordinates).
 * Blackboard memory stored in .data/shellaccess_memory.json.
 *
 * Run from repo root:
 *   npm run lesson23:task
 *   # or
 *   node --env-file=.env ./05_03_task/app.js
 */

import "../config.js";
import { runShellAgent } from "./src/agent.js";

const apikey = process.env.HUB_APIKEY?.trim();
if (!apikey) {
  console.error("Missing HUB_APIKEY in .env");
  process.exit(1);
}

console.log("\n\x1b[33mshellaccess\x1b[0m agent starting...");

try {
  const result = await runShellAgent({ apikey });
  if (result.flag) {
    console.log("\n\x1b[32m✓ FLAG:\x1b[0m", result.flag);
  } else {
    console.log("\n[done] Agent finished. Outcome:", result.outcome);
  }
} catch (e) {
  console.error("\n\x1b[31m[fatal]\x1b[0m", e.message);
  process.exit(1);
}
