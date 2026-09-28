import { readonly, ref } from 'vue'
import type { Ref } from 'vue'
import { ZodError } from 'zod'
import { workspaceDocumentSchema } from '#shared/workspace'
import type { WorkspaceDocument } from '#shared/workspace'
import { askAi, buildMiniMaxWorkspaceContext, generateAiBrief } from './minimax'
import type { MiniMaxAnswer } from './minimax'
import { aiModelTargetSchema } from './ai-model-target'
import type { AiModelTarget } from './ai-model-target'
import { agentPlanDraftSchema } from './agent-plan-schema'
import type { AgentPlanDraftV1 } from './agent-plan-schema'
import { validateAgentPlan } from './agent-plan-validation'

export function aiErrorMessage(cause: unknown, fallback = 'AI 操作失败，请重试') {
  if (cause instanceof ZodError) return 'AI 返回的计划格式无效，请重新生成。'
  if (cause instanceof Error && cause.message.trim()) return cause.message
  return typeof cause === 'string' && cause.trim() ? cause : fallback
}

export function isPendingAiPlan(draft: AgentPlanDraftV1 | null) {
  return !!draft && ['draft', 'conflicted', 'failed'].includes(draft.status)
}

export function buildAiPlanDraft(response: MiniMaxAnswer, question: string, document: WorkspaceDocument) {
  const initial = agentPlanDraftSchema.parse({
    version: 1, id: crypto.randomUUID(), question, model: response.model,
    createdAt: response.generatedAt, updatedAt: response.generatedAt, status: 'draft',
    actions: response.actions,
    validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] },
  })
  const validation = validateAgentPlan(initial, document)
  return agentPlanDraftSchema.parse({ ...initial, validation: { ...validation, issueCount: validation.issues.length } })
}

type PlanSink = {
  draft: Readonly<Ref<AgentPlanDraftV1 | null>>
  error: Readonly<Ref<string | null>>
  setDraft: (input: AgentPlanDraftV1) => boolean
}

/** Confirmation covers the complete pending draft, including edits within the same timestamp. */
export function saveAiProposal(sink: PlanSink, candidate: AgentPlanDraftV1, confirmedRevision?: string) {
  const draft = agentPlanDraftSchema.parse(candidate)
  const current = sink.draft.value
  if (isPendingAiPlan(current) && current!.id !== draft.id) {
    const revision = JSON.stringify(current)
    if (confirmedRevision !== revision) {
      return { status: 'replacement-required' as const, revision, changed: confirmedRevision !== undefined }
    }
  }
  if (!sink.setDraft(draft)) throw new Error(`无法保存 AI 计划草稿，请重试。 ${sink.error.value ?? '本机草稿存储不可用'}`)
  return { status: 'saved' as const }
}

export type AiProposal = {
  response: MiniMaxAnswer
  draft: AgentPlanDraftV1 | null
  error: string | null
}
type Outcome<T> = ({ status: 'ready', value: T } | { status: 'failed', error: string }) & { isCurrent: () => boolean }
type AskInput = { question: string, target: AiModelTarget, taskIds?: string[], images?: string[] }

/** Owns generation only. It cannot execute a plan or mutate a workspace. */
export function createAiGeneration(readDocument: () => Promise<WorkspaceDocument>) {
  const asking = ref(false)
  const generatingBrief = ref(false)
  const channels = { ask: { revision: 0, busy: asking }, brief: { revision: 0, busy: generatingBrief } }
  let disposed = false

  function invalidate() {
    for (const channel of Object.values(channels)) {
      channel.revision++
      channel.busy.value = false
    }
  }

  async function run<T>(name: keyof typeof channels, operation: (current: () => boolean) => Promise<T | null>): Promise<Outcome<T> | null> {
    const channel = channels[name]
    if (disposed || channel.busy.value) return null
    const revision = ++channel.revision
    const isCurrent = () => !disposed && revision === channel.revision
    channel.busy.value = true
    try {
      const value = await operation(isCurrent)
      return isCurrent() && value !== null ? { status: 'ready', value, isCurrent } : null
    }
    catch (cause) {
      return isCurrent() ? { status: 'failed', error: aiErrorMessage(cause), isCurrent } : null
    }
    finally {
      if (isCurrent()) channel.busy.value = false
    }
  }

  async function snapshot() {
    // Zod returns a detached plain-data snapshot, including when readDocument yields Vue proxies.
    return workspaceDocumentSchema.parse(await readDocument())
  }

  function proposal(response: MiniMaxAnswer, question: string, document: WorkspaceDocument): AiProposal {
    try {
      return { response, draft: response.actions.length ? buildAiPlanDraft(response, question, document) : null, error: null }
    }
    catch (cause) {
      return { response, draft: null, error: aiErrorMessage(cause) }
    }
  }

  function ask(input: AskInput) {
    return run('ask', async current => {
      const target = aiModelTargetSchema.parse(input.target)
      const question = input.question
      const ids = input.taskIds ? new Set(input.taskIds) : null
      const images = input.images ? [...input.images] : []
      const document = await snapshot()
      if (!current()) return null
      const context = buildMiniMaxWorkspaceContext(ids ? { ...document, tasks: document.tasks.filter(task => ids.has(task.id)) } : document)
      const response = await askAi(context, question, target, ...(images.length ? [images] : []))
      if (!current()) return null
      return proposal(response, question, document)
    })
  }

  function brief(targetInput: AiModelTarget) {
    return run('brief', async current => {
      const target = aiModelTargetSchema.parse(targetInput)
      const document = await snapshot()
      if (!current()) return null
      return generateAiBrief(buildMiniMaxWorkspaceContext(document), target)
    })
  }

  function fromAnswer(response: MiniMaxAnswer, question: string) {
    return run('ask', async current => {
      const document = await snapshot()
      return current() ? proposal(response, question, document) : null
    })
  }

  return {
    asking: readonly(asking), generatingBrief: readonly(generatingBrief),
    ask, brief, fromAnswer, invalidate,
    dispose() { disposed = true; invalidate() },
  }
}
