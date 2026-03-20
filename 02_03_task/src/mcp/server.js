/**
 * MCP Server — Failure Log Analysis Tools
 *
 * Exposes tools over stdio transport:
 *   - fetch_logs        — Download raw log file from hub
 *   - analyze_logs      — LLM subagent extracts critical events
 *   - refine_logs       — LLM subagent refines based on feedback
 *   - count_tokens      — Estimate token count
 *   - submit_answer     — Submit compressed logs to verification API
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Load env from root .env
import "../../../config.js";

import { analyzeLogsSubagent, refineLogsSubagent } from "../subagents/log-analyzer.js";

const API_KEY = process.env.HUB_APIKEY;
const BASE_URL = "https://hub.ag3nts.org";
const LOG_URL = `${BASE_URL}/data/${API_KEY}/failure.log`;
const VERIFY_URL = `${BASE_URL}/verify`;

// Cache raw logs in memory so we don't re-download
let cachedRawLogs = null;

// ── Server Setup ───────────────────────────────────────────────────────

const server = new McpServer(
  { name: "failure-logs", version: "1.0.0" },
  {
    capabilities: { tools: {} },
    instructions:
      "MCP server for analyzing power plant failure logs. " +
      "Tools allow fetching logs, analyzing with LLM, counting tokens, and submitting answers.",
  }
);

// ── Tool: fetch_logs ───────────────────────────────────────────────────

server.registerTool(
  "fetch_logs",
  {
    description:
      "Download the full failure log file from the hub API. Returns metadata about the file (line count, size) and caches it for analysis tools. The raw content is too large to return directly.",
    inputSchema: {},
  },
  async () => {
    const res = await fetch(LOG_URL);
    if (!res.ok) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: false, error: `HTTP ${res.status}` }) },
        ],
      };
    }

    cachedRawLogs = await res.text();
    const lines = cachedRawLogs.split("\n").filter(Boolean);
    const estimatedTokens = Math.ceil(cachedRawLogs.length / 4);

    // Show a sample of severity distribution
    const severityCounts = {};
    for (const line of lines) {
      const match = line.match(/\[(INFO|WARN|ERRO|CRIT|DEBUG|TRACE)\]/);
      if (match) severityCounts[match[1]] = (severityCounts[match[1]] || 0) + 1;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            total_lines: lines.length,
            total_chars: cachedRawLogs.length,
            estimated_tokens: estimatedTokens,
            severity_distribution: severityCounts,
            message:
              "Logs downloaded and cached. Use analyze_logs to extract critical events with LLM subagent.",
          }),
        },
      ],
    };
  }
);

// ── Tool: analyze_logs ─────────────────────────────────────────────────

server.registerTool(
  "analyze_logs",
  {
    description:
      "Send the cached raw logs to an LLM subagent that extracts critical events related to the power plant failure. Returns compressed event lines. Must call fetch_logs first.",
    inputSchema: {},
  },
  async () => {
    if (!cachedRawLogs) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: false, error: "No logs cached. Call fetch_logs first." }) },
        ],
      };
    }

    const compressed = await analyzeLogsSubagent(cachedRawLogs);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            compressed_logs: compressed,
            line_count: compressed?.split("\n").filter(Boolean).length ?? 0,
            estimated_tokens: Math.ceil((compressed?.length ?? 0) / 4),
            message: "Logs analyzed and compressed. Use count_tokens to verify, then submit_answer.",
          }),
        },
      ],
    };
  }
);

// ── Tool: refine_logs ──────────────────────────────────────────────────

server.registerTool(
  "refine_logs",
  {
    description:
      "Send current compressed logs and technician feedback to an LLM subagent for refinement. The subagent searches the raw logs for missing information mentioned in feedback.",
    inputSchema: {
      current_logs: z
        .string()
        .describe("The current compressed logs string that was rejected"),
      feedback: z
        .string()
        .describe("The technician feedback explaining what's missing or wrong"),
    },
  },
  async ({ current_logs, feedback }) => {
    if (!cachedRawLogs) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: false, error: "No raw logs cached. Call fetch_logs first." }) },
        ],
      };
    }

    const refined = await refineLogsSubagent(current_logs, feedback, cachedRawLogs);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            refined_logs: refined,
            line_count: refined?.split("\n").filter(Boolean).length ?? 0,
            estimated_tokens: Math.ceil((refined?.length ?? 0) / 4),
            message: "Logs refined based on feedback. Check token count and re-submit.",
          }),
        },
      ],
    };
  }
);

// ── Tool: search_logs ──────────────────────────────────────────────────

server.registerTool(
  "search_logs",
  {
    description:
      "Search the cached raw logs for lines matching a keyword or regex pattern. Returns matching lines. Useful for finding specific subsystem events (e.g. 'FIRMWARE', 'PUMP', 'COOLANT').",
    inputSchema: {
      pattern: z
        .string()
        .describe("Keyword or regex pattern to search for in log lines (case-insensitive)"),
      severity: z
        .string()
        .optional()
        .describe("Optional severity filter: INFO, WARN, ERRO, CRIT"),
    },
  },
  async ({ pattern, severity }) => {
    if (!cachedRawLogs) {
      return {
        content: [
          { type: "text", text: JSON.stringify({ success: false, error: "No logs cached. Call fetch_logs first." }) },
        ],
      };
    }

    const lines = cachedRawLogs.split("\n").filter(Boolean);
    const regex = new RegExp(pattern, "i");

    let matches = lines.filter((line) => regex.test(line));
    if (severity) {
      matches = matches.filter((line) => line.includes(`[${severity}]`));
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            success: true,
            total_matches: matches.length,
            matches: matches.slice(0, 200).join("\n"),
            truncated: matches.length > 200,
            message: `Found ${matches.length} lines matching "${pattern}"${severity ? ` with severity ${severity}` : ""}.`,
          }),
        },
      ],
    };
  }
);

// ── Tool: count_tokens ─────────────────────────────────────────────────

server.registerTool(
  "count_tokens",
  {
    description:
      "Estimate the token count of a text string. Uses a conservative estimate (chars/3.5). The hard limit is 1500 tokens.",
    inputSchema: {
      text: z.string().describe("The text to count tokens for"),
    },
  },
  async ({ text }) => {
    // Conservative estimate: ~3 chars per token for technical text with IDs/timestamps
    const estimated = Math.ceil(text.length / 3);
    const lineCount = text.split("\n").filter(Boolean).length;

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            estimated_tokens: estimated,
            char_count: text.length,
            line_count: lineCount,
            within_limit: estimated <= 1500,
            headroom: 1500 - estimated,
            message: estimated <= 1500
              ? `OK: ~${estimated} tokens (${1500 - estimated} headroom)`
              : `OVER LIMIT: ~${estimated} tokens (${estimated - 1500} over). Reduce content.`,
          }),
        },
      ],
    };
  }
);

// ── Tool: submit_answer ────────────────────────────────────────────────

server.registerTool(
  "submit_answer",
  {
    description:
      "Submit compressed logs to the verification API. Returns technician feedback or a flag. Lines should be separated by \\n in the string.",
    inputSchema: {
      logs: z
        .string()
        .describe(
          "Compressed log string with events separated by \\n. Each line: [YYYY-MM-DD HH:MM] [SEVERITY] SUBSYSTEM description"
        ),
    },
  },
  async ({ logs }) => {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: API_KEY,
        task: "failure",
        answer: { logs },
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
              : `Submission response: ${data.message ?? responseStr}`,
          }),
        },
      ],
    };
  }
);

// ── Start ──────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
