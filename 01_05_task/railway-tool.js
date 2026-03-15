/**
 * Railway tool — definicja narzędzia dla 01_05_agent.
 * Eksportuje obiekt zgodny z Tool (type, definition, handler). Kod pod 01_05_task.
 */

import { callRailwayApi, getApikeyFromEnv } from "./railway-api.js";

const definition = {
  type: "function",
  name: "railway",
  description:
    "Call the railway hub API (task railway). First use action \"help\" to get documentation. To activate route X-01: 1) reconfigure with route X-01, 2) setstatus with route X-01 and value RTOPEN, 3) save with route X-01. API is rate-limited and may return 503; the tool retries automatically.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["help", "reconfigure", "getstatus", "setstatus", "save"],
        description: "API action",
      },
      route: {
        type: "string",
        description: "Route name (e.g. X-01). Required for reconfigure, getstatus, setstatus, save.",
      },
      value: {
        type: "string",
        enum: ["RTOPEN", "RTCLOSE"],
        description: "Required for setstatus. RTOPEN = open, RTCLOSE = close.",
      },
    },
    required: ["action"],
  },
};

async function handler(args) {
  const apikey = await getApikeyFromEnv();
  if (!apikey) {
    return { ok: false, error: "HUB_APIKEY not set in environment" };
  }

  const answer = { action: args.action };
  if (args.route != null) answer.route = args.route;
  if (args.value != null) answer.value = args.value;

  try {
    const { status, data } = await callRailwayApi(apikey, answer);
    return { ok: true, output: JSON.stringify({ status, ...data }, null, 2) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Tool object for 01_05_agent registry (type, definition, handler). */
export const railwayTool = {
  type: "async",
  definition,
  handler,
};
