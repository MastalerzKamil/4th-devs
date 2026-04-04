/**
 * Local validation of a filesystem batch using hub `help` limits + structural rules.
 */

const LINK_RE = /\[([^\]]*)\]\((\/[^)\s]+)\)/g;

function splitPath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  return path.split("/").filter(Boolean);
}

function parentDir(segments) {
  if (segments.length <= 1) return "/";
  return `/${segments.slice(0, -1).join("/")}`;
}

function normalizeFilePath(segments) {
  return `/${segments.join("/")}`;
}

/**
 * @param {object} helpData - hub help payload (response.data)
 */
export function extractLimits(helpData) {
  const limits = helpData?.limits;
  if (!limits || typeof limits !== "object") return null;
  return limits;
}

function makeSegmentChecker(limits) {
  const patternStr = limits.allowed_name_pattern;
  let segmentRe;
  try {
    segmentRe = patternStr ? new RegExp(patternStr) : /^[a-z0-9_]+$/;
  } catch {
    segmentRe = /^[a-z0-9_]+$/;
  }

  return {
    segmentRe,
    maxDir: Number(limits.max_directory_name_length) || 255,
    maxFile: Number(limits.max_file_name_length) || 255,
    maxDepth: Number(limits.max_directory_depth) || 99,
    globalUnique: Boolean(limits.global_unique_names),
  };
}

function collectMarkdownTargets(content) {
  const out = [];
  if (typeof content !== "string") return out;
  const re = new RegExp(LINK_RE.source, "g");
  let m;
  while ((m = re.exec(content)) !== null) out.push(m[2]);
  return out;
}

/**
 * @param {object[]} batch
 * @param {object} helpData
 * @returns {{ ok: boolean, errors: string[], files: Map<string, string>, dirs: Set<string> }}
 */
