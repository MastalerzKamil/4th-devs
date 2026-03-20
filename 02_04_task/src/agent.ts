import type OpenAI from 'openai'
import { openai } from './config.js'
import { findTool, tools } from './tools.js'

const MAX_TURNS = 40
const MODEL = 'google/gemini-2.0-flash-001'
const TURN_DELAY_MS = 2000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const SYSTEM_PROMPT = `You are an intelligence agent searching a mailbox to find three specific pieces of information.

## Your mission
Find these three values:
1. **date** — When the security department plans to attack our power plant (format: YYYY-MM-DD)
2. **password** — A password to the employee system found somewhere in this mailbox
3. **confirmation_code** — A ticket confirmation code from the security department (format: SEC- followed by exactly 32 alphanumeric characters, 36 chars total)

## What you know
- Wiktor (a traitor from the resistance) sent at least one email from a proton.me domain to this mailbox
- The mailbox API supports Gmail-style search operators: from:, to:, subject:, OR, AND
- The mailbox is active — new emails may arrive during your search

## API workflow (IMPORTANT)
The mailbox works in steps — you CANNOT read email body directly from search/inbox results:
1. **zmail_search** or **zmail_get_inbox** → returns thread/message metadata (IDs only, no body)
2. **zmail_get_thread** (if you have a threadID from inbox) → returns list of messageIDs in that thread
3. **zmail_get_messages** with the messageID → returns the FULL email body

Always call zmail_get_messages with the ID to read the actual content.

## Search strategy
1. Search for Wiktor's emails: "from:proton.me"
2. For each result, call zmail_get_messages with the messageID to read the full body
3. Search for password emails: "subject:haslo" OR "subject:password" OR "subject:nowe haslo"
4. Search for SEC tickets: "subject:SEC-" or "SEC"
5. Browse inbox pages if needed, then use zmail_get_thread + zmail_get_messages to read content
6. Once you have all three values, submit with submit_answer
7. Use hub feedback to correct wrong values

## Important
- ALWAYS call zmail_get_messages with the messageID before extracting any information
- The confirmation_code is exactly 36 chars: "SEC-" + 32 alphanumeric chars
- Date must be YYYY-MM-DD format
- When hub returns FLG:... you are done — report the flag`

const truncate = (s: string, max = 150): string =>
  s.length > max ? s.slice(0, max) + '…' : s

export async function runMailboxAgent(): Promise<string> {
  const openaiTools = tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.definition.name,
      description: t.definition.description,
      parameters: t.definition.parameters,
    },
  }))

  const messages: OpenAI.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: 'Start searching the mailbox. Find: date of attack, password, and confirmation_code. Begin with zmail_help.',
    },
  ]

  let lastAssistantText = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (turn > 0) await sleep(TURN_DELAY_MS)
    console.log(`\n--- Turn ${turn + 1} ---`)

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: openaiTools,
    })

    const message = response.choices[0]?.message
    if (!message) return 'Error: No response from model'

    if (message.content) {
      lastAssistantText = message.content
      console.log(`[Agent] ${truncate(message.content)}`)
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    })

    // No tool calls = agent finished
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return lastAssistantText
    }

    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== 'function') continue

      const name = toolCall.function.name
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(toolCall.function.arguments || '{}')
      } catch {
        args = {}
      }

      console.log(`[Tool] ${name}(${truncate(JSON.stringify(args))})`)

      const tool = findTool(name)
      const result = tool ? await tool.handler(args) : `Unknown tool: ${name}`

      console.log(`[Result] ${truncate(result)}`)

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      })

      // If submit_answer returned a flag, log it prominently
      if (name === 'submit_answer' && result.includes('FLG:')) {
        console.log('\n🎯 FLAG FOUND:', result)
      }
    }
  }

  return `Agent exceeded maximum turns (${MAX_TURNS}). Last message: ${lastAssistantText}`
}
