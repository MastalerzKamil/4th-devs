import { complete } from "./api.js";

const extractText = (response) => {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const msg = response.output?.find((i) => i.type === "message");
  const part = msg?.content?.find((c) => c.type === "output_text" || c.type === "text");
  return part?.text ? String(part.text).trim() : "";
};

/**
 * Run a single agent loop until no more tool calls are made.
 *
 * @param {object} opts
 * @param {string}   opts.instructions  - System prompt
 * @param {object[]} opts.definitions   - OpenAI function-tool definitions
 * @param {Record<string, Function>} opts.handlers - Tool name → async handler
 * @param {object[]} opts.messages      - Initial conversation (Responses API format)
 * @param {string}   opts.model         - Model name (resolved for provider)
 * @param {number}   opts.maxSteps      - Max tool-call rounds
 * @param {string}   opts.name          - Agent name for logging
 * @returns {{ text: string, conversation: object[] }}
 */
export const runAgent = async ({
  instructions,
  definitions,
  handlers,
  messages,
  model,
  maxSteps = 30,
  name = "agent",
}) => {
  let conversation = [...messages];

  const runTool = async (call) => {
    const args = JSON.parse(call.arguments ?? "{}");
    const handler = handlers[call.name];
    if (!handler) throw new Error(`[${name}] Unknown tool: ${call.name}`);
    const result = await handler(args);
    const callId = call.call_id ?? call.id;
    return {
      type: "function_call_output",
      call_id: callId,
      output: typeof result === "string" ? result : JSON.stringify(result),
    };
  };

  for (let step = 0; step < maxSteps; step++) {
    const response = await complete(conversation, definitions, { instructions, model });
    const calls = (response.output ?? []).filter((i) => i.type === "function_call");

    if (calls.length === 0) {
      return { text: extractText(response), conversation };
    }

    console.log(`  [${name}] step ${step + 1}: ${calls.map((c) => c.name).join(", ")}`);

    if (calls.length === 1) {
      // Happy path: single tool call
      const call = calls[0];
      conversation.push(call);
      conversation.push(await runTool(call));
    } else {
      // Multiple tool calls: execute the first, reject the rest with a reminder.
      // This forces the model into sequential mode even if parallel_tool_calls
      // is not honoured by the provider.
      const [first, ...rest] = calls;
      conversation.push(first);
      conversation.push(await runTool(first));
      for (const extra of rest) {
        conversation.push(extra);
        conversation.push({
          type: "function_call_output",
          call_id: extra.call_id ?? extra.id,
          output: JSON.stringify({
            error: "Only one tool call at a time is allowed. Please call tools sequentially.",
          }),
        });
      }
    }
  }

  throw new Error(`[${name}] exceeded ${maxSteps} tool-call rounds`);
};
