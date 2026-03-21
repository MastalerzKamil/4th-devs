import type OpenAI from 'openai'
import { openai, MAP_URL, PLANT_ID, MODELS } from './config.js'
import { analyzeDroneMap } from './agents/vision-agent.js'
import { runDroneAgent } from './agents/drone-agent.js'

const MAX_TURNS = 10

export async function runOrchestrator(): Promise<string> {
  console.log('[Orchestrator] Initializing drone mission...')
  console.log(`[Orchestrator] Target plant ID: ${PLANT_ID}`)
  console.log(`[Orchestrator] Map URL: ${MAP_URL}`)

  const analyzeMapTool: OpenAI.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'analyze_map_image',
      description:
        'Delegate to the Vision Specialist agent to analyze the drone map image and identify the dam sector coordinates.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  }

  const executeMissionTool: OpenAI.ChatCompletionTool = {
    type: 'function',
    function: {
      name: 'execute_drone_mission',
      description:
        'Delegate to the Drone Commander agent to program and execute the drone mission with the specified dam coordinates.',
      parameters: {
        type: 'object',
        properties: {
          dam_x: {
            type: 'number',
            description: 'Column (x) coordinate of the dam sector in the map grid',
          },
          dam_y: {
            type: 'number',
            description: 'Row (y) coordinate of the dam sector in the map grid',
          },
        },
        required: ['dam_x', 'dam_y'],
      },
    },
  }

  const systemPrompt = `You are the mission orchestrator for a covert drone operation.

## Context
A drone must destroy a dam near the Żarnowiec power plant to restore reactor cooling water supply.
The drone must appear to target the power plant (ID: ${PLANT_ID}) in the military system, but actually bomb the dam.

## Your specialist agents
1. analyze_map_image — Vision specialist: analyzes the mission map to find the dam's grid coordinates
2. execute_drone_mission — Drone commander: programs and launches the drone with given coordinates

## Workflow
1. Call analyze_map_image first to get the dam location
2. Call execute_drone_mission with the dam coordinates
3. Report the final mission result (including any flag received)

Proceed efficiently. Delegate each task to the appropriate specialist.`

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: 'Execute the drone mission. Analyze the map first, then launch the drone.',
    },
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n[Orchestrator] Turn ${turn + 1}/${MAX_TURNS}`)

    const response = await openai.chat.completions.create({
      model: MODELS.orchestrator,
      messages,
      tools: [analyzeMapTool, executeMissionTool],
    })

    const message = response.choices[0]?.message
    if (!message) break

    if (message.content) {
      console.log(`[Orchestrator] ${message.content}`)
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    })

    if (!message.tool_calls?.length) {
      return message.content ?? 'Mission complete'
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue

      let toolResult = ''

      if (toolCall.function.name === 'analyze_map_image') {
        console.log('[Orchestrator] Delegating to VisionAgent...')
        const location = await analyzeDroneMap(MAP_URL)
        toolResult = JSON.stringify(location)
        console.log(`[Orchestrator] VisionAgent returned: x=${location.x}, y=${location.y}`)
      } else if (toolCall.function.name === 'execute_drone_mission') {
        let args: { dam_x?: number; dam_y?: number } = {}
        try {
          args = JSON.parse(toolCall.function.arguments || '{}')
        } catch {
          args = {}
        }
        console.log(`[Orchestrator] Delegating to DroneAgent (x=${args.dam_x}, y=${args.dam_y})...`)
        const missionResult = await runDroneAgent(args.dam_x ?? 0, args.dam_y ?? 0)
        toolResult = JSON.stringify(missionResult)

        if (missionResult.success && missionResult.flag) {
          console.log('\n[Orchestrator] === MISSION ACCOMPLISHED ===')
          console.log('FLAG:', missionResult.flag)
          return missionResult.flag
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolResult,
      })
    }
  }

  return 'Orchestration complete'
}
