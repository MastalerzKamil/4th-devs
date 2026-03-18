/**
 * S02E02 — Electricity Puzzle Solver (Agentic + MCP)
 *
 * Architecture:
 *
 *   Orchestrator Agent (Gemini Flash, function calling)
 *     │
 *     └── MCP Client (stdio transport)
 *           │
 *           └── MCP Server  [src/mcp/server.js]
 *                 ├── reset_and_download_board
 *                 ├── analyze_board_with_vision
 *                 │     └── Vision Subagent (Gemini Flash) — 9 cells in parallel
 *                 │           └── Pixel validation layer
 *                 ├── solve_puzzle (backtracking + BFS)
 *                 ├── rotate_cell (hub API)
 *                 └── download_board
 */

import "../config.js";
import { runAgent } from "./src/agent/index.js";
import { createMcpClient, getMcpToolDefinitions, callMcpTool, closeMcpClient } from "./src/mcp/client.js";
import { getUsageStats } from "./src/helpers/api.js";

const TASK = `Solve the electricity puzzle. Follow these steps:
1. Reset the board and download the image
2. Analyze the board image with the vision subagent
3. Use the cell data to solve the puzzle
4. Execute ALL rotations from the plan one by one (if a cell needs 3 rotations, call rotate_cell 3 times)
5. Report the flag when found

Start now.`;

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  S02E02 — Electricity Puzzle (Agentic + MCP)    ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 1. Start MCP server and connect client
  console.log("Booting MCP server...");
  const mcpClient = await createMcpClient("electricity");

  // 2. Get tool definitions from MCP server (OpenAI chat completions format)
  const toolDefinitions = await getMcpToolDefinitions(mcpClient);

  // 3. Build tools object expected by agent
  const tools = {
    definitions: toolDefinitions,
    handle: (name, argsStr) => callMcpTool(mcpClient, name, argsStr),
  };

  console.log("\nLaunching orchestrator agent...");

  // 4. Run the agent
  const result = await runAgent(TASK, tools);

  // 5. Shutdown MCP server
  await closeMcpClient(mcpClient);

  // 6. Summary
  const stats = getUsageStats();
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║                   SUMMARY                       ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`Agent steps:       ${result.steps}`);
  console.log(`API requests:      ${stats.requests}`);
  console.log(`Prompt tokens:     ${stats.promptTokens}`);
  console.log(`Completion tokens: ${stats.completionTokens}`);

  const flagMatch = result.response?.match(/\{FLG:.*?\}/);
  if (flagMatch) {
    console.log(`\n🏁 FLAG: ${flagMatch[0]}`);
  } else {
    console.log("\n⚠️  No flag in final response.");
    console.log("Agent response:", result.response?.slice(0, 500));
  }

  console.log("\nSecrets found: none in API responses");
}

main().catch(console.error);
