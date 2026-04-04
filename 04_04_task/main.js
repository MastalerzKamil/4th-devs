/**
 * S04E04 — filesystem task (multi-agent).
 *
 * 1. Reader — tools read ./input notes
 * 2. Analyst — structured output (Responses API text.format json_schema)
 * 3. Validate batch using hub `help` limits; second structured pass if needed
 * 4. Single POST batch + done
 *
 * Deterministic: node --env-file=.env ./04_04_task/main.js --deterministic
 *
 * From repo root: npm run lesson19:task
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import "../config.js";

import { postFilesystem } from "./src/hub.js";
import { solveFilesystem } from "./src/solve.js";
import { runFilesystemPipeline } from "./src/orchestrator.js";

const TASK_ROOT = dirname(fileURLToPath(import.meta.url));
const NOTES_DIR = join(TASK_ROOT, "input");

const apikey = process.env.HUB_APIKEY?.trim();
if (!apikey) {
  console.error("Missing HUB_APIKEY (Centrala API key for /verify).");
  process.exit(1);
}

const helpOnly = process.argv.includes("--help-only");
const deterministic = process.argv.includes("--deterministic");

console.log("\n\x1b[33mfilesystem\x1b[0m task\n");

const helpRes = await postFilesystem(apikey, { action: "help" });
console.log("[main] help:", JSON.stringify(helpRes, null, 2));

if (!helpRes.httpOk) {
  console.error("Help request failed.");
  process.exit(1);
}

const helpData = helpRes.data;

if (helpOnly) {
  process.exit(0);
}

try {
  if (deterministic) {
    console.log("\n\x1b[33m--deterministic\x1b[0m: skipping agents\n");
    const { applied, done, batchOpCount, validation } = await solveFilesystem(
      apikey,
      NOTES_DIR,
      helpData,
    );
    console.log(`\n[main] batch (${batchOpCount} ops), help validation: ${validation.ok ? "ok" : "failed"}`);
    console.log("\n[main] apply:", JSON.stringify(applied, null, 2));
    console.log("\n[main] done:", JSON.stringify(done, null, 2));
    summarizeDone(done);
    process.exit(done?.httpOk && done?.data?.code === 0 ? 0 : 1);
  }

  const result = await runFilesystemPipeline({
    apikey,
    notesDir: NOTES_DIR,
    helpData,
  });

  const done = result.verifyOutcome.lastDone;
  if (result.verifyOutcome.usedRepairBatch) {
    console.log("\n[main] Used second structured-analyst pass after help validation failed.");
  }
  console.log("\n[main] done:", JSON.stringify(done, null, 2));
  summarizeDone(done);
  process.exit(done?.httpOk && done?.data?.code === 0 ? 0 : 1);
} catch (e) {
  console.error(e);
  process.exit(1);
}

function summarizeDone(done) {
  const msg = done?.data?.message ?? done?.data?.msg ?? done?.message;
  if (typeof msg === "string") {
    if (/FLG/i.test(msg)) {
      console.log("\n\x1b[32mVerification message:\x1b[0m", msg);
    } else if (done?.data?.code !== 0 && done?.data?.code !== undefined) {
      console.log("\n\x1b[31mVerifier returned:\x1b[0m", msg);
    }
  }
}
