/**
 * Pure batch builder for hub filesystem — used after analyst JSON is validated.
 */

const POLISH_CHARS = /[ąĄćĆęĘłŁńŃóÓśŚźŹżŻ]/g;

const POLISH_REPLACEMENTS = {
  ą: "a",
  Ą: "a",
  ć: "c",
  Ć: "c",
  ę: "e",
  Ę: "e",
  ł: "l",
  Ł: "l",
  ń: "n",
  Ń: "n",
  ó: "o",
  Ó: "o",
  ś: "s",
  Ś: "s",
  ź: "z",
  Ź: "z",
  ż: "z",
  Ż: "z",
};

export const slugify = (str) => {
  const mapped = str.trim().replace(POLISH_CHARS, (ch) => POLISH_REPLACEMENTS[ch] ?? ch);
  return mapped
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
};

const GOOD_TO_SINGULAR_FILE = { ziemniaki: "ziemniak" };

const goodSlug = (raw) => {
  const s = slugify(raw);
  return GOOD_TO_SINGULAR_FILE[s] ?? s;
};

export function parseTransakcje(text) {
  /** @type {Map<string, Set<string>>} */
  const sellersByGood = new Map();
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const parts = t.split(/\s*->\s*/);
    if (parts.length !== 3) continue;
    const [sellerRaw, goodRaw] = parts;
    const seller = slugify(sellerRaw);
    const good = goodSlug(goodRaw);
    if (!sellersByGood.has(good)) sellersByGood.set(good, new Set());
    sellersByGood.get(good).add(seller);
  }
  return sellersByGood;
}

function miastaJsonBody(obj) {
  return JSON.stringify(obj);
}

function osobaMarkdown(name, citySlug) {
  const cityLabel = citySlug.charAt(0).toUpperCase() + citySlug.slice(1);
  return `${name}\n\n[${cityLabel}](/miasta/${citySlug})`;
}

function towarMarkdown(sellerSlugs) {
  const sorted = [...sellerSlugs].sort();
  return sorted
    .map((c) => {
      const label = c.charAt(0).toUpperCase() + c.slice(1);
      return `[${label}](/miasta/${c})`;
    })
    .join(" ");
}

/**
 * @typedef {Object} FilesystemPlan
 * @property {Record<string, Record<string, number>>} miasta - city slug -> good slug -> qty
 * @property {{ file: string, name: string, city: string }[]} osoby
 * @property {string} transakcje_text - raw lines like "A -> good -> B"
 */

/** @param {FilesystemPlan} plan */
export function buildBatchFromPlan(plan) {
  const { miasta, osoby, transakcje_text } = plan;
  if (!miasta || typeof miasta !== "object") throw new Error("plan.miasta missing");
  if (!Array.isArray(osoby)) throw new Error("plan.osoby missing");
  if (typeof transakcje_text !== "string" || !transakcje_text.trim()) {
    throw new Error("plan.transakcje_text missing");
  }

  const sellersByGood = parseTransakcje(transakcje_text);

  /** @type {object[]} */
  const ops = [{ action: "reset" }];

  for (const dir of ["/miasta", "/osoby", "/towary"]) {
    ops.push({ action: "createDirectory", path: dir });
  }

  for (const [cityKey, needs] of Object.entries(miasta)) {
    const city = slugify(cityKey);
    if (!needs || typeof needs !== "object") continue;
    const normalized = {};
    for (const [g, n] of Object.entries(needs)) {
      normalized[slugify(g)] = Number(n);
    }
    ops.push({
      action: "createFile",
      path: `/miasta/${city}`,
      content: miastaJsonBody(normalized),
    });
  }

  for (const row of osoby) {
    const file = slugify(row.file.replace(/\.[a-z]+$/i, ""));
    const city = slugify(row.city);
    ops.push({
      action: "createFile",
      path: `/osoby/${file}`,
      content: osobaMarkdown(String(row.name).trim(), city),
    });
  }

  for (const [good, sellers] of sellersByGood) {
    ops.push({
      action: "createFile",
      path: `/towary/${good}`,
      content: towarMarkdown(sellers),
    });
  }

  return ops;
}
