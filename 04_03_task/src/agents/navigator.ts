/**
 * NavigatorAgent
 *
 * Responsibilities:
 *  - Move a unit (transporter or scout) to a destination via the game API
 *  - Handle whatever move format the API uses (learned from help text)
 *  - Update unit position in SharedMemory
 *  - Return move result to Commander
 *
 * Uses raw gameApi calls — no LLM needed.
 */

import { gameApi } from '../game.js'
import type { SharedMemory } from '../memory.js'

const LABEL = '[Navigator]'

export async function moveUnit(
  memory: SharedMemory,
  unitId: string,
  destination: string,
): Promise<string> {
  console.log(`${LABEL} Moving unit ${unitId} → ${destination}...`)

  // Try the most common move API patterns
  const result = (await gameApi({
    action: 'move',
    unitId,
    to: destination,
  })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Move result: ${resultStr.slice(0, 200)}`)

  // Update position in memory
  const unit = memory.units.find((u) => u.id === unitId)
  if (unit) unit.position = destination

  // Check for flag
  const flagMatch = resultStr.match(/FLG:[A-Za-z0-9_{}]+/)
  if (flagMatch) {
    memory.flag = flagMatch[0]
    memory.missionComplete = true
    console.log(`${LABEL} FLAG DETECTED: ${flagMatch[0]}`)
  }

  return resultStr
}

export async function dropScouts(
  memory: SharedMemory,
  transporterId: string,
): Promise<string> {
  console.log(`${LABEL} Dropping scouts from transporter ${transporterId}...`)

  // Try common drop/deploy patterns
  const result = (await gameApi({
    action: 'drop',
    unitId: transporterId,
  })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Drop result: ${resultStr.slice(0, 200)}`)

  // Update scout positions to match transporter
  const transporter = memory.units.find((u) => u.id === transporterId)
  if (transporter?.passengers) {
    for (const scoutId of transporter.passengers) {
      const scout = memory.units.find((u) => u.id === scoutId)
      if (scout) scout.position = transporter.position
    }
  }

  return resultStr
}
