/**
 * S03E04 negotiations task — tool server
 *
 * Exposes one endpoint:
 *   POST /search  { "params": "<natural language query about an item>" }
 *   → { "output": "<comma-separated city names that sell the item>" }
 *
 * Matching: fast keyword/prefix overlap (no LLM) with Polish diacritic normalisation.
 * Falls back to LLM (OpenRouter) when no strong keyword match is found.
 */

import express from "express";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── env ──────────────────────────────────────────────────────────────────────
const ROOT_ENV = path.join(__dirname, "..", ".env");
if (existsSync(ROOT_ENV)) {
  try { process.loadEnvFile(ROOT_ENV); } catch { /* node < 20.12 */ }
}

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
const PORT = Number(process.env.PORT ?? 3456);

// ─── CSV helpers ──────────────────────────────────────────────────────────────
function parseCSV(content) {
  const lines = content.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? "").trim()]));
  });
}

// ─── Load data ────────────────────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, "data");
const items      = parseCSV(readFileSync(path.join(DATA_DIR, "items.csv"),       "utf8"));
const cities     = parseCSV(readFileSync(path.join(DATA_DIR, "cities.csv"),      "utf8"));
const connRows   = parseCSV(readFileSync(path.join(DATA_DIR, "connections.csv"), "utf8"));

const citiesByCode = new Map(cities.map(c => [c.code, c.name]));

// itemCode → [cityName, ...]
const itemToCities = new Map();
for (const { itemCode, cityCode } of connRows) {
  const cityName = citiesByCode.get(cityCode);
  if (!cityName) continue;
  if (!itemToCities.has(itemCode)) itemToCities.set(itemCode, []);
  itemToCities.get(itemCode).push(cityName);
}

console.log(`Loaded ${items.length} items, ${cities.length} cities, ${connRows.length} connections`);

// ─── Text normalisation ───────────────────────────────────────────────────────
function normalize(text) {
  return text
    .toLowerCase()
    .replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e")
    .replace(/ł/g, "l").replace(/ń/g, "n").replace(/ó/g, "o")
    .replace(/ś/g, "s").replace(/ź/g, "z").replace(/ż/g, "z")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return normalize(text).split(" ").filter(w => w.length > 1);
}

// ─── Keyword/prefix matching ──────────────────────────────────────────────────
function scoreItem(queryTokens, itemTokens) {
  let score = 0;
  for (const qt of queryTokens) {
    for (const it of itemTokens) {
      if (qt === it) {
        score += 3;           // exact word match
      } else if (qt.length >= 4 && it.startsWith(qt.slice(0, 4))) {
        score += 1;           // prefix overlap (handles Polish inflections)
      } else if (it.length >= 4 && qt.startsWith(it.slice(0, 4))) {
        score += 1;
      }
    }
  }
  return score;
}

function findTopCandidates(query, limit = 15) {
  const queryTokens = tokenize(query);
  const scored = items.map(item => ({
    item,
    score: scoreItem(queryTokens, tokenize(item.name)),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function findBestByKeywords(query) {
  const candidates = findTopCandidates(query, 15);
  const best = candidates[0];
  const second = candidates[1];

  // Strong unique match — no LLM needed
  if (best.score > 0 && best.score >= second.score * 2) {
    return { item: best.item, method: "keyword" };
  }

  return { item: best.score > 0 ? best.item : null, candidates, method: "ambiguous" };
}

// ─── LLM fallback ─────────────────────────────────────────────────────────────
async function matchWithLLM(query, candidates) {
  if (!OPENROUTER_API_KEY) {
    // No key — just return the top keyword match
    return candidates[0]?.item ?? null;
  }

  const list = candidates
    .filter(c => c.score > 0)
    .slice(0, 15)
    .map(c => `${c.item.code}: ${c.item.name}`)
    .join("\n");

  if (!list) return null;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a product catalogue assistant. Given a user query in Polish, return ONLY the product code from the list that best matches. Output ONLY the code, nothing else.",
        },
        {
          role: "user",
          content: `Query: ${query}\n\nCatalogue:\n${list}\n\nBest matching code:`,
        },
      ],
      max_tokens: 20,
      temperature: 0,
    }),
  });

  const data = await resp.json();
  const code = data.choices?.[0]?.message?.content?.trim();
  if (!code) return null;

  return items.find(i => i.code === code) ?? null;
}

// ─── Main search logic ────────────────────────────────────────────────────────
async function searchItem(query) {
  const { item, candidates, method } = findBestByKeywords(query);

  if (method === "keyword" && item) {
    console.log(`[keyword] "${query}" → ${item.code}: ${item.name}`);
    return item;
  }

  // Ambiguous or no match — try LLM
  const allCandidates = candidates ?? findTopCandidates(query, 15);
  const llmItem = await matchWithLLM(query, allCandidates);
  if (llmItem) {
    console.log(`[llm]     "${query}" → ${llmItem.code}: ${llmItem.name}`);
  } else {
    console.log(`[miss]    "${query}" — no match found`);
  }
  return llmItem;
}

function buildResponse(item) {
  if (!item) return { output: "No matching item found. Try rephrasing your query." };

  const cityList = itemToCities.get(item.code) ?? [];
  if (cityList.length === 0) return { output: `Item "${item.name}" found but no cities sell it.` };

  // Ensure response stays under 500 bytes
  let output = cityList.join(", ");
  const responseJson = JSON.stringify({ output });
  if (Buffer.byteLength(responseJson, "utf8") > 500) {
    // Truncate city list
    let truncated = "";
    for (const city of cityList) {
      const test = truncated ? `${truncated}, ${city}` : city;
      if (Buffer.byteLength(JSON.stringify({ output: test }), "utf8") <= 490) {
        truncated = test;
      } else break;
    }
    output = truncated || cityList[0];
  }

  return { output };
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

app.post("/search", async (req, res) => {
  const { params } = req.body ?? {};
  if (!params || typeof params !== "string") {
    return res.status(400).json({ output: "Error: missing params field" });
  }

  try {
    const item = await searchItem(params.trim());
    const response = buildResponse(item);
    console.log(`  → response: ${JSON.stringify(response)} (${Buffer.byteLength(JSON.stringify(response))} bytes)`);
    res.json(response);
  } catch (err) {
    console.error("Search error:", err.message);
    res.status(500).json({ output: "Internal error, please retry." });
  }
});

// Health check
app.get("/", (_req, res) => res.json({ status: "ok", endpoints: ["POST /search"] }));

app.listen(PORT, () => {
  console.log(`\nTool server listening on http://localhost:${PORT}`);
  console.log(`Endpoint: POST http://localhost:${PORT}/search`);
  console.log(`Body:     { "params": "<natural language item query>" }`);
});
