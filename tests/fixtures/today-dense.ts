import type { WorkspaceDocument } from '../../shared/workspace'

export function createDenseToday(): WorkspaceDocument {
  const stamp = '2026-10-28T00:00:00.000Z'
  const ownerId = '00000000-0000-4000-8000-000000000001'
  const projectId = '10000000-0000-4000-8000-000000000001'
  const names = ['碳棉三维视频', '收纳盒视频', '垃圾袋第二个视频', '展厅摆放', '9185尿布桶视频方案', '9506三维视频', '9306三维视频', '6577三维视频', '环保视频修改', '周年产品回顾视频']
  return {
    version: 3,
    projects: [{ id:projectId, ownerId, name:'三维视频', color:'#8b5cf6', description:'', priority:null, status:'active', targetDate:null, sortOrder:0, createdAt:stamp, updatedAt:stamp, deletedAt:null }],
    milestones: [], quarterGoals: [],
    tasks: Array.from({ length:53 }, (_, i) => ({
      id:`20000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`, ownerId,
      title:i===0?'完成产品视频方案':i<24?(names[i-1] ?? `产品视频交付 ${i}`):`已交付视频 ${i-23}`,
      description:'', projectId:i%3===0?null:projectId, milestoneId:null,
      priority: i===0?'high':(['low','medium','high',null] as const)[i%4]!,
      importance:'normal', status:i>=24?'done':'todo', isFocus:i===0,
      dueDate:i%4===0?'2026-10-30':null, dueTime:null, startDate:null, completionDate:null,
      estimatedMinutes:null, reminderAt:null, snoozedUntil:null, lastRemindedAt:null, attachments:[],
      sortOrder:i, completedAt:i>=24?stamp:null, createdAt:stamp, updatedAt:stamp, deletedAt:null,
    })),
  }
}
