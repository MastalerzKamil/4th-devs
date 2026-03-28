import { runAgent } from './agent.js';

runAgent().catch(err => {
  console.error('💥 Fatal error:', err);
  process.exit(1);
});
