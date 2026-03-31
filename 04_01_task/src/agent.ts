import type OpenAI from 'openai'
import { openai } from './config.js'
import { findTool, tools } from './tools.js'

const MODEL = 'google/gemini-2.0-flash-001'
const MAX_TURNS = 40

const SYSTEM_PROMPT = `You are an agent tasked with making specific changes to the OKO (Centrum Operacyjne OKO) surveillance system via its API.

## Your mission — complete ALL four tasks:

### Task 1: Change the Skolwin incident classification
- In the 'incydenty' list, find the incident about city Skolwin
- It is currently classified as MOVE03 (vehicles + humans)
- Change it to MOVE04 (animals) by updating its title prefix from MOVE03 to MOVE04
- Also update the content to describe the movement as animal activity (e.g., beavers/bobry)

### Task 2: Mark the Skolwin task as done
- In the 'zadania' list, find the task related to city Skolwin
- Mark it as done (done: "YES")
- Update its content to say that animals (e.g., beavers/bobry) were seen there

### Task 3: Add a Komarowo incident
- A new report about detection of human movement (MOVE01) near the uninhabited city of Komarowo must appear in the 'incydenty' list
- First try: call hub_api_update on 'incydenty' with a new randomly generated 32-char hex ID and title "MOVE01 Wykryto ruch ludzi w okolicach Komarowo"
- If that fails with "not found", fall back: pick an existing incident that is LEAST related to the story (e.g., the last/most generic one that is NOT the Skolwin entry) and update its title and content to be about Komarowo MOVE01
- Title must start with: MOVE01

### Task 4: Call done
- After completing all three tasks above, call hub_api_done to get the verification flag

## Incident code reference (from notatki):
- MOVE01 = ruch człowieka (human movement)
- MOVE02 = pojazd (vehicle)
- MOVE03 = pojazd + człowiek (vehicle + human)
- MOVE04 = zwierzęta (animals)

## Workflow:
1. Call hub_api_help to understand the API
2. Call oko_list_entries for 'incydenty' to find IDs and titles
3. Call oko_list_entries for 'zadania' to find the Skolwin task ID
4. Execute updates via hub_api_update
5. Call hub_api_done

Keep responses concise. Report the flag when found.`

const truncate = (s: string, max = 200) =>
  s.length > max ? s.slice(0, max) + '…' : s

export async function runAgent(): Promise<string> {
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
      content: 'Complete all required OKO editor tasks and return the flag.',
    },
  ]

  let lastText = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`\n--- Turn ${turn + 1} ---`)

    const response = await openai.chat.completions.create({
      model: MODEL,
      messages,
      tools: openaiTools,
    })

    const message = response.choices[0]?.message
    if (!message) return 'Error: No response from model'

    if (message.content) {
      lastText = message.content
      console.log(`[Agent] ${truncate(message.content)}`)
    }

    messages.push({
      role: 'assistant',
      content: message.content ?? null,
      tool_calls: message.tool_calls,
    })

    if (!message.tool_calls?.length) {
      return lastText
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

      if (result.includes('FLG:')) {
        console.log('\n*** FLAG FOUND:', result, '***')
      }
    }
  }

  return `Agent exceeded ${MAX_TURNS} turns. Last message: ${lastText}`
}
