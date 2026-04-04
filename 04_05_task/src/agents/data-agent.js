/**
 * Data Agent — gathers all information needed to build orders.
 *
 * Responsibilities:
 *  1. Fetch food requirements (food4cities.json)
 *  2. Query SQLite for all destinations (destination_id, name)
 *  3. Query SQLite for role-2 users (transport personnel)
 *
 * Returns structured JSON stored in shared memory under "gathered".
 */

import { runAgent } from "../agent.js";
import { callMcpTool } from "../mcp-client.js";
import { AGENT_MODEL, AGENT_MAX_STEPS } from "../taskConfig.js";

const INSTRUCTIONS = `
You are a data-collection agent for the foodwarehouse warehouse task.

STEPS (execute ALL three, in order):

1. Call get_food_requirements
   Returns JSON with city names as keys (lowercase, e.g. "opalino").
   These are ALL 8 cities we must serve. Note every city and its required items.

2. Call query_database with a WHERE IN query using the exact city names from step 1.
   Build the query like this (replace the names with the actual cities you found):
     SELECT destination_id, name FROM destinations WHERE LOWER(name) IN ('opalino','domatowo','brudzewo','darzlubie','celbowo','mechowo','puck','karlinkowo') LIMIT 20
   Columns: destination_id (integer, 6-digit), name (string, capitalized).
   You must get EXACTLY 8 rows — one per city. If you get fewer, re-query with LIMIT 50 without the WHERE clause.
   Match each row to the corresponding city by case-insensitive name comparison.
   Every city MUST have a non-zero integer destination_id. Never use 0 or null.

3. Call query_database with query: SELECT user_id, login, birthday, role FROM users WHERE role=2 AND is_active=1 LIMIT 3
   role 2 = transport personnel (required for creating orders).

OUTPUT — return ONLY this JSON, no markdown, no other text:
{"cities":["City1","City2",...],"foodRequirements":{"City1":{"item":qty},...},"destinations":{"City1":123456,...},"users":[{"user_id":2,"login":"tgajewski","birthday":"1991-04-06"}]}

CRITICAL RULES:
- "cities" must list ALL 8 cities (there must be exactly 8).
- Keys in "cities", "foodRequirements", and "destinations" must use the CAPITALIZED form from the destinations table.
- All destination values must be integers (6-digit numbers), never null or strings.
- Include ONLY role-2 users in "users".
- Do NOT call generate_signature, create_order, finalize.
- Return ONLY the JSON object as your final message — nothing else.
`.trim();

export const runDataAgent = async ({ mcpClient, mcpToolDefs }) => {
  console.log("\n\x1b[36m[DataAgent]\x1b[0m Starting data collection…");

  const handlers = Object.fromEntries(
    mcpToolDefs.map((def) => [
      def.name,
      (args) => callMcpTool(mcpClient, def.name, args),
    ]),
  );

  const { text } = await runAgent({
    name: "DataAgent",
    instructions: INSTRUCTIONS,
    definitions: mcpToolDefs,
    handlers,
    messages: [
      {
        role: "user",
        content:
          "Collect all data needed to create delivery orders: food requirements, destination codes (from destinations table), and role-2 users from SQLite.",
      },
    ],
    model: AGENT_MODEL,
    maxSteps: AGENT_MAX_STEPS,
  });

  console.log("\n\x1b[36m[DataAgent]\x1b[0m Raw output (first 500 chars):", text.slice(0, 500));

  // Extract JSON from response — handle markdown fences and extra text
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("[DataAgent] No JSON object found in response");

  const jsonStr = text.slice(start, end + 1);
  try {
    const parsed = JSON.parse(jsonStr);
    // Validate minimum expected fields
    if (!parsed.cities || !parsed.foodRequirements || !parsed.destinations || !parsed.users) {
      throw new Error(`Missing required fields. Got keys: ${Object.keys(parsed).join(", ")}`);
    }
    if (parsed.cities.length < 8) {
      console.warn(`[DataAgent] WARNING: only ${parsed.cities.length} cities found (expected 8). Missing: ${parsed.cities}`);
    }
    return parsed;
  } catch (parseErr) {
    throw new Error(`[DataAgent] JSON parse failed: ${parseErr.message}\n\nRaw (last 200 chars): ...${jsonStr.slice(-200)}`);
  }
};
