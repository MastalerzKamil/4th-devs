import { runMailboxAgent } from './agent.js'

async function main() {
  console.log('========================================')
  console.log('  Mailbox Intelligence Agent')
  console.log('========================================\n')

  const result = await runMailboxAgent()

  console.log('\n========================================')
  console.log('  Final Result')
  console.log('========================================\n')
  console.log(result)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
