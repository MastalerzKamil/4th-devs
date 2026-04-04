/**
 * Quick debug script to understand API response formats.
 * Just starts session, queues weather, dumps raw result.
 */

const API_URL = 'https://hub.ag3nts.org/verify'
const API_KEY = '5dea6038-4f1b-48a3-9d59-5b03ccf7f30c'
const TASK = 'windpower'

async function api(answer: Record<string, unknown>) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer }),
  })
  return res.json()
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function main() {
  const t0 = Date.now()
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'

  console.log(`[${elapsed()}] Starting...`)
  await api({ action: 'start' })

  console.log(`[${elapsed()}] Queueing all in parallel...`)
  await Promise.all([
    api({ action: 'get', param: 'weather' }),
    api({ action: 'get', param: 'turbinecheck' }),
    api({ action: 'get', param: 'powerplantcheck' }),
  ])

  console.log(`[${elapsed()}] Polling for results...`)
  const results: Record<string, unknown>[] = []

  while (results.length < 3 && Date.now() - t0 < 35000) {
    const res = (await api({ action: 'getResult' })) as Record<string, unknown>
    if (res.sourceFunction) {
      results.push(res)
      console.log(`[${elapsed()}] Got: ${res.sourceFunction}`)

      // Dump full response for weather
      if (res.sourceFunction === 'weather') {
        console.log('\n=== WEATHER RAW DATA ===')
        console.log(JSON.stringify(res, null, 2))
        console.log('=== END WEATHER ===\n')
      } else {
        console.log(JSON.stringify(res, null, 2))
      }
    } else {
      await sleep(100)
    }
  }

  console.log(`[${elapsed()}] Done. Got ${results.length} results.`)
}

main().catch(console.error)
