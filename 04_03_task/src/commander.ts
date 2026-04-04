/**
 * CommanderAgent — Central decision-making brain with extended thinking.
 *
 * Uses Claude 3.7 Sonnet with extended thinking so it can reason deeply
 * about map topology, action-point budgets, and search strategy before
 * committing to each move.
 *
 * Communication pattern:
 *   Commander calls a tool → specialist agent executes → updates SharedMemory
 *   → returns summary → Commander reads memory → decides next action
 */

import type OpenAI from 'openai'
import { chat, MODELS, type ChatMessage } from './llm.js'
import { gameApi } from './game.js'
import { runMapAnalyzer } from './agents/map-analyzer.js'
import { runLogsAnalyzer } from './agents/logs-analyzer.js'
import { createTransporter, createScout } from './agents/creator.js'
import { moveUnit, dropScouts } from './agents/navigator.js'
import { inspectCoordinate, callHelicopter } from './agents/inspector.js'
import type { SharedMemory } from './memory.js'

const MAX_TURNS = 60
const THINKING_BUDGET = 8000  // tokens for Commander's internal reasoning
const LABEL = '[Commander]'

const truncate = (s: string, n = 300) => (s.length > n ? s.slice(0, n) + '…' : s)

// ── Tool definitions ────────────────────────────────��──────────────────────
const TOOLS: OpenAI.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read_memory',
      description: 'Read the full shared mission memory. Always call this first to understand the current state before deciding on any action.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_map',
      description:
        'Trigger MapAnalyzerAgent: opens the visual map preview in a headless browser, ' +
        'calls getMap + help API, uses LLM with thinking to identify tall buildings and streets. ' +
        'MUST be called before any planning.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'analyze_logs',
      description:
        'Trigger LogsAnalyzerAgent: calls getLogs, extracts remaining action points, ' +
        'unit IDs and positions, mission events. Call periodically to keep state fresh.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_transporter',
      description:
        'Trigger CreatorAgent to spawn a transporter with scouts aboard. ' +
        'Cost: 5 pts base + 5 pts per passenger. Returns transporter ID and scout IDs — save them!',
      parameters: {
        type: 'object',
        properties: {
          passengers: {
            type: 'number',
            description: 'Number of scouts to load (1–4). Each scout: 5 extra pts.',
          },
        },
        required: ['passengers'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_scout',
      description: 'Trigger CreatorAgent to spawn a single scout. Cost: 5 pts.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_unit',
      description:
        'Trigger NavigatorAgent to move a unit toward a destination. ' +
        'Transporter: 1 pt/field (streets only). Scout: 7 pts/field. ' +
        'Always use transporter to carry scouts close before dropping them.',
      parameters: {
        type: 'object',
        properties: {
          unitId: { type: 'string', description: 'Unit ID to move' },
          destination: { type: 'string', description: 'Target coordinate, e.g. "E5"' },
        },
        required: ['unitId', 'destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'drop_scouts',
      description:
        'Trigger NavigatorAgent to drop all scouts from a transporter at its current position. Cost: 0 pts.',
      parameters: {
        type: 'object',
        properties: {
          transporterId: { type: 'string', description: 'Transporter ID' },
        },
        required: ['transporterId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'inspect_cell',
      description:
        'Trigger InspectorAgent to inspect a coordinate for the partisan. Cost: 1 pt. ' +
        'If the partisan is confirmed, the helicopter is called automatically.',
      parameters: {
        type: 'object',
        properties: {
          unitId: { type: 'string', description: 'Scout ID performing the inspection' },
          coordinate: { type: 'string', description: 'Coordinate to inspect, e.g. "E5"' },
        },
        required: ['unitId', 'coordinate'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_helicopter',
      description:
        'Call the rescue helicopter to a confirmed coordinate. ' +
        'Only call after an inspection has confirmed the partisan is present.',
      parameters: {
        type: 'object',
        properties: {
          destination: { type: 'string', description: 'Confirmed coordinate of the partisan' },
        },
        required: ['destination'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'call_game_api',
      description:
        'Low-level direct game API call. Use for actions not covered by other tools ' +
        '(e.g. unknown move/drop formats discovered in the help text).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          params: { type: 'object', additionalProperties: true },
        },
        required: ['action'],
      },
    },
  },
]

const SYSTEM_PROMPT = `You are the Commander of Operation Domatowo — a military rescue mission.

SITUATION:
A wounded partisan is hiding in ONE OF THE TALLEST buildings in the bombed city of Domatowo.
Intercepted radio message: "I survived. Bombs destroyed the city. I hid in one of the TALLEST buildings. I am injured. No food. Help."

YOUR ROLE:
You are the sole decision-maker. You coordinate specialist agents through a shared memory.
Each tool you call invokes one specialist agent which updates the shared memory and returns a summary.
Use your extended thinking capability to reason deeply about the map topology, routing, and action-point budget before each decision.

RESOURCES (hard limit: 300 action points):
  • Scout creation:        5 pts each
  • Transporter creation:  5 pts base + 5 pts per passenger scout (e.g. 2 scouts = 15 pts total)
  • Scout movement:        7 pts per field  ← VERY expensive — minimise by using transporter
  • Transporter movement:  1 pt per field   ← cheap — use it to carry scouts close to targets
  • Inspection:            1 pt per cell
  • Limits: max 4 transporters, max 8 scouts

MANDATORY WORKFLOW:
1. call analyze_map    — learn the city layout, tall buildings, street network
2. call analyze_logs   — check current game state, remaining action points
3. call read_memory    — review all gathered intelligence before planning
4. Think deeply about the optimal route (use your extended reasoning)
5. Create 1–2 transporters with 2 scouts each
6. Move each transporter along STREETS toward tall buildings (1 pt/field)
7. Drop scouts (0 pts) near target buildings
8. Inspect each tall building with the nearest scout (1 pt)
9. On confirmation → call_helicopter immediately

CRITICAL RULES:
  • NEVER move scouts on foot if a transporter can carry them closer (7× cost difference)
  • Inspect ALL tall buildings before giving up
  • Call analyze_logs every 5–6 actions to track remaining points
  • If action points < 30, stop creating units — focus solely on the closest uninspected tall building
  • When helicopter confirmed → STOP immediately, the mission is complete`

// ── Commander main loop ───────────────────────────────��────────────────────

export async function runCommander(memory: SharedMemory): Promise<void> {
  console.log(`${LABEL} Starting (thinking budget: ${THINKING_BUDGET} tokens, max turns: ${MAX_TURNS})`)

  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        'Commence Operation Domatowo. Analyse the map, plan your deployment, ' +
        'search the tallest buildings, and evacuate the partisan.',
    },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (memory.missionComplete) {
      console.log(`${LABEL} Mission complete — stopping`)
      break
    }

    console.log(`\n${LABEL} Turn ${turn + 1}`)

    let response
    try {
      response = await chat({
        model: MODELS.thinking,
        messages,
        tools: TOOLS,
        thinkingBudget: THINKING_BUDGET,
        maxTokens: THINKING_BUDGET + 4096,
      })
    } catch (err) {
      console.error(`${LABEL} LLM error: ${err}`)
      break
    }

    // Log thinking summary (first 400 chars) and text response
    if (response.thinking) {
      console.log(`${LABEL} 💭 Thinking: ${truncate(response.thinking, 400)}`)
    }
    if (response.text) {
      console.log(`${LABEL} ${truncate(response.text, 300)}`)
    }

    // Append assistant message — content must be string for history
    messages.push({
      role: 'assistant',
      content: response.text ?? null,
      tool_calls: response.toolCalls,
    })

    if (!response.toolCalls?.length) {
      console.log(`${LABEL} No tool calls — commander decided to stop`)
      break
    }

    // Execute each tool call
    for (const tc of response.toolCalls) {
      if (tc.type !== 'function') continue

      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments || '{}')
      } catch {
        messages.push({ role: 'tool', tool_call_id: tc.id, content: 'Error: invalid JSON' })
        continue
      }

      console.log(`${LABEL} ▶ ${tc.function.name}(${truncate(JSON.stringify(args), 150)})`)

      let result = ''
      try {
        result = await dispatchTool(tc.function.name, args, memory)
      } catch (err) {
        result = `Error: ${String(err)}`
        console.error(`${LABEL} Tool error: ${result}`)
      }

      console.log(`${LABEL} ◀ ${truncate(result, 300)}`)

      // Check for flag
      const flagMatch = result.match(/FLG:[A-Za-z0-9_{}]+/)
      if (flagMatch) {
        memory.flag = flagMatch[0]
        memory.missionComplete = true
        console.log(`\n${LABEL} *** FLAG: ${flagMatch[0]} ***\n`)
      }

      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })

      if (memory.missionComplete) break
    }
  }

  console.log(`${LABEL} Loop ended. Complete: ${memory.missionComplete}, Flag: ${memory.flag ?? 'none'}`)
}

