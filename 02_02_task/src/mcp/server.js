/**
 * MCP Server — Electricity Puzzle Tools
 *
 * Exposes 5 tools over stdio transport:
 *   - reset_and_download_board
 *   - analyze_board_with_vision
 *   - solve_puzzle
 *   - rotate_cell
 *   - download_board
 *
 * Started as a subprocess by the MCP client (via mcp.json).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";
import { downloadImage, splitBoardIntoCells } from "../helpers/image.js";
import { visionSubagent } from "../subagents/vision.js";
import { solvePuzzle } from "../helpers/puzzle.js";

// Load env from root .env
import "../../../config.js";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.join(DIR, "../../tmp");
const API_KEY = process.env.HUB_APIKEY;
const BASE_URL = "https://hub.ag3nts.org";
const IMAGE_URL = `${BASE_URL}/data/${API_KEY}/electricity.png`;
const VERIFY_URL = `${BASE_URL}/verify`;

// ── Server Setup ───────────────────────────────────────────────────────

const server = new McpServer(
  { name: "electricity-puzzle", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "MCP server providing tools to solve the electricity cable puzzle. " +
      "Tools allow resetting the board, analyzing cell connections via vision, " +
      "computing a rotation solution, and sending individual rotation commands.",
  }
);

// ── Tool: reset_and_download_board ─────────────────────────────────────

server.registerTool(
  "reset_and_download_board",
  {
    description:
      "Reset the electricity puzzle board to initial state and download the board image as PNG. Returns the file path to the saved image.",
    inputSchema: {},
  },
  async () => {
    const imgPath = path.join(TMP, "board.png");
    await downloadImage(`${IMAGE_URL}?reset=1`, imgPath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            image_path: imgPath,
            message: "Board reset and image downloaded.",
          }),
        },
      ],
    };
  }
);

// ── Tool: analyze_board_with_vision ────────────────────────────────────

server.registerTool(
  "analyze_board_with_vision",
  {
    description:
      "Delegate board analysis to a VISION SUBAGENT. Splits the board image into 9 cells, sends each to Gemini vision in parallel to identify cable edge connections, validates with pixel analysis. Returns 3x3 cell connection data.",
    inputSchema: {
      image_path: z
        .string()
        .describe("Absolute path to the board PNG image file"),
    },
  },
  async ({ image_path }) => {
    const cells = await splitBoardIntoCells(image_path, TMP);
    const { cellTypes, log } = await visionSubagent(cells);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            cells: cellTypes,
            subagent_log: log,
            message:
              "Vision subagent analyzed all 9 cells. 'cells' is a 3x3 array of {top,right,bottom,left} connections (1=connected, 0=not).",
          }),
        },
      ],
    };
  }
);

// ── Tool: solve_puzzle ─────────────────────────────────────────────────

server.registerTool(
  "solve_puzzle",
  {
    description:
      "Given 3x3 cell connection data, solve the puzzle using backtracking + BFS connectivity check. Returns a rotation plan with how many 90° clockwise rotations each cell needs.",
    inputSchema: {
      cells: z
        .string()
        .describe(
          'JSON string of a 3x3 array where each cell is {top:0|1, right:0|1, bottom:0|1, left:0|1}'
        ),
    },
  },
  async ({ cells }) => {
    const cellTypes = JSON.parse(cells);
    const solution = solvePuzzle(cellTypes);

    if (!solution) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: false,
              message: "No solution found. Cell detection may be wrong.",
            }),
          },
        ],
      };
    }

    const plan = [];
    for (let i = 0; i < 9; i++) {
      const row = Math.floor(i / 3) + 1;
      const col = (i % 3) + 1;
      const rot = solution.rotations[i];
      if (rot > 0) plan.push({ position: `${row}x${col}`, rotations: rot });
    }

    const gridDisplay = solution.grid.map((row, r) =>
      row
        .map(
          (c, col) =>
            `${r + 1}x${col + 1}:[T:${c.top} R:${c.right} B:${c.bottom} L:${c.left}]`
        )
        .join(" ")
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            boundary_config: solution.boundaryConfig,
            rotation_plan: plan,
            total_rotations: plan.reduce((s, p) => s + p.rotations, 0),
            solved_grid: gridDisplay,
            message: `Solution found! ${plan.length} cell(s) need rotation, ${plan.reduce((s, p) => s + p.rotations, 0)} total API calls needed.`,
          }),
        },
      ],
    };
  }
);

// ── Tool: rotate_cell ──────────────────────────────────────────────────

server.registerTool(
  "rotate_cell",
  {
    description:
      "Rotate a specific cell 90° clockwise via the hub API. One call = one rotation. Watch the response for {FLG:...} flag.",
    inputSchema: {
      position: z
        .string()
        .describe("Cell position in format AxB, e.g. '2x3' for row 2, column 3"),
    },
  },
  async ({ position }) => {
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
    const flagMatch = responseStr.match(/\{FLG:.*?\}/);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ...data,
            flag: flagMatch ? flagMatch[0] : null,
            message: flagMatch
              ? `FLAG FOUND: ${flagMatch[0]}`
              : `Rotated ${position}: ${data.message}`,
          }),
        },
      ],
    };
  }
);

// ── Tool: download_board ───────────────────────────────────────────────

server.registerTool(
  "download_board",
  {
    description: "Download the current board state as PNG (without resetting). Returns file path.",
    inputSchema: {},
  },
  async () => {
    const imgPath = path.join(TMP, "board_current.png");
    await downloadImage(IMAGE_URL, imgPath);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, image_path: imgPath }),
        },
      ],
    };
  }
);

// ── Start ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
