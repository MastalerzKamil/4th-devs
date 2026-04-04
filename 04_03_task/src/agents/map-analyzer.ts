/**
 * MapAnalyzerAgent
 *
 * Responsibilities:
 *  1. Open the visual map preview with a headless browser (Playwright)
 *  2. Extract page HTML and run JS evaluation to get raw map data
 *  3. Also call getMap + help via the game API
 *  4. Use LLM to interpret everything and identify tall buildings / streets
 *  5. Write findings to SharedMemory
 */

import { chromium } from 'playwright'
import { chat, MODELS } from '../llm.js'
import { gameApi } from '../game.js'
import type { SharedMemory } from '../memory.js'

const MAP_PREVIEW_URL = 'https://hub.ag3nts.org/domatowo_preview'
const THINKING_BUDGET = 5000
const LABEL = '[MapAnalyzer]'

export async function runMapAnalyzer(memory: SharedMemory): Promise<string> {
  console.log(`${LABEL} Starting map analysis...`)

  // ── Step 1: Headless browser — scrape the visual map preview ──────────
  let previewContent = ''
  let screenshotBase64 = ''

  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(MAP_PREVIEW_URL, { waitUntil: 'networkidle', timeout: 20_000 })
    await page.waitForTimeout(1500)

    // Extract full page text and DOM data
    previewContent = await page.evaluate(() => {
      // Try to get any embedded JSON map data
      const scripts = Array.from(document.querySelectorAll('script'))
        .map((s) => s.textContent ?? '')
        .join('\n')

      const bodyText = document.body?.innerText ?? ''
      const tableData = Array.from(document.querySelectorAll('table, .map, .grid, canvas'))
        .map((el) => el.outerHTML)
        .join('\n')

      return JSON.stringify({
        title: document.title,
        bodyText: bodyText.slice(0, 3000),
        tableData: tableData.slice(0, 5000),
        scripts: scripts.slice(0, 3000),
      })
    })

    // Take a screenshot and encode as base64 for vision analysis
    const screenshotBuf = await page.screenshot({ type: 'png', fullPage: true })
    screenshotBase64 = screenshotBuf.toString('base64')

    console.log(`${LABEL} Browser extraction complete (${previewContent.length} chars)`)
  } catch (err) {
    console.warn(`${LABEL} Browser failed: ${err} — falling back to fetch`)
    try {
      const res = await fetch(MAP_PREVIEW_URL)
      previewContent = await res.text()
      previewContent = previewContent.slice(0, 6000)
    } catch {
      previewContent = '(unavailable)'
    }
  } finally {
    await browser?.close()
  }

  memory.previewContent = previewContent

  // ── Step 2: Game API — get help + raw map data ────────────────────────
  console.log(`${LABEL} Fetching help and map data from game API...`)

  const [helpRaw, mapRaw] = await Promise.all([
    gameApi({ action: 'help' }),
    gameApi({ action: 'getMap' }),
  ])

  memory.helpText = JSON.stringify(helpRaw)
  memory.rawMapData = JSON.stringify(mapRaw)

  // ── Step 3: LLM analysis ──────────────────────────────────────────────
  console.log(`${LABEL} Sending data to LLM for interpretation...`)

  // Remove stale variable (replaced below)

  const systemPrompt = `You are a military map analyst for Operation Domatowo.

CONTEXT: A wounded partisan is hiding in ONE OF THE TALLEST buildings in a bombed 11x11 city grid.
Columns are A–K, rows are 1–11. Coordinates look like "A1", "E6", "K11".

Use your extended thinking to carefully analyse the game API help, raw map data, and visual preview:
1. What does each map symbol mean? (list all symbols with descriptions)
2. Which symbol(s) represent TALL buildings? (the partisan is in the tallest)
3. Which symbol(s) represent streets/roads? (transporters can only travel on these)
4. List ALL coordinates of tall buildings ordered by height (tallest first)
5. List sample street coordinates near those tall buildings

Return ONLY valid JSON inside a \`\`\`json block:
{
  "symbolLegend": { "X": "street", "B": "tall building", ... },
  "tallBuildingSymbols": ["B4", "B3"],
  "streetSymbols": [".", "R"],
  "tallBuildings": ["E5", "C8", "G3"],
  "allBuildings": ["E5", "C8", "G3", "A2", ...],
  "streetSamples": ["E4", "C7", "G2", ...],
  "analysis": "Brief narrative description of the city layout and strategy"
}`

  const userText =
    `GAME API HELP:\n${memory.helpText.slice(0, 2000)}\n\n` +
    `RAW MAP DATA:\n${memory.rawMapData.slice(0, 4000)}\n\n` +
    `PAGE CONTENT EXTRACTED:\n${previewContent.slice(0, 2000)}`

  const userMsg = screenshotBase64
    ? [
        { type: 'text' as const, text: userText + '\n\nThe screenshot above shows the visual map.' },
        {
          type: 'image_url' as const,
          image_url: { url: `data:image/png;base64,${screenshotBase64}`, detail: 'high' as const },
        },
      ]
    : userText

  const response = await chat({
    model: MODELS.thinking,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg) },
    ],
    thinkingBudget: THINKING_BUDGET,
    maxTokens: THINKING_BUDGET + 2048,
  })

  if (response.thinking) {
    console.log(`${LABEL} 💭 Thinking: ${response.thinking.slice(0, 300)}…`)
  }

  const text = response.text ?? ''
  console.log(`${LABEL} LLM response: ${text.slice(0, 300)}...`)

  // Parse LLM response
  try {
    const md = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/)
    const raw = text.match(/(\{[\s\S]+\})/)
    const parsed = JSON.parse(md?.[1] ?? raw?.[1] ?? text) as {
      symbolLegend?: Record<string, string>
      tallBuildings?: string[]
      allBuildings?: string[]
      streetSamples?: string[]
      analysis?: string
    }

    memory.symbolLegend = parsed.symbolLegend ?? {}
    memory.tallBuildings = parsed.tallBuildings ?? []
    memory.allBuildings = parsed.allBuildings ?? []
    memory.streetSamples = parsed.streetSamples ?? []
    memory.mapAnalysis = parsed.analysis ?? ''
  } catch {
    // Fallback: extract any coordinate-like strings
    const coords = [...new Set(text.match(/[A-K]\d{1,2}/g) ?? [])]
    memory.tallBuildings = coords.slice(0, 10)
    memory.mapAnalysis = text.slice(0, 500)
  }

  const summary =
    `Found ${memory.tallBuildings.length} tall buildings: ${memory.tallBuildings.join(', ')}. ` +
    `Analysis: ${memory.mapAnalysis.slice(0, 200)}`

  console.log(`${LABEL} Complete. ${summary}`)
  return summary
}
