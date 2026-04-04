// @ts-expect-error — root config is untyped JS
import { AI_API_KEY as _key } from '../../config.js'

export const HUB_APIKEY = (process.env.HUB_APIKEY ?? '') as string
export const VERIFY_URL = 'https://hub.ag3nts.org/verify'
export const TASK = 'domatowo'
