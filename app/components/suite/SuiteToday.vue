<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { deriveProjectProgress, isTaskActive } from '#shared/workspace'
import { dateKey } from '../../utils/calendar-view'
import SuiteHeader from './SuiteHeader.vue'
import SuiteTaskRow from './SuiteTaskRow.vue'
import TodayOverview from '../dashboard/TodayOverview.vue'
import UpcomingMilestones from '../dashboard/UpcomingMilestones.vue'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import { filterAndSortTasks, formatAgendaDate } from '../../utils/today-view'
import type { TodayPriorityFilter, TodayStatusFilter, TodaySort } from '../../utils/today-view'
const workspace=useWorkspace();const ui=useWorkspaceUi();const today=dateKey(new Date())
const search=ref('');const priority=ref<TodayPriorityFilter>('all');const status=ref<TodayStatusFilter>('all');const sort=ref<TodaySort>('manual')
const showFilters=ref(false);const view=ref<'list'|'agenda'>('list');const quickTask=ref('');const adding=ref(false);const error=ref('')
const collapsed=ref({next:false,other:false,completed:false})
const filtered=computed(()=>filterAndSortTasks(workspace.tasks.value,{query:search.value,priority:priority.value,status:status.value,projectId:null},sort.value))
const filteredView=computed(()=>Boolean(search.value.trim())||priority.value!=='all'||status.value!=='all')
const active=computed(()=>filtered.value.filter(isTaskActive))
const focus=computed(()=>[...active.value].filter(t=>t.isFocus||t.importance==='important'||t.status==='in_progress').sort((a,b)=>Number(b.status==='in_progress')-Number(a.status==='in_progress')).slice(0,3))
const others=computed(()=>active.value.filter(t=>!focus.value.some(f=>f.id===t.id)))
const completed=computed(()=>filtered.value.filter(t=>!isTaskActive(t)))
const sections=computed(()=>[{key:'next' as const,title:'今日重点',tasks:focus.value},{key:'other' as const,title:'其他待办',tasks:others.value},{key:'completed' as const,title:'已完成',tasks:completed.value}])
const agenda=computed(()=>{const dates=[...new Set(filtered.value.map(t=>t.dueDate??''))].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));return dates.map(date=>({date,label:formatAgendaDate(date||null,today),tasks:filtered.value.filter(t=>(t.dueDate??'')===date)}))})
const reminders=computed(()=>active.value.filter(t=>t.reminderAt && new Date(t.reminderAt).getTime()>=Date.now()).length)
const project=computed(()=>workspace.projects.value.find(p=>p.name!=='收集箱')??null)
const progress=computed(()=>project.value?deriveProjectProgress(project.value,workspace.milestones.value,workspace.tasks.value):0)
onMounted(()=>{if(!workspace.ready.value)void workspace.load();try{const saved=JSON.parse(localStorage.getItem('personal-ai-today-groups:v1')??'{}');for(const key of ['next','other','completed'] as const)if(typeof saved?.[key]==='boolean')collapsed.value[key]=saved[key]}catch{/* Ignore malformed preferences, never task data. */}})
watch(collapsed,value=>localStorage.setItem('personal-ai-today-groups:v1',JSON.stringify(value)),{deep:true})
async function addTask(){if(adding.value||!quickTask.value.trim())return;adding.value=true;error.value='';try{await workspace.createTask({title:quickTask.value.trim(),description:'',projectId:null,priority:null,dueDate:today,dueTime:null,isFocus:false,status:'todo',importance:'normal',milestoneId:null});quickTask.value=''}catch(e){error.value=e instanceof Error?e.message:typeof e==='string'?e:'添加失败，请重试'}finally{adding.value=false}}
</script>
<template>
<main class="suite-page suite-today"><SuiteHeader section="Today" /><div class="suite-content">
<header class="suite-heading"><div><div class="suite-today-title"><h1>Today</h1><time>{{new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}}</time></div><p>先做好重要的事。 <span data-backend-mode>{{workspace.backendLabel.value}}</span></p></div><button class="suite-primary add-button" @click="ui.openNewTask()"><UIcon name="i-lucide-plus" />新建任务</button></header>
<section class="suite-metrics"><article><strong>{{focus.length}}</strong><div><b>今日重点</b><small>聚焦关键任务</small></div></article><article><strong>{{reminders}}</strong><div><b>待提醒</b><small>近期将处理</small></div></article><article><strong>{{progress}}%</strong><div><b>项目进度</b><small>{{project?.name??'暂无项目'}}</small></div></article></section>
<UpcomingMilestones v-if="!filteredView" :document="workspace.document.value" :now="new Date()" />
<div class="today-controls"><div class="view-tabs suite-segments"><button :class="{active:view==='list'}" @click="view='list'">列表</button><button :class="{active:view==='agenda'}" @click="view='agenda'">日程</button></div><button class="suite-secondary" aria-label="筛选任务" :aria-expanded="showFilters" @click="showFilters=!showFilters">筛选任务</button><select v-model="sort" aria-label="任务排序"><option value="manual">手动排序</option><option value="due">按截止时间</option><option value="priority">按优先级</option><option value="title">按标题</option></select></div>
<div v-if="showFilters" class="today-controls"><input v-model="search" data-today-search aria-label="筛选关键词" placeholder="筛选任务标题或描述"><select v-model="priority" data-today-priority aria-label="优先级筛选"><option value="all">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="none">无</option></select><select v-model="status" data-today-status aria-label="完成状态筛选"><option value="all">全部状态</option><option value="active">未完成</option><option value="completed">已完成</option></select><button @click="search='';priority='all';status='all'">重置</button></div>
<template v-if="view==='list'"><section v-for="section in sections" :key="section.key" :data-today-section="section.key" class="suite-section"><header><h2><button class="group-toggle" :aria-label="`${collapsed[section.key]?'展开':'收起'}${section.title}`" :aria-expanded="!collapsed[section.key]" @click="collapsed[section.key]=!collapsed[section.key]"><UIcon :name="collapsed[section.key]?'i-lucide-chevron-right':'i-lucide-chevron-down'" />{{section.title}} <small>{{section.tasks.length}}</small></button></h2><NuxtLink v-if="section.key==='next'" to="/calendar">全部任务 <UIcon name="i-lucide-chevron-right" /></NuxtLink><NuxtLink v-if="section.key==='other'" to="/inbox">整理收集箱</NuxtLink></header><div v-if="!collapsed[section.key]" class="suite-list"><SuiteTaskRow v-for="task in section.tasks" :key="task.id" :task="task" /><p v-if="!section.tasks.length" class="suite-empty">暂无任务。</p></div></section></template>
<div v-else data-agenda-view><section v-for="group in agenda" :key="group.date" class="suite-section"><h2>{{group.label}}</h2><SuiteTaskRow v-for="task in group.tasks" :key="task.id" :task="task" class="agenda-task" /></section><p v-if="!agenda.length" class="suite-empty">没有匹配的任务。</p></div>
<form data-quick-add class="today-quick-add" @submit.prevent="addTask"><input v-model="quickTask" aria-label="快速添加任务" placeholder="记下一件待办，按 Enter 添加" :disabled="adding"><VoiceInputButton @transcript="text=>quickTask=[quickTask,text].filter(Boolean).join(' ')" /><button class="suite-primary" :disabled="adding||!quickTask.trim()">{{adding?'添加中…':'添加任务'}}</button></form><p v-if="error" role="alert">{{error}}</p>
<TodayOverview :today="today" /></div></main>
</template>
<style scoped>
.today-controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:16px 0}.today-controls input,.today-controls select{border:1px solid #e3e1eb;border-radius:8px;padding:9px;min-width:0;font-size:13px}.today-controls input{flex:1;min-width:160px}.group-toggle{display:flex;align-items:center;gap:6px;background:none;border:0;padding:0;font:inherit;cursor:pointer}.group-toggle small{font-size:12px;color:#8b8799}.today-quick-add{display:flex;align-items:center;gap:8px;padding:12px;border:1px solid #e3e1eb;border-radius:10px;margin:20px 0;background:white}.today-quick-add input{flex:1;min-width:0;border:0;background:transparent;padding:8px;font:inherit}.suite-heading [data-backend-mode]{font-size:12px;color:#8c889a}
</style>
