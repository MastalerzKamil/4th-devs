/**
 * Shared mission memory — the single source of truth all agents read from and write to.
 * The Commander uses this to make decisions; specialists update it with their findings.
 */

export interface UnitInfo {
  id: string
  type: 'scout' | 'transporter'
  passengers?: string[]  // scout IDs carried by a transporter
  position?: string      // last known coordinate
}

export interface InspectionResult {
  coordinate: string
  found: boolean
  details: string
}

export interface SharedMemory {
  // ── Set by MapAnalyzerAgent ────────────────────────────────────────────
  helpText: string          // raw help API response
  rawMapData: string        // raw getMap API response
  previewContent: string    // HTML / text extracted from the preview URL
  symbolLegend: Record<string, string>  // symbol → meaning
  tallBuildings: string[]   // coordinates of the tallest buildings (priority targets)
  allBuildings: string[]    // all building coordinates
  streetSamples: string[]   // sample street coordinates (for transporter routing)
  mapAnalysis: string       // LLM narrative analysis of the map

  // ── Set by LogsAnalyzerAgent ───────────────────────────────────────────
  actionPointsRemaining: number
  units: UnitInfo[]
  logsRaw: string
  logsAnalysis: string

  // ── Set by Commander ───────────────────────────────────────────────────
  deploymentPlan: string    // Commander's current plan in plain text

  // ── Set by InspectorAgent ──────────────────────────────────────────────
  inspected: string[]
  inspectionResults: InspectionResult[]
  targetFound: boolean
  targetLocation: string | null

  // ── Mission control ────────────────────────────────────────────────────
  missionComplete: boolean
  flag: string | null
}

export function createSharedMemory(): SharedMemory {
  return {
    helpText: '',
    rawMapData: '',
    previewContent: '',
    symbolLegend: {},
    tallBuildings: [],
    allBuildings: [],
    streetSamples: [],
    mapAnalysis: '',

    actionPointsRemaining: 300,
    units: [],
    logsRaw: '',
    logsAnalysis: '',

    deploymentPlan: '',

    inspected: [],
    inspectionResults: [],
    targetFound: false,
    targetLocation: null,

    missionComplete: false,
    flag: null,
  }
}
