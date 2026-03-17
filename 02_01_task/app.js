/**
 * Task S02E01 — Categorize (CTF challenge)
 *
 * Classifies 10 items as DNG (dangerous) or NEU (neutral).
 * Token budget: 100 tokens per prompt, 1.5 PP total for 10 queries.
 *
 * Strategy: craft a short prompt that correctly classifies weapons as DNG
 * and everything else (industrial parts, electronics, energy equipment) as NEU.
 * Reactor fuel cassettes are energy/industrial items — not weapons — so NEU is correct.
 */

const HUB_BASE = "https://hub.ag3nts.org";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const API_KEY = process.env.HUB_APIKEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const TASK = "categorize";

if (!API_KEY) { console.error("Missing HUB_APIKEY"); process.exit(1); }

// Prompt candidates, ordered from most to least likely to work.
// Static prefix first (benefits from prompt caching), variables {id}/{description} at end.
const PROMPT_CANDIDATES = [
  // Weapon-focused: classify as DNG only if a weapon for hurting humans
  "Is {id} a weapon designed to directly harm humans? DNG=yes NEU=no. {description}",

  // Direct weapon keywords
  "DNG if weapon (gun,rifle,knife,blade,firearm,spear,sword,explosive). NEU otherwise. {id}: {description}",

  // Firearms/blades only = DNG
  "Classify: firearms,blades,spears=DNG; all else (parts,tools,materials,fuel)=NEU. {id}: {description}",

  // Simple category list
  "Weapons that shoot or stab=DNG. Industrial parts,electronics,energy items=NEU. One word. {id}: {description}",

  // Explicit energy/reactor as neutral
  "DNG: guns,rifles,handguns,knives,swords,spears. NEU: machine parts,electronics,wiring,fuel,energy. {id}: {description}",
];

// --- Hub helpers ---

async function fetchCsv() {
  const url = `${HUB_BASE}/data/${API_KEY}/${TASK}.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return parseCsv(await res.text());
}

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idIdx = header.findIndex((h) => h === "id" || h === "code");
  const descIdx = header.findIndex((h) =>
    h.includes("desc") || h.includes("opis") || h.includes("name") || h.includes("item")
  );
  const idCol = idIdx >= 0 ? idIdx : 0;
  const descCol = descIdx >= 0 ? descIdx : 1;

  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const parts = line.split(",");
      return {
        id: parts[idCol]?.trim() ?? "",
        description: parts.slice(descCol).join(",").trim().replace(/^"|"$/g, ""),
      };
    });
}

async function resetBudget() {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { prompt: "reset" } }),
  });
  const data = await res.json();
  console.log("[RESET]", JSON.stringify(data));
}

async function classifyItem(prompt) {
  const res = await fetch(`${HUB_BASE}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer: { prompt } }),
  });
  return res.json();
}

// --- Optional: ask Claude via OpenRouter to refine a failing prompt ---

async function refinePrompt(template, failures, items) {
  if (!OPENROUTER_KEY) return null;

  const failureText = failures
    .map((f) => `  ${f.id} (${f.description}): got ${f.got}, expected ${f.expected}`)
    .join("\n");

  const content = `You are helping with a CTF dangerous-goods classification challenge.
Current prompt template (under 100 tokens when filled):
"${template}"

Misclassified items:
${failureText}

All items in this dataset:
${items.map((i) => `  ${i.id}: ${i.description}`).join("\n")}

Rules:
- Firearms, rifles, handguns, knives, swords, spears → DNG
- Industrial parts, mechanical components, electronics, wiring, fuel/energy items → NEU
- The small LLM reading the prompt must respond with exactly DNG or NEU
- Filled prompt must stay under 100 tokens
- Static text first, {id} and {description} at the end

Reply with ONLY the new prompt template text.`;

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENROUTER_KEY}` },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4-6",
        max_tokens: 200,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch {
    return null;
  }
}

// --- Main ---

async function runWithTemplate(template, items) {
  const results = [];
  let flag = null;
  let budgetExceeded = false;

  for (const item of items) {
    const prompt = template
      .replace(/\{id\}/g, item.id)
      .replace(/\{description\}/g, item.description);

    process.stdout.write(`  [${item.id}] ${item.description.slice(0, 45).padEnd(45)} → `);
    const result = await classifyItem(prompt);
    process.stdout.write(`${result.code === 0 ? "✓" : "✗"} ${result.message ?? ""}\n`);
    results.push({ item, result });

    const flagMatch = result.message?.match(/\{FLG:[^}]+\}/);
    if (flagMatch) flag = flagMatch[0];

    if (
      result.code !== 0 &&
      (result.message?.toLowerCase().includes("budget") ||
        result.message?.toLowerCase().includes("limit"))
    ) {
      budgetExceeded = true;
      break;
    }
  }

  return { results, flag, budgetExceeded };
}

async function main() {
  console.log("=== S02E01 Categorize Task ===\n");

  let templateQueue = [...PROMPT_CANDIDATES];
  let attempt = 0;

  while (templateQueue.length > 0) {
    attempt++;
    console.log(`\n--- Attempt ${attempt} ---`);

    console.log("Fetching fresh CSV...");
    const items = await fetchCsv();
    console.log(`Loaded ${items.length} items`);

    if (attempt > 1) {
      await resetBudget();
    }

    const template = templateQueue.shift();
    console.log(`Template: "${template}"\n`);

    const { results, flag, budgetExceeded } = await runWithTemplate(template, items);

    if (flag) {
      console.log(`\n✅ SUCCESS! Flag: ${flag}`);
      return;
    }

    if (budgetExceeded) {
      console.log("⚠️  Budget exceeded — trying next template");
      continue;
    }

    // Find failures to inform next attempt
    const failures = results
      .filter((r) => r.result.code !== 0)
      .map((r) => ({
        id: r.item.id,
        description: r.item.description,
        got: r.result.message,
        expected: "DNG or NEU",
      }));

    if (failures.length > 0) {
      console.log(`\nFailed: ${failures.length} items`);

      // Try to get a refined prompt from Claude
      if (OPENROUTER_KEY) {
        console.log("Asking Claude to refine prompt...");
        const refined = await refinePrompt(template, failures, items);
        if (refined && refined.length < 200) {
          console.log(`Refined: "${refined}"`);
          templateQueue.unshift(refined);
        }
      }
    } else {
      console.log("All OK but no flag — something unexpected. Hub responses above.");
    }
  }

  console.log("❌ All templates exhausted.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
