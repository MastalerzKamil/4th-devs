import { OPENROUTER_BASE, OPENROUTER_KEY, MODEL, MAX_STEPS } from './config.js';
import { toolSearch, callTool, submitAnswer } from './tools.js';

// ─── LLM tool definitions exposed to the model ───────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_tools',
      description:
        'Search the tool registry to discover available tools. ' +
        'Returns a list of tool names, endpoint URLs and descriptions. ' +
        'Use this first to find out what tools you have access to.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language query describing the kind of tool you are looking for.',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'use_tool',
      description:
        'Call a discovered tool endpoint with a natural language query. ' +
        'All tools accept a "query" string and return JSON. ' +
        'Use the endpoint URL returned by search_tools.',
      parameters: {
        type: 'object',
        properties: {
          endpoint: {
            type: 'string',
            description: 'Relative path or full URL of the tool endpoint (e.g. "/api/maps").',
          },
          query: {
            type: 'string',
            description: 'Natural language query sent to the tool.',
          },
        },
        required: ['endpoint', 'query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'submit_answer',
      description:
        'Submit the final planned route to headquarters. ' +
        'Call this only once you are confident in the optimal route. ' +
        'The first element must be the vehicle name, followed by movement directions.',
      parameters: {
        type: 'object',
        properties: {
          answer: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Array starting with the vehicle name (e.g. "horse"), ' +
              'then a sequence of directions: "up", "down", "left", "right". ' +
              'Example: ["horse", "right", "up", "up", "right"]',
          },
        },
        required: ['answer'],
      },
    },
  },
];

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a route-planning agent for a high-stakes messenger mission.

## MISSION
Your messenger must travel from the starting position (S) to the city of Skolwin (G) on a 10×10 grid map.

## RESOURCES
- Food: 10 portions total
- Fuel: 10 units total
Every single move costs food AND fuel (exact amounts depend on the chosen vehicle).
If either resource runs out before reaching G, the mission fails.

## VEHICLES (you must pick exactly one to depart with)
- rocket  — fuel: 1.0/move, food: 0.1/move  (fast, fuel-hungry, blocked by water)
- car     — fuel: 0.7/move, food: 1.0/move  (balanced, blocked by water)
- horse   — fuel: 0.0/move, food: 1.6/move  (no fuel cost, CAN cross water)
- walk    — fuel: 0.0/move, food: 2.5/move  (no fuel cost, CAN cross water, very food-hungry)
You may also "dismount" mid-route to switch to walking on foot.

## MAP LEGEND
- S = start position
- G = goal (Skolwin)
- . = empty passable ground
- W = water (impassable for rocket and car; passable for horse and walk)
- T = tree (impassable for all)
- R = rock (impassable for all)

## COORDINATE SYSTEM
The map is a 2D array: map[row][col], top-left is (row=0, col=0).
- "up"    → row - 1
- "down"  → row + 1
- "left"  → col - 1
- "right" → col + 1

## YOUR PROCESS
1. Use search_tools to discover what tools are available (maps, vehicles, rules, etc.).
2. Use use_tool to fetch the map for Skolwin, vehicle specs, and any movement-rule notes.
3. Carefully read the map. Identify S and G coordinates. Mark every W/T/R cell as an obstacle.
4. Reason about which cells the chosen vehicle CAN enter.
5. Find the shortest valid path (BFS preferred) from S to G that fits within the resource budget.
6. Verify your resource consumption: total_moves × food_per_move ≤ 10 AND total_moves × fuel_per_move ≤ 10.
7. If no single vehicle can make it, consider using one vehicle for part of the route then dismounting.
8. Call submit_answer with [vehicle_name, dir1, dir2, ...].
   To dismount mid-route, insert "dismount" as a step (e.g. ["rocket","up","right","dismount","right"]).
   After "dismount" the messenger walks (walk food/fuel rules apply from that point on).

