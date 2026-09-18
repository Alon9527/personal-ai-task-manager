<script setup lang="ts">
import type { AgentAction } from '../../services/agent-plan-schema'
const props=defineProps<{action:AgentAction,inbox:boolean}>()
const plan=useAgentPlan();const workspace=useWorkspace()
const payload=computed(()=>props.action.payload as Record<string,unknown>)
const existing=computed(()=>('targetId' in props.action)?workspace.tasks.value.find(t=>t.id===props.action.targetId):null)
const projectId=computed(()=>{const value=payload.value.projectId;if(value&&typeof value==='object')return (value as {kind:string,id?:string}).kind==='existing'?(value as {id:string}).id:'__draft__';return value===undefined?existing.value?.projectId??'':String(value??'')})
function changeProject(event:Event){const id=(event.target as HTMLSelectElement).value;if(id==='__draft__')return;plan.updateAction(props.action.actionId,{payload:{projectId:props.action.type==='createTask'?(id?{kind:'existing',id}:null):(id||null),milestoneId:null}})}
function patch(field:string,event:Event){plan.updateAction(props.action.actionId,{payload:{[field]:(event.target as HTMLInputElement).value||null}})}
</script>
<template><div v-if="['createTask','updateTask'].includes(action.type)" class="suite-plan-fields"><template v-if="inbox"><label>重要性<select :value="payload.importance??existing?.importance??'normal'" aria-label="建议重要性" @change="patch('importance',$event)"><option value="normal">普通</option><option value="important">重要</option></select></label><label>建议加入项目<select :value="projectId" aria-label="建议所属项目" @change="changeProject"><option value="">无项目</option><option v-if="projectId==='__draft__'" value="__draft__">AI 建议的新项目</option><option v-for="project in workspace.projects.value" :key="project.id" :value="project.id">{{project.name}}</option></select></label></template><template v-else><label>日期<input type="date" :value="payload.dueDate??existing?.dueDate??''" aria-label="建议日期" @change="patch('dueDate',$event)"></label><label>时间<input type="time" :value="payload.dueTime??existing?.dueTime??''" aria-label="建议时间" @change="patch('dueTime',$event)"></label></template><p v-if="plan.error.value" role="alert">{{plan.error.value}}</p></div></template>
