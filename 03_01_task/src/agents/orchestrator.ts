import { openai, MODELS, TASK_AGENT_CONCURRENCY, HUB_APIKEY, HUB_VERIFY_URL, TASK_NAME } from '../config.js'
import { listAllSensorIds, readSensorBatch } from '../tools/sensor_reader.js'
import { classifyNotes, analyzeReadout, challengeDecision, getSpecialistStats } from './readouts_specialist.js'
import { runTaskAgentsParallel } from './task_agent.js'
import { updateHistoricalStats } from '../utils/programmatic_checks.js'
import type { SensorField, OrchestratorContext } from '../types.js'
import type { HistoricalStats } from '../utils/programmatic_checks.js'
import type { SpecialistAnalysis } from './readouts_specialist.js'

// ============================================================================
// Orchestrator Agent
//
// - Maintains shared context about historical sensor readouts
// - Coordinates task agents and the readouts specialist
// - Can challenge specialist decisions based on historical patterns
// - Submits final answer to /verify
// ============================================================================

const FILE_BATCH_SIZE = 200  // files per task agent
const FILES_PER_LLM_LOAD = 500  // files to load for historical stats

// ============================================================================
// Step 1: Load all sensor data and build unique note index
// ============================================================================

const buildNoteIndex = async (fileIds: string[]): Promise<Map<string, string>> => {
  // Map: noteText → first fileId that has it
  const noteIndex = new Map<string, string>()

  // Load files in chunks to build note index
  console.log('[orchestrator] Building note index from all sensors...')

  for (let i = 0; i < fileIds.length; i += FILES_PER_LLM_LOAD) {
    const chunk = fileIds.slice(i, i + FILES_PER_LLM_LOAD)
    const readouts = await readSensorBatch(chunk)
    for (const { fileId, data } of readouts) {
      if (!noteIndex.has(data.operator_notes)) {
        noteIndex.set(data.operator_notes, fileId)
      }
    }
  }

  console.log(`[orchestrator] Found ${noteIndex.size} unique notes across ${fileIds.length} files`)
  return noteIndex
}

// ============================================================================
// Step 2: Orchestrator challenges borderline decisions
// ============================================================================

const challengeBorderlineCases = async (
  anomalies: SpecialistAnalysis[],
  historicalStats: Map<SensorField, HistoricalStats>,
  ctx: OrchestratorContext,
): Promise<SpecialistAnalysis[]> => {
  // Ask orchestrator LLM which cases to challenge
  const borderline = anomalies.filter(
    (a) => a.reasons.includes('note_says_error_but_data_ok'),
  )

  if (borderline.length === 0) return anomalies

  // Build historical context summary
  const statsJson = JSON.stringify(
    Object.fromEntries(
      [...historicalStats.entries()].map(([k, v]) => [
        k,
        { seenMin: v.seenMin, seenMax: v.seenMax, count: v.count, expected: v.expectedRange },
      ]),
    ),
    null,
    2,
  )

  const orchestratorResponse = await openai.chat.completions.create({
    model: MODELS.orchestrator,
    messages: [
      {
        role: 'system',
        content: `You are the orchestrator managing a sensor anomaly detection system.
You have historical context about sensor readings across ${ctx.totalFiles} files.
Historical statistics: ${statsJson}

The readouts specialist has flagged ${borderline.length} cases where operator notes mention errors but data looks OK.
Your job is to decide which cases genuinely need re-examination vs which are clearly correct.

Respond with JSON: {"challenge": ["fileId1", "fileId2"], "accept": ["fileId3"]}
Only include files in "challenge" if there's a specific reason from the historical data to doubt the specialist.`,
      },
      {
        role: 'user',
        content: `Files flagged for "note says error but data OK":\n${JSON.stringify(
          borderline.map((a) => ({ fileId: a.fileId, details: a.details })),
          null,
          2,
        )}`,
      },
    ],
    temperature: 0,
  })

  const text = orchestratorResponse.choices[0]?.message?.content ?? '{}'
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()

  let decision: { challenge: string[]; accept: string[] }
  try {
    decision = JSON.parse(cleaned) as { challenge: string[]; accept: string[] }
  } catch {
    console.warn('[orchestrator] Could not parse challenge decision, keeping all as anomalies')
    return anomalies
  }

  console.log(
    `[orchestrator] Challenging ${decision.challenge.length} decisions, accepting ${decision.accept.length}`,
  )

  // Re-examine challenged cases
  const challengedIds = new Set(decision.challenge)
  const finalAnomalies: SpecialistAnalysis[] = []

  for (const anomaly of anomalies) {
    if (!challengedIds.has(anomaly.fileId)) {
      finalAnomalies.push(anomaly)
      continue
    }

    // Read the file again for context
    const [readout] = await readSensorBatch([anomaly.fileId])
    const challengeReason = `Historical data shows ${statsJson.slice(0, 200)}...`
    const result = await challengeDecision(
      anomaly.fileId,
      readout.data,
      'anomaly',
      challengeReason,
    )

    ctx.challengedDecisions.push({
      fileId: anomaly.fileId,
      originalVerdict: 'anomaly',
      challengeReason,
      finalVerdict: result.finalVerdict,
    })

    if (result.finalVerdict === 'anomaly') {
      finalAnomalies.push(anomaly)
    } else {
      console.log(`[orchestrator] Removed ${anomaly.fileId} from anomalies after challenge: ${result.reasoning}`)
    }
  }

  return finalAnomalies
}

