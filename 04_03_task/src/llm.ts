/**
 * LLM helper with extended thinking support.
 *
 * Why a custom fetch instead of the openai SDK:
 *   The OpenAI SDK's TypeScript types don't include the `thinking` field
 *   required by Anthropic's extended-thinking API (forwarded by OpenRouter).
 *   Using raw fetch lets us pass it cleanly and handle the content-array
 *   response format that thinking mode produces.
 *
 * Supported models:
 *   • Thinking-capable  → anthropic/claude-3-7-sonnet  (thinking enabled)
 *   • Standard          → google/gemini-2.0-flash-001  (no thinking overhead)
 */

// @ts-expect-error — root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../config.js'
import type OpenAI from 'openai'

// ── Model constants ────────────────────────────────────────────────────────
export const MODELS = {
  /** Strategic reasoning — Commander, MapAnalyzer, LogsAnalyzer, Inspector */
  thinking: 'anthropic/claude-3-7-sonnet',
  /** Fast execution — Creator, Navigator (no LLM needed) */
  fast: 'google/gemini-2.0-flash-001',
} as const

// ── Types ──────────────────────────────────────────────────────────────────
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: OpenAI.ChatCompletionMessageToolCall[]
  tool_call_id?: string
}

export interface ChatResponse {
  /** Extracted text content (thinking blocks are stripped out) */
  text: string | null
  /** Standard tool-call array, same shape as OpenAI SDK */
  toolCalls: OpenAI.ChatCompletionMessageToolCall[] | undefined
  /** Raw thinking text extracted from the thinking block (informational) */
  thinking: string | null
}

// ── Core fetch-based chat ──────────────────────────────────────────────────

/**
 * Send a chat completion request.
 * Pass `thinkingBudget > 0` to enable Claude's extended thinking mode.
 */
export async function chat(params: {
  model: string
  messages: ChatMessage[]
  tools?: OpenAI.ChatCompletionTool[]
  thinkingBudget?: number   // tokens; 0 = disabled
  maxTokens?: number
}): Promise<ChatResponse> {
  const { model, messages, tools, thinkingBudget = 0, maxTokens = 16000 } = params

  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
  }

  if (tools?.length) body.tools = tools

  // Extended thinking — only for models that support it (Claude 3.7+)
  if (thinkingBudget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
    // temperature must be 1 when thinking is enabled
    body.temperature = 1
  }

  const res = await fetch(`${CHAT_API_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${AI_API_KEY}`,
      ...(EXTRA_API_HEADERS as Record<string, string>),
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`LLM API error ${res.status}: ${errText.slice(0, 400)}`)
  }

  const data = (await res.json()) as {
    choices: Array<{
      message: {
        content: string | Array<{ type: string; text?: string; thinking?: string }> | null
        tool_calls?: OpenAI.ChatCompletionMessageToolCall[]
      }
    }>
  }

  const message = data.choices[0]?.message
  if (!message) throw new Error('LLM returned no choices')

  return extractResponse(message)
}

// ── Response normaliser ────────────────────────────────────────────────────

function extractResponse(message: {
  content: string | Array<{ type: string; text?: string; thinking?: string }> | null
  tool_calls?: OpenAI.ChatCompletionMessageToolCall[]
}): ChatResponse {
  let text: string | null = null
  let thinking: string | null = null

  if (typeof message.content === 'string') {
    text = message.content || null
  } else if (Array.isArray(message.content)) {
    // Extended thinking response — content is an array of typed blocks
    for (const block of message.content) {
      if (block.type === 'thinking' && block.thinking) {
        thinking = block.thinking
      } else if (block.type === 'text' && block.text) {
        text = (text ?? '') + block.text
      }
    }
  }

  return {
    text: text || null,
    toolCalls: message.tool_calls?.length ? message.tool_calls : undefined,
    thinking,
  }
}
