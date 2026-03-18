import { readFile } from "fs/promises";
import { AI_API_KEY, EXTRA_API_HEADERS } from "../../../config.js";
import { VISION_MODEL } from "../config.js";
import { detectEdgesFromPixels } from "../helpers/image.js";

const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const VISION_PROMPT = `You are analyzing a single tile from a 3x3 electrical cable puzzle. The tile has thick black cable/pipe segments on a light beige background.

Your task: determine which of the 4 edges of this tile have a cable connection. A cable "connects" to an edge if a thick black line extends all the way to that edge of the tile.

Common tile types in such puzzles:
- Straight (2 opposite edges): horizontal (left+right) or vertical (top+bottom)
- Corner/L-bend (2 adjacent edges): e.g. top+right, right+bottom, bottom+left, left+top
- T-junction (3 edges): e.g. top+right+bottom, right+bottom+left, etc.
- Cross (all 4 edges)

Look carefully at where the thick black lines touch the tile edges.

Reply ONLY in this exact format with no other text:
top:X,right:X,bottom:X,left:X
where X is 1 if a cable reaches that edge, 0 if not.`;

/**
 * Send a single cell image to the vision model and parse the response.
 */
async function analyzeOneCell(cellImagePath) {
  const imageData = await readFile(cellImagePath);
  const base64 = imageData.toString("base64");

  const res = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
      ...EXTRA_API_HEADERS,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
      max_tokens: 50,
      temperature: 0,
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(`Vision API: ${data.error.message ?? JSON.stringify(data.error)}`);

  const text = data.choices[0].message.content.trim();
  const match = text.match(/top:(\d),\s*right:(\d),\s*bottom:(\d),\s*left:(\d)/);
  if (!match) throw new Error(`Unparseable vision response: "${text}"`);

  return {
    top: parseInt(match[1]),
    right: parseInt(match[2]),
    bottom: parseInt(match[3]),
    left: parseInt(match[4]),
  };
}

/**
 * Vision subagent: analyze all cells using Gemini vision in parallel,
 * then validate against pixel-based edge detection.
 *
 * @param {Array<{row,col,pos,path}>} cells - Cell file info from splitBoardIntoCells
 * @returns {Object[][]} 3x3 array of {top,right,bottom,left} connections
 */
export async function visionSubagent(cells) {
  const log = [];
  log.push(`[Vision Subagent] Analyzing ${cells.length} cells with model: ${VISION_MODEL}`);

  // Phase 1: Vision analysis (all cells in parallel)
  log.push("[Vision Subagent] Phase 1: Sending cells to vision model in parallel...");
  const visionResults = await Promise.all(
    cells.map(async (cell) => {
      try {
        return { ok: true, data: await analyzeOneCell(cell.path) };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    })
  );

  // Phase 2: Pixel validation (all in parallel)
  log.push("[Vision Subagent] Phase 2: Running pixel-based edge validation...");
  const pixelResults = await Promise.all(
    cells.map((cell) => detectEdgesFromPixels(cell.path))
  );

  // Phase 3: Merge and resolve conflicts
  log.push("[Vision Subagent] Phase 3: Merging results (pixel wins on conflict)...");
  const cellTypes = [[], [], []];
  const edges = ["top", "right", "bottom", "left"];

  for (let i = 0; i < cells.length; i++) {
    const { row, col, pos } = cells[i];
    const vision = visionResults[i];
    const pixel = pixelResults[i];

    if (!vision.ok) {
      log.push(`  ${pos}: Vision FAILED (${vision.error}), using pixel only`);
      cellTypes[row][col] = pixel;
      continue;
    }

    const conflicts = edges.filter((e) => vision.data[e] !== pixel[e]);
    if (conflicts.length > 0) {
      log.push(
        `  ${pos}: CONFLICT on [${conflicts}] — ` +
        `vision={T:${vision.data.top},R:${vision.data.right},B:${vision.data.bottom},L:${vision.data.left}} ` +
        `pixel={T:${pixel.top},R:${pixel.right},B:${pixel.bottom},L:${pixel.left}} → using pixel`
      );
      cellTypes[row][col] = pixel;
    } else {
      log.push(`  ${pos}: AGREE T=${pixel.top} R=${pixel.right} B=${pixel.bottom} L=${pixel.left}`);
      cellTypes[row][col] = vision.data;
    }
  }

  return { cellTypes, log };
}
