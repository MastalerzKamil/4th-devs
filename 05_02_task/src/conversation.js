import {
  createOpenAI,
  nextSpokenReply,
  speakPolish,
  transcribePolish,
} from "./openai_pipeline.js";
import { summarizeHubData, verifyPhonecall } from "./hub_client.js";
import {
  appendPhonecallTurn,
  finishPhonecallSession,
  startPhonecallSession,
} from "./memory_store.js";

/**
 * @param {unknown} data
 */
function extractFlag(data) {
  if (!data || typeof data !== "object") return null;
  const msg = data.message ?? data.msg ?? data.answer ?? "";
  const s = typeof msg === "string" ? msg : JSON.stringify(msg);
  const m = s.match(/FLG\{[^}]+\}/i) ?? s.match(/\{\{FLG[^}]*\}\}/);
  if (m) return m[0];
  if (/FLG/i.test(s)) return s.trim();
  return null;
}

/**
 * Koniec pętli tylko przy fladze lub twardym błędzie parsowania.
 * Ujemne kody (np. -820) = odrzucenie nagrania + wskazówka — **kontynuuj** z nową wypowiedzią.
 * @param {unknown} data
 */
function shouldStopSession(data) {
  if (!data || typeof data !== "object") return { stop: true, flag: null, reason: "invalid" };
  if ("parseError" in data && data.parseError) return { stop: true, flag: null, reason: "parse" };

  const flag = extractFlag(data);
  if (flag) return { stop: true, flag, reason: "flag" };

  const msg = typeof data.message === "string" ? data.message : "";
  if (msg && /musisz ponownie.*start|sesja.*unieważnion|zadanie.*anulowan|rozmowa.*spalona/i.test(msg)) {
    return { stop: true, flag: null, reason: "hard_reset" };
  }

  return { stop: false, flag: null, reason: "continue" };
}

const META_HUB_MESSAGE = /^Phonecall session started\.?$/i;
const META_HUB_MSG = /przez najbliższe\s+\d+\s+minut/i;

/**
 * Rozbij angielski hint Centrali na jawne punkty do spełnienia po polsku (model często ignoruje sam tekst).
 * @param {string} hintEn
 * @returns {string[]}
 */
function polishChecklistFromEnglishHint(hintEn) {
  const h = hintEn.trim();
  if (!h) return [];

  /** @type {string[]} */
  const lines = [];

  if (/secret transport|delivering a secret|purpose of the call.*transport/i.test(h)) {
    lines.push(
      "Powiedz wprost o **tajnym transporcie** (np. żywności) — samo „organizujemy transport” albo „do bazy” bez słowa „tajny” bywa niewystarczające.",
    );
  }
  if (/passable road|find a passable|needing to find.*road/i.test(h)) {
    lines.push(
      "Powiedz wprost, że musisz **znaleźć przejezdną drogę / trasę** (to jest cel rozmowy z monitoringiem).",
    );
  }
  if (/who this transport is for|for whom|mention who/i.test(h)) {
    lines.push(
      "Wskaż **dla kogo** jest transport — np. operacja dla **Zygfryda** / w ramach działań dla Zygfryda (nie zostawiaj tego domyślnego).",
    );
  }
  if (/status.*RD|RD\d{3}|three roads|all three/i.test(h)) {
    lines.push(
      "Zachowaj **numery dróg** RD224, RD472, RD820 (wyraźnie), jeśli w rozmowie nadal są potrzebne.",
    );
  }
  if (/purpose of the call/i.test(h)) {
    lines.push(
      "W **jednym** płynnym zdaniu połącz: cel (tajny transport + dla kogo) + potrzeba przejezdnej trasy — bez brzmienia jak odczyt listy punktów.",
    );
  }

  return lines;
}

/**
 * Odrzucenie / feedback od Centrali (kod < 0) — złóż jeden blok dla modelu.
 * @param {Record<string, unknown>} data
 * @param {import("openai").OpenAI} client
 * @param {(s: string) => void} log
 */
