/**
 * Windpower Task - Streaming Multi-Agent Solution v4
 *
 * Key learnings from v3:
 * - Weather takes ~24s. Unlock codes take ~2s. Turbinecheck ~12s.
 * - Unlock code results use signedParams.startDate/startHour for mapping.
 * - Need tight deadline management (39.5s budget out of 40s).
 * - Must queue turbinecheck BEFORE weather arrives to overlap with weather wait.
 *
 * Optimization: Queue turbinecheck early and consume it later. The first
 * turbinecheck result (from data collection) can be ignored. Queue a second
 * one right after config is submitted.
 *
 * Actually, let's try a different approach: queue turbinecheck at same time
 * as unlock codes to overlap.
 */

import { config as loadEnv } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
loadEnv({ path: resolve(__dirname, '../../.env') })

const API_URL = 'https://hub.ag3nts.org/verify'
const API_KEY = process.env.HUB_APIKEY!
const TASK = 'windpower'
const CUTOFF_WIND_MS = 14

interface ApiResponse {
  code: number
  message: string
  sourceFunction?: string
  signedParams?: { startDate: string; startHour: string; [k: string]: unknown }
  unlockCode?: string
  forecast?: ForecastEntry[]
  [key: string]: unknown
}

async function api(answer: Record<string, unknown>): Promise<ApiResponse> {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: API_KEY, task: TASK, answer }),
  })
  return res.json() as Promise<ApiResponse>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface ForecastEntry {
  timestamp: string
  windMs: number
}

interface ConfigPoint {
  datetime: string
  startDate: string
  startHour: string
  pitchAngle: number
  turbineMode: 'production' | 'idle'
  windMs: number
}

function parseTimestamp(ts: string): { startDate: string; startHour: string } {
  const [date, time] = ts.split(' ')
  return { startDate: date, startHour: time }
}

