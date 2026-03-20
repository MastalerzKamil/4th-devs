import { HUB_APIKEY } from './config.js'

const ZMAIL_URL = 'https://hub.ag3nts.org/api/zmail'
const VERIFY_URL = 'https://hub.ag3nts.org/verify'

export interface Tool {
  definition: {
    type: 'function'
    name: string
    description: string
    parameters: Record<string, unknown>
  }
  handler: (args: Record<string, unknown>) => Promise<string>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function zmailRequest(body: Record<string, unknown>): Promise<string> {
  // Retry with exponential backoff on throttle errors
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      const delay = attempt * 5000
      console.log(`  [throttle] waiting ${delay / 1000}s before retry ${attempt}...`)
      await sleep(delay)
    }
    const response = await fetch(ZMAIL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: HUB_APIKEY, ...body }),
    })
    const text = await response.text()
    if (!text.includes('-9999')) {
      return text
    }
    console.log(`  [throttle] rate limited, will retry...`)
  }
  return '{"error":"Rate limit exceeded after retries"}'
}

export const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'zmail_get_inbox',
      description: 'Get list of email threads in the inbox (no message body). Returns thread IDs and subjects.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Page number starting from 1' },
        },
      },
    },
    handler: async (args) => zmailRequest({ action: 'getInbox', page: args.page ?? 1 }),
  },
  {
    definition: {
      type: 'function',
      name: 'zmail_get_thread',
      description: 'Get list of rowID and messageID for messages in a thread. Use this to get message IDs before fetching full content.',
      parameters: {
        type: 'object',
        properties: {
          threadID: { type: 'number', description: 'Numeric thread identifier from getInbox' },
        },
        required: ['threadID'],
      },
    },
    handler: async (args) => zmailRequest({ action: 'getThread', threadID: args.threadID }),
  },
  {
    definition: {
      type: 'function',
      name: 'zmail_search',
      description: 'Search emails using Gmail-style operators: from:, to:, subject:, OR, AND. Returns messages with IDs. Example queries: "from:proton.me", "subject:password", "subject:SEC-".',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query using Gmail-style operators' },
          page: { type: 'number', description: 'Page number starting from 1' },
        },
        required: ['query'],
      },
    },
    handler: async (args) => zmailRequest({ action: 'search', query: args.query, page: args.page ?? 1 }),
  },
  {
    definition: {
      type: 'function',
      name: 'zmail_get_messages',
      description: 'Get full content (body) of one or more messages by their rowID or 32-char messageID. Always use this to read full email content before extracting information.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            description: 'A single message ID (numeric rowID or 32-char hex messageID) or an array of them',
            oneOf: [
              { type: 'string' },
              { type: 'number' },
              { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } },
            ],
          },
        },
        required: ['ids'],
      },
    },
    handler: async (args) => zmailRequest({ action: 'getMessages', ids: args.ids }),
  },
  {
    definition: {
      type: 'function',
      name: 'zmail_reset',
      description: 'Reset the API request counter if you get throttled. Call this if you see rate limit errors.',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => zmailRequest({ action: 'reset' }),
  },
  {
    definition: {
      type: 'function',
      name: 'submit_answer',
      description: 'Submit collected information to the hub for verification. Returns feedback on which values are correct, or a flag if all are correct.',
      parameters: {
        type: 'object',
        properties: {
          password: { type: 'string', description: 'Password found in the mailbox' },
          date: { type: 'string', description: 'Attack date in YYYY-MM-DD format' },
          confirmation_code: { type: 'string', description: 'Confirmation code: SEC- followed by exactly 32 alphanumeric characters (36 chars total)' },
        },
        required: ['password', 'date', 'confirmation_code'],
      },
    },
    handler: async (args) => {
      const response = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apikey: HUB_APIKEY,
          task: 'mailbox',
          answer: {
            password: args.password,
            date: args.date,
            confirmation_code: args.confirmation_code,
          },
        }),
      })
      return response.text()
    },
  },
]

export const findTool = (name: string): Tool | undefined =>
  tools.find((t) => t.definition.name === name)
