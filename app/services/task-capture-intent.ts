import type { WorkspaceDocument } from '#shared/workspace'
import type { AgentPlanDraftV1 } from './agent-plan-schema'

export const IMAGE_TASK_CAPTURE_REQUEST = '请把这些图片中能清楚识别的待办记录为新任务，不编造信息；没有任务就说明未识别到任务。已完成或匹配现有任务的内容只提出修改建议，等我确认。'

/** Only the current user's explicit recording request grants create-only authority. */
export function isTaskCaptureRequest(question: string) {
  const text = question.trim()
  // This UI-generated request authorizes new tasks only. Existing-record actions
  // are still rejected by canAutoCreateTasks; do not exempt arbitrary image prompts.
  if (text === IMAGE_TASK_CAPTURE_REQUEST) return true
  if (/[?？]|不要|别帮|别建|先别|暂不|如果|假如|是否|能不能|可不可以|能否|可否|什么|怎么|如何|为何|为什么|吗/.test(text)) return false
  if (/预览|草稿|草案|审阅|(?:先|仅|只).*(?:分析|讨论|建议|看看|看一下|看下)|(?:等|待).*确认|确认.*(?:后|再)|(?:先|请).*确认/.test(text)) return false
  return /^(?:请|麻烦)?\s*(?:(?:帮我|给我|替我)\s*)?(?:记下|记一下|记录|新建|新增|添加|创建)/.test(text)
    || /^请把(?:这些)?(?:图片|截图)中.*(?:记录为新任务|创建任务)/.test(text)
}

export function canAutoCreateTasks(question: string, draft: AgentPlanDraftV1, document: WorkspaceDocument) {
  if (!isTaskCaptureRequest(question) || !draft.actions.length) return false
  const titles = new Set<string>()
  return draft.actions.every(action => {
    if (action.type !== 'createTask' || !action.selected || action.dangerous) return false
    if (action.payload.projectId?.kind === 'draft' || action.payload.milestoneId?.kind === 'draft') return false
    if (action.payload.status && !['inbox', 'todo'].includes(action.payload.status)) return false
    const title = action.payload.title.trim().toLocaleLowerCase()
    if (!title || titles.has(title) || document.tasks.some(t => !t.deletedAt && t.title.trim().toLocaleLowerCase() === title)) return false
    titles.add(title)
    return true
  })
}
