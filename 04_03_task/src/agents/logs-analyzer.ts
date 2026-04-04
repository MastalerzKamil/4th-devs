/**
 * LogsAnalyzerAgent
 *
 * Responsibilities:
 *  1. Call getLogs from the game API
 *  2. Use LLM to extract actionable game state:
 *     - Remaining action points
 *     - Current unit positions
 *     - Any notable events (target found, errors, etc.)
 *  3. Write findings to SharedMemory
 */

import { chat, MODELS } from '../llm.js'
import { gameApi } from '../game.js'
import type { SharedMemory, UnitInfo } from '../memory.js'

const THINKING_BUDGET = 3000
const LABEL = '[LogsAnalyzer]'

export async function runLogsAnalyzer(memory: SharedMemory): Promise<string> {
  console.log(`${LABEL} Fetching game logs...`)

  const logsRaw = await gameApi({ action: 'getLogs' })
  const logsStr = JSON.stringify(logsRaw)
  memory.logsRaw = logsStr

  // Quick check for flag before LLM call
  const flagMatch = logsStr.match(/FLG:[A-Za-z0-9_{}]+/)
  if (flagMatch) {
    memory.flag = flagMatch[0]
    memory.missionComplete = true
    console.log(`${LABEL} FLAG DETECTED in logs: ${flagMatch[0]}`)
    return `FLAG FOUND: ${flagMatch[0]}`
  }

  console.log(`${LABEL} Analysing logs with LLM...`)

  const response = await chat({
    model: MODELS.thinking,
    messages: [
      {
        role: 'system',
        content: `You are a mission status analyst. Use your thinking to carefully parse game logs and extract all relevant state.

Return ONLY valid JSON inside a \`\`\`json block:
{
  "actionPointsRemaining": 285,
  "units": [
    { "id": "unit-abc", "type": "transporter", "position": "D4", "passengers": ["scout-1", "scout-2"] },
    { "id": "scout-1", "type": "scout", "position": "D4" }
  ],
  "targetFound": false,
  "targetLocation": null,
  "summary": "Brief description of current mission state"
}`,
      },
      {
        role: 'user',
        content: `Analyse these game logs and extract the current state:\n\n${logsStr.slice(0, 4000)}`,
      },
    ],
    thinkingBudget: THINKING_BUDGET,
    maxTokens: THINKING_BUDGET + 1024,
  })

  if (response.thinking) {
    console.log(`${LABEL} 💭 ${response.thinking.slice(0, 200)}…`)
  }

  const text = response.text ?? ''

  try {
    const md = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    const raw = text.match(/(\{[\s\S]+\})/)
    const parsed = JSON.parse(md?.[1] ?? raw?.[1] ?? text) as {
      actionPointsRemaining?: number
      units?: UnitInfo[]
      targetFound?: boolean
      targetLocation?: string | null
      summary?: string
    }

    if (parsed.actionPointsRemaining != null) {
      memory.actionPointsRemaining = parsed.actionPointsRemaining
    }
    if (parsed.units) {
      memory.units = parsed.units
    }
    if (parsed.targetFound) {
      memory.targetFound = true
      memory.targetLocation = parsed.targetLocation ?? null
    }

    memory.logsAnalysis = parsed.summary ?? ''

    const summary = `${memory.actionPointsRemaining} action points remaining. ${memory.units.length} units. ${memory.logsAnalysis}`
    console.log(`${LABEL} ${summary}`)
    return summary
  } catch {
    memory.logsAnalysis = text.slice(0, 300)
    console.warn(`${LABEL} Could not parse LLM response`)
    return text.slice(0, 200)
  }
}
