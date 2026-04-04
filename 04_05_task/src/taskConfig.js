export const VERIFY_URL = "https://hub.ag3nts.org/verify";
export const FOOD_URL = "https://hub.ag3nts.org/dane/food4cities.json";
export const TASK = "foodwarehouse";

/**
 * Orchestrator uses a capable/reasoning model for planning and coordination.
 * Sub-agents use the smallest effective model to minimise token cost.
 *
 * Override via env vars:
 *   ORCHESTRATOR_MODEL=openai/o4-mini
 *   AGENT_MODEL=openai/gpt-4o-mini
 */
export const ORCHESTRATOR_MODEL =
  process.env.ORCHESTRATOR_MODEL?.trim() || "openai/o4-mini";

export const AGENT_MODEL =
  process.env.AGENT_MODEL?.trim() || "openai/gpt-4o-mini";

/** Maximum tool-call rounds per agent */
export const ORCHESTRATOR_MAX_STEPS = 20;
export const AGENT_MAX_STEPS = 60;  // 8 cities × ~3 steps + reset + finalize + overhead
