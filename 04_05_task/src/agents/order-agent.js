/**
 * Order Agent — creates and populates all delivery orders.
 *
 * Receives gathered data (cities, food requirements, destinations, users)
 * and for each city:
 *  1. Calls generate_signature with user login+birthday AND that city's destination
 *  2. Calls create_order with title, creatorID, destination, and the returned hash
 *  3. Calls append_items (batch mode) with all required goods
 *
 * Finally calls finalize.
 */

import { runAgent } from "../agent.js";
import { callMcpTool } from "../mcp-client.js";
import { AGENT_MODEL, AGENT_MAX_STEPS } from "../taskConfig.js";

const buildInstructions = (gatheredData) => {
  const user = gatheredData.users[0];
  const cities = gatheredData.cities;

  // Build an explicit ordered task list so the model has no ambiguity
  const cityTasks = cities.map((city, i) => {
    const dest = gatheredData.destinations[city];
    const items = gatheredData.foodRequirements[city];
    return `  City ${i + 1}: ${city}
    destination: ${dest}
    items: ${JSON.stringify(items)}`;
  }).join("\n");

  return `
You are an order-creation agent for the foodwarehouse task.

CREATOR (use for ALL orders):
  user_id: ${user.user_id}
  login: "${user.login}"
  birthday: "${user.birthday}"

CITIES AND THEIR DATA:
${cityTasks}

CRITICAL RULE ABOUT SIGNATURES:
The signature depends on BOTH the user AND the destination.
Each city has a DIFFERENT destination code → each city needs its OWN signature call.
NEVER reuse a signature from one city for another city.
A signature generated for destination ${cities[0] ? gatheredData.destinations[cities[0]] : 'X'} is ONLY valid for that destination.

BEFORE STARTING:
- Call get_orders to see current state.
- Call reset_orders to start clean (removes sample orders).

EXACT WORKFLOW (repeat for EACH city in the list above, ONE city at a time):

Step A — generate_signature:
  Call generate_signature with:
    login: "${user.login}"
    birthday: "${user.birthday}"
    destination: <THIS CITY'S destination code from the list above>
  Note the "hash" (or "signature") value from the response — call it CITY_SIGNATURE.

Step B — create_order:
  Call create_order with:
    title: "Dostawa dla <CityName>"
    creatorID: ${user.user_id}
    destination: <SAME destination code used in Step A>
    signature: CITY_SIGNATURE from Step A
  Note the "id" from the response — call it ORDER_ID.

Step C — append_items:
  Call append_items with:
    id: ORDER_ID from Step B
    items: <the items object for this city>

Then move to the next city and repeat Steps A → B → C.

AFTER ALL ${cities.length} CITIES ARE DONE:
Call finalize.

IMPORTANT: Each city requires its own generate_signature call with ITS OWN destination code.
Do NOT skip any city. Process them in order. Do NOT call finalize early.
`.trim();
};

export const runOrderAgent = async ({ mcpClient, mcpToolDefs, gatheredData }) => {
  console.log("\n\x1b[36m[OrderAgent]\x1b[0m Starting order creation…");
  console.log(`  Cities: ${gatheredData.cities?.join(", ")}`);
  console.log(`  Creator: ${gatheredData.users?.[0]?.login} (id=${gatheredData.users?.[0]?.user_id})`);

  const handlers = Object.fromEntries(
    mcpToolDefs.map((def) => [
      def.name,
      (args) => callMcpTool(mcpClient, def.name, args),
    ]),
  );

  const { text } = await runAgent({
    name: "OrderAgent",
    instructions: buildInstructions(gatheredData),
    definitions: mcpToolDefs,
    handlers,
    messages: [
      {
        role: "user",
        content: `Create delivery orders for all ${gatheredData.cities?.length ?? 0} cities following the exact workflow in your instructions, then call finalize.`,
      },
    ],
    model: AGENT_MODEL,
    maxSteps: AGENT_MAX_STEPS,
  });

  console.log("\n\x1b[36m[OrderAgent]\x1b[0m Done:", text.slice(0, 300));
  return { summary: text };
};
