/**
 * Vision helper — wraps visionComplete with the image-analysis prompt.
 *
 * Called only when the signal router encounters an actual image binary.
 * Returns a text description / extracted intelligence for the blackboard.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { visionComplete } from "./api.js";
import { VISION_MODEL } from "./taskConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISION_PROMPT = readFileSync(
  path.join(__dirname, "../prompts/vision.md"),
  "utf-8"
).trim();

/**
 * Analyze an image buffer and return extracted intelligence as plain text.
 *
 * @param {Buffer} buffer - Decoded image bytes (never raw Base64)
 * @param {string} mime   - MIME type, e.g. "image/png"
 * @returns {Promise<string|null>} text description or null on error
 */
export const analyzeImage = async (buffer, mime) => {
  console.log(`[Vision] Analyzing image (${buffer.length} bytes, ${mime}) with ${VISION_MODEL}`);
  try {
    const result = await visionComplete(buffer, mime, VISION_PROMPT, VISION_MODEL);
    if (!result || result.trim().toLowerCase().includes("no relevant intelligence")) {
      console.log("[Vision] No intelligence found in image.");
      return null;
    }
    return result.trim();
  } catch (err) {
    console.error("[Vision] Analysis failed:", err.message);
    return null;
  }
};
