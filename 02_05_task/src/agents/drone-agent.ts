import type OpenAI from 'openai'
import { openai, HUB_APIKEY, HUB_VERIFY_URL, PLANT_ID, TASK_NAME, MODELS } from '../config.js'

const DRONE_API_DOCS = `# DRN-BMB7 Drone Control API

## Endpoint
POST https://hub.ag3nts.org/verify

## Request format
{
  "apikey": "<key>",
  "task": "drone",
  "answer": {
    "instructions": ["instruction1", "instruction2", ...]
  }
}

## Available instruction strings

### Location Control
- setDestinationObject(<ID>)   — Designate target by object ID (format: [A-Z]{3}[0-9]+[A-Z]{2}, e.g. PWR6132PL)
- set(<x>,<y>)                  — Set actual flight coordinates (origin 1,1 = top-left)

### Engine Control
- set(engineON)                 — Start engine
- set(engineOFF)                — Stop engine
- set(<N>%)                     — Set power level (0% to 100%)

### Flight Control
- set(<N>m)                     — Set altitude in meters (1m to 100m)
- flyToLocation                 — Execute flight to current coordinates

### Mission Objectives
- set(video)                    — Mission: record video
- set(image)                    — Mission: take photo
- set(destroy)                  — Mission: destroy target
- set(return)                   — Mission: return to base

### Diagnostics & Config
- selfCheck                     — Run diagnostic check
- getFirmwareVersion            — Get firmware version
- getConfig                     — Get current configuration

### Service
- hardReset                     — Factory reset (clears all state)
`

const MAX_TURNS = 20

export interface DroneAgentResult {
  success: boolean
  flag?: string
  lastApiResponse?: string
}

export async function runDroneAgent(damX: number, damY: number): Promise<DroneAgentResult> {
  console.log(`\n[DroneAgent] Starting. Dam coordinates: x=${damX}, y=${damY}`)

  const sendTool: OpenAI.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'send_instructions',
      description:
        'Send a sequence of drone instructions to the hub API. Returns the API response — read errors carefully and adjust your instructions.',
      parameters: {
        type: 'object',
        properties: {
          instructions: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ordered list of drone instruction strings',
          },
        },
        required: ['instructions'],
      },
    },
  }

  const systemPrompt = `You are a drone commander specialist. Your mission:

## Objective
Program a DRN-BMB7 drone to destroy a dam near the Żarnowiec power plant.
The drone must be officially registered as targeting power plant ID: ${PLANT_ID}.

## Initial Suspected Dam Coordinates
x=${damX}, y=${damY} (from visual map analysis — may be approximate)

## Strategy
ALWAYS include BOTH set(destroy) AND set(return) in every attempt. The drone requires a return instruction.

1. Start with the suspected coordinates: set(${damX},${damY})
2. Error interpretation:
   - "won't hit the dam" or "drop the bomb somewhere nearby" → WRONG coordinates, try next
   - "pretending to destroy power plants, not actually destroy one" → those are power plant coordinates, skip
   - "without a return instruction, we will lose it forever" → CORRECT coordinates! Just add set(return) to the goal
3. Systematically iterate through ALL grid coordinates (grid is about 5 cols x 4 rows):
   (${damX},${damY}), (${damX-1},${damY}), (${damX},${damY-1}), (${damX+1},${damY}), (${damX},${damY+1}), then (1,1) through (5,4)
4. For each attempt, send EXACTLY:
   ["setDestinationObject(${PLANT_ID})", "set(X,Y)", "set(destroy)", "set(return)", "flyToLocation"]
5. Success: response contains {FLG:...}

## Drone API Reference
${DRONE_API_DOCS}

## Rules
- ALWAYS include set(return) in every attempt
- If you get "return instruction" error — add set(return) and retry SAME coordinates
- Error "won't hit dam" = wrong coordinates, move to next
- Error "power plants" = those are plant coordinates, skip
- Do NOT use hardReset between attempts (wastes turns)
- Stop when response contains {FLG:...}`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Execute the mission. Find the correct dam coordinates by iterating through the grid if needed. Start with x=${damX}, y=${damY}. Register destination as ${PLANT_ID}. Begin now.`,
    },
  ]

  let lastApiResponse = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n[DroneAgent] Turn ${turn + 1}/${MAX_TURNS}`)

    const response = await openai.chat.completions.create({
      model: MODELS.droneCommander,
      messages,
      tools: [sendTool],
    })

    const message = response.choices[0]?.message
    if (!message) break

    if (message.content) {
      console.log(`[DroneAgent] ${message.content.slice(0, 300)}`)
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    })

    if (!message.tool_calls?.length) {
      console.log('[DroneAgent] Agent finished (no tool calls)')
      break
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue

      let args: { instructions?: string[] } = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        args = {}
      }

      const instructions = args.instructions ?? []
      console.log(`[DroneAgent] Sending: ${JSON.stringify(instructions)}`)

      const apiResponse = await fetch(HUB_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: HUB_APIKEY,
          task: TASK_NAME,
          answer: { instructions },
        }),
      })

      const responseText = await apiResponse.text()
      lastApiResponse = responseText
      console.log(`[DroneAgent] API: ${responseText}`)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: responseText,
      })

      if (responseText.includes('FLG:')) {
        console.log('\n[DroneAgent] *** FLAG FOUND ***', responseText)
        return { success: true, flag: responseText, lastApiResponse: responseText }
      }
    }
  }

  return { success: false, lastApiResponse }
}
