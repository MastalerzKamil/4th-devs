import { slugify } from "./buildBatch.js";

/** Dedupe osoby by city; fix file basename collisions with miasta city slugs (global_unique_names). */
export function postProcessPlan(plan) {
  const cityKeys = new Set(Object.keys(plan.miasta));
  const seen = new Set();
  const deduped = [];
  for (const row of plan.osoby) {
    const c = slugify(row.city);
    if (!cityKeys.has(c) || seen.has(c)) continue;
    seen.add(c);
    deduped.push(row);
  }

  const osoby = deduped.map((row) => {
    const fileSlug = slugify(String(row.file).replace(/\.[a-z]+$/i, ""));
    if (!cityKeys.has(fileSlug)) return row;
    return { ...row, file: `${fileSlug}_manager` };
  });

  return { ...plan, osoby };
}
