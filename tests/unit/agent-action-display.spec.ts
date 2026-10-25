import { expect, it } from 'vitest'
import { agentActionSchema } from '../../app/services/agent-plan-schema'
import { workspaceDocumentSchema } from '../../shared/workspace'
import { actionLabel, actionChanges } from '../../app/services/agent-action-display'
const id='10000000-0000-4000-8000-000000000001'
const document=workspaceDocumentSchema.parse({version:3,projects:[],tasks:[],milestones:[],quarterGoals:[]})
it('shows readable payload fields rather than raw reference IDs and objects',()=>{
  const a=agentActionSchema.parse({actionId:'task',type:'updateTask',reason:'安排工作',targetId:id,expectedUpdatedAt:'2026-10-26T00:00:00Z',payload:{title:'准备素材',projectId:id,priority:'high',isFocus:true}})
  const text=actionChanges(a,document,[])
  expect(text).toContain('标题：准备素材');expect(text).toContain('项目：项目不可用')
  expect(text).toContain('优先级：高');expect(text).not.toContain(id)
  expect(actionLabel(a,document)).not.toContain(id)
})
it('resolves draft project names in preview without exposing draft references',()=>{
  const project=agentActionSchema.parse({actionId:'project',draftRef:'internal-project',type:'createProject',reason:'新项目',payload:{name:'视频交付',description:'',color:'#7750ff',priority:null,status:'active',targetDate:null}})
  const a=agentActionSchema.parse({actionId:'task',type:'createTask',reason:'新任务',payload:{title:'准备素材',description:'',projectId:{kind:'draft',ref:'internal-project'},milestoneId:null,priority:null,dueDate:null,dueTime:null,isFocus:false}})
  expect(actionChanges(a,document,[project,a])).toContain('项目：视频交付（本次新建）')
  expect(actionChanges(a,document,[project,a])).not.toContain('internal-project')
})
