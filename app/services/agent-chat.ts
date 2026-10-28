import { computed, ref } from 'vue'
import type { WorkspaceDocument } from '#shared/workspace'
import type { createAgentPlanController } from '../composables/useAgentPlan'
import { createAgentConversation, conversationHistory, isExplicitConfirmation, planContentRevision } from './agent-conversation'
import { aiErrorMessage, buildAiPlanDraft, createAiGeneration, isPendingAiPlan, saveAiProposal } from './ai-generation'
import type { AiModelTarget } from './ai-model-target'
import type { ConversationRequest } from './agent-conversation'
import type { AgentPlanDraftV1 } from './agent-plan-schema'
import { actionLabel } from './agent-action-display'
import { canAutoCreateTasks, isTaskCaptureRequest } from './task-capture-intent'

type Ask = ReturnType<typeof createAiGeneration>['ask']
type Send = Parameters<Ask>[0]
type Dependencies = {
  log: ReturnType<typeof createAgentConversation>
  plan: ReturnType<typeof createAgentPlanController>
  readDocument: () => Promise<WorkspaceDocument>
  ask: Ask
  brief?: ReturnType<typeof createAiGeneration>['brief']
  fingerprint: (target: AiModelTarget) => Promise<string>
  invalidate?: () => void
  connectionGuard?: (key: string) => ConversationRequest['connectionGuard']
}

