import OpenAI from 'openai'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const SENSORS_DIR = resolve(__dirname, '../sensors')

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
export const HUB_APIKEY = process.env.HUB_APIKEY ?? ''
export const HUB_VERIFY_URL = 'https://hub.ag3nts.org/verify'
export const TASK_NAME = 'evaluation'

export const LANGFUSE_SECRET_KEY = process.env.LANGFUSE_SECRET_KEY ?? ''
export const LANGFUSE_PUBLIC_KEY = process.env.LANGFUSE_PUBLIC_KEY ?? ''
export const LANGFUSE_BASE_URL = process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com'

export const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: OPENROUTER_BASE_URL,
})

// Models — use cheaper models for bulk note classification
export const MODELS = {
  specialist: 'openai/gpt-4.1-mini',
  orchestrator: 'openai/gpt-4.1-mini',
}

// Parallel concurrency for task agents
export const TASK_AGENT_CONCURRENCY = 10
// Notes per LLM batch call
export const NOTE_BATCH_SIZE = 80
