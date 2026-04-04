import { runFilesystemStructuredAnalyst } from "./analystStructured.js";
import { buildBatchFromPlan } from "./buildBatch.js";
import { validateBatchAgainstHelp } from "./helpValidation.js";
import { postFilesystem } from "./hub.js";
import { postProcessPlan } from "./planPostProcess.js";
import { formatNotesForAnalyst, loadNotesBundle } from "./planParser.js";
import { DEFAULT_AGENT_MODEL } from "./taskConfig.js";

/** @deprecated Use orchestrator; kept for scripts / tests */
export { slugify } from "./buildBatch.js";

/**
 * @param {object} helpData - hub help `data`
 * @param {string} [model]
 */
export async function solveFilesystem(apikey, notesDir, helpData, model = DEFAULT_AGENT_MODEL) {
  const bundle = await loadNotesBundle(notesDir);
  const notesMarkdown = formatNotesForAnalyst(bundle);
  const transakcjeText = bundle["transakcje.txt"];

  let plan = postProcessPlan(
    await runFilesystemStructuredAnalyst({
      notesMarkdown,
      transakcjeText,
      model,
    }),
  );

  let batch = buildBatchFromPlan(plan);
  let v = validateBatchAgainstHelp(batch, helpData);
  if (!v.ok) {
    plan = postProcessPlan(
      await runFilesystemStructuredAnalyst({
        notesMarkdown,
        transakcjeText,
        model,
        repairErrors: v.errors,
      }),
    );
    batch = buildBatchFromPlan(plan);
    v = validateBatchAgainstHelp(batch, helpData);
    if (!v.ok) {
      throw new Error(`Deterministic path: help validation failed:\n${v.errors.join("\n")}`);
    }
  }

  const applied = await postFilesystem(apikey, batch);
  const done = await postFilesystem(apikey, { action: "done" });
  return {
    applied,
    done,
    batchOpCount: batch.length,
    validation: v,
  };
}
