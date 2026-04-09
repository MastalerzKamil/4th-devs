import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", ".data");
const STORE_PATH = path.join(DATA_DIR, "shellaccess_memory.json");

const MAX_SESSIONS = 20;

/**
 * @typedef {{
 *   step: number;
 *   thought?: string;
 *   command: string;
 *   output: string;
 *   hint?: string | null;
 *   hubStatus?: number;
 * }} StepRecord
 *
 * @typedef {{
 *   id: string;
 *   startedAt: string;
 *   endedAt?: string;
 *   outcome: string;
 *   flag?: string | null;
 *   steps: StepRecord[];
 * }} SessionRecord
 *
 * @typedef {{ version: number; sessions: SessionRecord[] }} MemoryStore
 */

async function ensureDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

/**
 * @returns {Promise<MemoryStore>}
 */
export async function loadMemory() {
  await ensureDir();
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.sessions)) {
      return /** @type {MemoryStore} */ (parsed);
    }
  } catch {
    // file missing or corrupt — start fresh
  }
  return { version: 1, sessions: [] };
}

/**
 * @param {MemoryStore} memory
 */
export async function saveMemory(memory) {
  await ensureDir();
  // Trim to max sessions
  while (memory.sessions.length > MAX_SESSIONS) {
    memory.sessions.shift();
  }
  await writeFile(STORE_PATH, JSON.stringify(memory, null, 2), "utf8");
}

/**
 * Build a concise blackboard text from past sessions for the system prompt.
 * @param {MemoryStore} memory
 * @param {number} [maxChars=6000]
 * @returns {string}
 */
export function buildBlackboard(memory, maxChars = 6000) {
  const completed = memory.sessions.filter(
    (s) => s.outcome !== "running" && s.steps.length > 0,
  );
  if (completed.length === 0) return "";

  const lines = ["=== PREVIOUS ATTEMPTS (blackboard) ==="];

  // Show last 5 sessions
  for (const session of completed.slice(-5)) {
    lines.push(`\n-- Session ${session.id} | outcome: ${session.outcome}${session.flag ? " | FLAG: " + session.flag : ""} --`);
    for (const step of session.steps) {
      lines.push(`  CMD: ${step.command}`);
      if (step.output) {
        const preview = step.output.slice(0, 600);
        lines.push(`  OUT: ${preview}${step.output.length > 600 ? "…" : ""}`);
      }
      if (step.hint) {
        lines.push(`  HINT: ${step.hint}`);
      }
    }
  }

  lines.push("=== END BLACKBOARD ===");

  let text = lines.join("\n");
  if (text.length > maxChars) {
    text = text.slice(0, maxChars) + "\n… [truncated]";
  }
  return text;
}
