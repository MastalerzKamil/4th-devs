import {
  AI_API_KEY,
  buildResponsesRequest,
  EXTRA_API_HEADERS,
  RESPONSES_API_ENDPOINT,
  resolveModelForProvider,
} from "../../config.js";
import { ANALYST_STRUCTURED_INSTRUCTIONS } from "./agents/prompts.js";
import { DEFAULT_AGENT_MODEL } from "./taskConfig.js";
import { slugify } from "./buildBatch.js";

/** OpenAI Responses API: `text.format` with strict json_schema (see 01_01_structured). */
export const FILESYSTEM_PLAN_FORMAT = {
  type: "json_schema",
  name: "filesystem_natan_plan",
  strict: true,
  schema: {
    type: "object",
    properties: {
      miasta: {
        type: "array",
        description:
          "One row per city that appears in ogłoszenia (demands). city_slug [a-z0-9_]+; quantities from announcements.",
        items: {
          type: "object",
          properties: {
            city_slug: {
              type: "string",
              description: "Lowercase ASCII slug for the city (no Polish diacritics).",
            },
            needs: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  good: {
                    type: "string",
                    description: "Good name: nominative singular, ASCII slug keys only conceptually.",
                  },
                  quantity: { type: "integer", minimum: 1 },
                },
                required: ["good", "quantity"],
                additionalProperties: false,
              },
            },
          },
          required: ["city_slug", "needs"],
          additionalProperties: false,
        },
        minItems: 8,
        maxItems: 8,
      },
      osoby: {
        type: "array",
        description:
          "Exactly one trade manager per city from rozmowy; city_slug must match a miasta.city_slug.",
        items: {
          type: "object",
          properties: {
            file: {
              type: "string",
              description:
                "Osoby filename slug [a-z0-9_]+ max 20 chars. MUST NOT equal any city_slug (hub global_unique_names).",
            },
            name: { type: "string", description: "Full name as in the diary." },
            city_slug: {
              type: "string",
              description: "City this person manages; must match miasta entry.",
            },
          },
          required: ["file", "name", "city_slug"],
          additionalProperties: false,
        },
        minItems: 8,
        maxItems: 8,
      },
    },
    required: ["miasta", "osoby"],
    additionalProperties: false,
  },
};

function extractResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const messages = Array.isArray(data?.output)
    ? data.output.filter((item) => item?.type === "message")
    : [];
  const textPart = messages
    .flatMap((message) => (Array.isArray(message?.content) ? message.content : []))
    .find((part) => part?.type === "output_text" && typeof part?.text === "string");
  return textPart?.text?.trim() ?? "";
}

/**
 * @param {object} parsed - API JSON (miasta array, osoby array)
 * @param {string} transakcje_text - verbatim transakcje.txt (from disk / reader)
 */
export function planFromStructured(parsed, transakcje_text) {
  if (!parsed?.miasta || !Array.isArray(parsed.miasta)) throw new Error("structured: miasta");
  if (!parsed?.osoby || !Array.isArray(parsed.osoby)) throw new Error("structured: osoby");
  if (typeof transakcje_text !== "string" || !transakcje_text.trim()) {
    throw new Error("structured: transakcje_text");
  }

  const miasta = {};
  for (const row of parsed.miasta) {
    const c = slugify(row.city_slug);
    miasta[c] = {};
    for (const n of row.needs ?? []) {
      miasta[c][slugify(n.good)] = Number(n.quantity);
    }
  }

  const osoby = (parsed.osoby ?? []).map((r) => ({
    file: String(r.file).trim(),
    name: String(r.name).trim(),
    city: slugify(r.city_slug),
  }));

  return { miasta, osoby, transakcje_text };
}

/**
 * @param {object} opts
 * @param {string} opts.notesMarkdown - transakcje + rozmowy + ogloszenia sections
 * @param {string} opts.transakcjeText - exact transakcje body for plan.transakcje_text
 * @param {string} [opts.model]
 * @param {string[]} [opts.repairErrors] - if set, second-pass repair prompt
 */
export async function runFilesystemStructuredAnalyst({
  notesMarkdown,
  transakcjeText,
  model = DEFAULT_AGENT_MODEL,
  repairErrors,
}) {
  const userBody = repairErrors?.length
    ? `Your previous structured plan failed local validation against the hub rules:\n${repairErrors.map((e) => `- ${e}`).join("\n")}\n\nReturn a corrected plan for the SAME notes below.\n\n${notesMarkdown}`
    : `Extract miasta (demands from ogłoszenia) and osoby (managers from rozmowy) from the notes. Use exact integer quantities from the announcements.\n\n${notesMarkdown}`;

  const body = buildResponsesRequest({
    model: resolveModelForProvider(model),
    input: [{ role: "user", content: userBody }],
    instructions: ANALYST_STRUCTURED_INSTRUCTIONS,
    text: { format: FILESYSTEM_PLAN_FORMAT },
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
    throw new Error(data?.error?.message ?? `Structured analyst failed (${response.status})`);
  }

  const text = extractResponseText(data);
  if (!text) throw new Error("Structured analyst: empty output");

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Structured analyst: invalid JSON (${e.message})`);
  }

  return planFromStructured(parsed, transakcjeText);
}
