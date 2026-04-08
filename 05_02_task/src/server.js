import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { runPhonecallConversation } from "./conversation.js";
import { getMemorySummary, MEMORY_DATA_DIR } from "./memory_store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = path.join(__dirname, "..", "public");

const PORT = Number(process.env.PHONECALL_PORT ?? "3312");

/** @type {{ controller: AbortController | null, running: boolean }} */
const session = {
  controller: null,
  running: false,
};

const LOG_MAX = 200;
/** @type {string[]} */
const logRing = [];

function pushLog(line) {
  const stamp = new Date().toISOString().slice(11, 23);
  const text = `[${stamp}] ${line}`;
  console.log(text);
  logRing.push(text);
  if (logRing.length > LOG_MAX) logRing.splice(0, logRing.length - LOG_MAX);
}

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({
    running: session.running,
    hasOpenAI: Boolean(process.env.OPENAI_API_KEY),
    hasHub: Boolean(process.env.HUB_APIKEY),
  }),
);

app.get("/api/log", (c) => c.json({ lines: logRing.slice(-120) }));

app.get("/api/memory", async (c) => {
  try {
    const summary = await getMemorySummary();
    return c.json({ ok: true, dataDir: MEMORY_DATA_DIR, ...summary });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.post("/api/start", async (c) => {
  if (session.running) {
    return c.json({ ok: false, error: "Already running" }, 409);
  }

  const openai = process.env.OPENAI_API_KEY?.trim();
  const hub = process.env.HUB_APIKEY?.trim();
  if (!openai) return c.json({ ok: false, error: "Missing OPENAI_API_KEY in root .env" }, 400);
  if (!hub) return c.json({ ok: false, error: "Missing HUB_APIKEY in root .env" }, 400);

  session.controller = new AbortController();
  session.running = true;
  const signal = session.controller.signal;

  logRing.length = 0;
  pushLog("Session started (fully automated phonecall loop).");

  void (async () => {
    try {
      const result = await runPhonecallConversation({
        apikey: hub,
        openaiKey: openai,
        signal,
        log: pushLog,
      });
      if (result?.flag) pushLog(`SUCCESS — flag: ${result.flag}`);
    } catch (e) {
      if (e && typeof e === "object" && "name" in e && e.name === "AbortError") {
        pushLog("Aborted.");
      } else {
        pushLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      session.running = false;
      session.controller = null;
      pushLog("Session finished.");
    }
  })();

  return c.json({ ok: true });
});

app.post("/api/stop", (c) => {
  if (!session.running || !session.controller) {
    return c.json({ ok: false, error: "Not running" }, 400);
  }
  session.controller.abort();
  return c.json({ ok: true });
});

app.use("/*", serveStatic({ root: PUBLIC_ROOT }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`[05_02_task] http://localhost:${PORT}`);
  console.log("[05_02_task] Env: OPENAI_API_KEY + HUB_APIKEY from repo root .env");
});
