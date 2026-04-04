/**
 * Orchestrator — coordinates the two sub-agents via a reasoning model.
 *
 * The orchestrator has three tools:
 *  - run_data_agent   → delegates to the DataAgent
 *  - run_order_agent  → delegates to the OrderAgent (receives gathered data)
 *  - memory_update    → stores a value in shared memory
 *  - memory_read      → reads a value from shared memory
 *
 * Shared memory is passed by reference so sub-agent results are always
 * accessible to the orchestrator in subsequent tool calls.
 */

import { runAgent } from "./agent.js";
import { runDataAgent } from "./agents/data-agent.js";
import { runOrderAgent } from "./agents/order-agent.js";
import { createMemory } from "./memory.js";
import { ORCHESTRATOR_MODEL, ORCHESTRATOR_MAX_STEPS } from "./taskConfig.js";

const INSTRUCTIONS = `
You are the orchestrator for the "foodwarehouse" task.

Your goal: ensure delivery orders are created for every city that needs supplies.

You have four tools available:
- run_data_agent: delegates to a specialist agent that fetches food requirements
  and queries the database for destination codes and user information.
- run_order_agent: delegates to a specialist agent that creates and populates
  all orders using the data returned by run_data_agent, then finalises.
- memory_update / memory_read: store and retrieve values between steps.

Workflow:
1. Call run_data_agent with a clear task description.
2. Store the returned JSON data with memory_update (key: "gathered").
3. Read it back with memory_read and pass it to run_order_agent.
4. run_order_agent will create all orders and call finalize internally.
5. Report the final result.

Do not attempt to create orders yourself — delegate everything to the agents.
`.trim();

const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "run_data_agent",
    description:
      "Run the DataAgent to collect food requirements, database schema, destination codes and user data. Returns a JSON object with all gathered information.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Short description of what to collect (passed to the agent as context)",
        },
      },
      required: ["task"],
    },
  },
  {
    type: "function",
    name: "run_order_agent",
    description:
      "Run the OrderAgent to create and populate all delivery orders, then call finalize. Pass the full gathered data object so the agent has everything it needs.",
    parameters: {
      type: "object",
      properties: {
        task: { type: "string", description: "Short description of the order-creation task" },
        gatheredData: {
          type: "object",
          description: "The full JSON object returned by run_data_agent (cities, foodRequirements, destinations, users)",
        },
      },
      required: ["task", "gatheredData"],
    },
  },
  {
    type: "function",
    name: "memory_update",
    description: "Persist a value in shared memory for use in later steps.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { description: "Any JSON-serialisable value" },
      },
      required: ["key", "value"],
    },
  },
  {
    type: "function",
    name: "memory_read",
    description: "Retrieve a value previously stored with memory_update.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
      },
      required: ["key"],
    },
  },
];

export const runOrchestrator = async ({ mcpClient, mcpToolDefs }) => {
  const memory = createMemory();

  const handlers = {
    run_data_agent: async ({ task }) => {
      console.log(`\n\x1b[33m[Orchestrator]\x1b[0m → DataAgent: "${task}"`);
      const data = await runDataAgent({ mcpClient, mcpToolDefs });
      memory.set("gathered", data);
      // Log key gathered values for debugging
      console.log("[Orchestrator] Gathered destinations:", JSON.stringify(data.destinations));
      console.log("[Orchestrator] Gathered cities:", data.cities?.join(", "));
      console.log("[Orchestrator] Users (first):", JSON.stringify(data.users?.[0]));
      return data;
    },

    run_order_agent: async ({ task, gatheredData }) => {
      console.log(`\n\x1b[33m[Orchestrator]\x1b[0m → OrderAgent: "${task}"`);
      const data = gatheredData ?? memory.get("gathered");
      if (!data) throw new Error("gatheredData is missing — run run_data_agent first");
      return runOrderAgent({ mcpClient, mcpToolDefs, gatheredData: data });
    },

    memory_update: ({ key, value }) => {
      memory.set(key, value);
      return { ok: true, key };
    },

    memory_read: ({ key }) => {
      const value = memory.get(key);
      return value !== undefined ? value : null;
    },
  };

  console.log("\n\x1b[33m[Orchestrator]\x1b[0m Starting…");

  return runAgent({
    name: "Orchestrator",
    instructions: INSTRUCTIONS,
    definitions: TOOL_DEFINITIONS,
    handlers,
    messages: [
      {
        role: "user",
        content:
          "Execute the foodwarehouse task: gather all required data and create correct delivery orders for every city.",
      },
    ],
    model: ORCHESTRATOR_MODEL,
    maxSteps: ORCHESTRATOR_MAX_STEPS,
  });
};
