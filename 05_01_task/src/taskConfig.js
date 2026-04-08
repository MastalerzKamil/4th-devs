export const VERIFY_URL = "https://hub.ag3nts.org/verify";
export const TASK = "radiomonitoring";

/**
 * Models — ordered cheapest-first.
 * Analyzer handles text extraction from collected transcriptions + decoded binaries.
 * Vision handles image attachments only (never raw Base64 audio/unknown).
 *
 * Override via env vars:
 *   ANALYZER_MODEL=openai/gpt-4o-mini
 *   VISION_MODEL=google/gemini-flash-1.5
 */
export const ANALYZER_MODEL =
  process.env.ANALYZER_MODEL?.trim() || "openai/gpt-4o-mini";

export const VISION_MODEL =
  process.env.VISION_MODEL?.trim() || "openai/gpt-4o-mini";

/** Safety limit on listen rounds to prevent infinite loops */
export const MAX_LISTEN_ROUNDS = 60;

/**
 * Skip binary attachments larger than this byte threshold (decoded bytes).
 * Text/JSON files: keep at 300 KB.
 * Images: handled separately with a higher limit (see signalRouter.js).
 */
export const MAX_BINARY_BYTES = 300_000;
export const MAX_IMAGE_BYTES = 1_000_000; // 1 MB — vision models handle these fine
export const MAX_AUDIO_BYTES = 25_000_000; // 25 MB — Whisper API limit

/** Minimum delay between Hub API calls (ms) to avoid rate-limiting */
export const HUB_CALL_DELAY_MS = Number(process.env.HUB_CALL_DELAY_MS ?? 800);