## IMPORTANT RULES
- All tool queries must be in English.
- Think step-by-step. Show your BFS or path-finding logic explicitly in your reasoning.
- Double-check obstacle avoidance before submitting.
- You CANNOT move diagonally — only up/down/left/right.`;

// ─── LLM call ─────────────────────────────────────────────────────────────────

async function callLLM(messages) {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 16000,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Tool dispatcher ──────────────────────────────────────────────────────────

async function dispatch(name, args) {
  switch (name) {
    case 'search_tools': {
      console.log(`  [search_tools] query="${args.query}"`);
      return toolSearch(args.query);
    }
    case 'use_tool': {
      console.log(`  [use_tool] endpoint="${args.endpoint}" query="${args.query}"`);
      return callTool(args.endpoint, args.query);
    }
    case 'submit_answer': {
      console.log(`  [submit_answer] answer=${JSON.stringify(args.answer)}`);
      return submitAnswer(args.answer);
    }
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFlag(text) {
  const m = String(text).match(/\{\{[A-Z0-9_]+\}\}|FLG\w+|\bflag[=:]\s*(\S+)/i);
  return m ? m[0] : null;
}

// ─── Main agent loop ──────────────────────────────────────────────────────────

export async function runAgent() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   SAVETHEM — Route Planning Agent        ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`  Model : ${MODEL}`);
  console.log(`  Task  : savethem\n`);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Start the mission. Discover available tools, fetch the Skolwin map, ' +
        'gather vehicle and movement-rule information, plan the optimal route, ' +
        'and submit it. Think carefully about resource constraints and obstacles.',
    },
  ];

  let iteration = 0;
  let done = false;

  while (iteration < MAX_STEPS && !done) {
    iteration++;
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Iteration ${iteration}/${MAX_STEPS}`);
    console.log('─'.repeat(60));

    let llmRes;
    try {
      llmRes = await callLLM(messages);
    } catch (err) {
      console.error(`[LLM] Error: ${err.message}`);
      if (err.message.includes('429')) {
        console.log('  Rate-limited, waiting 15s…');
        await new Promise(r => setTimeout(r, 15_000));
        iteration--;
        continue;
      }
      throw err;
    }

    const choice = llmRes.choices?.[0];
    if (!choice) { console.error('[LLM] No choices returned'); break; }

    const msg = choice.message;

    // Add assistant turn to history
    const assistantEntry = { role: 'assistant', content: msg.content ?? '' };
    if (msg.tool_calls?.length) assistantEntry.tool_calls = msg.tool_calls;
    messages.push(assistantEntry);

    if (msg.content?.trim()) {
      console.log(`\n[Agent thinking]\n${msg.content.trim()}`);
    }

    // No tool calls → agent is done reasoning
    if (!msg.tool_calls?.length) {
      console.log(`\n✅ Agent finished (reason: ${choice.finish_reason})`);
      done = true;
      break;
    }

    // Execute tool calls
    const toolResults = [];
    for (const call of msg.tool_calls) {
      const toolName = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* ignore parse error */ }

      let result;
      try {
        result = await dispatch(toolName, args);
      } catch (err) {
        result = { error: err.message };
      }

      const resultStr = JSON.stringify(result, null, 2);
      console.log(`\n  [tool result: ${toolName}]\n${resultStr.slice(0, 1000)}${resultStr.length > 1000 ? '\n  …(truncated)' : ''}`);

      // Detect success / flag
      const flag = extractFlag(resultStr);
      if (flag) {
        console.log(`\n🏁 FLAG DETECTED: ${flag}`);
        done = true;
      }
      if (result?.code === 0 || resultStr.toLowerCase().includes('"message":"ok"')) {
        console.log('\n🎉 Mission complete!');
        done = true;
      }

      toolResults.push({ role: 'tool', tool_call_id: call.id, content: resultStr });
    }

    messages.push(...toolResults);
  }

  console.log('\n══ Agent loop ended ══');
}
