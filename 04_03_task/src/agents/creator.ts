/**
 * CreatorAgent
 *
 * Responsibilities:
 *  - Create scouts and transporters via the game API
 *  - Record created unit IDs in SharedMemory
 *  - Return unit ID(s) to Commander
 *
 * No LLM needed — this is a deterministic API call.
 */

import { gameApi } from '../game.js'
import type { SharedMemory } from '../memory.js'

const LABEL = '[Creator]'

export async function createTransporter(
  memory: SharedMemory,
  passengers: number,
): Promise<string> {
  console.log(`${LABEL} Creating transporter with ${passengers} scout(s)...`)

  const result = (await gameApi({
    action: 'create',
    type: 'transporter',
    passengers,
  })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Create transporter result: ${resultStr}`)

  // Extract unit IDs from response — different APIs return different shapes
  const transporterId = extractId(result, 'transporter')
  const scoutIds = extractPassengerIds(result, passengers)

  if (transporterId) {
    memory.units.push({ id: transporterId, type: 'transporter', passengers: scoutIds })
  }
  for (const sid of scoutIds) {
    memory.units.push({ id: sid, type: 'scout' })
  }

  const summary = `Transporter ${transporterId ?? 'unknown'} created with scouts: ${scoutIds.join(', ') || 'none'}`
  console.log(`${LABEL} ${summary}`)
  return JSON.stringify({ transporterId, scoutIds, raw: result })
}

export async function createScout(memory: SharedMemory): Promise<string> {
  console.log(`${LABEL} Creating individual scout...`)

  const result = (await gameApi({ action: 'create', type: 'scout' })) as Record<string, unknown>

  const resultStr = JSON.stringify(result)
  console.log(`${LABEL} Create scout result: ${resultStr}`)

  const scoutId = extractId(result, 'scout')
  if (scoutId) {
    memory.units.push({ id: scoutId, type: 'scout' })
  }

  return JSON.stringify({ scoutId, raw: result })
}

// ── Helpers ───────────────────────────────────────────────────────────────

function extractId(result: Record<string, unknown>, type: string): string | undefined {
  // Common response patterns: { id }, { unitId }, { [type]: { id } }, { data: { id } }
  if (typeof result.id === 'string') return result.id
  if (typeof result.unitId === 'string') return result.unitId
  if (typeof result.transporterId === 'string' && type === 'transporter') return result.transporterId
  if (typeof result.scoutId === 'string' && type === 'scout') return result.scoutId

  const nested = result[type] as Record<string, unknown> | undefined
  if (nested && typeof nested.id === 'string') return nested.id

  // Try to find any string field that looks like an ID
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'string' && (k.toLowerCase().includes('id') || v.includes('-'))) {
      return v
    }
  }
  return undefined
}

function extractPassengerIds(
  result: Record<string, unknown>,
  count: number,
): string[] {
  // Look for array of scout IDs in the response
  for (const v of Object.values(result)) {
    if (Array.isArray(v) && v.length === count && v.every((x) => typeof x === 'string')) {
      return v as string[]
    }
  }

  if (Array.isArray(result.scouts)) return (result.scouts as unknown[]).map(String)
  if (Array.isArray(result.passengers)) return (result.passengers as unknown[]).map(String)
  if (Array.isArray(result.scoutIds)) return (result.scoutIds as unknown[]).map(String)

  return []
}
