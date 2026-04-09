import OpenAI from "openai";
// @ts-expect-error — root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL } from "../../config.js";
import {
  executeCommand,
  decryptHint,
  extractOutput,
  extractFlag,
} from "./hub_client.js";
import { loadMemory, saveMemory, buildBlackboard } from "./memory.js";

// Cost-effective model on OpenRouter
const MODEL = "google/gemini-2.0-flash-001";
const MAX_STEPS = 40;

const SYSTEM_PROMPT = `You are a shell-access agent. Your task is to explore a remote server and find specific information about a person named Rafał.

## Your goal
Find these facts from the files in the /data directory:
1. The DATE when Rafał's body was found
2. The CITY where it was found
3. The GPS LONGITUDE and LATITUDE of the location

## CRITICAL: The final answer date must be ONE DAY BEFORE the date when the body was found.

## Submitting the answer
When you have all four pieces of information, submit by executing this exact type of echo command:
  echo '{"date":"YYYY-MM-DD","city":"city name","longitude":XX.XXXXXX,"latitude":XX.XXXXXX}'

Replace the values with the actual data. The date must be the day BEFORE the body was found.

## Files available on server
- /data/gps.json — JSON array: [{latitude, longitude, type, location_id, entry_id}, ...]
- /data/locations.json — JSON array: [{location_id, name}, ...] — maps IDs to city names
- /data/time_logs.csv — CSV with time log entries, likely contains Rafał and timestamps

## IMPORTANT: Output limit is 4096 bytes. Use targeted commands:
- NEVER cat large files directly
- Use grep to search for specific strings
- Use head -n N to see just N lines
- Use jq with filters to get specific data
- Use awk/cut to process CSV columns

## Proven strategy (follow exactly)
1. Check time_logs.csv header: head -n 2 /data/time_logs.csv
2. Find ALL Rafał entries: grep -n "Rafał" /data/time_logs.csv | tail -n 10
   (format: linenum:date;description;location_id;entry_id)
3. Find body-found entry: look for "jaskinia" or "znaleziono" or check entries around line 3691+
4. Get entry_id from that line (e.g. 954634)
5. Find GPS: grep -B 4 "ENTRY_ID" /data/gps.json → gives latitude, longitude
6. Find city: grep -A 2 -B 2 "\"LOCATION_ID\"" /data/locations.json → gives city name
7. Calculate day before (e.g. found 2024-11-13 → answer 2024-11-12)
8. Submit: echo '{"date":"YYYY-MM-DD","city":"City","longitude":X.X,"latitude":X.X}'

## Notes
- Output limit is 4096 bytes — always use head/tail to limit output
- Use grep -B 4 ENTRY_ID /data/gps.json to get coordinates
- NEVER use cat on large files; use grep with context
- Hints might be base64 or ROT13 encoded — decoded automatically`;


/**
 * @param {{ apikey: string }} opts
 */
export async function runShellAgent({ apikey }) {
  const client = new OpenAI({
    apiKey: AI_API_KEY,
    baseURL: CHAT_API_BASE_URL,
  });

  const memory = await loadMemory();

  const sessionId = Date.now().toString(36);
  /** @type {import("./memory.js").SessionRecord} */
  const session = {
    id: sessionId,
    startedAt: new Date().toISOString(),
    outcome: "running",
    steps: [],
  };
  memory.sessions.push(session);
  await saveMemory(memory);

  // Build blackboard from previous (completed) sessions
  const previousSessions = { version: 1, sessions: memory.sessions.slice(0, -1) };
  const blackboard = buildBlackboard(previousSessions);

  const systemContent = blackboard
    ? `${SYSTEM_PROMPT}\n\n${blackboard}`
    : SYSTEM_PROMPT;

  /** @type {OpenAI.ChatCompletionMessageParam[]} */
  const messages = [
    { role: "system", content: systemContent },
    { role: "user", content: "Start exploring. List the /data directory first." },
  ];

  /** @type {OpenAI.ChatCompletionTool[]} */
  const tools = [
    {
      type: "function",
      function: {
        name: "execute_command",
        description:
          "Execute a shell command on the remote server. Returns the command output.",
        parameters: {
          type: "object",
          properties: {
            thought: {
              type: "string",
              description: "Brief reasoning about why you are executing this command",
            },
            cmd: {
              type: "string",
              description: "The shell command to execute on the remote server",
            },
          },
          required: ["cmd"],
        },
      },
    },
  ];

  const truncate = (s = "", max = 300) =>
    s.length > max ? s.slice(0, max) + "…" : s;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      console.log(`\n\x1b[36m--- Step ${step + 1}/${MAX_STEPS} ---\x1b[0m`);

      const response = await client.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
      });

      const message = response.choices[0]?.message;
      if (!message) {
        console.log("[agent] No response from model");
        break;
      }

      if (message.content) {
        console.log(`\x1b[33m[agent]\x1b[0m ${truncate(message.content)}`);
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: message.tool_calls,
      });

      // No tool calls means agent is done reasoning
      if (!message.tool_calls?.length) {
        console.log("[agent] No more tool calls — agent finished.");
        session.outcome = "no_tool_calls";
        break;
      }

      for (const toolCall of message.tool_calls) {
        if (toolCall.type !== "function") continue;

        let args = /** @type {{ cmd?: string; thought?: string }} */ ({});
        try {
          args = JSON.parse(toolCall.function.arguments || "{}");
        } catch {
          args = {};
        }

        const cmd = args.cmd ?? "";
        const thought = args.thought ?? "";

        if (thought) console.log(`\x1b[90m[thought] ${truncate(thought, 200)}\x1b[0m`);
        console.log(`\x1b[32m[cmd]\x1b[0m ${cmd}`);

        // Execute on remote server
        const result = await executeCommand(apikey, cmd);
        const output = extractOutput(result.data);

        // Decrypt hint if present
        const rawHint =
          typeof result.data?.hint === "string" ? result.data.hint : null;
        const hint = rawHint ? decryptHint(rawHint) : null;

        console.log(`\x1b[90m[status]\x1b[0m HTTP ${result.status}`);
        console.log(`\x1b[37m[output]\x1b[0m ${truncate(output, 600)}`);
        if (hint && hint !== rawHint) {
          console.log(`\x1b[35m[hint decrypted]\x1b[0m ${truncate(hint, 400)}`);
        } else if (hint) {
          console.log(`\x1b[35m[hint]\x1b[0m ${truncate(hint, 400)}`);
        }

        // Persist to blackboard
        session.steps.push({
          step,
          thought,
          command: cmd,
          output: output.slice(0, 3000),
          hint,
          hubStatus: result.status,
        });
        await saveMemory(memory);

        // Check for flag
        const flag =
          extractFlag(result.data) ?? extractFlag({ text: output });
        if (flag) {
          console.log(`\n\x1b[32m✓ FLAG FOUND:\x1b[0m ${flag}`);
          session.flag = flag;
          session.outcome = "flag";
          await saveMemory(memory);
          return { flag, outcome: "flag" };
        }

        // Add tool result to conversation
        const toolContent = output + (hint ? `\n\n[DECODED HINT: ${hint}]` : "");
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: toolContent,
        });
      }
    }
  } finally {
    if (session.outcome === "running") {
      session.outcome = "max_steps";
    }
    session.endedAt = new Date().toISOString();
    await saveMemory(memory);
  }

  return { flag: null, outcome: session.outcome };
}
