import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const MEMORY_DATA_DIR = path.join(__dirname, "..", ".data");
const STORE_PATH = path.join(MEMORY_DATA_DIR, "phonecall_memory.json");

const MAX_STORED_SESSIONS = 30;
const MAX_LESSON_CHARS = Number(process.env.PHONECALL_MEMORY_MAX_CHARS ?? "3800") || 3800;
const SESSIONS_IN_LESSONS = Number(process.env.PHONECALL_MEMORY_SESSIONS ?? "8") || 8;

/**
 * @typedef {{
 *   id: string;
 *   startedAt: string;
 *   endedAt?: string;
 *   outcome: string;
 *   flag?: string | null;
 *   turns: Array<{
 *     index: number;
 *     outgoingPreview: string;
 *     hubOk: boolean;
 *     hubStatus?: number;
 *     hubCode?: number;
 *     heard?: string;
 *     hint?: string;
 *     hubMessagePreview?: string;
 *     rejection: boolean;
 *   }>;
 * }} SessionRecord
 */

/**
 * @typedef {{ version: number; sessions: SessionRecord[] }} MemoryStore
 */

async function ensureDataDir() {
  await mkdir(MEMORY_DATA_DIR, { recursive: true });
}

async function readStore() {
  await ensureDataDir();
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && Array.isArray(j.sessions)) {
      return /** @type {MemoryStore} */ ({ version: j.version ?? 1, sessions: j.sessions });
    }
  } catch {
    /* empty */
  }
  return { version: 1, sessions: [] };
}

async function writeStore(store) {
  await ensureDataDir();
  while (store.sessions.length > MAX_STORED_SESSIONS) {
    store.sessions.shift();
  }
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

/**
 * New phonecall run — persisted immediately so a crash still keeps the id.
 */
export async function startPhonecallSession() {
  const id = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
  const session = /** @type {SessionRecord} */ ({
    id,
    startedAt: new Date().toISOString(),
    outcome: "running",
    turns: [],
  });
  const store = await readStore();
  store.sessions.push(session);
  await writeStore(store);
  return session;
}

/**
 * @param {SessionRecord} session
 * @param {object} p
 */
export async function appendPhonecallTurn(session, p) {
  const {
    index,
    tymonText,
    hubOk,
    hubStatus,
    hubData,
  } = p;

  const preview = (tymonText ?? "").slice(0, 400);
  const data = hubData && typeof hubData === "object" ? hubData : {};
  const code = typeof data.code === "number" ? data.code : undefined;
  const heard =
    typeof data.transcription === "string" ? data.transcription.trim().slice(0, 300) : undefined;
  const hint = typeof data.hint === "string" ? data.hint.trim().slice(0, 500) : undefined;
  const msg = typeof data.message === "string" ? data.message.trim() : "";
  const hubMessagePreview = msg ? msg.slice(0, 280) : undefined;
  const rejection = typeof code === "number" && code < 0;

  session.turns.push({
    index,
    outgoingPreview: preview,
    hubOk: Boolean(hubOk),
    hubStatus,
    hubCode: code,
    heard,
    hint,
    hubMessagePreview,
    rejection,
  });

  const store = await readStore();
  const idx = store.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) store.sessions[idx] = session;
  else store.sessions.push(session);
  await writeStore(store);
}

/**
 * @param {SessionRecord} session
 * @param {{ outcome: string; flag?: string | null }} end
 */
export async function finishPhonecallSession(session, end) {
  session.endedAt = new Date().toISOString();
  session.outcome = end.outcome;
  if (end.flag !== undefined) session.flag = end.flag;

  const store = await readStore();
  const idx = store.sessions.findIndex((s) => s.id === session.id);
  if (idx >= 0) store.sessions[idx] = session;
  else store.sessions.push(session);
  await writeStore(store);
}

/**
 * Heuristic tips from misheard name etc.
 * @param {SessionRecord["turns"]} turns
 */
function autoTipsFromTurns(turns) {
  /** @type {string[]} */
  const tips = [];
  for (const t of turns) {
    if (!t.heard) continue;
    const h = t.heard.toLowerCase();
    if (t.rejection && !h.includes("gajewski") && /gajew|kęck|kiepsk|kwiec|kowski/i.test(h)) {
      tips.push(
        `Centrala zrozumiała nazwisko inaczej („${t.heard}”) — wymów wyraźnie „Gajewski”, wolniej, w pełnym zdaniu powitalnym.`,
      );
    }
    if (t.hint && /full name|pełn|imię|nazwisk|introduce/i.test(t.hint)) {
      tips.push(`Gdy pojawi się wskazówka o przedstawieniu: ${t.hint}`);
    }
  }
  return [...new Set(tips)].slice(0, 12);
}

/**
 * Ostatnia odrzucona tura z polem `hint` w bieżącej lub poprzedniej sesji — zawsze na wierzchu pamięci.
 */
export async function loadLatestRejectedHint() {
  const store = await readStore();
  const s = store.sessions.at(-1);
  if (!s?.turns?.length) return "";

  for (let i = s.turns.length - 1; i >= 0; i--) {
    const t = s.turns[i];
    if (t.hint && String(t.hint).trim()) {
      return [
        "⚠️ NAJNOWSZA WSKAZÓWKA CENTRALI (obowiązkowa w tej turze — zrozum po angielsku, wypowiedz sens po polsku, innymi słowami niż poprzednio):",
        String(t.hint).trim(),
        `(Kod odpowiedzi Centrali: ${t.hubCode ?? "?"})`,
      ].join("\n");
    }
  }
  return "";
}

/**
 * Build text block for system prompt from recent sessions.
 */
export async function loadLessonsForPrompt() {
  const store = await readStore();
  const recent = store.sessions.filter((s) => s.turns.length > 0).slice(-SESSIONS_IN_LESSONS);

  if (recent.length === 0) {
    return "";
  }

  /** @type {string[]} */
  const lines = [];

  for (const s of recent) {
    const outcomeLabel = s.outcome === "running" ? "nieukończona" : s.outcome;
    const label = `${s.id.slice(0, 12)}… (${outcomeLabel}${s.flag ? ", flag" : ""})`;
    const bad = s.turns.filter((t) => t.rejection || (t.hubCode ?? 0) < 0);
    for (const t of bad) {
      const bits = [`Sesja ${label}, tura ${t.index}`];
      if (t.hubCode !== undefined) bits.push(`kod ${t.hubCode}`);
      if (t.heard) bits.push(`odsłuch: „${t.heard}”`);
      if (t.hint) bits.push(`hint: ${t.hint}`);
      lines.push(`- ${bits.join(" — ")}`);
    }
    for (const tip of autoTipsFromTurns(s.turns)) {
      lines.push(`- ${tip}`);
    }
  }

  let text = [
    "Poniżej: skrót z zapisanych poprzednich prób (ten sam scenariusz). Nie powtarzaj tych samych błędów; dostosuj wypowiedź.",
    ...[...new Set(lines)].slice(0, 45),
  ].join("\n");

  if (text.length > MAX_LESSON_CHARS) {
    text = `${text.slice(0, MAX_LESSON_CHARS)}\n… [obcięte]`;
  }
  return text;
}

/**
 * For UI / debugging
 */
export async function getMemorySummary() {
  const store = await readStore();
  const sessions = store.sessions.length;
  const last = store.sessions.at(-1);
  const lessonsPreview = (await loadLessonsForPrompt()).slice(0, 1200);
  return {
    path: STORE_PATH,
    sessions,
    lastSessionId: last?.id ?? null,
    lastOutcome: last?.outcome ?? null,
    lessonsPreview,
  };
}
