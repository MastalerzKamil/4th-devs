import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Load all three Natan notes from disk (deterministic path). */
export async function loadNotesBundle(notesDir) {
  return {
    "transakcje.txt": await readFile(join(notesDir, "transakcje.txt"), "utf8"),
    "rozmowy.txt": await readFile(join(notesDir, "rozmowy.txt"), "utf8"),
    "ogloszenia.txt": await readFile(join(notesDir, "ogłoszenia.txt"), "utf8"),
  };
}

export function extractReaderBundle(conversation) {
  const files = {};
  for (let i = 0; i < conversation.length - 1; i++) {
    const a = conversation[i];
    const b = conversation[i + 1];
    if (a?.type !== "function_call" || a.name !== "read_input_note") continue;
    if (b?.type === "function_call_output" && b.call_id === a.call_id) {
      try {
        const out = JSON.parse(b.output);
        const key = out.logical ?? out.file;
        if (key && typeof out.content === "string") files[key] = out.content;
      } catch {
        /* skip */
      }
    }
  }
  return files;
}

export function formatNotesForAnalyst(files) {
  const order = ["transakcje.txt", "rozmowy.txt", "ogloszenia.txt"];
  const parts = [];
  for (const k of order) {
    if (files[k]) parts.push(`### ${k}\n${files[k]}`);
  }
  return parts.join("\n\n");
}

export function parseAnalystPlan(text) {
  const m = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const raw = (m ? m[1] : text).trim();
  const plan = JSON.parse(raw);
  if (!plan.miasta || typeof plan.miasta !== "object") throw new Error("Invalid plan: miasta");
  if (!Array.isArray(plan.osoby)) throw new Error("Invalid plan: osoby");
  if (typeof plan.transakcje_text !== "string") throw new Error("Invalid plan: transakcje_text");
  if (!plan.transakcje_text.trim()) throw new Error("Invalid plan: empty transakcje_text");
  return plan;
}
