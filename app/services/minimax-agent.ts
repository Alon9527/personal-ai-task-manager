import type { MiniMaxAgentAction } from './minimax'
import type { CreateTaskInput, UpdateTaskInput } from '../data/workspace-gateway'

type AgentWorkspace = {
  createTask: (input: CreateTaskInput) => Promise<unknown>
  updateTask: (id: string, input: UpdateTaskInput) => Promise<unknown>
  setTaskCompleted: (id: string, completed: boolean) => Promise<unknown>
  deleteTask: (id: string) => Promise<unknown>
}

export class MiniMaxAgentExecutionError extends Error {
  constructor(
    message: string,
    public readonly completed: number,
    public readonly total: number,
  ) {
    super(message)
    this.name = 'MiniMaxAgentExecutionError'
  }
}

export async function applyMiniMaxAgentActions(actions: MiniMaxAgentAction[], workspace: AgentWorkspace) {
  const selectedActions = actions.filter(action => action.selected)
  if (selectedActions.length > 1) {
    throw new MiniMaxAgentExecutionError(
      '请在 Agent 计划确认中心审阅多项操作',
      0,
      selectedActions.length,
    )
  }
  const incompatible = selectedActions.find(action => (
    action.dangerous
    || !['createTask', 'updateTask', 'setTaskCompleted'].includes(action.type)
    || (action.type === 'createTask' && [action.payload.projectId, action.payload.milestoneId]
      .some(reference => reference?.kind === 'draft'))
  ))
  if (incompatible) {
    throw new MiniMaxAgentExecutionError(
      '请在 Agent 计划确认中心审阅项目和里程碑操作',
      0,
      selectedActions.length,
    )
  }

  let completed = 0
  for (const action of selectedActions) {
    try {
      if (action.type === 'createTask') {
        await workspace.createTask({
          ...action.payload,
          projectId: existingReferenceId(action.payload.projectId),
          milestoneId: existingReferenceId(action.payload.milestoneId),
        })
      }
      else if (action.type === 'updateTask') await workspace.updateTask(action.targetId, action.payload)
      else if (action.type === 'setTaskCompleted') await workspace.setTaskCompleted(action.targetId, action.payload.completed)
      completed += 1
    }
    catch (cause) {
      throw new MiniMaxAgentExecutionError(
        cause instanceof Error ? cause.message : '任务操作失败',
        completed,
        selectedActions.length,
      )
    }
  }
  return { completed, total: selectedActions.length }
}

export function describeMiniMaxAgentAction(action: MiniMaxAgentAction, taskTitles: ReadonlyMap<string, string>) {
  if (action.type === 'createProject') return `创建项目「${action.payload.name}」`
  if (action.type === 'createMilestone') return `创建里程碑「${action.payload.title}」`
  if (action.type === 'createTask') return `创建任务「${action.payload.title}」`
  if (action.type === 'updateProject') return '更新项目'
  if (action.type === 'setProjectCompleted') return `${action.payload.completed ? '完成' : '恢复'}项目`
  if (action.type === 'deleteProject') return '移入回收站：项目'
  if (action.type === 'updateMilestone') return '更新里程碑'
  if (action.type === 'setMilestoneCompleted') return `${action.payload.completed ? '完成' : '恢复'}里程碑`
  if (action.type === 'deleteMilestone') return '移入回收站：里程碑'
  const title = taskTitles.get(action.targetId) ?? '未命名任务'
  if (action.type === 'updateTask') return `更新任务「${title}」`
  if (action.type === 'setTaskCompleted') return `${action.payload.completed ? '完成' : '恢复'}任务「${title}」`
  return `移入回收站：任务「${title}」`
}

function existingReferenceId(reference: Extract<MiniMaxAgentAction, { type: 'createTask' }>['payload']['projectId']) {
  return reference?.kind === 'existing' ? reference.id : null
}
