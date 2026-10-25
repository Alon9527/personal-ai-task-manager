import { computed, ref, shallowRef } from 'vue'
import { z } from 'zod'
import { agentPlanDraftSchema } from './agent-plan-schema'
import type { AgentPlanDraftV1 } from './agent-plan-schema'

export const CONVERSATION_KEY = 'focus-agent-conversation:v1'
const MAX_BYTES = 2 * 1024 * 1024
export const historySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().min(1).refine(text => Array.from(text).length <= 16000) }).strict()).max(20)
  .refine(items => items.reduce((n, m) => n + Array.from(m.text).length, 0) <= 16000, '历史上下文过长')
export const conversationRequestSchema = z.object({
  history: historySchema.default([]),
  pendingPlan: agentPlanDraftSchema.nullable().optional(),
  connectionGuard: z.discriminatedUnion('kind', [
    z.object({kind:z.literal('minimax'), revision:z.string().min(1).max(100), region:z.enum(['cn','global'])}).strict(),
    z.object({kind:z.literal('custom'),baseUrl:z.string().max(4000),modelId:z.string().max(200),credentialGeneration:z.number().int().nonnegative(),updatedAt:z.string().datetime()}).strict(),
  ]).optional(),
}).strict()
export type ConversationRequest = z.input<typeof conversationRequestSchema>
const briefDisplaySchema = z.object({
  sources: z.array(z.object({ taskId:z.string().max(100), title:z.string().max(1000), projectName:z.string().max(1000).nullable() }).strict()).max(80),
  suggestion: z.object({ title:z.string().min(1).max(1000), description:z.string().max(6000), rationale:z.string().max(3000), projectId:z.string().nullable(), priority:z.enum(['low','medium','high']).nullable(), dueDate:z.string().nullable(), dueTime:z.string().nullable(), isFocus:z.boolean() }).strict().nullable(),
}).strict()
const messageSchema = z.object({
  id: z.string().uuid(), role: z.enum(['user', 'assistant', 'system']), text: z.string().min(1).max(16000),
  at: z.string().datetime(), status: z.enum(['pending', 'ready', 'failed']).default('ready'), error: z.string().max(2000).optional(),
  model: z.string().max(160).optional(), sourceCount: z.number().int().nonnegative().optional(), tokens: z.number().int().nonnegative().optional(),
  imageCount: z.number().int().min(0).max(4).optional(),
  plan: agentPlanDraftSchema.optional(), planLabels: z.array(z.string().max(1500)).max(30).optional(), receiptPlanId: z.string().uuid().optional(),
  brief: briefDisplaySchema.optional(),
}).strict()
export type ConversationMessage = z.infer<typeof messageSchema>
const stateSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), targetKey: z.string().max(4000).nullable(),
  messages: z.array(messageSchema).max(500), activePlanId: z.string().uuid().nullable(),
  candidate: z.object({ draft: agentPlanDraftSchema, baseRevision: z.string().max(250000) }).nullable(),
}).strict()
type Disk = Pick<Storage, 'getItem' | 'setItem'>
const empty = () => ({ version: 1 as const, id: crypto.randomUUID(), targetKey: null, messages: [], activePlanId: null, candidate: null })

export function planContentRevision(plan: AgentPlanDraftV1) {
  return JSON.stringify([plan.id, plan.updatedAt, plan.actions])
}
export function isExplicitConfirmation(text: string) {
  return /^(确认|确定|执行|确认执行)[。.!！]?$/.test(text.trim())
}
export function conversationHistory(messages: readonly ConversationMessage[]) {
  const selected: { role: 'user' | 'assistant', text: string }[] = []
  let budget = 16000
  for (const message of [...messages].reverse()) {
    if (message.role === 'system' || message.status !== 'ready') continue
    const length = Array.from(message.text).length
    if (selected.length === 20 || length > budget) break
    selected.unshift({ role: message.role, text: message.text }); budget -= length
  }
  return selected
}

