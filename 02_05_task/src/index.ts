import { runOrchestrator } from './orchestrator.js'

async function main() {
  console.log('==========================================')
  console.log('  Drone Mission Control — Multi-Agent')
  console.log('==========================================\n')

  const result = await runOrchestrator()

  console.log('\n==========================================')
  console.log('  Mission Result')
  console.log('==========================================')
  console.log(result)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
