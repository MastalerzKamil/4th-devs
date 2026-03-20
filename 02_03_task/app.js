/**
 * S02E03 — Failure Log Compression (Agentic + MCP)
 *
 * Architecture:
 *
 *   Orchestrator Agent (Gemini Flash, function calling)
 *     │
 *     └── MCP Client (stdio transport)
 *           │
 *           └── MCP Server  [src/mcp/server.js]
 *                 ├── fetch_logs         — Download raw log file
 *                 ├── analyze_logs       — LLM subagent extracts critical events
 *                 ├── refine_logs        — LLM subagent refines based on feedback
 *                 ├── count_tokens       — Estimate token count
 *                 └── submit_answer      — Submit to verification API
 */

import "../config.js";
import { runAgent } from "./src/agent/index.js";
import { createMcpClient, getMcpToolDefinitions, callMcpTool, closeMcpClient } from "./src/mcp/client.js";
import { getUsageStats } from "./src/helpers/api.js";

const TASK = `Analyze the power plant failure logs and submit a compressed version.

Steps:
1. Fetch the full log file
2. Use analyze_logs to extract critical events with the LLM subagent
3. Count tokens to verify under 1500
4. Submit the compressed logs
5. If feedback indicates missing info, use refine_logs with the feedback and raw logs, then re-submit
6. Repeat until you get the flag

Start now by fetching the logs.`;

async function main() {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  S02E03 — Failure Log Compression (Agentic+MCP) ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  // 1. Start MCP server and connect client
  console.log("Booting MCP server...");
  const mcpClient = await createMcpClient("failure-logs");

  // 2. Get tool definitions from MCP server
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
    console.log(`\nFLAG: ${flagMatch[0]}`);
  } else {
    console.log("\nNo flag in final response.");
    console.log("Agent response:", result.response?.slice(0, 500));
  }
}

main().catch(console.error);
