import { complete } from "./api.js";
import { DEFAULT_AGENT_MODEL } from "./taskConfig.js";

const MAX_STEPS = 24;

const extractFinalText = (response) => {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const message = response.output?.find((item) => item.type === "message");
  const part = message?.content?.find((c) => c.type === "output_text" || c.type === "text");
  if (part?.text) return String(part.text).trim();
  return "";
};

/**
 * @param {object} params
 * @param {string} params.instructions
 * @param {object[]} params.definitions - OpenAI function tools
 * @param {Record<string, Function>} params.handlers
 * @param {object[]} params.initialMessages
 * @param {string} [params.model]
 */
export const runAgent = async ({
  instructions,
  definitions,
  handlers,
  initialMessages,
  model = DEFAULT_AGENT_MODEL,
  onStep,
}) => {
  let conversation = [...initialMessages];

  const runTool = async (call) => {
    const args = JSON.parse(call.arguments ?? "{}");
    const handler = handlers[call.name];
    if (!handler) throw new Error(`Unknown tool: ${call.name}`);
    const result = await handler(args);
    const callId = call.call_id ?? call.id;
    if (!callId) throw new Error("Tool call missing call_id");
    return {
      type: "function_call_output",
      call_id: callId,
      output: JSON.stringify(result),
    };
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const tools = definitions.length > 0 ? definitions : undefined;
    const response = await complete(conversation, tools, { instructions, model });
    const calls = (response.output ?? []).filter((item) => item.type === "function_call");

    if (onStep) onStep({ step, callCount: calls.length });

    if (calls.length === 0) {
      return {
        text: extractFinalText(response) || "",
        conversation,
        lastResponse: response,
      };
    }

    for (const call of calls) {
      conversation.push(call);
      conversation.push(await runTool(call));
    }
  }

  throw new Error(`Agent exceeded ${MAX_STEPS} tool rounds`);
};
