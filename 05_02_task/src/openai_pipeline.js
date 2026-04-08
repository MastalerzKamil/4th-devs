import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { loadLatestRejectedHint, loadLessonsForPrompt } from "./memory_store.js";

const CHAT_MODEL = process.env.PHONECALL_CHAT_MODEL?.trim() || "gpt-4o";
const TTS_MODEL = process.env.PHONECALL_TTS_MODEL?.trim() || "tts-1-hd";
const TTS_VOICE = process.env.PHONECALL_TTS_VOICE?.trim() || "nova";
const TTS_SPEED = Math.min(4, Math.max(0.25, Number(process.env.PHONECALL_TTS_SPEED ?? "0.92") || 0.92));


/**
 * @param {string} apiKey
 */
export function createOpenAI(apiKey) {
  return new OpenAI({ apiKey });
}

/**
 * @param {import("openai").OpenAI} client
 * @param {Buffer} audioBuffer
 * @param {string} [mime]
 */
export async function transcribePolish(client, audioBuffer, mime = "audio/mpeg") {
  const ext = mime.includes("wav") ? "wav" : mime.includes("webm") ? "webm" : "mp3";
  const file = await toFile(audioBuffer, `in.${ext}`, { type: mime });
  const r = await client.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "pl",
  });
  return (r.text ?? "").trim();
}

/**
 * @param {import("openai").OpenAI} client
 * @param {string} text
 * @returns {Promise<Buffer>} MP3
 */
export async function speakPolish(client, text) {
  const res = await client.audio.speech.create({
    model: TTS_MODEL,
    voice: TTS_VOICE,
    input: text,
    response_format: "mp3",
    speed: TTS_SPEED,
  });
  return Buffer.from(await res.arrayBuffer());
}

const SYSTEM_INSTRUCTIONS = `Jesteś Tymon Gajewski — rozmawiasz przez telefon z operatorem systemu monitoringu dróg (po polsku).

To wieloetapowa rozmowa — kolejność jest krytyczna. Wypowiadaj się krótko, naturalnie.

KRYTYCZNE — wymowa numerów dróg: ZAWSZE pisz numery dróg słownie, nigdy cyframi.
- RD224 → „RD dwieście dwadzieścia cztery”
- RD472 → „RD czterysta siedemdziesiąt dwa”
- RD820 → „RD osiemset dwadzieścia”
Synteza mowy (TTS) błędnie wymawia cyfry, co powoduje odrzucenie nagrania przez system.

Scenariusz:
1) Pierwsza wypowiedź: przedstaw się pełnym imieniem i nazwiskiem „Tymon Gajewski” + krótki kontekst (monitoring dróg), bez pytań o drogi w tej samej turze.
2) Druga wypowiedź — JEDEN blok mowy zawierający:
   - Pytanie o status dróg (wszystkie trzy, słownie): RD dwieście dwadzieścia cztery, RD czterysta siedemdziesiąt dwa, RD osiemset dwadzieścia.
   - Cel: transport organizowany do jednej z baz Zygfryda.
   - Pytanie: które drogi są przejezdne.
3) Gdy poznasz przejezdność — KRÓTKA prośba o wyłączenie monitoringu:
   - Podaj KONKRETNY numer drogi słownie (np. „RD dwieście dwadzieścia cztery”), którą operator wskazał jako przejezdną.
   - Uzasadnij: „To jest w ramach tajnej operacji zleconej przez Zygfryda” — te słowa muszą się pojawić.
   - NIE podawaj hasła BARBAKAN dopóki operator go nie poprosi.
4) Jeśli operator pyta, dlaczego wyłączyć monitoring: transport żywności do tajnej bazy Zygfryda; misja nie może być odnotowana w logach.
5) Jeśli operator prosi o hasło: podaj „BARBAKAN”.

Gdy w wiadomości użytkownika jest „WSKAZÓWKA OD CENTRALI”, „OBOWIĄZKOWA LISTA” lub odrzucenie nagrania:
- **Najpierw** spełnij angielski hint i każdy punkt listy (zrozum po angielsku, wypowiedz sens po polsku w tej samej turze). Nie wolno ignorować hintu.
- **Nie powtarzaj** poprzedniej odrzuconej wypowiedzi — zmień strukturę zdania i dodaj brakujące elementy.

Zasady formatu odpowiedzi:
- Zwracaj WYŁĄCZNIE tekst wypowiedzi do przeczytania na głos operatorowi.
- Bez cudzysłowów, bez numeracji, bez komentarzy meta, bez prefiksów “Tymon:”.
- Jeśli operator potwierdził wyłączenie monitoringu, odpowiedz krótkim “Dziękuję.” i nic więcej.

Narzędzie read_phonecall_memory:
- Przed każdą własną wypowiedzią wywołaj read_phonecall_memory, potem jedna wypowiedź po polsku z uwzględnieniem pamięci i bieżącej rozmowy.`;

