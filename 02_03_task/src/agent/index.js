import { chat, extractToolCalls, extractText, extractAssistantMessage } from "../helpers/api.js";
import { AGENT_MODEL, MAX_AGENT_STEPS, AGENT_INSTRUCTIONS } from "../config.js";

/**
 * Run the agent loop with function calling.
 */
export async function runAgent(task, tools) {
  const messages = [
    { role: "system", content: AGENT_INSTRUCTIONS },
    { role: "user", content: task },
  ];

  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    console.log(`\n── Agent Step ${step}/${MAX_AGENT_STEPS} ──`);

    const response = await chat({
      model: AGENT_MODEL,
      messages,
      tools: tools.definitions,
      toolChoice: "auto",
      maxTokens: 8192,
    });

    const assistantMsg = extractAssistantMessage(response);
    const toolCalls = extractToolCalls(response);
    const text = extractText(response);

    if (toolCalls.length === 0) {
      if (text) {
        console.log(`\nAgent response:\n${text}`);
      }
      messages.push(assistantMsg);
      return { response: text, steps: step, history: messages };
    }

    console.log(`  Tool calls: ${toolCalls.map((tc) => tc.function.name).join(", ")}`);
    messages.push(assistantMsg);

    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      console.log(`  Executing: ${name}(${truncate(argsStr, 120)})`);

      const result = await tools.handle(name, argsStr);
      const preview = truncate(result, 300);
      console.log(`  Result: ${preview}`);

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: result,
      });
    }
  }

  console.log(`\nAgent reached max steps (${MAX_AGENT_STEPS})`);
  return { response: null, steps: MAX_AGENT_STEPS, history: messages };
}

function truncate(str, max) {
  if (!str) return "";
  return str.length > max ? str.slice(0, max) + "..." : str;
}
