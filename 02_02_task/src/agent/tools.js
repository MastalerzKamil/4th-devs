import path from "path";
import { fileURLToPath } from "url";
import { downloadImage, splitBoardIntoCells } from "../helpers/image.js";
import { visionSubagent } from "../subagents/vision.js";
import { solvePuzzle } from "../helpers/puzzle.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(DIR, "../../tmp");
const API_KEY = process.env.HUB_APIKEY;
const BASE_URL = "https://hub.ag3nts.org";
const IMAGE_URL = `${BASE_URL}/data/${API_KEY}/electricity.png`;
const VERIFY_URL = `${BASE_URL}/verify`;

// ── Tool Definitions (OpenAI function-calling format) ──────────────────

const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "reset_and_download_board",
      description:
        "Reset the electricity puzzle board to initial state and download the board image as PNG. Returns the file path to the saved image.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "analyze_board_with_vision",
      description:
        "Delegate board analysis to a VISION SUBAGENT. The subagent splits the board image into 9 cells, sends each cell to Gemini vision model in parallel to identify cable edge connections, then validates results with pixel analysis. Returns a JSON object with cell connection data for all 9 cells.",
      parameters: {
        type: "object",
        properties: {
          image_path: {
            type: "string",
            description: "Absolute path to the board PNG image file",
          },
        },
        required: ["image_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "solve_puzzle",
      description:
        "Given the 3x3 cell connection data, solve the puzzle using backtracking with boundary constraints and BFS connectivity check. Returns the rotation plan (how many 90° clockwise rotations each cell needs).",
      parameters: {
        type: "object",
        properties: {
          cells: {
            type: "string",
            description:
              'JSON string of a 3x3 array where each cell is {top:0|1, right:0|1, bottom:0|1, left:0|1}. Example: [[{"top":0,"right":1,"bottom":1,"left":0}, ...], ...]',
          },
        },
        required: ["cells"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "rotate_cell",
      description:
        "Rotate a specific cell on the puzzle board by 90 degrees clockwise. Sends one API request. Returns the hub API response (watch for {FLG:...} flag in the response).",
      parameters: {
        type: "object",
        properties: {
          position: {
            type: "string",
            description: "Cell position in format AxB, e.g. '2x3' for row 2, column 3",
          },
        },
        required: ["position"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_board",
      description:
        "Download the current board image (without resetting). Returns the file path.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
];

// ── Tool Handlers ──────────────────────────────────────────────────────

const handlers = {
  async reset_and_download_board() {
    const imgPath = path.join(TMP, "board.png");
    await downloadImage(`${IMAGE_URL}?reset=1`, imgPath);
    return JSON.stringify({ success: true, image_path: imgPath, message: "Board reset and image downloaded." });
  },

  async analyze_board_with_vision({ image_path }) {
    // 1. Split into cells
    const cells = await splitBoardIntoCells(image_path, TMP);

    // 2. Run vision subagent
    const { cellTypes, log } = await visionSubagent(cells);

    // 3. Format result
    return JSON.stringify({
      success: true,
      cells: cellTypes,
      subagent_log: log,
      message: "Vision subagent analyzed all 9 cells. Cell data is in 'cells' field as a 3x3 array of {top,right,bottom,left} connections (1=connected, 0=not).",
    });
  },

  async solve_puzzle({ cells }) {
    const cellTypes = JSON.parse(cells);
    const solution = solvePuzzle(cellTypes);

    if (!solution) {
      return JSON.stringify({
        success: false,
        message: "No solution found. Cell detection may be wrong. Consider re-analyzing or resetting.",
      });
    }

    // Build human-readable rotation plan
    const plan = [];
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3) + 1;
      const col = (i % 3) + 1;
      const rot = solution.rotations[i];
      if (rot > 0) {
        plan.push({ position: `${row}x${col}`, rotations: rot });
      }
    }

    // Build solved grid display
    const gridDisplay = solution.grid.map((row, r) =>
      row.map((c, col) => `${r + 1}x${col + 1}:[T:${c.top} R:${c.right} B:${c.bottom} L:${c.left}]`).join(" ")
    );

    return JSON.stringify({
      success: true,
      boundary_config: solution.boundaryConfig,
      rotation_plan: plan,
      total_rotations: plan.reduce((s, p) => s + p.rotations, 0),
      solved_grid: gridDisplay,
      message: `Solution found! ${plan.length} cell(s) need rotation, ${plan.reduce((s, p) => s + p.rotations, 0)} total API calls needed.`,
    });
  },

  async rotate_cell({ position }) {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: API_KEY,
        task: "electricity",
        answer: { rotate: position },
      }),
    });
    const data = await res.json();
    const responseStr = JSON.stringify(data);

    // Check for flag
    const flagMatch = responseStr.match(/\{FLG:.*?\}/);
    return JSON.stringify({
      ...data,
      flag: flagMatch ? flagMatch[0] : null,
      message: flagMatch
        ? `FLAG FOUND: ${flagMatch[0]}`
        : `Rotated ${position}: ${data.message}`,
    });
  },

  async download_board() {
    const imgPath = path.join(TMP, "board_current.png");
    await downloadImage(IMAGE_URL, imgPath);
    return JSON.stringify({ success: true, image_path: imgPath });
  },
};

// ── Public API ─────────────────────────────────────────────────────────

export function createTools() {
  return {
    definitions: TOOL_DEFINITIONS,

    async handle(name, argsStr) {
      const handler = handlers[name];
      if (!handler) {
        return JSON.stringify({ error: `Unknown tool: ${name}` });
      }

      const args = argsStr ? (typeof argsStr === "string" ? JSON.parse(argsStr) : argsStr) : {};

      try {
        return await handler(args);
      } catch (err) {
        return JSON.stringify({ error: err.message, tool: name });
      }
    },
  };
}