/**
 * @param {Record<string, unknown>} data
 * @param {import("openai").OpenAI} client
 * @param {(s: string) => void} log
 * @param {string} [rejectedSpeech] — ostatnia wypowiedź Tymona (żeby model nie powtarzał jej dosłownie)
 */
async function formatHubRejection(data, client, log, rejectedSpeech = "") {
  const parts = [];
  const code = data.code;
  const hint = typeof data.hint === "string" ? data.hint.trim() : "";
  const trans = typeof data.transcription === "string" ? data.transcription.trim() : "";
  const poleMsg = typeof data.message === "string" ? data.message.trim() : "";

  parts.push(`=== ODRZUCENIE NAGRANIA (kod ${code}) — kolejna wypowiedź MUSI być inna niż poprzednia ===`);

  if (hint) {
    parts.push("WSKAZÓWKA OD CENTRALI (po angielsku — przeczytaj i SPEŁNIJ sens w następnej wypowiedzi po polsku, naturalnym tonem):");
    parts.push(hint);
    const checklist = polishChecklistFromEnglishHint(hint);
    if (checklist.length) {
      parts.push("");
      parts.push("OBOWIĄZKOWA LISTA (spełnij KAŻDY punkt — po polsku, jednym lub dwoma krótkimi zdaniami, innym brzmieniem niż poprzednia odrzucona wypowiedź):");
      for (const line of checklist) {
        parts.push(`• ${line}`);
      }
    }
    parts.push(
      "Zasady: (1) nie ignoruj powyższego — zwykle chodzi o: tajny transport, cel/przejezdność dróg, dla kogo operacja, itp.; (2) nie kopiuj poprzedniego zdania ani szablonu „Chciałbym zapytać…” jeśli już został odrzucony — zmień strukturę i słowa.",
    );
    parts.push(
      `Przypomnienie na końcu (najważniejsze): ${hint}`,
    );
  }

  if (rejectedSpeech) {
    parts.push(`Twoja poprzednia wypowiedź (NIE powtarzaj jej dosłownie): «${rejectedSpeech.slice(0, 420)}${rejectedSpeech.length > 420 ? "…" : ""}»`);
    if (/chciałbym zapytać|chciałbym się zapytać/i.test(rejectedSpeech)) {
      parts.push(
        "Konkretnie: NIE zaczynaj od «Chciałbym zapytać» ani tej samej konstrukcji — zacznij inaczej (np. „Dzwonię, ponieważ…», „W ramach operacji…», „Muszę ustalić…», „Potrzebuję od Was…»).",
      );
    }
  }
  if (trans) {
    parts.push(`Jak zrozumiano twoją mowę po stronie systemu (diagnostyka): „${trans}”.`);
  }
  if (poleMsg) {
    parts.push(`Komunikat: ${poleMsg}`);
  }

  const b64 = typeof data.audio === "string" ? data.audio : typeof data.attachment === "string" ? data.attachment : null;
  if (typeof b64 === "string" && b64.length > 200) {
    try {
      const buf = Buffer.from(b64, "base64");
      let mime = "audio/mpeg";
      if (typeof data.meta === "string" && data.meta.includes("/")) mime = data.meta;
      log(`[hub] transkrypcja audio zwrotnego (${buf.length} b)…`);
      const t = await transcribePolish(client, buf, mime);
      if (t?.trim()) parts.push(`Operator (transkrypcja audio): ${t.trim()}`);
    } catch (e) {
      log(`[whisper] zwrotne: ${e instanceof Error ? e.message : e}`);
    }
  }
  return parts.join("\n");
}

/**
 * @param {unknown} data
 * @param {import("openai").OpenAI} client
 * @param {(s: string) => void} log
 * @returns {Promise<string | null>}
 */
