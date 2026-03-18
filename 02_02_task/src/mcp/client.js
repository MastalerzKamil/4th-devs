import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(DIR, "../..");

async function loadMcpConfig() {
  const configPath = join(PROJECT_ROOT, "mcp.json");
  const content = await readFile(configPath, "utf-8");
  return JSON.parse(content);
}

/**
 * Create and connect an MCP client for the given server name.
 * Passes current process env vars so the server inherits API keys.
 */
export async function createMcpClient(serverName = "electricity") {
  const config = await loadMcpConfig();
  const serverConfig = config.mcpServers[serverName];

  if (!serverConfig) {
    throw new Error(`MCP server "${serverName}" not found in mcp.json`);
  }

  const client = new Client(
    { name: "electricity-agent-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const transport = new StdioClientTransport({
    command: serverConfig.command,
    args: serverConfig.args,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: process.env.NODE_ENV ?? "development",
      HUB_APIKEY: process.env.HUB_APIKEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
      AI_PROVIDER: process.env.AI_PROVIDER ?? "openrouter",
      ...serverConfig.env,
    },
    cwd: PROJECT_ROOT,
    stderr: "inherit",
  });

  await client.connect(transport);
  console.log(`  [MCP] Connected to server: ${serverName}`);

  return client;
}

/**
 * List all tools from the MCP server and convert to OpenAI
 * chat completions function-calling format.
 */
export async function getMcpToolDefinitions(client) {
  const { tools } = await client.listTools();
  console.log(`  [MCP] Available tools: ${tools.map((t) => t.name).join(", ")}`);

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {}, required: [] },
    },
  }));
}

/**
 * Call an MCP tool by name with arguments.
 * Returns the text content as a string.
 */
export async function callMcpTool(client, name, argsStr) {
  const args = argsStr
    ? typeof argsStr === "string"
      ? JSON.parse(argsStr)
      : argsStr
    : {};

  const result = await client.callTool({ name, arguments: args });

  const textContent = result.content?.find((c) => c.type === "text");
  return textContent?.text ?? JSON.stringify(result);
}

/**
 * Gracefully close the MCP client.
 */
export async function closeMcpClient(client) {
  try {
    await client.close();
    console.log("  [MCP] Client closed.");
  } catch {
    // ignore close errors
  }
}
