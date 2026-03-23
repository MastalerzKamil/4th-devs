import { runOrchestrator } from './agents/orchestrator.js'

// ============================================================================
// Entry point
// ============================================================================

const main = async (): Promise<void> => {
  try {
    const result = await runOrchestrator()

    process.exit(0)
  } catch (error) {
    console.error('[main] Fatal error:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
