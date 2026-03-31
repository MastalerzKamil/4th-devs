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
export const OKO_BASE_URL = 'https://oko.ag3nts.org'
export const OKO_LOGIN = 'Zofia'
export const OKO_PASSWORD = 'Zofia2026!'
export const TASK_NAME = 'okoeditor'
