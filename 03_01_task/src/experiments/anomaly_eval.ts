/**
 * Langfuse evaluation experiment for the readouts specialist.
 *
 * This eval measures how accurately the readouts specialist classifies
 * operator notes as OK vs ERR across a synthetic test dataset.
 *
 * It mirrors the structure of 03_01_evals experiments and logs results
 * to the same Langfuse project.
 */

import { LangfuseClient, type Evaluator, type ExperimentTask } from '@langfuse/client'
import { LANGFUSE_SECRET_KEY, LANGFUSE_PUBLIC_KEY, LANGFUSE_BASE_URL } from '../config.js'
import { classifyNotes } from '../agents/readouts_specialist.js'
import { runProgrammaticChecks } from '../utils/programmatic_checks.js'
import type { SensorData } from '../types.js'

// ============================================================================
// Synthetic test dataset — covers all anomaly categories
// ============================================================================

interface EvalCase {
  id: string
  fileId: string
  data: SensorData
  expectedIsAnomaly: boolean
  expectedReason: string
}

const EVAL_CASES: EvalCase[] = [
  // Data out of range — temperature too low
  {
    id: 'oor_temp_low',
    fileId: 'test-001',
    data: {
      sensor_type: 'temperature',
      timestamp: 1774000000,
      temperature_K: 400,
      pressure_bar: 0,
      water_level_meters: 0,
      voltage_supply_v: 0,
      humidity_percent: 0,
      operator_notes: 'Readings are calm and predictable, signal quality remains smooth.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'out_of_range',
  },
  // Data out of range — voltage too high
  {
    id: 'oor_voltage_high',
    fileId: 'test-002',
    data: {
      sensor_type: 'voltage',
      timestamp: 1774000001,
      temperature_K: 0,
      pressure_bar: 0,
      water_level_meters: 0,
      voltage_supply_v: 245.0,
      humidity_percent: 0,
      operator_notes: 'All looks fine, no issues detected during this monitoring pass.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'out_of_range',
  },
  // Wrong field — water sensor returning voltage
  {
    id: 'wrong_field',
    fileId: 'test-003',
    data: {
      sensor_type: 'water',
      timestamp: 1774000002,
      temperature_K: 0,
      pressure_bar: 0,
      water_level_meters: 10.5,
      voltage_supply_v: 229.5,
      humidity_percent: 0,
      operator_notes: 'Daily monitoring confirms stability, normal operation continues.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'wrong_field_nonzero',
  },
  // Note says error but data is OK
  {
    id: 'note_err_data_ok',
    fileId: 'test-004',
    data: {
      sensor_type: 'pressure',
      timestamp: 1774000003,
      temperature_K: 0,
      pressure_bar: 95.0,
      water_level_meters: 0,
      voltage_supply_v: 0,
      humidity_percent: 0,
      operator_notes: 'Alarm triggered — unexpected pressure spike detected, flagging for review.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'note_says_error_but_data_ok',
  },
  // Note says OK but data is wrong
  {
    id: 'note_ok_data_wrong',
    fileId: 'test-005',
    data: {
      sensor_type: 'humidity',
      timestamp: 1774000004,
      temperature_K: 0,
      pressure_bar: 0,
      water_level_meters: 0,
      voltage_supply_v: 0,
      humidity_percent: 95.0,
      operator_notes: 'Everything looks normal, system is operating within expected parameters.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'note_says_ok_but_data_wrong',
  },
  // All normal — no anomaly
  {
    id: 'normal_01',
    fileId: 'test-006',
    data: {
      sensor_type: 'temperature/voltage',
      timestamp: 1774000005,
      temperature_K: 700,
      pressure_bar: 0,
      water_level_meters: 0,
      voltage_supply_v: 230.0,
      humidity_percent: 0,
      operator_notes: 'System is operating normally. All readings within expected range.',
    },
    expectedIsAnomaly: false,
    expectedReason: 'none',
  },
  // Multi-sensor all normal
  {
    id: 'normal_multi',
    fileId: 'test-007',
    data: {
      sensor_type: 'pressure/water/humidity',
      timestamp: 1774000006,
      temperature_K: 0,
      pressure_bar: 100.0,
      water_level_meters: 10.0,
      voltage_supply_v: 0,
      humidity_percent: 60.0,
      operator_notes: 'No irregular behavior is visible, monitoring continues as planned.',
    },
    expectedIsAnomaly: false,
    expectedReason: 'none',
  },
  // Pressure out of range (too high)
  {
    id: 'oor_pressure_high',
    fileId: 'test-008',
    data: {
      sensor_type: 'pressure',
      timestamp: 1774000007,
      temperature_K: 0,
      pressure_bar: 175.0,
      water_level_meters: 0,
      voltage_supply_v: 0,
      humidity_percent: 0,
      operator_notes: 'Something seems off — readings are exceeding normal thresholds.',
    },
    expectedIsAnomaly: true,
    expectedReason: 'out_of_range',
  },
]

// ============================================================================
// Langfuse eval setup
// ============================================================================

const DATASET_NAME = '03_01_task/anomaly-detection-synthetic'

const runAnalysis = async (evalCase: EvalCase): Promise<{
  isAnomaly: boolean
  reasons: string[]
  details: string
  noteClassification: 'OK' | 'ERR' | 'UNKNOWN'
}> => {
  // Ensure the note is classified
  const noteMap = new Map<string, string>([[evalCase.data.operator_notes, evalCase.fileId]])
  await classifyNotes(noteMap)

  const { analyzeReadout } = await import('../agents/readouts_specialist.js')
  const result = analyzeReadout(evalCase.fileId, evalCase.data)

  return {
    isAnomaly: result.isAnomaly,
    reasons: result.reasons,
    details: result.details,
    noteClassification: result.noteClassification,
  }
}

const anomalyEvaluator: Evaluator = async ({ input, output, expectedOutput }) => {
  const expected = expectedOutput as { isAnomaly: boolean; reason: string }
  const actual = output as { isAnomaly: boolean; reasons: string[] }

  const correct = actual.isAnomaly === expected.isAnomaly ? 1 : 0
  const reasonMatch =
    expected.reason === 'none'
      ? actual.reasons.length === 0 ? 1 : 0
      : actual.reasons.includes(expected.reason) ? 1 : 0

  return [
    { name: 'anomaly_detection_accuracy', value: correct },
    { name: 'reason_accuracy', value: reasonMatch },
    { name: 'overall_score', value: (correct + reasonMatch) / 2 },
  ]
}

const buildTask = (): ExperimentTask => async (item) => {
  const input = item.input as EvalCase
  const result = await runAnalysis(input)
  return result
}

// ============================================================================
// Main eval runner
// ============================================================================

const main = async (): Promise<void> => {
  console.log('[eval] Starting anomaly detection evaluation...')

  const langfuse = new LangfuseClient({
    secretKey: LANGFUSE_SECRET_KEY,
    publicKey: LANGFUSE_PUBLIC_KEY,
    baseUrl: LANGFUSE_BASE_URL,
  })

  try {
    // Ensure dataset exists
    try {
      await langfuse.api.datasets.get(DATASET_NAME)
    } catch {
      await langfuse.api.datasets.create({
        name: DATASET_NAME,
        description: 'Synthetic anomaly detection cases for the readouts specialist',
        metadata: { source: 'synthetic', domain: 'sensor-anomaly' },
      })
    }

    // Upsert dataset items
    for (const evalCase of EVAL_CASES) {
      await langfuse.api.datasetItems.create({
        datasetName: DATASET_NAME,
        id: `03_01_task_${evalCase.id}`,
        input: evalCase,
        expectedOutput: { isAnomaly: evalCase.expectedIsAnomaly, reason: evalCase.expectedReason },
        metadata: { caseId: evalCase.id },
      })
    }

    console.log(`[eval] Uploaded ${EVAL_CASES.length} dataset items`)

    const dataset = await langfuse.dataset.get(DATASET_NAME)
    const result = await dataset.runExperiment({
      name: '03_01 Anomaly Detection Eval',
      description: 'Evaluates readouts specialist accuracy on synthetic sensor anomaly cases',
      metadata: { datasetName: DATASET_NAME },
      task: buildTask(),
      evaluators: [anomalyEvaluator],
    })

    // Check programmatic correctness locally
    let correct = 0
    for (const evalCase of EVAL_CASES) {
      const check = runProgrammaticChecks(evalCase.data)
      const expectedData = evalCase.expectedReason === 'out_of_range' || evalCase.expectedReason === 'wrong_field_nonzero'
      if (expectedData && !check.dataOk) correct++
      if (!expectedData && check.dataOk) correct++ // note-based cases need LLM
    }

    console.log('\n[eval] Results uploaded to Langfuse')
    console.log(`[eval] Dataset: ${DATASET_NAME}`)
    console.log(`[eval] Cases: ${EVAL_CASES.length}`)
  } finally {
    await langfuse.flush()
    await langfuse.shutdown()
  }
}

main().catch((error) => {
  console.error('[eval] Failed:', error instanceof Error ? error.message : String(error))
  process.exit(1)
})
