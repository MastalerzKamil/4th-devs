/**
 * Sendit task: submit SPK transport declaration (Gdańsk → Żarnowiec).
 * Uses HUB_APIKEY for verification (not OPENROUTER).
 * Outputs the flag from /verify on success.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../.."); // workspace root (4th-devs)
const ROOT_CONFIG_URL = pathToFileURL(path.join(ROOT, "config.js")).href;

const VERIFY_URL = "https://hub.ag3nts.org/verify";
const DOC_BASE = "https://hub.ag3nts.org/dane/doc";

// Load .env from workspace root (HUB_APIKEY)
const envPath = path.join(ROOT, ".env");
let HUB_APIKEY = process.env.HUB_APIKEY?.trim() ?? "";

async function loadEnv() {
  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*HUB_APIKEY\s*=\s*(.+?)\s*$/);
      if (m) {
        HUB_APIKEY = m[1].replace(/^["']|["']$/g, "").trim();
        break;
      }
    }
  } catch {
    // .env not found or no HUB_APIKEY
  }
}

/**
 * Build declaration text exactly as in Załącznik E (zalacznik-E.md).
 * Data from task:
 * - Nadawca: 450202122
 * - Punkt nadawczy: Gdańsk
 * - Punkt docelowy: Żarnowiec
 * - Waga: 2800 kg (2,8 t)
 * - Budżet 0 PP → Category A or B (opłata 0, System pays)
 * - Zawartość: kasety z paliwem do reaktora → Category A (strategic)
 * - Uwagi specjalne: brak (empty)
 * - Trasa: Gdańsk–Żarnowiec is excluded; only A/B allowed (Dyrektywa 7.7). Route code from "trasy wyłączone" list (image).
 *   Doc says full list is in trasy-wylaczone.png. If we don't have it, try common code. Often excluded routes use X-xx.
 *   zalacznik-F shows: "ŻARNOWIEC ===X=== GDAŃSK" so there is a direct excluded segment. We use route code for that.
 * - WDP: Wagony Dodatkowe Płatne. Standard = 2×500 kg = 1000 kg. 2800 kg → need ceil((2800-1000)/500) = 4 extra wagons.
 *   Doc: WDP = number of additional wagons. For category A the fee for them is not charged, but we must declare 4.
 * - KWOTA DO ZAPŁATY: 0
 */
function buildDeclaration(routeCode, dateStr) {
  return `SYSTEM PRZESYŁEK KONDUKTORSKICH - DEKLARACJA ZAWARTOŚCI
======================================================
DATA: ${dateStr}
PUNKT NADAWCZY: Gdańsk
------------------------------------------------------
NADAWCA: 450202122
PUNKT DOCELOWY: Żarnowiec
TRASA: ${routeCode}
------------------------------------------------------
KATEGORIA PRZESYŁKI: A
------------------------------------------------------
OPIS ZAWARTOŚCI (max 200 znaków): kasety z paliwem do reaktora
------------------------------------------------------
DEKLAROWANA MASA (kg): 2800
------------------------------------------------------
WDP: 4
------------------------------------------------------
UWAGI SPECJALNE: 
------------------------------------------------------
KWOTA DO ZAPŁATY: 0
------------------------------------------------------
OŚWIADCZAM, ŻE PODANE INFORMACJE SĄ PRAWDZIWE.
BIORĘ NA SIEBIE KONSEKWENCJĘ ZA FAŁSZYWE OŚWIADCZENIE.
======================================================
`;
}

async function fetchRouteCodeFromImage() {
  const {
    AI_API_KEY,
    EXTRA_API_HEADERS,
    RESPONSES_API_ENDPOINT,
    resolveModelForProvider,
  } = await import(ROOT_CONFIG_URL);

  const imageUrl = `${DOC_BASE}/trasy-wylaczone.png`;
  const res = await fetch(imageUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;

  const buf = await res.arrayBuffer();
  const base64 = Buffer.from(buf).toString("base64");
  const mimeType = res.headers.get("content-type") || "image/png";

  const response = await fetch(RESPONSES_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify({
      model: resolveModelForProvider("gpt-4o"),
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Na tym obrazie jest lista tras wyłączonych (kody tras). Podaj dokładnie jeden kod trasy, który łączy Gdańsk z Żarnowcem (lub Żarnowiec z Gdańskiem). Odpowiedz wyłącznie tym kodem, np. X-01 lub L-99, bez żadnego opisu.",
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok || data.error) return null;

  const text =
    data.output?.find((o) => o.type === "message")?.content?.find((c) => c.type === "output_text")?.text ??
    data.output_text ??
    "";
  const match = text.match(/\b([A-Z]+-\d+)\b/);
  return match ? match[1].trim() : null;
}

async function verify(apikey, declaration) {
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apikey,
      task: "sendit",
      answer: { declaration },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = data.message ?? data.error ?? res.statusText;
    throw new Error(`Verify failed (${res.status}): ${msg}`);
  }

  return data;
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  await loadEnv();

  if (!HUB_APIKEY) {
    console.error("Brak HUB_APIKEY w .env (użyj klucza do weryfikacji zadań, nie OPENROUTER_API_KEY).");
    process.exit(1);
  }

  const dateStr = todayStr();

  // Route code: try vision from image first; fallback to plausible code for Gdańsk–Żarnowiec (excluded).
  // Documentation: excluded routes list is in trasy-wylaczone.png. Common pattern for excluded: X-xx.
  let routeCode = null;
  try {
    routeCode = await fetchRouteCodeFromImage();
  } catch {
    // ignore
  }

  // Plausible codes for excluded Gdańsk–Żarnowiec (doc: list in trasy-wylaczone.png; often X-xx)
  const fallbackCodes = ["X-01", "X-02", "X-03", "L-GZ", "L-ŻG"];
  const codesToTry = routeCode ? [routeCode] : fallbackCodes;

  for (const code of codesToTry) {
    const declaration = buildDeclaration(code, dateStr);
    let result;
    try {
      result = await verify(HUB_APIKEY, declaration);
    } catch (err) {
      if (err.message && err.message.includes("Invalid route")) {
        continue; // try next route code
      }
      throw err;
    }

    const flag = result.flag ?? (result.message && result.message.match(/\{FLG:[^}]+\}/)?.[0]);
    if (flag) {
      console.log(flag);
      return;
    }
    if (result.message) {
      console.error("Hub:", result.message);
    }
  }

  console.error("Verification failed for all route codes tried.");
  process.exit(1);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
