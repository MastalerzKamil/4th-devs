import {
  HUB_BASE, API_KEY, TASK, OPENROUTER_BASE, OPENROUTER_KEY, MODEL,
  PREVIEW_URL, MAX_STEPS, SCREENSHOT_INTERVAL,
} from './config.js';
import {
  parseMap, decideCommand, updateBlockDirs,
} from './navigator.js';
import { launchPreview, takeScreenshot, closeBrowser } from './browser.js';

// ─── Hub API ───────────────────────────────────────────────────────────────

async function sendCommand(command) {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { command } }),
  });
  if (!res.ok) throw new Error(`Hub error ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Formatting helpers ────────────────────────────────────────────────────

function renderBoard(mapStr) {
  const lines = mapStr.trim().split('\n');
  return lines.map((row, i) => `  row${i + 1}  ${row}`).join('\n');
}

function extractFlag(text) {
  const m = String(text).match(/\{\{[A-Z0-9_]+\}\}|FLG\w+|\bflag[=:]\s*(\S+)/i);
  return m ? m[0] : null;
}

// ─── LLM call (OpenRouter) ─────────────────────────────────────────────────

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_reactor_command',
      description: 'Send one command to the reactor robot API and get back the updated board state.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            enum: ['start', 'right', 'left', 'wait', 'reset'],
            description: 'The command to send.',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'take_preview_screenshot',
      description: 'Take a screenshot of the reactor visual preview page in the browser.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

const SYSTEM_PROMPT = `You are controlling a robot that must transport a cooling module through a reactor.

BOARD: 7 columns × 5 rows. Robot (P) starts at col 1, row 5. Goal (G) is at col 7, row 5.
Reactor blocks (B) are 2 rows tall and bounce up/down. They move one step with EVERY command you send.

RULES:
- Only one command at a time: start | right | left | wait | reset
- The robot moves on the bottom row only
- A block crushes the robot if it occupies the bottom row (row 5) when the robot is there
- The flag/answer is returned by the API when the robot reaches the goal

ALGORITHM (follow this strictly):
1. Always start by sending "start".
2. After each command, look at the returned map and block data.
3. Decide the next command:
   a. If the column to the RIGHT will be safe after one block step → send "right"
   b. If right is not safe but CURRENT column stays safe after one step → send "wait"
   c. If both right and current column are dangerous (block closing in) → send "left"
4. Repeat until the robot reaches the goal (col 7).
5. When you see a flag ({{...}} or similar) in the API response, report it clearly.

SAFETY: A column is safe if the block top row in that column will be ≤ 2 after moving
(block occupies rows ≤ 2-3, which does not touch the robot row 4/5).

Use the send_reactor_command tool to interact with the API.
Use take_preview_screenshot occasionally to monitor progress visually.
When done, output the flag you found.`;

async function callLLM(messages) {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENROUTER_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4096,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  return res.json();
}

// ─── Tool dispatch ─────────────────────────────────────────────────────────

let stepCount = 0;
let prevBlockTopRow = {};
let blockDir = {};

async function dispatchTool(name, args) {
  if (name === 'send_reactor_command') {
    const { command } = args;
    console.log(`  → command: ${command}`);
    const data = await sendCommand(command);
    stepCount++;

    // Parse map to update block directions
    if (data.map) {
      const parsed = parseMap(data.map);
      updateBlockDirs(prevBlockTopRow, parsed.blockTopRow, blockDir);
      prevBlockTopRow = parsed.blockTopRow;

      const robotColDisplay = parsed.robotCol + 1; // 1-indexed for display
      const goalColDisplay = parsed.goalCol + 1;
      console.log(`  Robot col: ${robotColDisplay}  Goal col: ${goalColDisplay}  Blocks: ${JSON.stringify(parsed.blockTopRow)}`);
      console.log('  Board:\n' + renderBoard(data.map));
    }

    // Take a screenshot periodically
    if (stepCount % SCREENSHOT_INTERVAL === 0) {
      const path = await takeScreenshot(`step-${stepCount}`);
      if (path) console.log(`  [screenshot] ${path}`);
    }

    // Check for flags
    const raw = JSON.stringify(data);
    const flag = extractFlag(raw);
    if (flag) console.log(`\n  🏁 FLAG DETECTED: ${flag}`);

    return data;
  }

  if (name === 'take_preview_screenshot') {
    const path = await takeScreenshot(`manual-${Date.now()}`);
    return { screenshot: path || 'unavailable' };
  }

  return { error: `Unknown tool: ${name}` };
}

// ─── Main agent loop ───────────────────────────────────────────────────────

export async function runAgent() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   S03E03 — Reactor Robot Agent           ║');
  console.log('╚══════════════════════════════════════════╝\n');
  console.log(`  Model   : ${MODEL}`);
  console.log(`  Hub     : ${HUB_BASE}`);
  console.log(`  Task    : ${TASK}`);
  console.log(`  Preview : ${PREVIEW_URL}\n`);

  // Launch playwright browser to monitor the preview
  try {
    await launchPreview(PREVIEW_URL);
    await takeScreenshot('step-0-initial');
    console.log('  [browser] Initial screenshot saved.\n');
  } catch (err) {
    console.warn(`  [browser] Could not launch preview: ${err.message}`);
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Start the reactor navigation mission. ' +
        'Send the "start" command first, then navigate the robot to the goal column using the algorithm. ' +
        'Report the flag when you find it.',
    },
  ];

  let iteration = 0;
  let missionComplete = false;

  while (iteration < MAX_STEPS && !missionComplete) {
    iteration++;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Iteration ${iteration}/${MAX_STEPS}`);
    console.log('─'.repeat(50));

    let llmRes;
    try {
      llmRes = await callLLM(messages);
    } catch (err) {
      console.error(`[LLM] Error: ${err.message}`);
      if (err.message.includes('429')) {
        await new Promise(r => setTimeout(r, 15_000));
        iteration--;
        continue;
      }
      throw err;
    }

    const choice = llmRes.choices?.[0];
    if (!choice) { console.error('[LLM] No choices'); break; }

    const msg = choice.message;
    const assistantMsg = { role: 'assistant', content: msg.content ?? '' };
    if (msg.tool_calls?.length) assistantMsg.tool_calls = msg.tool_calls;
    messages.push(assistantMsg);

    if (msg.content?.trim()) {
      console.log(`\n[Agent] ${msg.content.trim()}`);
    }

    if (!msg.tool_calls?.length) {
      console.log(`\n✅ Agent finished (${choice.finish_reason})`);
      missionComplete = true;
      break;
    }

    const toolResults = [];
    for (const call of msg.tool_calls) {
      const toolName = call.function.name;
      let args = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* ignore */ }

      let result;
      try { result = await dispatchTool(toolName, args); }
      catch (err) { result = { error: err.message }; }

      const resultStr = JSON.stringify(result);
      console.log(`  [tool result] ${resultStr.slice(0, 300)}${resultStr.length > 300 ? '…' : ''}`);

      // Check for flag or win condition
      if (resultStr.includes('{{') || resultStr.toLowerCase().includes('flag') || result?.code === 0) {
        const flag = extractFlag(resultStr);
        if (flag || result?.code === 0) {
          console.log(`\n🎉 SUCCESS! ${flag || JSON.stringify(result)}`);
          missionComplete = true;
        }
      }

      toolResults.push({ role: 'tool', tool_call_id: call.id, content: resultStr });
    }

    messages.push(...toolResults);
  }

  // Final screenshot
  try {
    const finalPath = await takeScreenshot('final');
    if (finalPath) console.log(`\n[browser] Final screenshot: ${finalPath}`);
  } catch { /* ignore */ }

  await closeBrowser();
  console.log('\n══ Agent loop ended ══');
}