const MEMORY_TOOL = {
  type: "function",
  function: {
    name: "read_phonecall_memory",
    description:
      "Odczytuje z dysku aktualny skrót lekcji z poprzednich sesji phonecall (kody Centrali, hinty, błędne odsłuchy). Wywołaj zawsze przed wypowiedzią głosową.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
};

/**
 * Dwuetapowo: (1) wymuszone wywołanie read_phonecall_memory → świeży odczyt pliku,
 * (2) odpowiedź mówiona. Dzięki temu agent zawsze „czyta” pamięć przed odpowiedzią.
 *
 * @param {import("openai").OpenAI} client
 * @param {Array<{ role: string, content: string }>} messages
 * @param {{ useMemoryTool?: boolean }} [options] — useMemoryTool false = jeden prosty request (testy)
 */
export async function nextSpokenReply(client, messages, options = {}) {
  const useMemoryTool =
    options.useMemoryTool !== false && process.env.PHONECALL_USE_MEMORY_TOOL?.trim() !== "0";

  const lastUser = messages.at(-1)?.content ?? "";
  const hintFixMode =
    /WSKAZÓWKA OD CENTRALI|ODRZUCENIE NAGRANIA|NAJNOWSZA WSKAZÓWKA|OBOWIĄZKOWA LISTA|⚠️/i.test(lastUser);

  let systemBody = SYSTEM_INSTRUCTIONS;
  if (hintFixMode) {
    systemBody += `\n\n## TERAZ: POPRAWKA PO ODRZUCENIU\nOstatnia wiadomość użytkownika zawiera wymagania Centrali (w tym listę punktów). Najpierw spełnij **wszystkie** punkty listy — po polsku, jak żywa rozmowa telefoniczna, nie jak lista numerowana na głos. Nie wolno pominąć angielskiego hintu na rzecz wcześniejszego scenariusza. Twoja wypowiedź musi brzmieć **inaczej** niż poprzednia odrzucona linia (inna pierwsza fraza, inna składnia).`;
  }

  if (!useMemoryTool) {
    const res = await client.chat.completions.create({
      model: CHAT_MODEL,
      temperature: hintFixMode ? 0.62 : 0.4,
      max_tokens: hintFixMode ? 520 : 400,
      messages: [{ role: "system", content: systemBody }, ...messages],
    });
    const text = res.choices?.[0]?.message?.content?.trim() ?? "";
    return text.replace(/^["„]|["”]$/g, "").trim();
  }

  const messagesForModel = [{ role: "system", content: systemBody }, ...messages];

  const res1 = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    max_tokens: 200,
    messages: messagesForModel,
    tools: [MEMORY_TOOL],
    tool_choice: { type: "function", function: { name: "read_phonecall_memory" } },
  });

  const msg1 = res1.choices?.[0]?.message;
  const tc = msg1?.tool_calls?.[0];
  if (!tc || tc.type !== "function" || tc.function.name !== "read_phonecall_memory") {
    const fallback = msg1?.content?.trim() ?? "";
    return fallback.replace(/^["„]|["”]$/g, "").trim();
  }

  const urgent = await loadLatestRejectedHint();
  const bulk = await loadLessonsForPrompt();
  const memoryText =
    [urgent, bulk].filter(Boolean).join("\n\n--- DŁUGA PAMIĘĆ (poprzednie sesje) ---\n\n")
    || "(Brak zapisanych lekcji — pierwsza próba lub pusty plik.)";

  const messagesRound2 = [
    ...messagesForModel,
    {
      role: "assistant",
      content: msg1.content ?? null,
      tool_calls: msg1.tool_calls,
    },
    {
      role: "tool",
      tool_call_id: tc.id,
      content: memoryText,
    },
  ];

  const res2 = await client.chat.completions.create({
    model: CHAT_MODEL,
    temperature: hintFixMode ? 0.65 : 0.4,
    max_tokens: hintFixMode ? 520 : 420,
    messages: messagesRound2,
    tools: [MEMORY_TOOL],
    tool_choice: "none",
  });

  const text = res2.choices?.[0]?.message?.content?.trim() ?? "";
  return text.replace(/^["„]|["”]$/g, "").trim();
}