export function validateBatchAgainstHelp(batch, helpData) {
  const errors = [];
  if (!Array.isArray(batch) || batch.length === 0) {
    return { ok: false, errors: ["Batch must be a non-empty array"], files: new Map(), dirs: new Set() };
  }

  const limits = extractLimits(helpData);
  if (!limits) {
    return { ok: false, errors: ["help.limits missing"], files: new Map(), dirs: new Set() };
  }

  const chk = makeSegmentChecker(limits);
  const allowedBatch = new Set(helpData?.batch_mode?.allowed_actions ?? []);

  const dirs = new Set(["/"]);
  const files = new Map();
  const basenameCount = new Map();

  const bumpBase = (path) => {
    const segs = splitPath(path);
    if (!segs?.length) return;
    const b = segs[segs.length - 1];
    basenameCount.set(b, (basenameCount.get(b) ?? 0) + 1);
  };

  const checkSegs = (path, isDir) => {
    const segs = splitPath(path);
    if (!segs?.length) {
      errors.push(`Invalid path: ${path}`);
      return null;
    }
    if (segs.length > chk.maxDepth) {
      errors.push(`Path depth ${segs.length} > max_directory_depth ${chk.maxDepth}: ${path}`);
      return null;
    }
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const isLast = i === segs.length - 1;
      const maxLen = isLast && !isDir ? chk.maxFile : chk.maxDir;
      if (s.length > maxLen) {
        errors.push(`Segment "${s}" too long in ${path}`);
        return null;
      }
      if (!chk.segmentRe.test(s)) {
        errors.push(`Segment "${s}" fails allowed_name_pattern in ${path}`);
        return null;
      }
    }
    return segs;
  };

  for (const op of batch) {
    if (!op || typeof op !== "object") continue;

    if (allowedBatch.size > 0 && op.action && !allowedBatch.has(op.action)) {
      errors.push(`Disallowed batch action: ${op.action}`);
    }

    if (op.action === "reset") {
      dirs.clear();
      dirs.add("/");
      files.clear();
      basenameCount.clear();
      continue;
    }

    if (op.action === "createDirectory") {
      const segs = checkSegs(op.path, true);
      if (!segs) continue;
      const par = parentDir(segs);
      if (!dirs.has(par)) {
        errors.push(`createDirectory parent not found: ${op.path} (need ${par})`);
        continue;
      }
      const norm = normalizeFilePath(segs);
      dirs.add(norm);
      bumpBase(norm);
      continue;
    }

    if (op.action === "createFile") {
      const segs = checkSegs(op.path, false);
      if (!segs) continue;
      const par = parentDir(segs);
      if (!dirs.has(par)) {
        errors.push(`createFile parent not found: ${op.path}`);
        continue;
      }
      const norm = normalizeFilePath(segs);
      files.set(norm, op.content ?? "");
      bumpBase(norm);
    }
  }

  if (chk.globalUnique) {
    const dup = [...basenameCount.entries()].filter(([, n]) => n > 1).map(([b]) => b);
    if (dup.length) {
      errors.push(`global_unique_names: duplicate basenames: ${dup.join(", ")}`);
    }
  }

  const filePaths = new Set(files.keys());

  for (const [fpath, content] of files) {
    if (fpath.startsWith("/miasta/")) {
      try {
        const obj = JSON.parse(content);
        if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
          errors.push(`${fpath}: miasta file must be a JSON object`);
        } else {
          for (const [k, v] of Object.entries(obj)) {
            if (!chk.segmentRe.test(k)) {
              errors.push(`${fpath}: JSON key "${k}" fails name pattern`);
            }
            if (typeof v !== "number" || !Number.isFinite(v)) {
              errors.push(`${fpath}: value for "${k}" must be a finite number`);
            }
          }
        }
      } catch (e) {
        errors.push(`${fpath}: invalid JSON (${e.message})`);
      }
      continue;
    }

    for (const target of collectMarkdownTargets(content)) {
      const abs = target.startsWith("/") ? target.replace(/\/+$/, "") || "/" : `/${target}`;
      const checkPath = abs === "/" ? "/" : abs;
      if (!filePaths.has(checkPath)) {
        errors.push(`${fpath}: markdown link target not found: ${target}`);
      }
    }
  }

  const miastaFiles = [...filePaths].filter((p) => p.startsWith("/miasta/"));
  const osobyFiles = [...filePaths].filter((p) => p.startsWith("/osoby/"));

  if (miastaFiles.length > 0 && osobyFiles.length > 0 && miastaFiles.length !== osobyFiles.length) {
    errors.push(
      `miasta/osoby file count mismatch: ${miastaFiles.length} vs ${osobyFiles.length}`,
    );
  }

  const citiesFromMiasta = new Set(miastaFiles.map((p) => splitPath(p).at(-1)));
  const citiesLinked = new Set();
  for (const p of osobyFiles) {
    for (const target of collectMarkdownTargets(files.get(p) ?? "")) {
      const m = /^\/miasta\/([a-z0-9_]+)$/.exec(target.replace(/\/+$/, ""));
      if (m) citiesLinked.add(m[1]);
    }
  }
  for (const c of citiesFromMiasta) {
    if (c && !citiesLinked.has(c)) {
      errors.push(`No osoby file links to /miasta/${c}`);
    }
  }

  return { ok: errors.length === 0, errors, files, dirs };
}

/**
 * @returns {Promise<{ batch: object[], validation: object, usedRepair: boolean, firstValidationErrors?: string[] }>}
 */
export async function buildValidatedBatch({
  plan,
  helpData,
  buildBatchFromPlan: buildFn,
  repairPlan,
}) {
  let batch = buildFn(plan);
  let v = validateBatchAgainstHelp(batch, helpData);
  if (v.ok) {
    return { batch, validation: v, usedRepair: false };
  }

  const firstErrors = [...v.errors];
  if (typeof repairPlan !== "function") {
    throw new Error(`Batch failed help validation:\n${firstErrors.join("\n")}`);
  }

  const plan2 = await repairPlan(firstErrors);
  const batch2 = buildFn(plan2);
  const v2 = validateBatchAgainstHelp(batch2, helpData);
  if (!v2.ok) {
    const msg = [...firstErrors, "--- after repair plan ---", ...v2.errors].join("\n");
    throw new Error(`Batch failed help validation:\n${msg}`);
  }
  return { batch: batch2, validation: v2, usedRepair: true, firstValidationErrors: firstErrors };
}
