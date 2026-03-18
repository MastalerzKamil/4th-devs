import { chat, extractToolCalls, extractText, extractAssistantMessage } from "../helpers/api.js";
import { AGENT_MODEL, MAX_AGENT_STEPS, AGENT_INSTRUCTIONS } from "../config.js";

/**
 * Run the agent loop with function calling.
 *
 * The agent receives a task, can call tools, and loops until it produces
 * a final text response or hits the step limit.
 *
 * @param {string} task - The initial user message / task description
 * @param {{ definitions: Object[], handle: Function }} tools - Tool registry
 * @returns {{ response: string, steps: number, history: Object[] }}
 */
export async function runAgent(task, tools) {
  const messages = [
    { role: "system", content: AGENT_INSTRUCTIONS },
    { role: "user", content: task },
  ];

  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    console.log(`\n── Agent Step ${step}/${MAX_AGENT_STEPS} ──`);

    // 1. Call LLM with tools
    const response = await chat({
      model: AGENT_MODEL,
      messages,
      tools: tools.definitions,
      toolChoice: "auto",
      maxTokens: 4096,
    });

    const assistantMsg = extractAssistantMessage(response);
    const toolCalls = extractToolCalls(response);
    const text = extractText(response);

    // 2. If assistant produced text (and no tool calls), we're done
    if (toolCalls.length === 0) {
      if (text) {
        console.log(`\n🤖 Agent response:\n${text}`);
      }
      messages.push(assistantMsg);
      return { response: text, steps: step, history: messages };
    }

    // 3. Log tool calls
    console.log(`  Tool calls: ${toolCalls.map((tc) => tc.function.name).join(", ")}`);

    // 4. Add assistant message with tool_calls to history
    messages.push(assistantMsg);

    // 5. Execute each tool and add results
    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      console.log(`  ⚙️  Executing: ${name}(${truncate(argsStr, 100)})`);

      const result = await tools.handle(name, argsStr);
      const preview = truncate(result, 200);
      console.log(`  ✅ Result: ${preview}`);

      // Add tool result to conversation
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  console.log(`\n⚠️  Agent reached max steps (${MAX_AGENT_STEPS})`);
  return { response: null, steps: MAX_AGENT_STEPS, history: messages };
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "…" : str;
}
