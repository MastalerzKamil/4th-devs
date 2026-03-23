import { openai, MODELS, NOTE_BATCH_SIZE } from '../config.js'
import type { SensorData, SensorField, SpecialistVerdict, AnomalyReason } from '../types.js'
import { runProgrammaticChecks } from '../utils/programmatic_checks.js'

// ============================================================================
// Readouts Specialist Agent
//
// - Knows anomaly detection rules (true/false for each case)
// - Classifies operator notes via LLM with in-process caching
// - Can be queried by task agents and challenged by orchestrator
// - Maintains a note classification cache to avoid duplicate LLM calls
// ============================================================================

export interface SpecialistAnalysis {
  fileId: string
  isAnomaly: boolean
  dataOk: boolean
  noteClassification: 'OK' | 'ERR' | 'UNKNOWN'
  reasons: AnomalyReason[]
  details: string
}

const NOTE_CACHE = new Map<string, SpecialistVerdict>()
let totalLLMCalls = 0

// ============================================================================
// LLM-based note classification (batched + cached)
// ============================================================================

const SYSTEM_PROMPT = `You are a sensor readout specialist at a power plant.
Your job is to classify operator notes as either OK (operator reports normal operation)
or ERR (operator reports a problem, anomaly, or error in the readings).

Rules:
- OK: notes that say everything is fine, normal, stable, no issues, monitoring continues, etc.
- ERR: notes that mention errors, anomalies, problems, unexpected readings, alarms, malfunctions, warnings

You will receive a JSON array of {id, note} objects.
Respond with ONLY a JSON array of {id, classification} where classification is "OK" or "ERR".
No explanations, no markdown, just the JSON array.`

interface NoteItem {
  id: string
  note: string
}

interface ClassificationResult {
  id: string
  classification: 'OK' | 'ERR'
}

// Uses short numeric IDs in the LLM call to keep output minimal, then maps back to note text
const classifyNotesBatch = async (
  items: NoteItem[],
  indexToNote: Map<string, string>, // index → noteText
): Promise<Map<string, 'OK' | 'ERR'>> => {
  totalLLMCalls++
  // Replace note text IDs with short indices to minimise output tokens
  const indexed = items.map((item, i) => ({ id: String(i), note: item.note }))
  const prompt = JSON.stringify(indexed)

  const response = await openai.chat.completions.create({
    model: MODELS.specialist,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ],
    temperature: 0,
    // Output is just short JSON array: [{"id":"0","classification":"OK"}, ...] ~25 tokens per item
    max_tokens: items.length * 25 + 100,
  })

  const text = response.choices[0]?.message?.content ?? '[]'
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()

  let results: ClassificationResult[]
  try {
    results = JSON.parse(cleaned) as ClassificationResult[]
  } catch {
    console.error('[specialist] Failed to parse batch, defaulting to OK:', text.slice(0, 200))
    results = indexed.map((item) => ({ id: item.id, classification: 'OK' as const }))
  }

  const map = new Map<string, 'OK' | 'ERR'>()
  for (const r of results) {
    const noteText = indexToNote.get(r.id)
    if (noteText !== undefined) {
      map.set(noteText, r.classification)
    }
  }
  return map
}

// ============================================================================
// Cache unique notes and classify in batches
// ============================================================================

export const classifyNotes = async (
  noteMap: Map<string, string>, // noteText → unique key
): Promise<void> => {
  // Only classify notes not already in cache
  const uncached: NoteItem[] = []
  for (const [noteText] of noteMap) {
    if (!NOTE_CACHE.has(noteText)) {
      uncached.push({ id: noteText, note: noteText })
    }
  }

  if (uncached.length === 0) return

  console.log(`[specialist] Classifying ${uncached.length} unique notes via LLM...`)

  // Process in batches
  for (let i = 0; i < uncached.length; i += NOTE_BATCH_SIZE) {
    const batch = uncached.slice(i, i + NOTE_BATCH_SIZE)
    // Build index map: short integer id → note text
    const indexToNote = new Map<string, string>(batch.map((item, idx) => [String(idx), item.note]))
    const results = await classifyNotesBatch(batch, indexToNote)

    for (const [noteText, classification] of results) {
      NOTE_CACHE.set(noteText, {
        note: noteText,
        classification,
        confidence: 1.0,
        reasoning: `LLM classification: ${classification}`,
      })
    }

    const done = Math.min(i + NOTE_BATCH_SIZE, uncached.length)
    console.log(`[specialist] Classified ${done}/${uncached.length} notes (${totalLLMCalls} LLM calls total)`)
  }
}

// ============================================================================
// Orchestrator challenge endpoint
// ============================================================================

export const challengeDecision = async (
  fileId: string,
  data: SensorData,
  currentVerdict: 'anomaly' | 'ok',
  historicalContext: string,
): Promise<{ finalVerdict: 'anomaly' | 'ok'; reasoning: string }> => {
  const response = await openai.chat.completions.create({
    model: MODELS.specialist,
    messages: [
      {
        role: 'system',
        content: `You are a senior sensor readout specialist reviewing a decision about sensor file ${fileId}.
The orchestrator has challenged your decision because: ${historicalContext}
Review the data carefully and provide a final verdict.`,
      },
      {
        role: 'user',
        content: `Sensor data:\n${JSON.stringify(data, null, 2)}\n\nCurrent verdict: ${currentVerdict}\n\nIs this file anomalous? Reply with JSON: {"verdict": "anomaly" | "ok", "reasoning": "..."}`,
      },
    ],
    temperature: 0,
  })

  const text = response.choices[0]?.message?.content ?? '{}'
  const cleaned = text.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim()

  try {
    const result = JSON.parse(cleaned) as { verdict: 'anomaly' | 'ok'; reasoning: string }
    return { finalVerdict: result.verdict, reasoning: result.reasoning }
  } catch {
    return { finalVerdict: currentVerdict, reasoning: 'Parse error, keeping original verdict' }
  }
}

// ============================================================================
// Main analysis function — called by task agents
// ============================================================================

export const analyzeReadout = (
  fileId: string,
  data: SensorData,
): SpecialistAnalysis => {
  const check = runProgrammaticChecks(data)
  const noteVerdict = NOTE_CACHE.get(data.operator_notes)
  const noteClassification = noteVerdict?.classification ?? 'UNKNOWN'

  const reasons: AnomalyReason[] = [...check.reasons]
  const details: string[] = [...check.details]

  // Cross-check note with data
  if (!check.dataOk && noteClassification === 'OK') {
    if (!reasons.includes('note_says_ok_but_data_wrong')) {
      reasons.push('note_says_ok_but_data_wrong')
      details.push('Operator notes say OK but data has errors')
    }
  }

  if (check.dataOk && noteClassification === 'ERR') {
    reasons.push('note_says_error_but_data_ok')
    details.push('Operator notes report an error but data is within normal range')
  }

  const isAnomaly = reasons.length > 0

  return {
    fileId,
    isAnomaly,
    dataOk: check.dataOk,
    noteClassification,
    reasons,
    details: details.join('; '),
  }
}

export const getSpecialistStats = () => ({
  noteCacheSize: NOTE_CACHE.size,
  totalLLMCalls,
})
