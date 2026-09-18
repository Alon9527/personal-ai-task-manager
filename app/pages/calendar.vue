<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { calendarEvents, dateKey, weekDays } from '../utils/calendar-view'
import type { Task } from '#shared/workspace'
import type { CreateTaskInput } from '../data/workspace-gateway'
import TaskEditorDialog from '../components/workspace/TaskEditorDialog.vue'
import SuiteHeader from '../components/suite/SuiteHeader.vue'
import SuiteTaskRow from '../components/suite/SuiteTaskRow.vue'
const workspace = useWorkspace(); const ui = useWorkspaceUi(); const route = useRoute()
const anchor = ref(new Date()); const view = ref('calendar'); const selectedId = ref<string|null>(null)
const creating = ref(false); const defaultDate = ref(''); const defaultTime = ref(''); const error = ref(''); const busy = ref(false)
const scroll = ref<HTMLElement|null>(null)
const days = computed(() => weekDays(anchor.value)); const today = dateKey(new Date())
const selected = computed(() => workspace.tasks.value.find(t => t.id === selectedId.value) ?? null)
const tasks = computed(() => workspace.tasks.value.filter(t => {
  if (route.query.filter === 'done') return t.status === 'done'
  if (t.status === 'cancelled' || t.status === 'done') return false
  if (route.query.filter === 'today') return t.dueDate === today
  if (route.query.filter === 'week') return !!t.dueDate && t.dueDate >= today && t.dueDate <= dateKey(new Date(Date.now() + 6*86400000))
  return true
}))
const columns = [{id:'todo',label:'待办'},{id:'in_progress',label:'进行中'},{id:'waiting',label:'等待中'},{id:'done',label:'已完成'}]
onMounted(async () => { if (!workspace.ready.value) await workspace.load(); await nextTick(); if (scroll.value) scroll.value.scrollTop = 8*64 })
function shift(n: number) { const d = new Date(anchor.value); d.setDate(d.getDate()+n*7); anchor.value=d }
function choose(task: Task) { creating.value=false; selectedId.value=task.id; error.value='' }
function create(day = today, hour = '09:00') { defaultDate.value=day; defaultTime.value=hour; selectedId.value=null; creating.value=true; error.value='' }
async function save(input: CreateTaskInput) {
  if (busy.value) return; busy.value=true; error.value=''
  try { if (selected.value) await workspace.updateTask(selected.value.id,input); else await workspace.createTask(input); creating.value=false; selectedId.value=null }
  catch (e) { error.value=e instanceof Error?e.message:'保存失败，请重试' } finally { busy.value=false }
}
function color(task: Task) { return workspace.projects.value.find(p=>p.id===task.projectId)?.color ?? '#805cff' }
</script>
<template><main class="suite-page suite-calendar"><SuiteHeader section="任务与日程" />
<div class="suite-content"><header class="suite-heading"><div><h1>{{ view === 'calendar' ? '日历' : '任务与日程' }}</h1><p>规划时间，高效完成每一项任务。</p></div><div class="suite-segments"><button v-for="v in [{id:'list',label:'列表'},{id:'board',label:'看板'},{id:'calendar',label:'日历'}]" :key="v.id" :class="{active:view===v.id}" @click="view=v.id">{{ v.label }}</button></div><button class="suite-primary" @click="create()"><UIcon name="i-lucide-plus" />新建任务</button></header>
<div class="suite-calendar-layout" :class="{'has-detail':selected || creating}">
<section v-if="view==='calendar'" class="suite-calendar-card"><header class="suite-calendar-toolbar"><button aria-label="上一周" @click="shift(-1)">‹</button><button aria-label="下一周" @click="shift(1)">›</button><strong>{{ days[0]?.key }} — {{ days[6]?.key }}</strong><button @click="anchor=new Date()">今天</button><span>周视图</span></header>
<div ref="scroll" class="suite-week-scroll"><div class="suite-week"><div class="suite-week-head"><span /><div v-for="day in days" :key="day.key" :class="{'is-today':day.key===today}"><strong>{{ day.date.getMonth()+1 }}/{{ day.date.getDate() }}</strong><small>周{{ '日一二三四五六'[day.date.getDay()] }}</small></div></div>
<div class="suite-all-day"><span>全天</span><div v-for="day in days" :key="day.key"><button v-for="task in tasks.filter(t=>t.dueDate===day.key&&!t.dueTime)" :key="task.id" @click="choose(task)">{{ task.title }}</button></div></div>
<div class="suite-week-body"><div class="suite-hours"><span v-for="hour in 24" :key="hour">{{ String(hour-1).padStart(2,'0') }}:00</span></div><div v-for="day in days" :key="day.key" class="suite-day-column" :class="{'is-today':day.key===today}">
<button v-for="hour in 24" :key="hour" class="suite-time-slot" :aria-label="`${day.key} ${hour-1}点新建任务`" @dblclick="create(day.key,`${String(hour-1).padStart(2,'0')}:00`)"></button>
<button v-for="event in calendarEvents(tasks,day.key)" :key="event.task.id" class="suite-calendar-event" :style="{top:`${event.start/60*64}px`,height:`${Math.max(26,(event.end-event.start)/60*64)}px`,left:`calc(${event.lane/event.lanes*100}% + 3px)`,width:`calc(${100/event.lanes}% - 6px)`,'--event-color':color(event.task)}" :aria-label="`${event.task.title} ${event.task.dueTime}`" @click="choose(event.task)"><small>{{ event.task.dueTime }}</small><strong>{{ event.task.title }}</strong><small>{{ event.task.estimatedMinutes ?? 30 }} 分钟</small></button>
</div></div></div></div><p class="suite-hint">双击空白时段添加任务；未安排日期的任务请在列表中查看。</p></section>
<section v-else-if="view==='list'" class="suite-list"><SuiteTaskRow v-for="task in tasks" :key="task.id" :task="task" /><p v-if="!tasks.length" class="suite-empty">暂无符合条件的任务</p></section>
<section v-else class="suite-kanban"><div v-for="column in columns" :key="column.id" :class="column.id"><header>{{ column.label }}</header><button v-for="task in workspace.tasks.value.filter(t=>column.id==='todo'?['todo','inbox'].includes(t.status):t.status===column.id)" :key="task.id" @click="choose(task)"><strong>{{ task.title }}</strong><small>{{ task.dueDate ?? '未安排日期' }}</small></button></div></section>
<aside v-if="selected || creating" class="suite-task-detail"><p v-if="error" role="alert">{{ error }}</p><TaskEditorDialog :key="selected?.id ?? `${defaultDate}-${defaultTime}`" :open="true" embedded :task="selected" :projects="workspace.projects.value" :milestones="workspace.milestones.value" :default-date="defaultDate" :default-time="defaultTime" :attachments-enabled="workspace.backendMode.value!=='supabase'" @save="save" @close="selectedId=null;creating=false" /><button v-if="selected" class="suite-danger" @click="ui.askDeleteTask(selected.id)">删除任务</button><p v-if="busy">正在保存…</p></aside>
</div></div></main></template>
