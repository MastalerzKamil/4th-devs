export const HUB_BASE       = 'https://hub.ag3nts.org';
export const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
export const TASK            = 'savethem';
export const MODEL           = 'anthropic/claude-sonnet-4-6';
export const MAX_STEPS       = 50;

export const API_KEY        = process.env.HUB_APIKEY;
export const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY)        { console.error('❌ Missing HUB_APIKEY env var');        process.exit(1); }
if (!OPENROUTER_KEY) { console.error('❌ Missing OPENROUTER_API_KEY env var'); process.exit(1); }