async function extractOperatorText(data, client, log) {
  if (!data || typeof data !== "object") return null;

  const hasAudio =
    (typeof data.audio === "string" && data.audio.length > 100)
    || (typeof data.attachment === "string" && data.attachment.length > 100);

  if (data.action === "start" && !hasAudio && !data.transcription) {
    return null;
  }

  // Hub-side transcription (most reliable)
  if (typeof data.transcription === "string" && data.transcription.trim()) {
    return data.transcription.trim();
  }

  // If audio is present, transcribe it first — the text `message` is often just a
  // short status string ("Road status delivered.") that loses the actual operator speech.
  const b64 = typeof data.audio === "string" ? data.audio : typeof data.attachment === "string" ? data.attachment : null;
  if (b64 && b64.length > 100) {
    let mime = "audio/mpeg";
    if (typeof data.meta === "string" && data.meta.includes("/")) mime = data.meta;
    try {
      const buf = Buffer.from(b64, "base64");
      if (buf.length > 0) {
        log(`[hub] audio od operatora (${buf.length} bytes, ${mime}) → Whisper…`);
        const t = await transcribePolish(client, buf, mime);
        if (t?.trim()) return t.trim();
      }
    } catch (e) {
      log(`[whisper] ${e instanceof Error ? e.message : e}`);
    }
  }

  // Fallback: text message from hub
  const textMsg = typeof data.message === "string" ? data.message.trim() : "";
  if (
    textMsg
    && !textMsg.startsWith("<!DOCTYPE")
    && textMsg.length < 10_000
    && !META_HUB_MESSAGE.test(textMsg)
    && !/^[\s{}[\]"]+$/.test(textMsg)
  ) {
    return textMsg;
  }

  const hint = typeof data.hint === "string" ? data.hint.trim() : "";
  if (hint) return hint;

  const shortMsg = typeof data.msg === "string" ? data.msg.trim() : "";
  if (shortMsg && shortMsg.length < 4000 && !META_HUB_MSG.test(shortMsg)) {
    return shortMsg;
  }

  return null;
}

/**
 * @param {unknown} data
 */
/**
 * @param {unknown} data
 * @param {string} [lastTymonLine] — tekst ostatniej wysłanej wypowiedzi (przy odrzuceniu)
 */
async function buildUserMessageFromHub(data, client, log, lastTymonLine = "") {
  if (!data || typeof data !== "object") return null;

  const code = data.code;
  if (typeof code === "number" && code < 0) {
    return formatHubRejection(data, client, log, lastTymonLine);
  }

  return extractOperatorText(data, client, log);
}

/**
 * @typedef {{ flag: string | null; lastHub: unknown }} ConversationResult
 */

/**
 * @param {{ apikey: string, openaiKey: string, signal: AbortSignal, log: (s: string) => void }} opts
 * @returns {Promise<ConversationResult>}
 */
export async function runPhonecallConversation(opts) {
  const { apikey, openaiKey, signal, log } = opts;
  const client = createOpenAI(openaiKey);

  /** @type {Awaited<ReturnType<typeof startPhonecallSession>> | null} */
  let mem = null;
  const endState = { outcome: "running", flag: /** @type {string | null | undefined} */ (undefined) };

  const messages = /** @type {Array<{ role: string, content: string }>} */ ([]);

  try {
    mem = await startPhonecallSession();
    log(`[memory] Sesja ${mem.id} — przed każdą odpowiedzią agent wywołuje narzędzie read_phonecall_memory (odczyt .data).`);

    log("[hub] POST answer.action=start …");
    const start = await verifyPhonecall(apikey, { action: "start" });
    log(`[hub] start HTTP ${start.status} ok=${start.ok}`);
    log(summarizeHubData(start.data));

    if (!start.ok && start.status >= 500) {
      throw new Error(`Hub unavailable (HTTP ${start.status}). Retry later.`);
    }

    const doneAtStart = shouldStopSession(start.data);
    if (doneAtStart.stop && doneAtStart.flag) {
      log(`[FLAG] ${doneAtStart.flag}`);
      endState.outcome = "flag";
      endState.flag = doneAtStart.flag;
      return { flag: doneAtStart.flag, lastHub: start.data };
    }

    let opText = await buildUserMessageFromHub(start.data, client, log);
    if (opText) {
      log(`[do modelu] ${opText.slice(0, 500)}${opText.length > 500 ? "…" : ""}`);
      messages.push({ role: "user", content: opText });
    } else {
      messages.push({
        role: "user",
        content:
          "Nawiązano połączenie z operatorem. Twoja pierwsza wypowiedź musi zawierać pełne imię i nazwisko: Tymon Gajewski — wyraźnie, po polsku.",
      });
    }

    const maxTurns = Number(process.env.PHONECALL_MAX_TURNS ?? "40") || 40;

    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal.aborted) {
        log("[abort] Stopped by user.");
        endState.outcome = "abort";
        const err = new Error("Aborted");
        err.name = "AbortError";
        throw err;
      }

      const reply = await nextSpokenReply(client, messages);

      if (!reply) {
        log("[agent] empty reply from model — stopping.");
        endState.outcome = "empty_reply";
        return { flag: null, lastHub: null };
      }

      log(`[Tymon] ${reply}`);
      messages.push({ role: "assistant", content: reply });

      const mp3 = await speakPolish(client, reply);
      const audioB64 = mp3.toString("base64");

      log(`[hub] POST audio (${mp3.length} bytes mp3) …`);
      const hub = await verifyPhonecall(apikey, { audio: audioB64 });
      log(`[hub] HTTP ${hub.status} ok=${hub.ok}`);
      log(summarizeHubData(hub.data));

      await appendPhonecallTurn(mem, {
        index: turn,
        tymonText: reply,
        hubOk: hub.ok,
        hubStatus: hub.status,
        hubData: hub.data,
      });

      const fin = shouldStopSession(hub.data);
      if (fin.stop) {
        const flag = fin.flag ?? extractFlag(hub.data);
        if (flag) log(`[FLAG] ${flag}`);
        else if (fin.reason === "hard_reset") log("[koniec] Sesja wymaga ponownego startu (komunikat Centrali).");
        else log(`[koniec] ${fin.reason ?? "stop"}`);

        if (fin.flag) {
          endState.outcome = "flag";
          endState.flag = flag ?? null;
        } else if (fin.reason === "hard_reset") {
          endState.outcome = "hard_reset";
        } else if (fin.reason === "parse") {
          endState.outcome = "parse";
        } else {
          endState.outcome = "error";
        }

        return { flag: flag ?? null, lastHub: hub.data };
      }

      opText = await buildUserMessageFromHub(hub.data, client, log, reply);
      if (opText) {
        log(`[do modelu] ${opText.slice(0, 600)}${opText.length > 600 ? "…" : ""}`);
        messages.push({ role: "user", content: opText });
      } else {
        messages.push({
          role: "user",
          content:
            "[Centrala nie zwróciła treści głosowej w tej odpowiedzi — kontynuuj scenariusz: kolejny krótki krok albo doprecyzowanie ostatniej prośby.",
        });
      }
    }

    log("[warn] Max turns reached.");
    endState.outcome = "max_turns";
    return { flag: null, lastHub: null };
  } catch (e) {
    if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
      endState.outcome = "abort";
    } else {
      endState.outcome = "error";
    }
    throw e;
  } finally {
    if (mem) {
      await finishPhonecallSession(mem, {
        outcome: endState.outcome,
        flag: endState.flag ?? null,
      }).catch((err) => {
        log(`[memory] save failed: ${err instanceof Error ? err.message : String(err)}`);
      });
      log(`[memory] Sesja zapisana (${endState.outcome}).`);
    }
  }
}
