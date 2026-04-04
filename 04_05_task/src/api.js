import {
  AI_API_KEY,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
} from "../../config.js";

export const complete = async (input, tools, { instructions, model } = {}) => {
  const body = buildResponsesRequest({
    model: resolveModelForProvider(model),
    input,
    tools: tools?.length ? tools : undefined,
    instructions,
    parallel_tool_calls: false,
  });

  const res = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message ?? `LLM request failed (${res.status})`);
  }
  return data;
};
