import type { ChatRequest } from './chat.schema.js'
import type { RuntimeContext, RunResult } from '../runtime/index.js'
import type { ProviderStreamEvent } from '../providers/index.js'
import type { Agent, AgentId, CallId, Item, UserId } from '../domain/index.js'
import { runAgent, runAgentStream, deliverResult as deliverAgentResult } from '../runtime/index.js'
import type { ToolResult } from '../tools/index.js'
import { filterResponseItems, toChatResponse, type ChatResponse } from './chat.response.js'
import { getAgentLastSequence, setupChatTurn, type SetupChatTurnResult } from './chat.turn.js'

export type { ChatResponse } from './chat.response.js'
export type PreparedChat = SetupChatTurnResult

export type ChatResult =
  | { ok: true; response: ChatResponse }
  | { ok: false; error: string }

function createExecution(agent: Agent, req: ChatRequest, userId: UserId, traceId: string) {
  return {
    traceId,
    rootAgentId: agent.rootAgentId,
    depth: agent.depth,
    userId,
    userInput: req.input,
    agentName: req.agent,
  }
}

async function loadVisibleItems(
  result: Extract<RunResult, { ok: true }>,
  ctx: RuntimeContext,
  agentId: AgentId,
  responseStartSequence: number,
): Promise<Item[]> {
  const items = result.status === 'completed'
    ? result.items
    : await ctx.repositories.items.listByAgent(agentId)

  return filterResponseItems(items, responseStartSequence)
}

export async function prepareChat(req: ChatRequest, ctx: RuntimeContext, userId: UserId) {
  return setupChatTurn(req, ctx, userId)
}

export async function executePreparedChat(
  prepared: PreparedChat,
  req: ChatRequest,
  ctx: RuntimeContext,
  userId: UserId,
): Promise<ChatResult> {
  const { agent, traceId, responseStartSequence } = prepared

  const session = req.sessionId
    ? await ctx.repositories.sessions.getById(req.sessionId) ?? await ctx.repositories.sessions.create(userId)
    : await ctx.repositories.sessions.create(userId)

  // When template specifies tools, use only those (no merge). Otherwise merge with registry.
  const tools = (agentConfig.tools && agentConfig.tools.length > 0)
    ? agentConfig.tools
    : mergeTools(ctx, agentConfig.tools)

  const agent = await ctx.repositories.agents.create({
    sessionId: session.id,
    task: agentConfig.task,
    config: { model: agentConfig.model, temperature: req.temperature, maxTokens: req.maxTokens, tools },
  })

  const input = typeof req.input === 'string'
    ? [{ type: 'message' as const, role: 'user' as const, content: req.input }]
    : req.input

  for (const item of input) {
    if (item.type === 'message') {
      await ctx.repositories.items.create(agent.id, {
        type: 'message',
        role: item.role,
        content: toContent(item.content),
      })
    }
  }

  return { agent, traceId }
}

export async function processChat(req: ChatRequest, ctx: RuntimeContext, userId: UserId): Promise<ChatResult> {
  const { agent, traceId } = await setupChatAgent(req, ctx, userId)

  const result = await runAgent(agent.id, ctx, {
    maxTurns: 10,
    execution: createExecution(agent, req, userId, traceId),
  })

  if (!result.ok) {
    return { ok: false, error: result.status === 'cancelled' ? 'Cancelled' : result.error }
  }

  const visibleItems = await loadVisibleItems(result, ctx, agent.id, responseStartSequence)

  return {
    ok: true,
    response: toChatResponse(
      result.agent,
      visibleItems,
      result.status,
      result.status === 'waiting' ? result.waitingFor : undefined,
    ),
  }
}

export async function processChat(req: ChatRequest, ctx: RuntimeContext, userId: UserId): Promise<ChatResult> {
  const setup = await prepareChat(req, ctx, userId)
  if (!setup.ok) {
    return { ok: false, error: setup.error }
  }

  return executePreparedChat(setup.data, req, ctx, userId)
}

export async function deliverResult(
  agentId: AgentId,
  callId: CallId,
  result: ToolResult,
  ctx: RuntimeContext
): Promise<ChatResult> {
  const responseStartSequence = await getAgentLastSequence(agentId, ctx)
  const runResult = await deliverAgentResult(agentId, callId, result, ctx)

  if (!runResult.ok) {
    return { ok: false, error: runResult.status === 'cancelled' ? 'Cancelled' : runResult.error }
  }

  const visibleItems = await loadVisibleItems(runResult, ctx, agentId, responseStartSequence)

  return {
    ok: true,
    response: toChatResponse(
      runResult.agent,
      visibleItems,
      runResult.status,
      runResult.status === 'waiting' ? runResult.waitingFor : undefined,
    ),
  }
}

export async function* streamPreparedChat(
  prepared: PreparedChat,
  req: ChatRequest,
  ctx: RuntimeContext,
  userId: UserId,
): AsyncIterable<ProviderStreamEvent> {
  const { agent, traceId } = prepared
  yield* runAgentStream(agent.id, ctx, {
    maxTurns: 10,
    execution: createExecution(agent, req, userId, traceId),
  })
}

export async function* processChatStream(req: ChatRequest, ctx: RuntimeContext, userId: UserId): AsyncIterable<ProviderStreamEvent> {
  const setup = await prepareChat(req, ctx, userId)
  if (!setup.ok) {
    yield { type: 'error', error: setup.error }
    return
  }

  yield* streamPreparedChat(setup.data, req, ctx, userId)
}
