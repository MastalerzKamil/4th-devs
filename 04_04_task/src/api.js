import {
  AI_API_KEY,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
} from "../../config.js";
import { DEFAULT_AGENT_MODEL } from "./taskConfig.js";

export const complete = async (input, tools, { instructions, model } = {}) => {
  const body = buildResponsesRequest({
    model: resolveModelForProvider(model ?? DEFAULT_AGENT_MODEL),
    input,
    tools,
    instructions,
    parallel_tool_calls: false,
  });

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message ?? `LLM request failed (${response.status})`);
  }
  return data;
};
