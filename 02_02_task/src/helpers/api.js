import { AI_API_KEY, EXTRA_API_HEADERS } from "../../../config.js";

const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

let totalUsage = { requests: 0, promptTokens: 0, completionTokens: 0 };

/**
 * Call chat completions API with optional tools (function calling).
 */
export async function chat({ model, messages, tools, toolChoice = "auto", maxTokens = 4096 }) {
  const body = { model, messages, max_tokens: maxTokens };

  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(`API error: ${data.error.message ?? JSON.stringify(data.error)}`);
  }

  // Track usage
  if (data.usage) {
    totalUsage.requests++;
    totalUsage.promptTokens += data.usage.prompt_tokens ?? 0;
    totalUsage.completionTokens += data.usage.completion_tokens ?? 0;
  }

  return data;
}

/**
 * Extract tool calls from a chat completion response.
 */
export function extractToolCalls(response) {
  const message = response.choices?.[0]?.message;
  return message?.tool_calls ?? [];
}

/**
 * Extract text content from a chat completion response.
 */
export function extractText(response) {
  return response.choices?.[0]?.message?.content ?? null;
}

/**
 * Get the full assistant message (for appending to conversation history).
 */
export function extractAssistantMessage(response) {
  return response.choices?.[0]?.message ?? null;
}

/**
 * Log and return total usage stats.
 */
export function getUsageStats() {
  return { ...totalUsage };
}
