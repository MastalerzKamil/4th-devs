/**
 * MCP Client — spawns the warehouse MCP server as a child process over stdio
 * and converts its tools into OpenAI Responses-API function definitions that
 * our agent loop can use directly.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Spawn the warehouse MCP server subprocess and return a connected client.
 * All current env vars (including HUB_APIKEY) are forwarded to the server.
 */
export const createWarehouseClient = async () => {
  const client = new Client(
    { name: "warehouse-orchestrator-client", version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = new StdioClientTransport({
    command: process.execPath,          // current Node binary — no PATH dependency
    args: [join(__dirname, "mcp-server.js")],
    env: { ...process.env },
    stderr: "inherit",
  });

  await client.connect(transport);
  return client;
};

/**
 * Convert MCP tool descriptors → OpenAI Responses-API function definitions.
 *
 * MCP:  { name, description, inputSchema: { type, properties, required } }
 * OAI:  { type: "function", name, description, parameters: { ... } }
 */
export const getMcpToolDefinitions = async (client) => {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    type: "function",
    name: t.name,
    description: t.description,
    parameters: t.inputSchema ?? { type: "object", properties: {} },
  }));
};

/**
 * Call a tool on the MCP server and return its parsed result.
 * The MCP server always returns { content: [{ type: "text", text: "..." }] }
 * where text is a JSON string.
 */
export const callMcpTool = async (client, name, args) => {
  const result = await client.callTool({ name, arguments: args ?? {} });
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

/** Gracefully close the MCP client (and its server subprocess). */
export const closeMcpClient = async (client) => {
  await client.close();
};