// ── Tool dispatcher ────────────────────────���────────────────────────────��──

async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  memory: SharedMemory,
): Promise<string> {
  switch (name) {
    case 'read_memory':
      return JSON.stringify({
        mapAnalysis: memory.mapAnalysis,
        tallBuildings: memory.tallBuildings,
        streetSamples: memory.streetSamples,
        symbolLegend: memory.symbolLegend,
        helpText: memory.helpText.slice(0, 1500),
        actionPointsRemaining: memory.actionPointsRemaining,
        units: memory.units,
        inspected: memory.inspected,
        inspectionResults: memory.inspectionResults,
        targetFound: memory.targetFound,
        targetLocation: memory.targetLocation,
        missionComplete: memory.missionComplete,
      })

    case 'analyze_map':
      return await runMapAnalyzer(memory)

    case 'analyze_logs':
      return await runLogsAnalyzer(memory)

    case 'create_transporter':
      return await createTransporter(memory, Number(args.passengers ?? 2))

    case 'create_scout':
      return await createScout(memory)

    case 'move_unit':
      return await moveUnit(memory, String(args.unitId), String(args.destination))

    case 'drop_scouts':
      return await dropScouts(memory, String(args.transporterId))

    case 'inspect_cell': {
      const outcome = await inspectCoordinate(
        memory,
        String(args.unitId),
        String(args.coordinate),
      )
      return JSON.stringify(outcome)
    }

    case 'call_helicopter':
      return await callHelicopter(memory, String(args.destination))

    case 'call_game_api': {
      const answer = { action: String(args.action), ...(args.params as object ?? {}) }
      return JSON.stringify(await gameApi(answer))
    }

    default:
      return `Unknown tool: ${name}`
  }
}
