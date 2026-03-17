/**
 * Task S02E01 — Categorize (agentic version)
 *
 * Claude acts as a full agent with tools to interact with the hub.
 * It autonomously fetches items, tests prompts, reads errors, and iterates.
 *
 * Prompt caching note: the hub caches the static prefix of each prompt.
 * We mark the system prompt with cache_control so OpenRouter/Anthropic caches it too.
 */

const HUB_BASE = "https://hub.ag3nts.org";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const API_KEY = process.env.HUB_APIKEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const TASK = "categorize";
const MODEL = "anthropic/claude-sonnet-4-6";

if (!API_KEY) { console.error("Missing HUB_APIKEY"); process.exit(1); }
if (!OPENROUTER_KEY) { console.error("Missing OPENROUTER_API_KEY"); process.exit(1); }

// ─── Tool implementations ────────────────────────────────────────────────────

async function toolFetchItems() {
  const url = `${HUB_BASE}/data/${API_KEY}/${TASK}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idCol = header.findIndex((h) => h === "id" || h === "code") ?? 0;
  const descCol = header.findIndex((h) => h.includes("desc") || h.includes("opis")) ?? 1;
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(",");
      return {
        id: parts[idCol]?.trim() ?? "",
        description: parts.slice(descCol).join(",").trim().replace(/^"|"$/g, ""),
      };
    });
}

async function toolClassifyItem(prompt) {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { prompt } }),
  });
  return res.json();
}

async function toolResetBudget() {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { prompt: "reset" } }),
  });
  return res.json();
}

// ─── Tool definitions for Claude ─────────────────────────────────────────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "fetch_items",
      description:
        "Fetch the current list of 10 items to classify from the hub CSV. Returns array of {id, description}. Always fetch fresh before a new classification attempt — contents change every few minutes.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "classify_item",
      description:
        "Send a filled prompt for one item to the hub classifier. The prompt must be under 100 tokens. Hub returns {code, message, balance}. code=0 means correct classification; code<0 means error. The flag {FLG:...} appears in message when ALL 10 items are correctly classified.",
      parameters: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: {
            type: "string",
            description: "The filled prompt with actual item id and description substituted in. Must include the item id somewhere.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_budget",
      description:
        "Reset the token budget back to 1.5 PP. Call this before each new classification attempt to avoid running out of budget mid-attempt.",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

async function dispatchTool(name, args) {
  switch (name) {
    case "fetch_items":
      return toolFetchItems();
    case "classify_item":
      return toolClassifyItem(args.prompt);
    case "reset_budget":
      return toolResetBudget();
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are solving a CTF challenge: classify 10 goods as DNG (dangerous weapon) or NEU (neutral/safe).

## CRITICAL: How the hub works
Your prompt is passed to a small internal LLM. That LLM's response MUST be exactly the single word "DNG" or "NEU" — nothing else.
If it responds with anything else (explanations, "Firearm", "Weapon", categories, etc.) the hub returns code=-890 (NOT ACCEPTED).
You MUST include a strong format constraint like "Reply with only DNG or NEU" in your prompt.

## Good prompt example (proven to work):
"Is this item a weapon designed to directly harm humans? Answer DNG if yes, NEU if no. Only output DNG or NEU. Item: {id} {description}"

Key properties:
1. Forces a yes/no question (single-word answer)
2. Explicit: "Only output DNG or NEU"
3. Static instruction FIRST, variable data ({id} {description}) LAST

## Your task
1. Fetch the items with fetch_items
2. Reset budget with reset_budget
3. Call classify_item 10 times with good filled prompts (under 100 tokens each)
4. If code=-890 (NOT ACCEPTED): adjust prompt format (model didn't answer DNG/NEU)
5. If code=-910 (insufficient funds): call reset_budget and retry all 10
6. When all 10 correct the hub returns {FLG:...} — report it and stop

## Classification rules
- Firearms, rifles, handguns, knives, blades, spears → DNG
- Industrial parts, machine components, electronics, wiring, energy/fuel items → NEU

## Prompt caching (reduces cost — important for 1.5 PP budget)
- Static prefix FIRST (cached after request 1), {id} and {description} at the END
- Longer static prefix = more cache hits = cheaper
- Total filled prompt must stay under 100 tokens`;

async function runAgent() {
  console.log("=== S02E01 Categorize (agentic) ===\n");

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Solve the categorize task and get the flag." },
  ];

  let iteration = 0;
  const MAX_ITERATIONS = 30;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENROUTER_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        messages,
        tools: TOOLS,
        tool_choice: "auto",
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`API error ${res.status}: ${err}`);
    }

    const data = await res.json();
    const choice = data.choices[0];
    const msg = choice.message;

    // Add assistant message to history
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

    // Print any text the agent says
    if (msg.content) {
      console.log(`[Agent] ${msg.content}`);
    }

    // Check if done
    if (choice.finish_reason === "stop" && !msg.tool_calls?.length) {
      console.log("\nAgent finished.");
      break;
    }

    // Execute tool calls
    if (msg.tool_calls?.length) {
      const toolResults = [];
      for (const call of msg.tool_calls) {
        const name = call.function.name;
        const args = JSON.parse(call.function.arguments || "{}");
        console.log(`[Tool] ${name}(${JSON.stringify(args).slice(0, 80)})`);

        let result;
        try {
          result = await dispatchTool(name, args);
        } catch (err) {
          result = { error: err.message };
        }

        const resultStr = JSON.stringify(result);
        console.log(`       → ${resultStr.slice(0, 120)}`);

        // Check for flag
        if (resultStr.includes("{FLG:")) {
          const flagMatch = resultStr.match(/\{FLG:[^}]+\}/);
          if (flagMatch) {
            console.log(`\n✅ SUCCESS! Flag: ${flagMatch[0]}`);
          }
        }

        toolResults.push({
          role: "tool",
          tool_call_id: call.id,
          content: resultStr,
        });
      }

      // Add tool results to history
      messages.push(...toolResults);
    }
  }
}

runAgent().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
