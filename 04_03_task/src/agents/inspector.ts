/**
 * InspectorAgent
 *
 * Responsibilities:
 *  - Call the inspect action for a given coordinate
 *  - Use LLM to interpret the inspection result (found / not found)
 *  - Update SharedMemory with findings
 *  - Signal mission complete if partisan is found
 *  - Call callHelicopter immediately when confirmed
 */

import { chat, MODELS } from '../llm.js'
import { gameApi } from '../game.js'
import type { SharedMemory } from '../memory.js'

const THINKING_BUDGET = 3000
const LABEL = '[Inspector]'

export interface InspectOutcome {
  found: boolean
  coordinate: string
  details: string
}

export async function inspectCoordinate(
  memory: SharedMemory,
  unitId: string,
  coordinate: string,
): Promise<InspectOutcome> {
  console.log(`${LABEL} Inspecting ${coordinate} with unit ${unitId}...`)

  const result = (await gameApi({
    action: 'inspect',
    unitId,
    coordinate,
  })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Inspect result: ${resultStr.slice(0, 300)}`)

  // Mark as inspected
  if (!memory.inspected.includes(coordinate)) {
    memory.inspected.push(coordinate)
  }

  // Check for flag directly
  const flagMatch = resultStr.match(/FLG:[A-Za-z0-9_{}]+/)
  if (flagMatch) {
    memory.flag = flagMatch[0]
    memory.missionComplete = true
    memory.targetFound = true
    memory.targetLocation = coordinate
    console.log(`${LABEL} FLAG DETECTED: ${flagMatch[0]}`)
    return { found: true, coordinate, details: `FLAG: ${flagMatch[0]}` }
  }

  // Use LLM with thinking to interpret the inspection result
  const response = await chat({
    model: MODELS.thinking,
    messages: [
      {
        role: 'system',
        content: `You are analysing the result of a field inspection in a rescue mission.
Use your thinking to carefully determine if a wounded partisan was found at the inspected location.

Return ONLY valid JSON:
{
  "found": true | false,
  "details": "brief explanation"
}`,
      },
      {
        role: 'user',
        content: `Inspection result for coordinate ${coordinate}:\n${resultStr}`,
      },
    ],
    thinkingBudget: THINKING_BUDGET,
    maxTokens: THINKING_BUDGET + 512,
  })

  if (response.thinking) {
    console.log(`${LABEL} 💭 ${response.thinking.slice(0, 200)}…`)
  }

  const text = response.text ?? ''

  let found = false
  let details = ''

  try {
    const md = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    const raw = text.match(/(\{[\s\S]+\})/)
    const parsed = JSON.parse(md?.[1] ?? raw?.[1] ?? text) as {
      found?: boolean
      details?: string
    }
    found = parsed.found ?? false
    details = parsed.details ?? ''
  } catch {
    // Fallback: look for positive keywords
    const lower = (resultStr + text).toLowerCase()
    found =
      lower.includes('found') ||
      lower.includes('partisan') ||
      lower.includes('person') ||
      lower.includes('człowiek') ||
      lower.includes('znaleziono')
    details = text.slice(0, 200)
  }

  const outcome: InspectOutcome = { found, coordinate, details }
  memory.inspectionResults.push({ coordinate, found, details })

  if (found) {
    memory.targetFound = true
    memory.targetLocation = coordinate
    console.log(`${LABEL} PARTISAN FOUND at ${coordinate}! Calling helicopter...`)
    await callHelicopter(memory, coordinate)
  } else {
    console.log(`${LABEL} ${coordinate}: not found — ${details.slice(0, 100)}`)
  }

  return outcome
}

export async function callHelicopter(memory: SharedMemory, destination: string): Promise<string> {
  console.log(`${LABEL} Calling helicopter to ${destination}...`)

  const result = (await gameApi({
    action: 'callHelicopter',
    destination,
  })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Helicopter result: ${resultStr}`)

  const flagMatch = resultStr.match(/FLG:[A-Za-z0-9_{}]+/)
  if (flagMatch) {
    memory.flag = flagMatch[0]
    console.log(`\n  *** FLAG: ${flagMatch[0]} ***\n`)
  }

  memory.missionComplete = true
  return resultStr
}
