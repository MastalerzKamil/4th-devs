// ============================================================================
// Sensor data types
// ============================================================================

export interface SensorData {
  sensor_type: string
  timestamp: number
  temperature_K: number
  pressure_bar: number
  water_level_meters: number
  voltage_supply_v: number
  humidity_percent: number
  operator_notes: string
}

export type SensorField = 'temperature' | 'pressure' | 'water' | 'voltage' | 'humidity'

export const SENSOR_FIELD_MAP: Record<SensorField, keyof SensorData> = {
  temperature: 'temperature_K',
  pressure: 'pressure_bar',
  water: 'water_level_meters',
  voltage: 'voltage_supply_v',
  humidity: 'humidity_percent',
}

export const VALID_RANGES: Record<SensorField, { min: number; max: number }> = {
  temperature: { min: 553, max: 873 },
  pressure: { min: 60, max: 160 },
  water: { min: 5.0, max: 15.0 },
  voltage: { min: 229.0, max: 231.0 },
  humidity: { min: 40.0, max: 80.0 },
}

// ============================================================================
// Anomaly types
// ============================================================================

export type AnomalyReason =
  | 'out_of_range'
  | 'wrong_field_nonzero'
  | 'note_says_error_but_data_ok'
  | 'note_says_ok_but_data_wrong'

export interface Anomaly {
  fileId: string
  reasons: AnomalyReason[]
  details: string
  dataOk: boolean
  noteClassification: 'OK' | 'ERR' | 'UNKNOWN'
}

// ============================================================================
// Agent communication types
// ============================================================================

export interface SensorReadout {
  fileId: string
  data: SensorData
}

export interface TaskAgentReport {
  agentId: string
  processedFiles: string[]
  anomalies: Anomaly[]
  errors: string[]
}

export interface SpecialistVerdict {
  note: string
  classification: 'OK' | 'ERR'
  confidence: number
  reasoning: string
}

export interface OrchestratorContext {
  totalFiles: number
  processedFiles: number
  anomaliesFound: number
  historicalRanges: Record<SensorField, { seenMin: number; seenMax: number; count: number }>
  challengedDecisions: ChallengedDecision[]
}

export interface ChallengedDecision {
  fileId: string
  originalVerdict: 'anomaly' | 'ok'
  challengeReason: string
  finalVerdict: 'anomaly' | 'ok'
}
