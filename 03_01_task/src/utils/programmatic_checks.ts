import type { SensorData, SensorField, AnomalyReason } from '../types.js'
import { VALID_RANGES, SENSOR_FIELD_MAP } from '../types.js'

// ============================================================================
// Fast programmatic anomaly detection — no LLM needed
// ============================================================================

const parseSensorTypes = (sensorType: string): Set<SensorField> => {
  const parts = sensorType.toLowerCase().split('/')
  const valid = new Set<SensorField>(['temperature', 'pressure', 'water', 'voltage', 'humidity'])
  const result = new Set<SensorField>()
  for (const part of parts) {
    const trimmed = part.trim() as SensorField
    if (valid.has(trimmed)) {
      result.add(trimmed)
    }
  }
  return result
}

export interface ProgrammaticCheckResult {
  dataOk: boolean
  reasons: AnomalyReason[]
  details: string[]
  activeSensors: Set<SensorField>
}

export const runProgrammaticChecks = (data: SensorData): ProgrammaticCheckResult => {
  const activeSensors = parseSensorTypes(data.sensor_type)
  const reasons: AnomalyReason[] = []
  const details: string[] = []

  const allFields: SensorField[] = ['temperature', 'pressure', 'water', 'voltage', 'humidity']

  for (const field of allFields) {
    const dataKey = SENSOR_FIELD_MAP[field]
    const value = data[dataKey] as number
    const isActive = activeSensors.has(field)

    if (isActive) {
      // Active sensor: value must be in range
      const range = VALID_RANGES[field]
      if (value < range.min || value > range.max) {
        reasons.push('out_of_range')
        details.push(
          `${field} value ${value} is out of range [${range.min}, ${range.max}]`,
        )
      }
    } else {
      // Inactive sensor: value must be 0
      if (value !== 0) {
        reasons.push('wrong_field_nonzero')
        details.push(
          `${field} value ${value} should be 0 (sensor not active: ${data.sensor_type})`,
        )
      }
    }
  }

  return {
    dataOk: reasons.length === 0,
    reasons,
    details,
    activeSensors,
  }
}

// ============================================================================
// Batch programmatic check — returns map of fileId → result
// ============================================================================

export const batchProgrammaticCheck = (
  readouts: Array<{ fileId: string; data: SensorData }>,
): Map<string, ProgrammaticCheckResult> => {
  const results = new Map<string, ProgrammaticCheckResult>()
  for (const { fileId, data } of readouts) {
    results.set(fileId, runProgrammaticChecks(data))
  }
  return results
}

// ============================================================================
// Historical context — track seen min/max for orchestrator challenges
// ============================================================================

export interface HistoricalStats {
  field: SensorField
  seenMin: number
  seenMax: number
  count: number
  expectedRange: { min: number; max: number }
}

export const updateHistoricalStats = (
  stats: Map<SensorField, HistoricalStats>,
  data: SensorData,
  activeSensors: Set<SensorField>,
): void => {
  for (const field of activeSensors) {
    const dataKey = SENSOR_FIELD_MAP[field]
    const value = data[dataKey] as number
    if (value === 0) continue

    const existing = stats.get(field)
    if (!existing) {
      stats.set(field, {
        field,
        seenMin: value,
        seenMax: value,
        count: 1,
        expectedRange: VALID_RANGES[field],
      })
    } else {
      existing.seenMin = Math.min(existing.seenMin, value)
      existing.seenMax = Math.max(existing.seenMax, value)
      existing.count++
    }
  }
}
