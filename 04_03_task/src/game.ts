import { HUB_APIKEY, VERIFY_URL, TASK } from './config.js'

export async function gameApi(answer: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: HUB_APIKEY, task: TASK, answer }),
  })
  return res.json()
}