async function main() {
  const t0 = Date.now()
  const el = () => ((Date.now() - t0) / 1000).toFixed(1) + 's'

  console.log('=== Windpower v4 ===\n')

  // ── Phase 1: Start session ──
  console.log(`[${el()}] Starting session...`)
  await api({ action: 'start' })

  // ── Phase 2: Queue data requests in parallel ──
  console.log(`[${el()}] Queueing data requests...`)
  await Promise.all([
    api({ action: 'get', param: 'weather' }),
    api({ action: 'get', param: 'turbinecheck' }),
    api({ action: 'get', param: 'powerplantcheck' }),
  ])

  // ── Phase 3: Streaming poll loop ──
  let configPoints: ConfigPoint[] = []
  const unlockCodes = new Map<string, string>()
  let unlockCodesNeeded = 0
  let configSubmitted = false
  let postConfigTurbineQueued = false
  let postConfigTurbineDone = false
  let weatherProcessed = false
  let initialTurbineConsumed = false
  let initialPowerConsumed = false

  const DEADLINE = t0 + 39500

  while (Date.now() < DEADLINE) {
    const res = await api({ action: 'getResult' })

    if (!res.sourceFunction) {
      if (res.code === -805) {
        console.log(`[${el()}] SERVER TIMEOUT!`)
        break
      }
      await sleep(80)
      continue
    }

    const sf = res.sourceFunction

    // ── Initial data collection phase ──
    if (sf === 'powerplantcheck' && !initialPowerConsumed) {
      initialPowerConsumed = true
      console.log(`[${el()}] PowerPlant: deficit=${res.powerDeficitKw}kW`)
      continue
    }

    if (sf === 'turbinecheck' && !initialTurbineConsumed) {
      initialTurbineConsumed = true
      console.log(`[${el()}] Turbine: status=${res.status}, battery=${res.battery}`)
      continue
    }

    if (sf === 'weather' && !weatherProcessed) {
      weatherProcessed = true
      const forecast = (res.forecast || []) as ForecastEntry[]
      console.log(`[${el()}] Weather: ${forecast.length} entries`)

      const dangerous = forecast.filter((e) => e.windMs >= CUTOFF_WIND_MS)
      const safe = forecast
        .filter((e) => e.windMs >= 4 && e.windMs < CUTOFF_WIND_MS)
        .sort((a, b) => b.windMs - a.windMs)

      console.log(`[${el()}] Dangerous: ${dangerous.map((d) => `${d.timestamp}@${d.windMs}`).join(', ')}`)

      const best = safe[0]
      if (best) console.log(`[${el()}] Production: ${best.timestamp}@${best.windMs}`)

      // Build config
      configPoints = []
      for (const d of dangerous) {
        const { startDate, startHour } = parseTimestamp(d.timestamp)
        configPoints.push({
          datetime: d.timestamp,
          startDate,
          startHour,
          pitchAngle: 90,
          turbineMode: 'idle',
          windMs: d.windMs,
        })
      }
      if (best) {
        const { startDate, startHour } = parseTimestamp(best.timestamp)
        configPoints.push({
          datetime: best.timestamp,
          startDate,
          startHour,
          pitchAngle: 0,
          turbineMode: 'production',
          windMs: best.windMs,
        })
      }

      unlockCodesNeeded = configPoints.length
      console.log(`[${el()}] Queueing ${unlockCodesNeeded} unlock codes...`)

      // Queue all unlock codes in parallel
      await Promise.all(
        configPoints.map((p) =>
          api({
            action: 'unlockCodeGenerator',
            startDate: p.startDate,
            startHour: p.startHour,
            windMs: p.windMs,
            pitchAngle: p.pitchAngle,
          })
        )
      )
      console.log(`[${el()}] Unlock codes queued.`)
      continue
    }

    // ── Unlock code collection phase ──
    if (sf === 'unlockCodeGenerator') {
      const sp = res.signedParams
      if (sp && res.unlockCode) {
        const key = `${sp.startDate} ${sp.startHour}`
        unlockCodes.set(key, res.unlockCode)
        console.log(`[${el()}] Unlock: ${key} -> ${res.unlockCode.substring(0, 12)}...`)
      } else {
        console.log(`[${el()}] Unlock: unexpected format: ${JSON.stringify(res).substring(0, 200)}`)
      }

      // All codes collected? Submit config!
      if (unlockCodes.size >= unlockCodesNeeded && !configSubmitted) {
        configSubmitted = true

        const configs: Record<
          string,
          { pitchAngle: number; turbineMode: string; unlockCode: string }
        > = {}

        for (const p of configPoints) {
          const uc = unlockCodes.get(p.datetime)
          if (!uc) {
            console.warn(`  WARN: Missing unlock for ${p.datetime}`)
            continue
          }
          configs[p.datetime] = {
            pitchAngle: p.pitchAngle,
            turbineMode: p.turbineMode,
            unlockCode: uc,
          }
        }

        console.log(`[${el()}] Submitting ${Object.keys(configs).length} configs...`)
        const cfgRes = await api({ action: 'config', configs })
        console.log(`[${el()}] Config: ${cfgRes.message} (stored: ${cfgRes.storedPoints})`)

        // Queue final turbinecheck
        console.log(`[${el()}] Queueing final turbinecheck...`)
        postConfigTurbineQueued = true
        await api({ action: 'get', param: 'turbinecheck' })
      }
      continue
    }

    // ── Post-config turbinecheck result ──
    if (sf === 'turbinecheck' && postConfigTurbineQueued && !postConfigTurbineDone) {
      postConfigTurbineDone = true
      console.log(`[${el()}] Final turbinecheck: ${res.status}`)

      // DONE!
      console.log(`[${el()}] Sending done...`)
      const doneRes = await api({ action: 'done' })
      console.log(`\n  *** ${JSON.stringify(doneRes)} ***`)
      console.log(`\n=== Completed in ${el()} ===`)
      return
    }

    console.log(`[${el()}] Unhandled result: ${sf}`)
  }

  console.log(`[${el()}] DEADLINE REACHED!`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
