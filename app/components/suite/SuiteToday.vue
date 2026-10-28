<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { deriveProjectProgress, getTaskStatus, isTaskActive, isTaskCompleted } from '#shared/workspace'
import { useLocalClock } from '../../composables/useLocalClock'
import SuiteHeader from './SuiteHeader.vue'
import SuiteTaskRow from './SuiteTaskRow.vue'
import TodayOverview from '../dashboard/TodayOverview.vue'
import UpcomingMilestones from '../dashboard/UpcomingMilestones.vue'
import VoiceInputButton from '../workspace/VoiceInputButton.vue'
import { filterAndSortTasks, formatAgendaDate } from '../../utils/today-view'
import type { TodayPriorityFilter, TodayStatusFilter, TodaySort } from '../../utils/today-view'
const workspace=useWorkspace();const ui=useWorkspaceUi();const {now,today,refresh}=useLocalClock()
const search=ref('');const priority=ref<TodayPriorityFilter>('all');const status=ref<TodayStatusFilter>('all');const sort=ref<TodaySort>('manual')
const showFilters=ref(false);const view=ref<'list'|'agenda'>('list');const quickTask=ref('');const adding=ref(false);const error=ref('')
const collapsed=ref({next:false,other:false,completed:true})
const groupStorageKey='personal-ai-today-groups:v2'
const filtered=computed(()=>filterAndSortTasks(workspace.tasks.value,{query:search.value,priority:priority.value,status:status.value,projectId:null},sort.value))
const filteredView=computed(()=>Boolean(search.value.trim())||priority.value!=='all'||status.value!=='all')
const active=computed(()=>filtered.value.filter(isTaskActive))
const focus=computed(()=>[...active.value].filter(t=>t.isFocus||t.importance==='important'||t.status==='in_progress').sort((a,b)=>Number(b.status==='in_progress')-Number(a.status==='in_progress')).slice(0,3))
const others=computed(()=>active.value.filter(t=>!focus.value.some(f=>f.id===t.id)))
const completed=computed(()=>filtered.value.filter(isTaskCompleted))
const cancelled=computed(()=>filtered.value.filter(t=>getTaskStatus(t)==='cancelled'))
const sections=computed(()=>[{key:'next' as const,title:'今日重点',tasks:focus.value},{key:'other' as const,title:'其他待办',tasks:others.value},{key:'completed' as const,title:status.value==='cancelled'?'已取消':'已完成',tasks:status.value==='cancelled'?cancelled.value:completed.value}])
const agenda=computed(()=>{const dates=[...new Set(filtered.value.map(t=>t.dueDate??''))].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));return dates.map(date=>({date,label:formatAgendaDate(date||null,today.value),tasks:filtered.value.filter(t=>(t.dueDate??'')===date)}))})
const reminders=computed(()=>active.value.filter(t=>t.reminderAt && new Date(t.reminderAt).getTime()>=now.value.getTime()).length)
const project=computed(()=>workspace.projects.value.find(p=>p.name!=='收集箱')??null)
const progress=computed(()=>project.value?deriveProjectProgress(project.value,workspace.milestones.value,workspace.tasks.value):0)
onMounted(()=>{if(!workspace.ready.value)void workspace.load().catch(() => { /* Recovery is shown by the layout. */ });try{const saved=JSON.parse(localStorage.getItem(groupStorageKey)??localStorage.getItem('personal-ai-today-groups:v1')??'{}');for(const key of ['next','other','completed'] as const)if(typeof saved?.[key]==='boolean')collapsed.value[key]=saved[key]}catch{/* Ignore malformed preferences, never task data. */}})
watch(collapsed,value=>{try{localStorage.setItem(groupStorageKey,JSON.stringify(value))}catch{/* Preferences must not block task interactions. */}},{deep:true})
async function addTask(){if(adding.value||!quickTask.value.trim())return;adding.value=true;error.value='';try{refresh();await workspace.createTask({title:quickTask.value.trim(),description:'',projectId:null,priority:null,dueDate:today.value,dueTime:null,isFocus:false,status:'todo',importance:'normal',milestoneId:null});quickTask.value=''}catch(e){error.value=e instanceof Error?e.message:typeof e==='string'?e:'添加失败，请重试'}finally{adding.value=false}}
</script>
<template>
<main class="suite-page suite-today"><SuiteHeader section="Today" /><div class="suite-content">
<header class="suite-heading"><div><div class="suite-today-title"><h1>Today</h1><time>{{now.toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'long'})}}</time></div><p>先做好重要的事。 <span data-backend-mode>{{workspace.backendLabel.value}}</span></p></div><button class="suite-primary add-button" @click="ui.openNewTask()"><UIcon name="i-lucide-plus" />新建任务</button></header>
<section class="suite-metrics"><article><strong>{{focus.length}}</strong><div><b>今日重点</b><small>聚焦关键任务</small></div></article><article><strong>{{reminders}}</strong><div><b>待提醒</b><small>近期将处理</small></div></article><article><strong>{{progress}}%</strong><div><b>项目进度</b><small>{{project?.name??'暂无项目'}}</small></div></article></section>
<div class="today-controls"><div class="view-tabs suite-segments"><button :class="{active:view==='list'}" @click="view='list'">列表</button><button :class="{active:view==='agenda'}" @click="view='agenda'">日程</button></div><button class="suite-secondary" aria-label="筛选任务" :aria-expanded="showFilters" @click="showFilters=!showFilters">筛选任务</button><select v-model="sort" aria-label="任务排序"><option value="manual">手动排序</option><option value="due">按截止时间</option><option value="priority">按优先级</option><option value="title">按标题</option></select></div>
<div v-if="showFilters" class="today-controls"><input v-model="search" data-today-search aria-label="筛选关键词" placeholder="筛选任务标题或描述"><select v-model="priority" data-today-priority aria-label="优先级筛选"><option value="all">全部优先级</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="none">无</option></select><select v-model="status" data-today-status aria-label="完成状态筛选"><option value="all">全部状态</option><option value="active">未完成</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select><button @click="search='';priority='all';status='all'">重置</button></div>
<form data-quick-add class="today-quick-add" @submit.prevent="addTask"><input v-model="quickTask" aria-label="快速添加任务" placeholder="记下一件待办，按 Enter 添加" :disabled="adding"><VoiceInputButton @transcript="text=>quickTask=[quickTask,text].filter(Boolean).join(' ')" /><button class="suite-primary" :disabled="adding||!quickTask.trim()">{{adding?'添加中…':'添加任务'}}</button></form><p v-if="error" role="alert">{{error}}</p>
<template v-if="view==='list'">
  <section v-for="section in sections" :key="section.key" :data-today-section="section.key" class="suite-section today-task-section">
    <header>
      <h2><button class="group-toggle" :aria-label="`${collapsed[section.key]?'展开':'收起'}${section.title}`" :aria-expanded="!collapsed[section.key]" :aria-controls="`today-group-${section.key}`" @click="collapsed[section.key]=!collapsed[section.key]"><UIcon :name="collapsed[section.key]?'i-lucide-chevron-right':'i-lucide-chevron-down'" />{{section.title}} <small>{{section.tasks.length}}</small></button></h2>
      <NuxtLink v-if="!collapsed[section.key] && section.key==='next'" to="/calendar">全部任务 <UIcon name="i-lucide-chevron-right" /></NuxtLink>
      <NuxtLink v-if="!collapsed[section.key] && section.key==='other'" to="/inbox">整理收集箱</NuxtLink>
    </header>
    <div :id="`today-group-${section.key}`" :hidden="collapsed[section.key]">
      <div v-if="!collapsed[section.key]" class="suite-list" :class="{'today-compact-grid':section.key!=='next'}">
        <SuiteTaskRow v-for="task in section.tasks" :key="task.id" :task="task" :compact="section.key!=='next'" :focus="section.key==='next'" />
        <p v-if="!section.tasks.length" class="suite-empty">暂无任务。</p>
      </div>
    </div>
  </section>
