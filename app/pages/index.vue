<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { deriveQuarterMetrics, getTaskImportance, getTaskStatus } from '#shared/workspace'
import type { Task } from '#shared/workspace'
import UpcomingMilestones from '../components/dashboard/UpcomingMilestones.vue'
import ProjectProgressPanel from '../components/projects/ProjectProgressPanel.vue'
import TaskActionsMenu from '../components/workspace/TaskActionsMenu.vue'
import VoiceInputButton from '../components/workspace/VoiceInputButton.vue'
import TodayOverview from '../components/dashboard/TodayOverview.vue'
import SuiteToday from '../components/suite/SuiteToday.vue'
import {
  deriveTodayLanes,
  filterAndSortTasks,
  formatAgendaDate,
  formatTodayHeading,
  getCurrentQuarter,
  getTodayDateInput,
} from '../utils/today-view'
import type { TodayPriorityFilter, TodaySort, TodayStatusFilter } from '../utils/today-view'

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const route = useRoute()
const router = useRouter()
const now = ref(new Date())
const quickTask = ref('')
const openMenuId = ref<string | null>(null)
const showFilters = ref(false)
const filterQuery = ref('')
const priorityFilter = ref<TodayPriorityFilter>('all')
const statusFilter = ref<TodayStatusFilter>('all')
const sortMode = ref<TodaySort>('manual')
const viewMode = ref<'list' | 'agenda'>('list')
watch(() => route.query.view, value => { viewMode.value = value === 'agenda' ? 'agenda' : 'list' }, { immediate: true })
type TodaySectionKey = 'next' | 'laterToday' | 'backlog' | 'completed'
const collapsedGroups = ref<Record<TodaySectionKey, boolean>>({ next: false, laterToday: false, backlog: false, completed: false })

const todayDate = computed(() => getTodayDateInput(now.value))
const todayHeading = computed(() => formatTodayHeading(now.value))
const currentQuarter = computed(() => getCurrentQuarter(now.value))
const quarterMetrics = computed(() => deriveQuarterMetrics(workspace.document.value, currentQuarter.value, now.value))
const selectedProjectId = computed(() => typeof route.query.project === 'string' ? route.query.project : null)
const selectedProject = computed(() => workspace.projects.value.find(project => project.id === selectedProjectId.value) ?? null)
const filteredTasks = computed(() => filterAndSortTasks(workspace.tasks.value, {
  query: filterQuery.value,
  projectId: selectedProjectId.value,
  priority: priorityFilter.value,
  status: statusFilter.value,
}, sortMode.value))
const lanes = computed(() => deriveTodayLanes(filteredTasks.value, now.value))
const nowTask = computed(() => lanes.value.nowTask)
const groups = computed(() => [
  { key: 'next' as const, title: '接下来', hint: '最多 3 项', tasks: lanes.value.nextTasks },
  { key: 'laterToday' as const, title: '今天稍后', hint: '今天仍需推进', tasks: lanes.value.laterTodayTasks },
  { key: 'backlog' as const, title: '待整理', hint: '尚未排入今天', tasks: lanes.value.backlogTasks },
  { key: 'completed' as const, title: '已完成', hint: '', tasks: lanes.value.completedTasks },
])
const visibleMetrics = computed(() => ({
  focus: Number(Boolean(nowTask.value)) + lanes.value.nextTasks.length + lanes.value.laterTodayTasks.length,
  active: Number(Boolean(nowTask.value)) + lanes.value.nextTasks.length + lanes.value.laterTodayTasks.length + lanes.value.backlogTasks.length,
  completed: lanes.value.completedTasks.length,
}))
const activeFilterCount = computed(() => Number(Boolean(filterQuery.value.trim()))
  + Number(priorityFilter.value !== 'all')
  + Number(statusFilter.value !== 'all')
  + Number(Boolean(selectedProjectId.value)))