/** Explicit capture can create tasks; all other writes require bound review confirmation. */
export function createAgentChat({ log, plan, readDocument, ask, brief, fingerprint, invalidate, connectionGuard }: Dependencies) {
  const busy = ref(false), error = ref('')
  const consent = ref<string | null>(null)
  const readyToDisplay = ref<string | null>(null)
  const goalIds = ref<string[]>([])
  const year = ref(new Date().getFullYear())
  const pending = computed(() => isPendingAiPlan(plan.draft.value) ? plan.draft.value : null)
  let epoch = 0
  let activeTurn: string | undefined
  let confirming = false
  let captureExecutionId: string | null = null
  function planLabels(draft: AgentPlanDraftV1, document: WorkspaceDocument) {
    return draft.actions.map(a => actionLabel(a, document))
  }
  plan.subscribeExecution?.({
    before() { log.load(); log.assertRoom() },
    after(draft, before, results) {
      try {
        const captured = draft.id === captureExecutionId
        log.receipt(draft.id, `${captured ? `已创建 ${results.length} 项任务。` : `已执行 ${results.length} 项操作。`}\n${planLabels({...draft,actions:draft.actions.filter(a=>a.selected)}, before).join('\n')}${captured ? '\n已保存。请一次检查以上任务，项目、日期等可以稍后补充；如需调整请告诉我。' : ''}`)
        log.displayedRevision.value = null
      } catch { log.error.value = '操作已执行，但执行记录暂未保存；请以任务或目标中的实际结果为准，不要重复提交。' }
    },
  })
  function load() { log.load(); plan.loadDraft() }
  function review() {
    load()
    if (busy.value || plan.executing.value || log.state.value.candidate || !pending.value) return
    log.associate(pending.value)
    log.markDisplayed(pending.value)
    error.value = ''
  }
  async function confirm() {
    load()
    if (busy.value || plan.executing.value) return false
    const draft = pending.value
    if (!draft || !log.canConfirm(draft)) {
      error.value = '请先查看并确认当前方案；恢复的方案、修改后的方案或候选方案不能直接用“确定”执行。'
      return false
    }
    busy.value = true; confirming = true; error.value = ''
    const revision = planContentRevision(draft)
    try {
      log.assertRoom()
      log.append('user', '确认执行当前方案')
      await readDocument()
      // A plan can change while the latest document is being read.
      if (!pending.value || !log.canConfirm(pending.value) || planContentRevision(pending.value) !== revision) throw new Error('方案已变化，请重新审阅。')
      const result = await plan.requestExecution(revision)
      log.displayedRevision.value = null
      if (['executed', 'already-applied', 'applied-cleanup-failed'].includes(result.status)) {
        if (result.status === 'already-applied') log.receipt(draft.id, '这份方案此前已执行，没有重复修改。')
        return true
      }
      error.value = result.status === 'confirmation-required' ? '涉及删除等操作，请进入“审阅计划”进行额外确认。'
        : plan.error.value || '方案存在版本冲突或无效操作，未写入；请审阅计划或重新生成。'
      log.append('system', error.value)
      return false
    } catch (cause) { error.value = aiErrorMessage(cause); return false }
    finally { busy.value = false; confirming = false }
  }
  async function send(input: Send) {
    load()
    if (busy.value || plan.executing.value) return false
    error.value = ''
    if (isExplicitConfirmation(input.question)) {
      if (pending.value || log.state.value.candidate) return confirm()
      if (!log.messages.value.length || log.messages.value.at(-1)?.role === 'system') {
        error.value = '当前没有新的待确认方案；已执行的操作不会重复执行。'
        return false
      }
      // Discussion-only confirmation is still a model request for a preview,
      // never permission to mutate a record.
    }
    busy.value = true
    const token = ++epoch, session = log.state.value.id
    let turn: string | undefined
    try {
      const key = await fingerprint(input.target)
      if (token !== epoch || session !== log.state.value.id) return false
      if (log.needsConsent(key)) { consent.value = key; error.value = '模型或连接已变化。是否允许将当前文字历史发送给这个模型？'; return false }
      consent.value = null
      const history = conversationHistory(log.messages.value)
      const previous = pending.value
      const baseRevision = previous ? JSON.stringify(previous) : null
      turn = log.beginTurn(input.question, key, input.images?.length ?? 0); activeTurn = turn
      const outcome = await ask({ ...input, goalIds: [...goalIds.value], year: year.value,
        ...(history.length || previous ? { conversation: { history, pendingPlan: previous, connectionGuard: connectionGuard?.(key) } } : {}),
      })
      if (token !== epoch || session !== log.state.value.id) return false
      if (await fingerprint(input.target) !== key) throw new Error('模型连接在回复期间已变化，本次回复未采用，请重新发送。')
      if (token !== epoch || session !== log.state.value.id) return false
      if (!outcome?.isCurrent()) throw new Error('请求已中断，请重试。')
      if (outcome.status === 'failed') throw new Error(outcome.error)
      const proposal = outcome.value
      const document = proposal.draft ? proposal.sourceDocument ?? await readDocument() : null
      if (token !== epoch || session !== log.state.value.id) return false
      const answer = !proposal.error && input.images?.length && isTaskCaptureRequest(input.question) && !proposal.response.actions.length
        ? `未识别到可新建的任务。${proposal.response.answer}` : proposal.response.answer
      log.finishTurn(turn, answer, { model: proposal.response.model, sourceCount: proposal.response.sources?.length ?? 0, tokens: proposal.response.usage?.totalTokens,
        ...(proposal.draft && document ? {plan:proposal.draft,planLabels:planLabels(proposal.draft,document)} : {}),
      })
      turn = undefined
      if (proposal.error) { error.value = proposal.error; return false }
      if (proposal.draft) {
        if (baseRevision !== (pending.value ? JSON.stringify(pending.value) : null)) throw new Error('回复期间方案已变化；本次回复未替换当前方案，请重新提问。')
        if (previous) log.propose(proposal.draft, baseRevision!)
        else {
          try { saveAiProposal(plan, proposal.draft) }
          catch (cause) { log.propose(proposal.draft, 'null'); throw cause }
          log.associate(plan.draft.value!)
          readyToDisplay.value = planContentRevision(plan.draft.value!)
          if (!log.state.value.candidate && document && canAutoCreateTasks(input.question, proposal.draft, document)) {
            // The current create request, not a model sentence or historical "OK", authorizes this exact plan.
            captureExecutionId = plan.draft.value!.id
            confirming = true
            try {
              const result = await plan.requestExecution(planContentRevision(plan.draft.value!))
              if (!['executed', 'already-applied', 'applied-cleanup-failed'].includes(result.status)) {
                error.value = plan.error.value || '任务未保存，请检查计划后重试。'
                log.append('system', error.value)
                return false
              }
              readyToDisplay.value = null
            } finally { captureExecutionId = null; confirming = false }
          }
        }
      }
      return true
    } catch (cause) {
      if (token !== epoch || session !== log.state.value.id) return false
      error.value = aiErrorMessage(cause)
      if (turn && session === log.state.value.id) {
        try { log.failTurn(turn, error.value) } catch { /* Original history remains intact. */ }
      }
      return false
    } finally { if (token === epoch) { busy.value = false; activeTurn = undefined } }
  }
  async function generateBrief(target: AiModelTarget) {
    load()
    if (!brief || busy.value || plan.executing.value) return false
    busy.value = true; error.value = ''
    const token = ++epoch, session = log.state.value.id
    let turn: string | undefined
    try {
      const key = await fingerprint(target)
      if (token !== epoch || session !== log.state.value.id) return false
      if (log.needsConsent(key)) { consent.value = key; error.value = '模型或连接已变化，请先确认是否继续使用这个模型。'; return false }
      consent.value = null
      turn = log.beginTurn('生成今日简报', key); activeTurn = turn
      const outcome = await brief(target)
      if (token !== epoch || session !== log.state.value.id) return false
      if (await fingerprint(target) !== key) throw new Error('模型连接在回复期间已变化，本次简报未采用，请重试。')
      if (token !== epoch || session !== log.state.value.id) return false
      if (!outcome?.isCurrent()) throw new Error('请求已中断，请重试。')
      if (outcome.status === 'failed') throw new Error(outcome.error)
      const b = outcome.value
      log.finishTurn(turn, ['今日简报', b.focus, ...b.progress.map(p => p.text), ...(b.suggestion ? [`建议：${b.suggestion.title}`, b.suggestion.rationale] : [])].join('\n\n'),
        {model:b.model,sourceCount:b.sources.length,tokens:b.usage?.totalTokens,brief:{sources:b.sources,suggestion:b.suggestion}})
      return true
    } catch (cause) {
      if (token !== epoch || session !== log.state.value.id) return false
      error.value = aiErrorMessage(cause)
      if (turn && session === log.state.value.id) { try { log.failTurn(turn,error.value) } catch { /* Preserve history. */ } }
      return false
    } finally { if(token===epoch){busy.value=false;activeTurn=undefined} }
  }
  function isBriefSuggestionUsed(messageId: string) {
    const actionId = `brief:${messageId}`
    const contains = (draft: AgentPlanDraftV1 | null | undefined) => Boolean(draft?.actions.some(a => a.actionId === actionId))
    if (contains(pending.value) || contains(log.state.value.candidate?.draft)) return true
    if (plan.draft.value?.status === 'applied' && contains(plan.draft.value)) return true
    const receipts = new Set(log.messages.value.map(m=>m.receiptPlanId).filter(Boolean))
    return log.messages.value.some(m=>m.plan && receipts.has(m.plan.id) && contains(m.plan))
  }
  async function suggestBrief(messageId: string) {
    load()
    if (busy.value || plan.executing.value) return false
    const message = log.messages.value.find(m=>m.id===messageId)
    const suggestion = message?.brief?.suggestion
    if (!suggestion || !message) return false
    const actionId = `brief:${messageId}`
    if (isBriefSuggestionUsed(messageId)) { error.value='这条建议已有待处理或已执行方案，不能重复生成。'; return false }
    busy.value=true; error.value=''
    const token=++epoch, session=log.state.value.id
    const previous=pending.value, baseRevision=previous ? JSON.stringify(previous) : 'null'
    try {
      const document=await readDocument()
      if(token!==epoch || session!==log.state.value.id) return false
      if(JSON.stringify(pending.value)!==baseRevision) throw new Error('计划已变化，请重新审阅。')
      const question=`采用今日简报建议：${suggestion.title}`
      const draft=buildAiPlanDraft({ answer:message.text,model:message.model ?? 'AI',generatedAt:new Date().toISOString(),usage:null,sources:message.brief!.sources,
        actions:[{actionId,type:'createTask',reason:suggestion.rationale,selected:true,dangerous:false,draftRef:'task:daily-brief-suggestion',payload:{title:suggestion.title,description:suggestion.description,projectId:suggestion.projectId ? {kind:'existing',id:suggestion.projectId} : null,milestoneId:null,priority:suggestion.priority,dueDate:suggestion.dueDate,dueTime:suggestion.dueTime,isFocus:suggestion.isFocus}}],
      },question,document)
      log.assertRoom()
      const turn=log.append('user',question)
      log.finishTurn(turn,'已生成建议方案，请审阅后确认。',{plan:draft,planLabels:planLabels(draft,document)})
      if(previous) log.propose(draft,baseRevision)
      else {
        try { saveAiProposal(plan,draft) } catch(cause) { log.propose(draft,'null'); throw cause }
        log.associate(plan.draft.value!); readyToDisplay.value=planContentRevision(plan.draft.value!)
      }
      return true
    } catch(cause) { if(token===epoch && session===log.state.value.id)error.value=aiErrorMessage(cause);return false }
    finally { if(token===epoch) busy.value=false }
  }
  function cancel() {
    if (plan.executing.value || confirming) return
    epoch++; invalidate?.(); busy.value = false; readyToDisplay.value = null; log.displayedRevision.value = null
    if (activeTurn) { try { log.failTurn(activeTurn, '页面或模型已切换，请重新发送。') } catch { /* Preserve original. */ } }
    activeTurn = undefined
  }
  function allowHistory() { if (consent.value) { log.allowTarget(consent.value); consent.value = null; error.value = '已允许。请再次发送问题。' } }
  function adopt() {
    if (busy.value || plan.executing.value) return
    const candidate = log.state.value.candidate
    if (!candidate) return
    try {
      if (JSON.stringify(pending.value) !== candidate.baseRevision) throw new Error('计划已变化，不能覆盖；请保留原方案后重新提问。')
      const result = saveAiProposal(plan, candidate.draft, candidate.baseRevision)
      if (result.status !== 'saved') throw new Error('原方案已变化，不能覆盖；请保留原方案后重新提问。')
      log.associate(plan.draft.value!)
      readyToDisplay.value = planContentRevision(plan.draft.value!)
      error.value = ''
    } catch (cause) { error.value = aiErrorMessage(cause) }
  }
  function keep() { if (!busy.value && !plan.executing.value) { log.keepOriginal(); error.value = '' } }
  function reset(discardPlan: boolean) {
    if (busy.value || plan.executing.value) return
    try {
      if (pending.value && !discardPlan) throw new Error('当前仍有待确认方案，请先明确是否放弃。')
      log.reset(() => {
        if (pending.value && !plan.discardDraft()) throw new Error(plan.error.value || '无法放弃方案。')
      })
      epoch++; goalIds.value = []; consent.value = null; error.value = ''
    } catch (cause) { error.value = aiErrorMessage(cause) }
  }
  function displayed() {
    if (pending.value && readyToDisplay.value === planContentRevision(pending.value)) log.markDisplayed(pending.value)
    readyToDisplay.value = null
  }
  return { log, plan, pending, busy, error, consent, readyToDisplay, goalIds, year, load, send, generateBrief, suggestBrief, isBriefSuggestionUsed, confirm, review, displayed, allowHistory, adopt, keep, reset, cancel }
}
