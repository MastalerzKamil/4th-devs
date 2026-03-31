import { HUB_APIKEY, HUB_VERIFY_URL, OKO_BASE_URL, OKO_LOGIN, OKO_PASSWORD, TASK_NAME } from './config.js'

export interface Tool {
  definition: {
    type: 'function'
    name: string
    description: string
    parameters: Record<string, unknown>
  }
  handler: (args: Record<string, unknown>) => Promise<string>
}

let sessionCookie = ''

async function loginToOko(): Promise<string> {
  const body = new URLSearchParams({
    action: 'login',
    login: OKO_LOGIN,
    password: OKO_PASSWORD,
    access_key: HUB_APIKEY,
  })

  const res = await fetch(`${OKO_BASE_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    redirect: 'manual',
  })

  const setCookieHeaders: string[] =
    typeof (res.headers as any).getSetCookie === 'function'
      ? (res.headers as any).getSetCookie()
      : [res.headers.get('set-cookie') ?? ''].filter(Boolean)

  // Use the last oko_session cookie (server sets two, the last is the valid one)
  let lastSession = ''
  for (const header of setCookieHeaders) {
    const match = header.match(/oko_session=([^;]+)/)
    if (match) lastSession = match[1]
  }

  if (lastSession) {
    sessionCookie = `oko_session=${lastSession}`
    return 'Login successful. Session established.'
  }

  return 'Login attempt completed but no session cookie was returned.'
}

async function okoFetch(path: string): Promise<string> {
  if (!sessionCookie) {
    await loginToOko()
  }

  const res = await fetch(`${OKO_BASE_URL}${path}`, {
    headers: { Cookie: sessionCookie },
  })
  const text = await res.text()

  if (text.includes('Logowanie operatora') || text.includes('login-form')) {
    await loginToOko()
    const res2 = await fetch(`${OKO_BASE_URL}${path}`, {
      headers: { Cookie: sessionCookie },
    })
    return res2.text()
  }

  return text
}

function parseEntries(html: string, page: string): Array<{ id: string; title: string }> {
  const entries: Array<{ id: string; title: string }> = []
  const seen = new Set<string>()

  const regex = new RegExp(
    `href="\\/${page}\\/([a-f0-9]{32})"[\\s\\S]*?<strong[^>]*>([\\s\\S]*?)<\\/strong>`,
    'g'
  )

  let match
  while ((match = regex.exec(html)) !== null) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      const title = match[2].replace(/<[^>]+>/g, '').trim()
      entries.push({ id, title })
    }
  }

  return entries
}

async function callHubApi(answer: Record<string, unknown>): Promise<string> {
  const res = await fetch(HUB_VERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apikey: HUB_APIKEY, task: TASK_NAME, answer }),
  })
  return res.text()
}

export const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'hub_api_help',
      description:
        'Get help documentation from the OKO editor API. Returns available commands and syntax.',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => callHubApi({ action: 'help' }),
  },
  {
    definition: {
      type: 'function',
      name: 'oko_list_entries',
      description:
        'List all entries (with IDs and titles) from a specific OKO page by scraping the web panel. Use this to find which entry ID corresponds to Skolwin, Komarowo, etc.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['incydenty', 'notatki', 'zadania'],
            description: 'Which page to list entries from',
          },
        },
        required: ['page'],
      },
    },
    handler: async (args) => {
      const page = args.page as string
      const html = await okoFetch(`/${page}`)
      const entries = parseEntries(html, page)
      if (entries.length === 0) {
        return `No entries found on ${page} page. Raw HTML snippet: ${html.slice(0, 500)}`
      }
      return JSON.stringify(entries, null, 2)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'oko_get_entry',
      description: 'Get the full content of a specific entry from the OKO system.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['incydenty', 'notatki', 'zadania'],
            description: 'Which page the entry is on',
          },
          id: { type: 'string', description: '32-character hex ID of the entry' },
        },
        required: ['page', 'id'],
      },
    },
    handler: async (args) => {
      const html = await okoFetch(`/${args.page}/${args.id}`)
      const bodyMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/)
      const content = bodyMatch ? bodyMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : html.slice(0, 1000)
      return content.slice(0, 2000)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'hub_api_update',
      description:
        'Update an existing entry in the OKO system via the hub API. Can update incydenty (incidents), notatki (notes), or zadania (tasks). The id must be an existing 32-char hex ID found on the target page.',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['incydenty', 'notatki', 'zadania'],
            description: 'Which page/section to update',
          },
          id: { type: 'string', description: '32-character hex ID of the entry to update' },
          title: { type: 'string', description: 'New title for the entry (optional but must be provided with content)' },
          content: { type: 'string', description: 'New content/description for the entry (optional but must be provided with title)' },
          done: {
            type: 'string',
            enum: ['YES', 'NO'],
            description: 'Mark task as done (only for zadania page)',
          },
        },
        required: ['page', 'id'],
      },
    },
    handler: async (args) => {
      const answer: Record<string, unknown> = {
        action: 'update',
        page: args.page,
        id: args.id,
      }
      if (args.title !== undefined) answer.title = args.title
      if (args.content !== undefined) answer.content = args.content
      if (args.done !== undefined) answer.done = args.done
      return callHubApi(answer)
    },
  },
  {
    definition: {
      type: 'function',
      name: 'hub_api_done',
      description:
        'Signal that all required edits are complete. Returns a flag if all conditions are satisfied, or an error message if something is still missing.',
      parameters: { type: 'object', properties: {} },
    },
    handler: async () => callHubApi({ action: 'done' }),
  },
]

export const findTool = (name: string): Tool | undefined =>
  tools.find((t) => t.definition.name === name)