/** Text-only storage; never contains provider credentials or image data. */
export function createAgentConversation(disk?: Disk) {
  const state = shallowRef<z.infer<typeof stateSchema>>(empty())
  const error = ref('')
  const displayedRevision = ref<string | null>(null)
  let loaded = false, corrupt = false
  function encode(value: z.infer<typeof stateSchema>) {
    const parsed = stateSchema.parse(value)
    const json = JSON.stringify(parsed)
    if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('聊天记录达到容量上限，请先开启新对话。')
    return { parsed, json }
  }
  function save(next: z.infer<typeof stateSchema>) {
    if (corrupt) throw new Error('聊天记录损坏，原记录已保留，请先确认开启新对话。')
    const { parsed, json } = encode(next)
    state.value = parsed
    try { disk?.setItem(CONVERSATION_KEY, json); error.value = '' }
    catch { error.value = '聊天记录暂未保存到本机，关闭软件可能丢失；请检查存储空间。' }
  }
  function load() {
    if (loaded) return
    loaded = true
    try {
      const raw = disk?.getItem(CONVERSATION_KEY)
      if (!raw) return
      if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('oversize')
      state.value = stateSchema.parse(JSON.parse(raw))
      state.value.messages = state.value.messages.map(m => m.status === 'pending' ? { ...m, status: 'failed', error: '上次请求已中断，可以重试。' } : m)
    } catch { corrupt = true; error.value = '本机聊天记录损坏或无法读取，原记录未覆盖。' }
  }
  function append(role: ConversationMessage['role'], text: string, status: ConversationMessage['status'] = 'ready', imageCount = 0) {
    load()
    if (state.value.messages.length >= 500) throw new Error('聊天记录达到 500 条上限，请先开启新对话。')
    const message = messageSchema.parse({ id: crypto.randomUUID(), role, text, status, at: new Date().toISOString(), imageCount })
    save({ ...state.value, messages: [...state.value.messages, message] })
    return message.id
  }
  function needsConsent(target: string) { return state.value.messages.length > 0 && state.value.targetKey !== target }
  function allowTarget(target: string) { displayedRevision.value = null; save({ ...state.value, targetKey: target }) }
  function beginTurn(text: string, target: string, imageCount = 0) {
    load()
    if (needsConsent(target)) throw new Error('请先授权将当前对话历史发送给所选模型。')
    assertRoom()
    if (state.value.targetKey !== target) allowTarget(target)
    const last = state.value.messages.at(-1)
    if (last?.role === 'user' && last.status === 'failed' && last.text === text) {
      save({ ...state.value, messages: state.value.messages.map(m => m.id === last.id ? { ...m, status: 'pending', error: undefined, imageCount } : m) })
      return last.id
    }
    return append('user', text, 'pending', imageCount)
  }
  function assertRoom() {
    // Reserve both a user message and a maximum-sized response, not just the
    // outgoing text. No existing message is silently trimmed to make room.
    if (state.value.messages.length > 497 || new TextEncoder().encode(JSON.stringify(state.value)).length > MAX_BYTES - 200000) throw new Error('聊天记录接近容量上限，请先开启新对话。')
  }
  function failTurn(id: string, cause: string) {
    save({ ...state.value, messages: state.value.messages.map(m => m.id === id ? { ...m, status: 'failed', error: cause.slice(0, 2000) } : m) })
  }
  function finishTurn(id: string, text: string, metadata: { model?: string, sourceCount?: number, tokens?: number, plan?: AgentPlanDraftV1, planLabels?: string[], brief?: z.infer<typeof briefDisplaySchema> } = {}) {
    const assistant = messageSchema.parse({ id: crypto.randomUUID(), role: 'assistant', text, status: 'ready', at: new Date().toISOString(), ...metadata })
    save({ ...state.value, messages: [...state.value.messages.map(m => m.id === id ? { ...m, status: 'ready' as const, error: undefined } : m), assistant] })
  }
  function receipt(planId: string, text: string) {
    load()
    if (state.value.messages.some(m => m.receiptPlanId === planId)) return
    const message = messageSchema.parse({id:crypto.randomUUID(),role:'system',text,status:'ready',at:new Date().toISOString(),receiptPlanId:planId})
    save({...state.value,messages:[...state.value.messages,message]})
  }
  function associate(plan: AgentPlanDraftV1) { displayedRevision.value = null; save({ ...state.value, activePlanId: plan.id, candidate: null }) }
  function propose(draft: AgentPlanDraftV1, baseRevision: string) { displayedRevision.value = null; save({ ...state.value, candidate: { draft, baseRevision } }) }
  function keepOriginal() { displayedRevision.value = null; save({ ...state.value, candidate: null }) }
  function markDisplayed(plan: AgentPlanDraftV1) {
    if (!state.value.candidate && state.value.activePlanId === plan.id) displayedRevision.value = planContentRevision(plan)
  }
  function canConfirm(plan: AgentPlanDraftV1) {
    return !state.value.candidate && state.value.activePlanId === plan.id && displayedRevision.value === planContentRevision(plan)
  }
  function reset(beforeCommit?: () => void) {
    const next = empty(); const { json } = encode(next)
    const original = disk?.getItem(CONVERSATION_KEY) ?? encode(state.value).json
    // Preserve the original if an explicit reset cannot be persisted.
    disk?.setItem(CONVERSATION_KEY, json)
    try { beforeCommit?.() }
    catch (cause) {
      try { disk?.setItem(CONVERSATION_KEY, original) }
      catch { error.value = '新对话未完成，旧聊天仍在当前窗口；恢复本机存储失败，请勿关闭软件。' }
      throw cause
    }
    state.value = next; corrupt = false; error.value = ''; displayedRevision.value = null
  }
  return { state, messages: computed(() => state.value.messages), error, displayedRevision, load, append, beginTurn, finishTurn, failTurn, receipt, needsConsent, allowTarget, associate, propose, keepOriginal, markDisplayed, canConfirm, assertRoom, reset }
}
