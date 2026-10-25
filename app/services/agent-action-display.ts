import type { WorkspaceDocument } from '#shared/workspace'
import type { AgentAction } from './agent-plan-schema'
import { describeMiniMaxAgentAction } from './minimax-agent'

/** Presentation only. Never replace IDs in the executable plan. */
export function actionLabel(action: AgentAction, document: WorkspaceDocument) {
  if (action.type === 'renameQuarterGoal') {
    const goal = document.quarterGoals.find(g => g.id === action.targetId && !g.deletedAt)
    return `${goal?.quarter ?? '季度目标'}「${goal?.title ?? '目标不可用'}」→「${action.payload.title}」`
  }
  const base = describeMiniMaxAgentAction(action, new Map(document.tasks.map(t => [t.id, t.title])))
  if (action.type !== 'createProject' && action.type.endsWith('Project')) return `${base}「${document.projects.find(p=>p.id===action.targetId)?.name ?? '项目不可用'}」`
  if (action.type !== 'createMilestone' && action.type.endsWith('Milestone')) return `${base}「${document.milestones.find(m=>m.id===action.targetId)?.title ?? '里程碑不可用'}」`
  return base
}

export function actionChanges(action: AgentAction, document: WorkspaceDocument, actions: AgentAction[]) {
  const names: Record<string,string> = {title:'标题',name:'名称',color:'颜色',dueDate:'截止日期',dueTime:'时间',targetDate:'目标日期',startDate:'开始日期',status:'状态',priority:'优先级',importance:'重要性',description:'描述',completed:'完成',estimatedMinutes:'预计分钟',projectId:'项目',milestoneId:'里程碑',isFocus:'今日重点',progress:'进度',progressMode:'进度方式',reminderAt:'提醒时间',snoozedUntil:'稍后提醒',lastRemindedAt:'上次提醒'}
  const enums: Record<string,string> = {low:'低',medium:'中',high:'高',normal:'普通',important:'重要',inbox:'收集箱',todo:'待办',in_progress:'进行中',waiting:'等待中',done:'已完成',cancelled:'已取消',active:'进行中',completed:'已完成',archived:'已归档',manual:'手动',tasks:'按任务'}
  function reference(key:string,value:unknown) {
    const kind=key==='projectId'?'项目':'里程碑'
    if(value===null)return `无${kind}`
    if(typeof value==='object' && value && 'kind' in value && value.kind==='draft' && 'ref' in value){
      const draft=actions.find(a=>a.draftRef===value.ref && a.type===(key==='projectId'?'createProject':'createMilestone'))
      return draft && 'name' in draft.payload ? `${draft.payload.name}（本次新建）` : draft && 'title' in draft.payload ? `${draft.payload.title}（本次新建）` : `待新建${kind}`
    }
    const id=typeof value==='string'?value:typeof value==='object'&&value&&'id' in value?value.id:null
    return key==='projectId' ? document.projects.find(p=>p.id===id)?.name ?? '项目不可用' : document.milestones.find(m=>m.id===id)?.title ?? '里程碑不可用'
  }
  return Object.entries(action.payload).filter(([,v])=>v!==undefined).map(([key,value])=>{
    const text=key==='projectId'||key==='milestoneId'?reference(key,value):value===null?'清空':typeof value==='boolean'?value?'是':'否':['status','priority','importance','progressMode'].includes(key)?enums[String(value)]??String(value):typeof value==='object'?'已更新':String(value)
    return `${names[key]??key}：${text}`
  }).join('\n')
}
