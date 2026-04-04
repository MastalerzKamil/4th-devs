import { runAgent } from "./agent.js";
import { runFilesystemStructuredAnalyst } from "./analystStructured.js";
import { buildBatchFromPlan } from "./buildBatch.js";
import { createReaderTools } from "./agents/readerTools.js";
import { READER_INSTRUCTIONS } from "./agents/prompts.js";
import { buildValidatedBatch } from "./helpValidation.js";
import { postFilesystem } from "./hub.js";
import { postProcessPlan } from "./planPostProcess.js";
import {
  extractReaderBundle,
  formatNotesForAnalyst,
} from "./planParser.js";
import { DEFAULT_AGENT_MODEL } from "./taskConfig.js";

/**
 * @param {object} params
 * @param {object} params.helpData - `data` field from hub help response (limits, batch_mode, …)
 */
export async function runFilesystemPipeline({
  apikey,
  notesDir,
  helpData,
  model = DEFAULT_AGENT_MODEL,
}) {
  const log = (label, msg, extra) => {
    console.log(`\n\x1b[36m[${label}]\x1b[0m ${msg}`);
    if (extra !== undefined) console.log(typeof extra === "string" ? extra : JSON.stringify(extra, null, 2));
  };

  log("1-Reader", "Starting (tools: list + read notes)…");
  const readerKit = createReaderTools(notesDir);
  const readerResult = await runAgent({
    instructions: READER_INSTRUCTIONS,
    definitions: readerKit.definitions,
    handlers: readerKit.handlers,
    initialMessages: [
      {
        role: "user",
        content: "Read all Natan notes in the input folder. Use tools for every file.",
      },
    ],
    model,
    onStep: ({ step, callCount }) => {
      if (callCount) console.log(`  reader step ${step + 1}: ${callCount} tool call(s)`);
    },
  });

  const bundle = extractReaderBundle(readerResult.conversation);
  const required = ["transakcje.txt", "rozmowy.txt", "ogloszenia.txt"];
  const missing = required.filter((k) => !bundle[k]);
  if (missing.length) {
    throw new Error(`Reader did not load: ${missing.join(", ")}`);
  }
  log("1-Reader", "Done.", readerResult.text.slice(0, 200));

  const analystInput = formatNotesForAnalyst(bundle);
  const transakcjeText = bundle["transakcje.txt"];

  log("2-Analyst", "Structured output (OpenAI Responses API: text.format json_schema)…");

  let plan = postProcessPlan(
    await runFilesystemStructuredAnalyst({
      notesMarkdown: analystInput,
      transakcjeText,
      model,
    }),
  );

  log("2-Analyst", "Plan ready.", {
    cities: Object.keys(plan.miasta).length,
    osoby: plan.osoby.length,
    transakcjeChars: plan.transakcje_text.length,
  });

  log("3-Validate", "Checking batch against hub `help` rules (limits, links, JSON)…");
  const { batch, validation, usedRepair, firstValidationErrors } = await buildValidatedBatch({
    plan,
    helpData,
    buildBatchFromPlan,
    repairPlan: async (errors) =>
      postProcessPlan(
        await runFilesystemStructuredAnalyst({
          notesMarkdown: analystInput,
          transakcjeText,
          model,
          repairErrors: errors,
        }),
      ),
  });

  if (usedRepair) {
    log("3-Validate", "First plan failed local validation; repaired plan passed.", firstValidationErrors);
  } else {
    log("3-Validate", "Batch OK.", { errors: validation.errors });
  }

  log("4-Submit", `POST batch (${batch.length} ops) + done…`);
  const lastApplied = await postFilesystem(apikey, batch);
  const lastDone = await postFilesystem(apikey, { action: "done" });

  log("4-Submit", "Hub done response.", {
    code: lastDone?.data?.code,
    message: lastDone?.data?.message,
  });

  return {
    readerText: readerResult.text,
    analystText: `[structured] cities=${Object.keys(plan.miasta).length} osoby=${plan.osoby.length}`,
    verifyText: lastDone?.data?.message ?? "",
    verifyOutcome: {
      lastApplied,
      lastDone,
      batchUsed: batch,
      attemptsUsed: 1,
      validation,
      usedRepairBatch: usedRepair,
    },
    plan,
    batchLength: batch.length,
  };
}
