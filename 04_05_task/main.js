/**
 * S04E05 — foodwarehouse task (multi-agent, MCP-backed).
 *
 * Architecture:
 *  ┌──────────────────────────────────────────────────────────┐
 *  │ Orchestrator (reasoning model)                           │
 *  │   shared memory                                          │
 *  │   ├── run_data_agent  → DataAgent  (small model)         │
 *  │   └── run_order_agent → OrderAgent (small model)         │
 *  └──────────────────────────────────────────────────────────┘
 *         │                        │
 *         └────────────────────────┘
 *              MCP Client ←stdio→ MCP Server (warehouse tools)
 *
 * Run from repo root:
 *   npm run lesson20:task
 *   # or
 *   node --env-file=.env ./04_05_task/main.js
 */

import "../config.js";  // loads .env from repo root

import {
  createWarehouseClient,
  getMcpToolDefinitions,
  closeMcpClient,
} from "./src/mcp-client.js";
import { runOrchestrator } from "./src/orchestrator.js";
import { ORCHESTRATOR_MODEL, AGENT_MODEL } from "./src/taskConfig.js";

const apikey = process.env.HUB_APIKEY?.trim();
if (!apikey) {
  console.error("Missing HUB_APIKEY in .env");
  process.exit(1);
}

console.log("\n\x1b[33mfoodwarehouse\x1b[0m task");
console.log(`  orchestrator : ${ORCHESTRATOR_MODEL}`);
console.log(`  sub-agents   : ${AGENT_MODEL}`);

let mcpClient;
try {
  console.log("\n[main] Connecting to warehouse MCP server…");
  mcpClient = await createWarehouseClient();

  const mcpToolDefs = await getMcpToolDefinitions(mcpClient);
  console.log(`[main] MCP tools available: ${mcpToolDefs.map((t) => t.name).join(", ")}`);

  const result = await runOrchestrator({ mcpClient, mcpToolDefs });

  const msg = result.text;
  if (/FLG/i.test(msg)) {
    console.log("\n\x1b[32m✓ Flag received:\x1b[0m", msg);
  } else {
    console.log("\n[main] Orchestrator final output:", msg);
  }

  process.exit(0);
} catch (err) {
  console.error("\n\x1b[31m[main] Fatal error:\x1b[0m", err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  if (mcpClient) await closeMcpClient(mcpClient).catch(() => {});
}
