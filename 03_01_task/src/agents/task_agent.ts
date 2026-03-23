import { readSensorBatch } from '../tools/sensor_reader.js'
import { analyzeReadout } from './readouts_specialist.js'
import type { SpecialistAnalysis } from './readouts_specialist.js'

// ============================================================================
// Task Agent — parallel batch worker
//
// - Reads sensor files using the read_sensor_readouts tool
// - Reports each file to the readouts specialist for analysis
// - Returns found anomalies back to the orchestrator
// ============================================================================

export interface TaskAgentResult {
  agentId: string
  processedCount: number
  anomalies: SpecialistAnalysis[]
  errors: Array<{ fileId: string; error: string }>
}

export const runTaskAgent = async (
  agentId: string,
  fileIds: string[],
): Promise<TaskAgentResult> => {
  const anomalies: SpecialistAnalysis[] = []
  const errors: Array<{ fileId: string; error: string }> = []

  // read_sensor_readouts tool call
  let readouts: Awaited<ReturnType<typeof readSensorBatch>>
  try {
    readouts = await readSensorBatch(fileIds)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[task-agent:${agentId}] Failed to read batch: ${message}`)
    return { agentId, processedCount: 0, anomalies, errors: fileIds.map((id) => ({ fileId: id, error: message })) }
  }

  // Analyze each readout via readouts specialist
  for (const readout of readouts) {
    try {
      const analysis = analyzeReadout(readout.fileId, readout.data)
      if (analysis.isAnomaly) {
        anomalies.push(analysis)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ fileId: readout.fileId, error: message })
    }
  }

  return {
    agentId,
    processedCount: readouts.length,
    anomalies,
    errors,
  }
}

// ============================================================================
// Run multiple task agents in parallel with concurrency control
// ============================================================================

export const runTaskAgentsParallel = async (
  allFileIds: string[],
  batchSize: number,
  concurrency: number,
): Promise<TaskAgentResult[]> => {
  // Split into batches
  const batches: string[][] = []
  for (let i = 0; i < allFileIds.length; i += batchSize) {
    batches.push(allFileIds.slice(i, i + batchSize))
  }

  const results: TaskAgentResult[] = []
  let completed = 0

  // Process with concurrency limit
  for (let i = 0; i < batches.length; i += concurrency) {
    const chunk = batches.slice(i, i + concurrency)
    const chunkResults = await Promise.all(
      chunk.map((batch, idx) => {
        const agentId = `agent-${String(i + idx + 1).padStart(3, '0')}`
        return runTaskAgent(agentId, batch)
      }),
    )
    results.push(...chunkResults)
    completed += chunk.length
    const processedFiles = results.reduce((sum, r) => sum + r.processedCount, 0)
    const foundAnomalies = results.reduce((sum, r) => sum + r.anomalies.length, 0)
    console.log(
      `[orchestrator] Batches: ${completed}/${batches.length} | Files: ${processedFiles}/${allFileIds.length} | Anomalies: ${foundAnomalies}`,
    )
  }

  return results
}