const agendaGroups = computed(() => {
  const buckets = new Map<string, Task[]>()
  filteredTasks.value.forEach((task) => {
    const key = task.dueDate ?? ''
    const bucket = buckets.get(key) ?? []
    bucket.push(task)
    buckets.set(key, bucket)
  })
  return [...buckets.entries()]
    .sort(([left], [right]) => (left || '9999-12-31').localeCompare(right || '9999-12-31'))
    .map(([date, tasks]) => ({ date: date || null, label: formatAgendaDate(date || null, todayDate.value), tasks }))
})

onMounted(() => {
  if (!workspace.ready.value) void workspace.load()
  try {
    const saved = localStorage.getItem('personal-ai-today-groups:v1')
    if (saved) collapsedGroups.value = { ...collapsedGroups.value, ...JSON.parse(saved) }
  }
  catch {
    localStorage.removeItem('personal-ai-today-groups:v1')
  }
})

watch(collapsedGroups, value => {
  if (import.meta.client) localStorage.setItem('personal-ai-today-groups:v1', JSON.stringify(value))
}, { deep: true })

function projectFor(task: Task) {
  return workspace.projects.value.find(project => project.id === task.projectId) ?? null
}

function priorityLabel(priority: Task['priority']) {
  return priority === 'high' ? '高' : priority === 'medium' ? '中' : priority === 'low' ? '低' : ''
}

function statusLabel(task: Task) {
  const labels = { inbox: '收集箱', todo: '待办', in_progress: '进行中', waiting: '等待中', done: '已完成', cancelled: '已取消' }
  return labels[getTaskStatus(task)]
}

function estimateLabel(task: Task) {
  if (!task.estimatedMinutes) return '未估时'
  return task.estimatedMinutes >= 60 && task.estimatedMinutes % 60 === 0
    ? `${task.estimatedMinutes / 60} 小时`
    : `${task.estimatedMinutes} 分钟`
}

async function addTask() {
  const title = quickTask.value.trim()
  if (!title) return
  const inbox = workspace.projects.value.find(project => project.name === '收集箱')
  await workspace.createTask({
    title,
    description: '',
    projectId: selectedProjectId.value ?? inbox?.id ?? null,
    priority: null,
    dueDate: todayDate.value,
    dueTime: null,
    isFocus: false,
    status: selectedProjectId.value === inbox?.id ? 'inbox' : 'todo',
    importance: 'normal',
    estimatedMinutes: null,
    reminderAt: null,
    milestoneId: null,
  })
  quickTask.value = ''
}

function appendQuickTaskVoice(text: string) {
  quickTask.value = [quickTask.value.trim(), text.trim()].filter(Boolean).join(' ')
}

function toggleGroup(group: TodaySectionKey) {
  collapsedGroups.value[group] = !collapsedGroups.value[group]
}

function snoozeTenMinutes(taskId: string) {
  openMenuId.value = null
  return workspace.snoozeTask(taskId, new Date(Date.now() + 10 * 60_000).toISOString())
}

async function clearFilters() {
  filterQuery.value = ''
  priorityFilter.value = 'all'
  statusFilter.value = 'all'
  if (selectedProjectId.value) await router.replace({ path: '/' })
}
</script>

