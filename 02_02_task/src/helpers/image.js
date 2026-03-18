import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import sharp from "sharp";

// Grid coordinates detected from pixel analysis of 800x450 board image
const GRID = { x: 238, y: 99, w: 285, h: 285 };
const CELL_W = 95;
const CELL_H = 95;
const MARGIN = 6;
const UPSCALE = 3; // upscale cells for better vision accuracy

/**
 * Download an image from URL and save to filepath.
 */
export async function downloadImage(url, filepath) {
  const dir = path.dirname(filepath);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(filepath, buf);
  return filepath;
}

/**
 * Split board image into 9 individual cell images (upscaled for vision).
 * Returns array of { row, col, pos, path } objects.
 */
export async function splitBoardIntoCells(boardImagePath, outputDir) {
  if (!existsSync(outputDir)) await mkdir(outputDir, { recursive: true });

  const cells = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const x = GRID.x + col * CELL_W + MARGIN;
      const y = GRID.y + row * CELL_H + MARGIN;
      const w = CELL_W - 2 * MARGIN;
      const h = CELL_H - 2 * MARGIN;
      const cellPath = path.join(outputDir, `cell_${row + 1}x${col + 1}.png`);

      await sharp(boardImagePath)
        .extract({ left: x, top: y, width: w, height: h })
        .resize(w * UPSCALE, h * UPSCALE, { kernel: "nearest" })
        .toFile(cellPath);

      cells.push({ row, col, pos: `${row + 1}x${col + 1}`, path: cellPath });
    }
  }

  return cells;
}

/**
 * Pixel-based edge detection for a single cell image.
 * Used for validation of vision results.
 */
export async function detectEdgesFromPixels(cellImagePath) {
  const { data, info } = await sharp(cellImagePath)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const DARK = 80;

  const isDark = (x, y) => {
    const i = (y * width + x) * channels;
    return data[i] < DARK && data[i + 1] < DARK && data[i + 2] < DARK;
  };

  const checkEdge = (positions) => {
    let dark = 0;
    for (const [x, y] of positions) if (isDark(x, y)) dark++;
    return dark / positions.length > 0.3 ? 1 : 0;
  };

  const cx1 = Math.floor(width * 0.3), cx2 = Math.floor(width * 0.7);
  const cy1 = Math.floor(height * 0.3), cy2 = Math.floor(height * 0.7);

  const mkRange = (gen) => { const a = []; gen(a); return a; };

  return {
    top:    checkEdge(mkRange(a => { for (let x = cx1; x < cx2; x++) for (let y = 0; y < 3; y++) a.push([x, y]); })),
    right:  checkEdge(mkRange(a => { for (let y = cy1; y < cy2; y++) for (let x = width - 3; x < width; x++) a.push([x, y]); })),
    bottom: checkEdge(mkRange(a => { for (let x = cx1; x < cx2; x++) for (let y = height - 3; y < height; y++) a.push([x, y]); })),
    left:   checkEdge(mkRange(a => { for (let y = cy1; y < cy2; y++) for (let x = 0; x < 3; x++) a.push([x, y]); })),
  };
}
