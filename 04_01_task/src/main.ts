import { runAgent } from './agent.js'

async function main() {
  console.log('========================================')
  console.log('  OKO Editor Agent')
  console.log('========================================\n')

  const result = await runAgent()

  console.log('\n========================================')
  console.log('  Final Result')
  console.log('========================================\n')
  console.log(result)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