<template>
  <SuiteToday v-if="!route.query.project && !route.query.view" />
  <main v-else class="today-page">
    <header class="today-topbar">
      <div class="breadcrumb">
        <span>工作空间</span><UIcon name="i-lucide-chevron-right" /><b>{{ viewMode === 'agenda' ? '任务与日程' : 'Today' }}</b>
        <span v-if="selectedProject"><UIcon name="i-lucide-chevron-right" />{{ selectedProject.name }}</span>
        <span data-backend-mode class="mode-badge"><span />{{ workspace.backendLabel.value }}</span>
      </div>
      <div class="topbar-actions">
        <button class="focus-search" aria-label="全局搜索" title="Ctrl+K" @click="ui.openSearch()"><UIcon name="i-lucide-search" /><span>搜索任务、项目或内容…</span><kbd>Ctrl K</kbd></button>
        <button :class="{ 'filter-active': activeFilterCount }" aria-label="筛选任务" @click="showFilters = !showFilters"><UIcon name="i-lucide-list-filter" /><b v-if="activeFilterCount">{{ activeFilterCount }}</b></button>
        <button class="focus-profile" aria-label="本机工作区设置" @click="ui.openWorkspaceInfo">L</button>
      </div>
    </header>

    <div class="today-content">
      <section class="today-heading">
        <div><div class="focus-heading-line"><h1>{{ selectedProject ? selectedProject.name : viewMode === 'agenda' ? '任务与日程' : 'Today' }}</h1><p>{{ todayHeading }}</p></div><span>{{ viewMode === 'agenda' ? '规划时间，从容完成每一件事。' : '先做好重要的事。' }}</span></div>
        <button class="add-button focus-new-task" @click="ui.openNewTask(selectedProjectId)"><UIcon name="i-lucide-plus" />新建任务</button>
      </section>

      <ProjectProgressPanel
        v-if="selectedProject"
        :project="selectedProject"
        :milestones="workspace.milestones.value"
        :tasks="workspace.tasks.value"
        :now="now"
      />

      <UpcomingMilestones
        v-else-if="activeFilterCount === 0"
        :document="workspace.document.value"
        :now="now"
      />

      <section class="metric-grid" aria-label="今日概览">
        <article><span class="metric-icon violet"><UIcon name="i-lucide-target" /></span><div><small>今日重点</small><strong>{{ visibleMetrics.focus }}</strong></div><em>保持专注</em></article>
        <article><span class="metric-icon blue"><UIcon name="i-lucide-loader-circle" /></span><div><small>待推进</small><strong>{{ visibleMetrics.active }}</strong></div><em>当前视图</em></article>
        <article><span class="metric-icon green"><UIcon name="i-lucide-circle-check-big" /></span><div><small>已完成</small><strong>{{ visibleMetrics.completed }}</strong></div><em class="positive">当前视图</em></article>
        <article class="quarter-card"><div><small>{{ currentQuarter.replace('-', ' ') }} 季度进度</small><strong>{{ quarterMetrics.averageProgress }}%</strong></div><div class="progress-track"><span :style="{ width: `${quarterMetrics.averageProgress}%` }" /></div><em>剩余 {{ quarterMetrics.remainingDays }} 天</em></article>
      </section>

      <section class="task-board">
        <div class="board-toolbar">
          <div class="view-tabs">
            <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'"><UIcon name="i-lucide-list" />列表</button>
            <button :class="{ active: viewMode === 'agenda' }" @click="viewMode = 'agenda'"><UIcon name="i-lucide-calendar-days" />日程</button>
          </div>
          <button class="focus-brief-refresh" @click="ui.requestMiniMaxBrief"><UIcon name="i-lucide-sparkles" />更新 AI 简报</button>
          <label class="sort-control"><UIcon name="i-lucide-arrow-up-down" /><select v-model="sortMode" aria-label="任务排序"><option value="manual">手动排序</option><option value="due">按截止时间</option><option value="priority">按优先级</option><option value="title">按标题</option></select></label>
        </div>

        <div v-if="showFilters" class="today-filters">
          <label class="filter-search"><UIcon name="i-lucide-search" /><input v-model="filterQuery" data-today-search aria-label="筛选关键词" placeholder="筛选任务标题或描述"></label>
          <select v-model="priorityFilter" data-today-priority aria-label="优先级筛选"><option value="all">全部优先级</option><option value="high">高优先级</option><option value="medium">中优先级</option><option value="low">低优先级</option><option value="none">无优先级</option></select>
          <select v-model="statusFilter" data-today-status aria-label="完成状态筛选"><option value="all">全部状态</option><option value="active">未完成</option><option value="completed">已完成</option></select>
          <button :disabled="!activeFilterCount" @click="clearFilters"><UIcon name="i-lucide-rotate-ccw" />重置</button>
        </div>

        <div v-if="workspace.loading.value" class="loading-panel"><UIcon name="i-lucide-loader-circle" />正在加载工作区…</div>
        <template v-else-if="viewMode === 'list'">
          <section v-if="nowTask" data-now-task data-task-row class="now-task-card">
            <div class="now-kicker"><span><UIcon name="i-lucide-circle-play" />现在做</span><em>{{ statusLabel(nowTask) }}</em></div>
            <button class="now-main" type="button" @click="ui.openEditTask(nowTask.id)">
              <strong>{{ nowTask.title }}</strong>
              <span><i :style="{ background: projectFor(nowTask)?.color ?? '#9297a1' }" />{{ projectFor(nowTask)?.name ?? '无项目' }} · {{ estimateLabel(nowTask) }}</span>
            </button>
            <span v-if="getTaskImportance(nowTask) === 'important'" class="importance-badge"><UIcon name="i-lucide-star" />重要</span>
            <button v-if="getTaskStatus(nowTask) !== 'in_progress'" class="now-start" type="button" @click="workspace.startTask(nowTask.id)"><UIcon name="i-lucide-play" />开始</button>
            <button v-else class="now-start secondary" type="button" @click="workspace.updateTask(nowTask.id, { status: 'todo' })"><UIcon name="i-lucide-pause" />暂停</button>
            <button class="now-complete" type="button" aria-label="完成当前任务" @click="workspace.setTaskCompleted(nowTask.id, true)"><UIcon name="i-lucide-check" />完成</button>
          </section>
          <section v-else class="now-task-empty"><UIcon name="i-lucide-party-popper" /><div><strong>当前没有待办</strong><span>记录一件事情，Focus AI 会把它放到合适位置。</span></div><button @click="ui.openNewTask(selectedProjectId)">添加任务</button></section>
          <section v-for="group in groups" :key="group.key" class="task-group" :class="{ 'completed-group': group.key === 'completed' }">
            <header><button :aria-label="`${collapsedGroups[group.key] ? '展开' : '收起'}${group.title}`" @click="toggleGroup(group.key)"><UIcon name="i-lucide-chevron-down" :class="{ collapsed: collapsedGroups[group.key] }" /></button><h2>{{ group.title }}</h2><span>{{ group.tasks.length }}</span><div /><small>{{ group.hint }}</small></header>
            <template v-if="!collapsedGroups[group.key]">
              <div v-if="group.tasks.length" class="task-list">
                <article v-for="(task, index) in group.tasks" :key="task.id" data-task-row class="task-row">
                  <button class="task-check" :class="{ checked: task.completedAt !== null }" :aria-label="`${task.completedAt ? '恢复' : '完成'} ${task.title}`" @click="workspace.setTaskCompleted(task.id, task.completedAt === null)"><UIcon v-if="task.completedAt" name="i-lucide-check" /></button>
                  <button class="task-main task-open" @click="ui.openEditTask(task.id)"><span :class="{ completed: task.completedAt !== null }">{{ task.title }}</span><span class="task-meta"><i class="mini-dot" :style="{ background: projectFor(task)?.color ?? '#9297a1' }" />{{ projectFor(task)?.name ?? '无项目' }}</span></button>
                  <span class="task-status-pill" :class="getTaskStatus(task)">{{ statusLabel(task) }}</span>
                  <span v-if="task.priority" class="priority" :class="task.priority">{{ priorityLabel(task.priority) }}</span>
                  <span v-if="task.dueTime" class="task-time"><UIcon name="i-lucide-clock-3" />{{ task.dueTime }}</span>
                  <div class="task-menu-wrap">
                    <button class="task-menu-toggle" :aria-expanded="openMenuId === task.id" :aria-label="`${task.title} 操作菜单`" @click="openMenuId = openMenuId === task.id ? null : task.id"><UIcon name="i-lucide-ellipsis" /></button>
                    <TaskActionsMenu
                      v-if="openMenuId === task.id"
                      :task="task"
                      :first="true"
                      :last="true"
                      @edit="openMenuId = null; ui.openEditTask(task.id)"
                      @move="openMenuId = null; workspace.moveTask(task.id, !task.isFocus)"
                      @start="openMenuId = null; workspace.startTask(task.id)"
                      @pause="openMenuId = null; workspace.updateTask(task.id, { status: 'todo' })"
                      @snooze="snoozeTenMinutes(task.id)"
                      @delete="openMenuId = null; ui.askDeleteTask(task.id)"
                    />
                  </div>
                </article>
              </div>
              <div v-else class="empty-state"><span>{{ activeFilterCount ? '没有符合当前筛选条件的任务' : group.key === 'completed' ? '还没有完成记录' : '这个分组现在是空的' }}</span><button v-if="group.key !== 'completed' && !activeFilterCount" @click="ui.openNewTask(selectedProjectId)">添加一项任务</button></div>
            </template>
          </section>
          <form data-quick-add class="quick-add" @submit.prevent="addTask">
            <UIcon name="i-lucide-plus" />
            <input v-model="quickTask" aria-label="快速添加任务" :placeholder="selectedProject ? `添加到 ${selectedProject.name}，按 Enter 保存…` : '快速添加任务，按 Enter 保存…'">
            <VoiceInputButton @transcript="appendQuickTaskVoice" />
            <kbd>Enter</kbd>
          </form>
        </template>

        <section v-else class="agenda-view" data-agenda-view>
          <article v-for="agenda in agendaGroups" :key="agenda.date ?? 'none'" class="agenda-group">
            <header><div><span>{{ agenda.label }}</span><small>{{ agenda.date ?? '稍后整理' }}</small></div><b>{{ agenda.tasks.length }}</b></header>
            <article v-for="task in agenda.tasks" :key="task.id" class="agenda-task" role="button" tabindex="0" @click="ui.openEditTask(task.id)" @keydown.enter="ui.openEditTask(task.id)">
              <span class="agenda-time">{{ task.dueTime ?? '全天' }}</span>
              <i :style="{ background: projectFor(task)?.color ?? '#9297a1' }" />
              <span><b :class="{ completed: task.completedAt !== null }">{{ task.title }}</b><small>{{ projectFor(task)?.name ?? '无项目' }}</small></span>
              <button class="task-check" :class="{ checked: task.completedAt !== null }" :aria-label="`${task.completedAt ? '恢复' : '完成'} ${task.title}`" @click.stop="workspace.setTaskCompleted(task.id, task.completedAt === null)"><UIcon v-if="task.completedAt" name="i-lucide-check" /></button>
            </article>
          </article>
          <div v-if="!agendaGroups.length" class="empty-state"><span>没有符合当前筛选条件的日程</span><button @click="clearFilters">清除筛选</button></div>
        </section>
      </section>
      <TodayOverview v-if="!selectedProject && viewMode === 'list' && activeFilterCount === 0" :today="todayDate" />
    </div>
  </main>