// ============================================================================
// Step 3: Submit answer to /verify
// ============================================================================

const submitAnswer = async (anomalyIds: string[]): Promise<unknown> => {
  const body = {
    apikey: HUB_APIKEY,
    task: TASK_NAME,
    answer: {
      recheck: anomalyIds,
    },
  }

  console.log(`\n[orchestrator] Submitting ${anomalyIds.length} anomalies to ${HUB_VERIFY_URL}`)
  console.log('[orchestrator] Answer:', JSON.stringify(body, null, 2))

  const response = await fetch(HUB_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  const result = await response.json()
  return result
}

// ============================================================================
// Main orchestrator run
// ============================================================================

export const runOrchestrator = async (): Promise<{
  anomalyIds: string[]
  context: OrchestratorContext
  verifyResponse: unknown
}> => {
  console.log('\n=== Sensor Anomaly Detector — Multi-Agent System ===\n')

  // Initialize context
  const ctx: OrchestratorContext = {
    totalFiles: 0,
    processedFiles: 0,
    anomaliesFound: 0,
    historicalRanges: {} as OrchestratorContext['historicalRanges'],
    challengedDecisions: [],
  }

  // Phase 1: Discover all sensor files
  console.log('[orchestrator] Discovering sensor files...')
  const allFileIds = await listAllSensorIds()
  ctx.totalFiles = allFileIds.length
  console.log(`[orchestrator] Found ${ctx.totalFiles} sensor files`)

  // Phase 2: Build note index (for deduplication + caching)
  const noteIndex = await buildNoteIndex(allFileIds)

  // Phase 3: Pre-classify all unique notes via readouts specialist LLM
  await classifyNotes(noteIndex)

  // Phase 4: Build historical stats from a sample for orchestrator context
  console.log('[orchestrator] Building historical statistics...')
  const historicalStats = new Map<SensorField, HistoricalStats>()
  const sampleIds = allFileIds.slice(0, FILES_PER_LLM_LOAD)
  const sampleReadouts = await readSensorBatch(sampleIds)
  for (const { data } of sampleReadouts) {
    const { SENSOR_FIELD_MAP } = await import('../types.js')
    const activeSensors = new Set(
      data.sensor_type.split('/').map((s) => s.trim()) as SensorField[],
    )
    updateHistoricalStats(historicalStats, data, activeSensors)
  }

  // Phase 5: Spawn task agents to analyze all files in parallel
  console.log('\n[orchestrator] Spawning task agents...')
  const taskResults = await runTaskAgentsParallel(
    allFileIds,
    FILE_BATCH_SIZE,
    TASK_AGENT_CONCURRENCY,
  )

  // Phase 6: Collect all anomalies
  const allAnomalies: SpecialistAnalysis[] = taskResults.flatMap((r) => r.anomalies)
  ctx.processedFiles = taskResults.reduce((sum, r) => sum + r.processedCount, 0)
  ctx.anomaliesFound = allAnomalies.length

  const errors = taskResults.flatMap((r) => r.errors)
  if (errors.length > 0) {
    console.warn(`[orchestrator] ${errors.length} file read errors`)
  }

  console.log(`\n[orchestrator] Initial analysis: ${allAnomalies.length} anomalies found`)

  // Phase 7: Orchestrator challenges borderline decisions
  const finalAnomalies = await challengeBorderlineCases(allAnomalies, historicalStats, ctx)
  ctx.anomaliesFound = finalAnomalies.length

  // Phase 8: Print summary
  console.log('\n=== Anomaly Summary ===')
  const byReason: Record<string, number> = {}
  for (const a of finalAnomalies) {
    for (const r of a.reasons) {
      byReason[r] = (byReason[r] ?? 0) + 1
    }
  }
  for (const [reason, count] of Object.entries(byReason)) {
    console.log(`  ${reason}: ${count}`)
  }

  const stats = getSpecialistStats()
  console.log(`\n[specialist] Note cache size: ${stats.noteCacheSize}`)
  console.log(`[specialist] Total LLM calls: ${stats.totalLLMCalls}`)

  const anomalyIds = finalAnomalies.map((a) => a.fileId)
  console.log(`\n[orchestrator] Final anomaly count: ${anomalyIds.length}`)
  console.log('[orchestrator] Anomaly IDs:', anomalyIds.join(', '))

  // Phase 9: Submit answer
  const verifyResponse = await submitAnswer(anomalyIds)
  console.log('\n[orchestrator] Verify response:', JSON.stringify(verifyResponse, null, 2))

  return { anomalyIds, context: ctx, verifyResponse }
}
