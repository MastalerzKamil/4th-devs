/**
 * LLM API helpers for the radiomonitoring task.
 *
 * Two functions:
 *  - complete(messages, { instructions, model })
 *    Uses the OpenAI Responses API endpoint (same as other tasks in this repo).
 *    For pure-text analysis (analyzer agent).
 *
 *  - visionComplete(buffer, mime, prompt, model)
 *    Uses the OpenAI-compatible Chat Completions endpoint (broader vision support).
 *    Used ONLY when an actual image binary is received; never for text/JSON.
 */

import {
  AI_API_KEY,
  CHAT_API_BASE_URL,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
  OPENAI_API_KEY,
} from "../../config.js";

// ─── Audio transcription (Whisper API) ───────────────────────────────────────

/**
 * Transcribe an audio buffer using Whisper via OpenRouter/OpenAI.
 *
 * @param {Buffer} audioBuffer - Decoded audio bytes
 * @param {string} mime        - MIME type e.g. "audio/mpeg"
 * @returns {Promise<string|null>} - Transcription text or null on error
 */
/**
 * Audio transcription using Google Gemini (supports audio natively via OpenRouter).
 */
const AUDIO_MODEL = process.env.AUDIO_MODEL?.trim() || "google/gemini-2.0-flash-001";

export const audioTranscribe = async (audioBuffer, mime) => {
  const audioMime = mime || "audio/mpeg";
  const b64 = audioBuffer.toString("base64");
  const dataUrl = `data:${audioMime};base64,${b64}`;

  const body = {
    model: AUDIO_MODEL,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: dataUrl } },
          {
            type: "text",
            text: "Transcribe this audio recording. The language is Polish. Return ONLY the transcription text, nothing else.",
          },
        ],
      },
    ],
    max_tokens: 2048,
  };

  const res = await fetch(`${CHAT_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Audio LLM error (${res.status})`);
  return data?.choices?.[0]?.message?.content?.trim() || null;
};

// ─── Text completion (Responses API) ─────────────────────────────────────────

export const complete = async (messages, { instructions, model } = {}) => {
  const body = buildResponsesRequest({
    model: resolveModelForProvider(model),
    input: messages,
    instructions,
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
  if (!res.ok) throw new Error(data?.error?.message ?? `LLM error (${res.status})`);
  return data;
};

export const extractText = (response) => {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const msg = response.output?.find((i) => i.type === "message");
  const part = msg?.content?.find((c) => c.type === "output_text" || c.type === "text");
  return part?.text ? String(part.text).trim() : "";
};

// ─── Vision completion (Chat Completions API) ─────────────────────────────────

/**
 * Analyze an image buffer with a vision-capable model.
 * The raw buffer is encoded as base64 data-URL — never passed as a bare Base64 string.
 *
 * @param {Buffer} imageBuffer - Decoded image bytes
 * @param {string} mime        - MIME type e.g. "image/png"
 * @param {string} prompt      - What to extract from the image
 * @param {string} model       - Model name (must support vision)
 * @returns {Promise<string>}  - Model's textual description/analysis
 */
export const visionComplete = async (imageBuffer, mime, prompt, model) => {
  const dataUrl = `data:${mime};base64,${imageBuffer.toString("base64")}`;

  const body = {
    model: resolveModelForProvider(model),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 1024,
  };

  const res = await fetch(`${CHAT_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message ?? `Vision LLM error (${res.status})`);
  return data?.choices?.[0]?.message?.content?.trim() ?? "";
};
