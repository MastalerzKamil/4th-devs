import { chat, extractText } from "../helpers/api.js";
import { ANALYSIS_MODEL } from "../config.js";

/**
 * Subagent that analyzes raw log content and extracts critical events.
 * Uses a large-context model to process the full log file.
 */
export async function analyzeLogsSubagent(rawLogs) {
  console.log("  [LogAnalyzer] Analyzing logs with LLM subagent...");
  console.log(`  [LogAnalyzer] Input size: ${rawLogs.length} chars`);

  const response = await chat({
    model: ANALYSIS_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a power plant log analyst. Extract ONLY the critical events relevant to diagnosing a failure/shutdown.

## DEDUPLICATION IS CRITICAL
Many events repeat dozens of times with identical messages. You MUST deduplicate:
- For repeating events, keep ONLY the FIRST and LAST occurrence
- Add "(repeats Nx)" to the first occurrence to indicate how many times total it appeared
- Example: if "FIRMWARE entered emergency guard branch" appears 16 times between 12:51 and 21:08,
  output TWO lines:
  [2026-03-17 12:51] [CRIT] FIRMWARE emergency guard branch, repeated safety faults. Manual override locked (repeats 16x)
  [2026-03-17 21:08] [CRIT] FIRMWARE emergency guard branch (last occurrence)

## What to extract:
- ALL unique event TYPES with severity WARN, ERRO, or CRIT (first occurrence + count)
- Key INFO events: system boot, shutdown start/complete
- For each subsystem, show the progression from first warning to critical failure

## What to SKIP:
- Routine INFO monitoring messages
- Duplicate events (merge them as described above)

## Output format:
[YYYY-MM-DD HH:MM] [SEVERITY] SUBSYSTEM_ID short_description

Rules:
- Keep timestamps from the original (can drop seconds: HH:MM is fine)
- Keep severity and subsystem IDs exact
- Shorten descriptions aggressively - just the key technical fact
- Add "(repeats Nx)" for duplicated events
- Target UNDER 1200 tokens (~3600 chars max)
- Output NOTHING else — no headers, explanations, or summaries`,
      },
      {
        role: "user",
        content: `Extract critical events from these power plant logs:\n\n${rawLogs}`,
      },
    ],
    maxTokens: 4096,
  });

  const result = extractText(response);
  console.log(`  [LogAnalyzer] Extracted ${result?.split("\n").length ?? 0} events`);
  return result;
}

/**
 * Subagent that refines compressed logs based on technician feedback.
 */
export async function refineLogsSubagent(currentLogs, feedback, rawLogs) {
  console.log("  [LogRefiner] Refining logs based on feedback...");

  const response = await chat({
    model: ANALYSIS_MODEL,
    messages: [
      {
        role: "system",
        content: `You are a power plant log analyst refining compressed logs based on technician feedback.

## Your task:
1. Read feedback carefully — it specifies exactly what's missing or unclear
2. Search raw logs for missing information
3. Produce updated compressed logs addressing ALL feedback
4. Stay UNDER 1200 tokens (~3600 chars max)

## DEDUPLICATION RULES:
- For repeating events, keep FIRST + LAST occurrence only
- Add "(repeats Nx)" to the first occurrence
- This is critical for staying within token limits

## IMPORTANT for specific devices:
If feedback mentions a device is unclear, include ALL unique event types for that device:
- First occurrence of each unique message pattern (with repeat count)
- Last occurrence if it differs in time
- The full progression from normal → warning → error → critical

## Output format:
[YYYY-MM-DD HH:MM] [SEVERITY] SUBSYSTEM_ID short_description
- One event per line, NO headers or explanations
- Keep timestamps, severity, subsystem IDs exact
- Shorten descriptions aggressively`,
      },
      {
        role: "user",
        content: `## Current compressed logs:
${currentLogs}

## Technician feedback:
${feedback}

## Full raw logs (search here for missing info):
${rawLogs}`,
      },
    ],
    maxTokens: 4096,
  });

  const result = extractText(response);
  console.log(`  [LogRefiner] Refined to ${result?.split("\n").length ?? 0} events`);
  return result;
}