</template>

<style scoped>
.task-row{min-height:56px}.task-row:hover .task-menu-toggle{color:#555a63}.task-menu-wrap{display:grid;place-items:center}.priority.low{background:#edf3fb;color:#57769d}
.now-task-card{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:10px;align-items:center;margin:14px;border:1px solid #d7d3ff;border-radius:11px;padding:15px 16px;background:linear-gradient(135deg,#f8f7ff 0%,#fff 72%);box-shadow:0 8px 24px rgb(83 72 190 / 8%)}.now-kicker{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between}.now-kicker span{display:flex;gap:6px;align-items:center;color:#655bdb;font-size:12px;font-weight:800;letter-spacing:.05em}.now-kicker em{color:#8d91a0;font-size:11px;font-style:normal}.now-main{display:grid;gap:5px;min-width:0;padding:0;border:0;background:transparent;text-align:left;cursor:pointer}.now-main strong{overflow:hidden;color:#242730;font-size:17px;text-overflow:ellipsis;white-space:nowrap}.now-main span{display:flex;gap:6px;align-items:center;color:#858a94;font-size:12px}.now-main i{width:7px;height:7px;border-radius:50%}.importance-badge{display:flex;gap:4px;align-items:center;padding:5px 7px;border-radius:6px;background:#fff0e6;color:#b56625;font-size:11px;font-weight:750}.now-start,.now-complete{display:flex;gap:5px;align-items:center;justify-content:center;min-height:34px;padding:0 11px;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer}.now-start{border:1px solid #6459d8;background:#6b61df;color:#fff}.now-start.secondary{border-color:#d9dae0;background:#fff;color:#656a73}.now-complete{border:1px solid #c9e8d9;background:#f1faf6;color:#32775a}.now-task-empty{display:flex;gap:12px;align-items:center;margin:14px;padding:15px 16px;border:1px dashed #d9dbe2;border-radius:10px;color:#8b9099}.now-task-empty>div{display:grid;gap:3px;flex:1}.now-task-empty strong{color:#4b4f57;font-size:14px}.now-task-empty span{font-size:12px}.now-task-empty button{border:0;background:transparent;color:#6359d2;font-size:12px;font-weight:700;cursor:pointer}
.topbar-actions .filter-active{position:relative;background:#eeecff;color:#6157d0}.topbar-actions .filter-active b{position:absolute;right:-3px;top:-4px;display:grid;min-width:15px;height:15px;place-items:center;border:2px solid #fff;border-radius:999px;background:#665bd7;color:#fff;font-size:10px}
.today-filters{display:grid;grid-template-columns:minmax(180px,1fr) 135px 120px auto;gap:8px;padding:10px 14px;border-bottom:1px solid #e8e9ed;background:#fafafd}.today-filters select,.filter-search{height:33px;border:1px solid #dfe1e6;border-radius:7px;background:#fff;color:#5f646d;font-size:12px}.today-filters select{padding:0 8px}.filter-search{display:grid;grid-template-columns:18px 1fr;gap:5px;align-items:center;padding:0 9px;color:#969aa2}.filter-search input{min-width:0;border:0;outline:0;background:transparent;font:inherit}.today-filters>button{display:flex;gap:5px;align-items:center;justify-content:center;padding:0 10px;border:1px solid #dedfe4;border-radius:7px;background:#fff;color:#6f747d;font-size:11px;cursor:pointer}.today-filters>button:disabled{opacity:.45;cursor:not-allowed}
.sort-control{display:flex;gap:5px;align-items:center;color:#777b84}.sort-control select{height:29px;padding:0 5px;border:0;outline:0;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}.task-group header svg{transition:transform .16s ease}.task-group header svg.collapsed{transform:rotate(-90deg)}
.task-open{display:grid;gap:4px;min-width:0;padding:0;border:0;background:transparent;text-align:left;cursor:pointer}.task-open>span:first-child{overflow:hidden;color:#353941;font-size:15px;text-overflow:ellipsis;white-space:nowrap}.task-open .task-meta{display:flex;gap:6px;align-items:center;color:#858a94;font-size:12px}.task-open .mini-dot{display:inline-block;width:6px;height:6px;border-radius:50%}
.agenda-view{padding:8px 14px 16px}.agenda-group{display:grid;grid-template-columns:112px minmax(0,1fr);border-bottom:1px solid #eceef1}.agenda-group>header{display:flex;justify-content:space-between;align-items:flex-start;padding:13px 14px 13px 2px}.agenda-group>header div{display:grid;gap:3px}.agenda-group>header span{font-size:13px;font-weight:700}.agenda-group>header small{color:#989ca4;font-size:11px}.agenda-group>header b{display:grid;min-width:18px;height:18px;place-items:center;border-radius:5px;background:#f0f1f4;color:#777c85;font-size:11px}.agenda-task{display:grid;grid-template-columns:50px 7px minmax(0,1fr) 22px;gap:9px;align-items:center;min-height:52px;padding:0 8px;border:0;border-bottom:1px solid #f0f1f3;background:transparent;text-align:left;cursor:pointer}.agenda-task:hover{background:#fafafd}.agenda-task>i{width:7px;height:28px;border-radius:4px}.agenda-task>span:nth-child(3){display:grid;gap:3px}.agenda-task b{overflow:hidden;color:#393d45;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.agenda-task small,.agenda-time{color:#969aa2;font-size:11px}.completed{text-decoration:line-through;color:#989ca4!important}
@media(max-width:760px){.today-filters{grid-template-columns:1fr 1fr}.filter-search{grid-column:1/-1}.agenda-group{grid-template-columns:1fr}.agenda-group>header{padding-right:4px}.agenda-task{grid-template-columns:44px 6px minmax(0,1fr) 22px}.sort-control svg{display:none}.now-task-card{grid-template-columns:1fr 1fr}.now-main{grid-column:1/-1}.importance-badge{display:none}.now-start,.now-complete{width:100%}}
</style>
