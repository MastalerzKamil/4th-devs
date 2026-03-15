/**
 * Serwer proxy-asystenta (zadanie proxy AI Devs).
 * POST JSON: { "sessionID": "...", "msg": "..." }
 * Odpowiedź: { "msg": "..." }
 */
import http from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAgentTurn, appendTurn } from "./src/agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT?.trim() || 3000);
/** Hub (ag3nts): wyłącznie API paczek + to samo apikey co przy verify — NIE OpenRouter */
const HUB_APIKEY = process.env.HUB_APIKEY?.trim() ?? "";
const SESSIONS_DIR = path.join(__dirname, "sessions");

/** @type {Map<string, { role: string, content: string }[]>} */
const sessionStore = new Map();

const ensureSessionsDir = async () => {
  await mkdir(SESSIONS_DIR, { recursive: true });
};

const sessionPath = (id) =>
  path.join(SESSIONS_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 128)}.json`);

const loadSession = async (sessionID) => {
  if (sessionStore.has(sessionID)) return sessionStore.get(sessionID);
  try {
    const raw = await readFile(sessionPath(sessionID), "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.messages)) {
      sessionStore.set(sessionID, data.messages);
      return data.messages;
    }
  } catch {
    /* brak pliku */
  }
  sessionStore.set(sessionID, []);
  return [];
};

const saveSession = async (sessionID, messages) => {
  sessionStore.set(sessionID, messages);
  await ensureSessionsDir();
  await writeFile(sessionPath(sessionID), JSON.stringify({ messages }, null, 0), "utf8");
};

const sendJson = (res, status, obj) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && (req.url === "/" || req.url === "/health")) {
    return sendJson(res, 200, { ok: true, service: "proxy-assistant" });
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { msg: "Zły JSON w body." });
  }

  const sessionID = typeof body.sessionID === "string" ? body.sessionID.trim() : "";
  const msg = typeof body.msg === "string" ? body.msg : "";

  if (!sessionID || !msg) {
    return sendJson(res, 400, { msg: "Wymagane pola: sessionID i msg (stringi)." });
  }

  console.log(`[${sessionID.slice(0, 12)}…] ← ${msg.slice(0, 200)}`);

  try {
    const history = await loadSession(sessionID);
    const { reply } = await runAgentTurn(msg, history, HUB_APIKEY);
    const next = appendTurn(history, msg, reply);
    await saveSession(sessionID, next);
    console.log(`[${sessionID.slice(0, 12)}…] → ${reply.slice(0, 200)}`);
    return sendJson(res, 200, { msg: reply });
  } catch (e) {
    console.error(e);
    return sendJson(res, 500, {
      msg: "Chwilowy błąd systemu — spróbuj za chwilę."
    });
  }
});

await ensureSessionsDir();

if (!HUB_APIKEY) {
  console.error("Brak HUB_APIKEY w .env — potrzebny do API paczek (inny niż OPENROUTER_API_KEY).");
  process.exit(1);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy-asystent: http://0.0.0.0:${PORT} (POST { sessionID, msg })`);
  console.log(
    `HUB_APIKEY (paczki/verify): ${HUB_APIKEY ? `${HUB_APIKEY.slice(0, 8)}…` : "(ustaw w .env — wymagane)"}`
  );
});
