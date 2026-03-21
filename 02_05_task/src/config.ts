import OpenAI from 'openai'
// @ts-expect-error — root config is untyped JS
import { AI_API_KEY, CHAT_API_BASE_URL, EXTRA_API_HEADERS } from '../../config.js'

export const openai = new OpenAI({
  apiKey: AI_API_KEY as string,
  baseURL: CHAT_API_BASE_URL as string,
  defaultHeaders: EXTRA_API_HEADERS as Record<string, string>,
})

export const HUB_APIKEY = (process.env.HUB_APIKEY ?? '') as string
export const HUB_VERIFY_URL = 'https://hub.ag3nts.org/verify'
export const MAP_URL = `https://hub.ag3nts.org/data/${process.env.HUB_APIKEY}/drone.png`
export const PLANT_ID = 'PWR6132PL'
export const TASK_NAME = 'drone'

export const MODELS = {
  orchestrator: 'openai/gpt-4o',
  vision: 'openai/gpt-4o',
  droneCommander: 'openai/gpt-4o',
}
