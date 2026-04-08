/**
 * S05E01 — radiomonitoring task (multi-agent, Blackboard pattern).
 *
 * Architecture:
 *  ┌──────────────────────────────────────────────────────────────┐
 *  │  Orchestrator (pure JS state machine)                        │
 *  │   Blackboard (shared memory)                                 │
 *  │   ├── ListenerAgent  → fetches & locally routes signals      │
 *  │   ├── AnalyzerAgent  → LLM extracts facts from text only     │
 *  │   └── ReporterAgent  → transmits final report                │
 *  └──────────────────────────────────────────────────────────────┘
 *
 * Token-cost strategy:
 *  - Binary files are NEVER sent raw to LLM
 *  - Base64 decoded locally; JSON/text extracted as plain text
 *  - Images sent to cheap vision model (Gemini Flash) only when needed
 *  - Text analysis uses cheap small model (GPT-4o-mini / Gemini Flash)
 *
 * Run from repo root:
 *   node --env-file=.env ./05_01_task/main.js
 */

import "../config.js";

import { createBlackboard } from "./src/blackboard.js";
import { runOrchestrator } from "./src/orchestrator.js";
import { ANALYZER_MODEL, VISION_MODEL } from "./src/taskConfig.js";

const apikey = process.env.HUB_APIKEY?.trim();
if (!apikey) {
  console.error("Missing HUB_APIKEY in .env");
  process.exit(1);
}

console.log("\n\x1b[33mradiomonitoring\x1b[0m task");
console.log(`  analyzer model : ${ANALYZER_MODEL}`);
console.log(`  vision model   : ${VISION_MODEL}`);

const blackboard = createBlackboard();

try {
  const result = await runOrchestrator({ apikey, blackboard });

  if (result?.flag || /FLG/i.test(JSON.stringify(result))) {
    console.log("\n\x1b[32m✓ Flag received:\x1b[0m", JSON.stringify(result, null, 2));
  } else {
    console.log("\n[main] Final result:", JSON.stringify(result, null, 2));
  }

  process.exit(0);
} catch (err) {
  console.error("\n\x1b[31m[main] Fatal error:\x1b[0m", err.message);
  console.error(err.stack);
  process.exit(1);
}