</template>
<div v-else data-agenda-view><section v-for="group in agenda" :key="group.date" class="suite-section"><h2>{{group.label}}</h2><SuiteTaskRow v-for="task in group.tasks" :key="task.id" :task="task" class="agenda-task" /></section><p v-if="!agenda.length" class="suite-empty">没有匹配的任务。</p></div>
<TodayOverview :today="today" />
<UpcomingMilestones v-if="!filteredView" :document="workspace.document.value" :now="now" />
</div></main>
</template>
<style scoped>
.suite-today .suite-content{padding:10px 24px 28px;container-type:inline-size}
.suite-today :deep(.suite-topbar){min-height:48px}
.suite-today .suite-heading{margin-bottom:12px;gap:12px}
.suite-today .suite-heading h1{font-size:34px;margin:0;line-height:1.2}
.suite-today .suite-heading p{font-size:14px;margin-top:4px}
.suite-heading [data-backend-mode]{font-size:12px;color:#8c889a}
.suite-today .suite-metrics{padding:10px 0}
.suite-today .suite-metrics strong{font-size:28px}
.suite-today .suite-metrics article{padding:0 16px;gap:10px}
.suite-today .suite-metrics small{font-size:12px}
.today-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0}
.today-controls input,.today-controls select{border:1px solid #e3e1eb;border-radius:8px;padding:7px;min-width:0;font-size:13px}
.today-controls input{flex:1;min-width:160px}
.today-controls .suite-secondary{min-height:34px;padding:6px 12px;font-size:13px}
.today-controls .suite-segments button{padding:5px 16px}
.today-quick-add{display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid #e3e1eb;border-radius:9px;margin:0 0 12px;background:white}
.today-quick-add input{flex:1;min-width:0;border:0;background:transparent;padding:6px;font:inherit;font-size:14px}
.today-quick-add .suite-primary{min-height:32px;padding:5px 12px;font-size:13px}
.suite-today .today-task-section{margin-top:8px}
.today-task-section>header{margin:0 0 6px;padding:0 10px;min-height:34px;border-radius:7px;background:#f0f1fc;gap:8px}
.today-task-section[data-today-section=next]>header{background:#f2edff}
.today-task-section[data-today-section=completed]>header{background:#eef7f1}
.today-task-section>header h2{flex:1;min-width:0}
.today-task-section>header .group-toggle{display:flex;align-items:center;gap:6px;width:100%;min-height:34px;background:none;border:0;padding:0;font:inherit;font-size:15px;font-weight:650;cursor:pointer;text-align:left}
.today-task-section[data-today-section=completed] .group-toggle{color:#397356}
.group-toggle small{font-size:12px;color:#747b91;font-weight:500}
.today-task-section>header a{font-size:12px;white-space:nowrap}
.today-task-section .suite-list{gap:3px 10px}
.today-compact-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:3px 10px}
.today-task-section .suite-empty{padding:12px;grid-column:1/-1}
.suite-today :deep(.focus-overview){margin-top:18px}
.suite-today :is(button,input,select,a):focus-visible{outline:2px solid #7950f8;outline-offset:2px}
@container(min-width:600px){.today-compact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.suite-today .suite-content{padding:10px 14px 24px}.suite-today .suite-heading h1{font-size:30px}.suite-today .suite-metrics article{padding:0 9px}.today-quick-add{gap:4px}.today-quick-add input{font-size:13px}}
</style>
