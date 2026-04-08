/**
 * Analyzer Agent — uses a small/cheap LLM to extract intelligence facts.
 *
 * Input : All transcriptions + locally-decoded binary content from the blackboard.
 *         Text is concatenated as plain strings — NO raw Base64, NO binary data.
 * Output: { cityName, cityArea, warehousesCount, phoneNumber } written to blackboard.
 *
 * Cost strategy:
 *  - Only text is sent to the LLM (no images inline here; those are handled by visionAnalyze)
 *  - Uses the cheapest capable model (Gemini Flash or gpt-4o-mini)
 *  - Single-shot prompt — no multi-turn conversation
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { complete, extractText } from "../api.js";
import { ANALYZER_MODEL } from "../taskConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  path.join(__dirname, "../../prompts/analyzer.md"),
  "utf-8"
).trim();

/**
 * @param {object} opts
 * @param {object} opts.blackboard
 * @returns {Promise<object|null>} extracted facts object or null on failure
 */
export const runAnalyzerAgent = async ({ blackboard }) => {
  const state = blackboard.getAll();

  const textBlocks = [
    ...state.transcriptions.map((t, i) => `=== Radio Transcription ${i + 1} ===\n${t}`),
    ...state.binaryContent.map((b, i) => `=== Decoded Signal ${i + 1} ===\n${b}`),
  ];

  if (textBlocks.length === 0) {
    console.warn("[AnalyzerAgent] No content to analyze — blackboard is empty.");
    return null;
  }

  const corpus = textBlocks.join("\n\n");
  const charCount = corpus.length;

  console.log(
    `\n\x1b[36m[AnalyzerAgent]\x1b[0m Analyzing ${textBlocks.length} blocks ` +
    `(${charCount} chars) with model: ${ANALYZER_MODEL}`
  );

  const messages = [
    {
      role: "user",
      content: `Intercepted radio intelligence:\n\n${corpus}\n\nExtract the four required facts about "Syjon".`,
    },
  ];

  let responseText;
  try {
    const response = await complete(messages, {
      instructions: SYSTEM_PROMPT,
      model: ANALYZER_MODEL,
    });
    responseText = extractText(response);
  } catch (err) {
    blackboard.addError(`AnalyzerAgent LLM call failed: ${err.message}`);
    console.error("[AnalyzerAgent] LLM error:", err.message);
    return null;
  }

  console.log("[AnalyzerAgent] Raw LLM response:", responseText.slice(0, 500));

  // Extract the JSON object from the response (strip any surrounding markdown)
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    blackboard.addError("AnalyzerAgent: no JSON found in LLM response");
    console.error("[AnalyzerAgent] Could not find JSON in response:", responseText);
    return null;
  }

  let facts;
  try {
    facts = JSON.parse(jsonMatch[0]);
  } catch (err) {
    blackboard.addError(`AnalyzerAgent: JSON parse failed — ${err.message}`);
    console.error("[AnalyzerAgent] JSON parse error:", err.message);
    return null;
  }

  // Validate required fields
  const required = ["cityName", "cityArea", "warehousesCount", "phoneNumber"];
  for (const field of required) {
    if (!(field in facts)) {
      blackboard.addError(`AnalyzerAgent: missing field "${field}" in extracted facts`);
    }
  }

  // Convert any "null" string values to actual null
  for (const field of ["cityName", "cityArea", "warehousesCount", "phoneNumber"]) {
    if (facts[field] === "null" || facts[field] === "" || facts[field] === "unknown") {
      facts[field] = null;
    }
  }

  // Normalise cityArea to exactly 2 decimal places (string)
  if (facts.cityArea != null) {
    const numArea = parseFloat(String(facts.cityArea).replace(",", "."));
    if (!isNaN(numArea)) {
      facts.cityArea = numArea.toFixed(2);
    } else {
      facts.cityArea = null;
    }
  }

  // Normalise phoneNumber to digits only
  if (facts.phoneNumber != null) {
    const digitsOnly = String(facts.phoneNumber).replace(/\D/g, "");
    facts.phoneNumber = digitsOnly.length > 0 ? digitsOnly : null;
  }

  // Normalise warehousesCount to integer
  if (facts.warehousesCount != null) {
    const count = parseInt(String(facts.warehousesCount), 10);
    facts.warehousesCount = isNaN(count) ? null : count;
  }

  blackboard.mergeFacts(facts);
  console.log("[AnalyzerAgent] Facts extracted:", facts);

  return facts;
};
