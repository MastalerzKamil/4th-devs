/**
 * Operation Domatowo — Multi-Agent Rescue Mission
 *
 * Agent hierarchy:
 *
 *   ┌──────────────────────────────────────────────┐
 *   │         Commander (LLM tool-use loop)         │
 *   │  Central brain — reads SharedMemory,          │
 *   │  dispatches to specialist agents,             │
 *   │  makes all strategic decisions.               │
 *   └──────┬──────────┬──────────┬──────────┬───────┘
 *          │          │          │          │
 *   ┌──────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌───▼──────┐
 *   │MapAnalyzer│ │  Logs  │ │Creator │ │Navigator  │
 *   │ Playwright│ │Analyzer│ │        │ │+Inspector │
 *   │  + LLM   │ │  +LLM  │ │  API   │ │ +LLM      │
 *   └───────────┘ └────────┘ └────────┘ └───────────┘
 *          │          │          │           │
 *          └──────────┴──────────┴───────────┘
 *                     SharedMemory
 *
 * Communication: all agents read from and write to the SharedMemory object.
 */

import { createSharedMemory } from './memory.js'
import { runCommander } from './commander.js'

async function main() {
  const t0 = Date.now()
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║       OPERATION DOMATOWO — RESCUE MISSION            ║')
  console.log('╚══════════════════════════════════════════════════════╝\n')

  // Initialise shared mission memory
  const memory = createSharedMemory()

  // Run the Commander — it orchestrates all specialist agents
  await runCommander(memory)

  console.log('\n╔══════════════════════════════════════════════════════╗')
  console.log('║                 MISSION REPORT                       ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log(`  Duration          : ${elapsed()}`)
  console.log(`  Action pts used   : ${300 - memory.actionPointsRemaining}`)
  console.log(`  Units created     : ${memory.units.length}`)
  console.log(`  Cells inspected   : ${memory.inspected.length}`)
  console.log(`  Target found      : ${memory.targetFound}`)
  console.log(`  Target location   : ${memory.targetLocation ?? 'unknown'}`)
  console.log(`  Mission complete  : ${memory.missionComplete}`)

  if (memory.flag) {
    console.log(`\n  *** FLAG: ${memory.flag} ***\n`)
  } else {
    console.log('\n  No flag received.')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
