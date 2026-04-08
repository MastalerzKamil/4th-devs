/**
 * Orchestrator — coordinates the radiomonitoring pipeline.
 *
 * Pipeline stages (sequential, no LLM needed for orchestration itself):
 *
 *  1. START SESSION   — initialise the Hub radio-monitoring session
 *  2. LISTEN LOOP     — ListenerAgent fetches & routes all signals (pure code)
 *  3. ANALYSE         — AnalyzerAgent extracts facts from collected text (cheap LLM)
 *  4. RE-ANALYSE?     — if facts incomplete, retry with a hint (up to MAX_RETRIES)
 *  5. VALIDATE        — check all four facts are present and well-formed
 *  6. TRANSMIT        — ReporterAgent sends the final report and returns the flag
 *
 * Shared state: Blackboard (passed by reference to all agents)
 */

import { startSession } from "./hubApi.js";
import { runListenerAgent } from "./agents/listener.js";
import { runAnalyzerAgent } from "./agents/analyzer.js";
import { runReporterAgent } from "./agents/reporter.js";
import { analyzeImage } from "./vision.js";
import { audioTranscribe } from "./api.js";

const MAX_ANALYSIS_RETRIES = 2;

/**
 * @param {object} opts
 * @param {string} opts.apikey
 * @param {object} opts.blackboard
 * @returns {Promise<object>} final Hub API response (contains flag)
 */
export const runOrchestrator = async ({ apikey, blackboard }) => {
  // ── Stage 1: Start session ──────────────────────────────────────────────
  console.log("\n\x1b[33m[Orchestrator]\x1b[0m Starting radio-monitoring session…");
  const startResponse = await startSession(apikey);
  console.log("[Orchestrator] Session start response:", JSON.stringify(startResponse));

  if (startResponse?.code < 0) {
    throw new Error(`Session start failed: ${startResponse.message}`);
  }

  // ── Stage 2: Listen loop ────────────────────────────────────────────────
  console.log("\n\x1b[33m[Orchestrator]\x1b[0m Launching ListenerAgent…");
  await runListenerAgent({
    apikey,
    blackboard,
    visionAnalyze: analyzeImage,
    audioTranscribe,
  });

  const state = blackboard.getAll();
  console.log(`\n\x1b[33m[Orchestrator]\x1b[0m Blackboard after listening:\n${blackboard.summary()}`);

  if (state.transcriptions.length === 0 && state.binaryContent.length === 0) {
    throw new Error("No usable signals collected — cannot proceed with analysis");
  }

  // ── Debug: print collected content ─────────────────────────────────────
  if (process.env.DEBUG_CONTENT === "1") {
    console.log("\n=== COLLECTED TRANSCRIPTIONS ===");
    state.transcriptions.forEach((t, i) => console.log(`\n--- Transcription ${i + 1} ---\n${t}`));
    console.log("\n=== COLLECTED BINARY CONTENT ===");
    state.binaryContent.forEach((b, i) => console.log(`\n--- Binary ${i + 1} ---\n${b}`));
  }

  // ── Stage 3 + 4: Analyse (with retries) ────────────────────────────────
  console.log("\n\x1b[33m[Orchestrator]\x1b[0m Launching AnalyzerAgent…");

  for (let attempt = 1; attempt <= MAX_ANALYSIS_RETRIES + 1; attempt++) {
    await runAnalyzerAgent({ blackboard });

    if (blackboard.factsComplete()) {
      console.log(`\n\x1b[33m[Orchestrator]\x1b[0m All facts found on attempt ${attempt}.`);
      break;
    }

    if (attempt <= MAX_ANALYSIS_RETRIES) {
      const missing = getMissingFields(blackboard.get("extractedFacts"));
      console.warn(
        `[Orchestrator] Attempt ${attempt}: facts incomplete. Missing: ${missing.join(", ")}. ` +
        `Retrying analysis…`
      );
      // Add a hint to the blackboard for the next analysis pass
      blackboard.addBinaryContent(
        `[Orchestrator hint]: Still need: ${missing.join(", ")}. ` +
        `Please re-examine ALL previous fragments carefully.`
      );
    } else {
      console.warn("[Orchestrator] Max analysis retries reached — proceeding with partial facts.");
    }
  }

  console.log(`\n\x1b[33m[Orchestrator]\x1b[0m Blackboard after analysis:\n${blackboard.summary()}`);

  // ── Stage 5: Validate ───────────────────────────────────────────────────
  if (!blackboard.factsComplete()) {
    const missing = getMissingFields(blackboard.get("extractedFacts"));
    throw new Error(
      `Cannot transmit — missing facts after analysis: ${missing.join(", ")}\n` +
      `Current facts: ${JSON.stringify(blackboard.get("extractedFacts"), null, 2)}`
    );
  }

  // ── Stage 6: Transmit ───────────────────────────────────────────────────
  console.log("\n\x1b[33m[Orchestrator]\x1b[0m Launching ReporterAgent…");
  return runReporterAgent({ apikey, blackboard });
};

const getMissingFields = (facts) =>
  ["cityName", "cityArea", "warehousesCount", "phoneNumber"].filter(
    (f) => facts[f] == null
  );
