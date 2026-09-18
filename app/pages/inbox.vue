<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import SuiteHeader from '../components/suite/SuiteHeader.vue'
import VoiceInputButton from '../components/workspace/VoiceInputButton.vue'
import type { Task, TaskGroup } from '#shared/workspace'
import DashboardTopbar from '../components/dashboard/DashboardTopbar.vue'
import EmptyDashboardState from '../components/dashboard/EmptyDashboardState.vue'
import MetricCard from '../components/dashboard/MetricCard.vue'
import TaskActionsMenu from '../components/workspace/TaskActionsMenu.vue'
import { softDeleteTasks } from '../services/inbox-bulk-delete'

type StatusFilter = 'all' | 'active' | 'completed'
type PriorityFilter = 'all' | 'none' | NonNullable<Task['priority']>

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const search = ref('')
const statusFilter = ref<StatusFilter>('all')
const priorityFilter = ref<PriorityFilter>('all')
const openMenuId = ref<string | null>(null)
const selectedTaskIds = ref<string[]>([])
const aiSelectedIds = useState<string[]>('suite-inbox-selection',()=>[])
watch(selectedTaskIds, ids=>{aiSelectedIds.value=[...ids]}, {deep:true})
onBeforeUnmount(()=>{aiSelectedIds.value=[]})
const capture = ref('')
const capturing = ref(false)
const captureError = ref('')
async function captureTask(){if(!capture.value.trim()||capturing.value)return;capturing.value=true;captureError.value='';try{await workspace.createTask({title:capture.value.trim(),description:'',projectId:inboxProject.value?.id??null,priority:null,dueDate:null,dueTime:null,isFocus:false,status:'inbox',importance:'normal',estimatedMinutes:null,reminderAt:null,milestoneId:null});capture.value=''}catch(e){captureError.value=e instanceof Error?e.message:'记录失败'}finally{capturing.value=false}}
const bulkDeleteOpen = ref(false)
const bulkDeleting = ref(false)
const bulkDeleteError = ref('')

const inboxProject = computed(() =>
  workspace.projects.value.find(project => project.name === '收集箱') ?? null,
)

const inboxTasks = computed(() => workspace.tasks.value.filter(task =>
  task.projectId === null || task.projectId === inboxProject.value?.id,
))

const activeInboxTasks = computed(() =>
  inboxTasks.value.filter(task => task.completedAt === null),
)

const todayAdded = computed(() => {
  const today = localDateKey(new Date())
  return inboxTasks.value.filter(task => localDateKey(new Date(task.createdAt)) === today).length
})

const noProjectCount = computed(() =>
  inboxTasks.value.filter(task => task.projectId === null).length,
)

const filteredTasks = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('zh-CN')
  return inboxTasks.value.filter((task) => {
    if (query && !`${task.title} ${task.description}`.toLocaleLowerCase('zh-CN').includes(query)) return false
    if (statusFilter.value === 'active' && task.completedAt !== null) return false
    if (statusFilter.value === 'completed' && task.completedAt === null) return false
    if (priorityFilter.value === 'none' && task.priority !== null) return false
    if (priorityFilter.value !== 'all' && priorityFilter.value !== 'none' && task.priority !== priorityFilter.value) return false
    return true
  })
})

const selectedTaskIdSet = computed(() => new Set(selectedTaskIds.value))
const allFilteredSelected = computed(() =>
  filteredTasks.value.length > 0
  && filteredTasks.value.every(task => selectedTaskIdSet.value.has(task.id)),
)
const someFilteredSelected = computed(() =>
  filteredTasks.value.some(task => selectedTaskIdSet.value.has(task.id))
  && !allFilteredSelected.value,
)

onMounted(() => {
  if (!workspace.ready.value) void workspace.load()
})

watch(
  () => inboxTasks.value.map(task => task.id),
  (taskIds) => {
    const availableIds = new Set(taskIds)
    selectedTaskIds.value = selectedTaskIds.value.filter(id => availableIds.has(id))
  },
)

watch([search, statusFilter, priorityFilter], () => {
  selectedTaskIds.value = []
  bulkDeleteOpen.value = false
  bulkDeleteError.value = ''
})

function toggleTaskSelection(taskId: string, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  if (checked) {
    selectedTaskIds.value = [...new Set([...selectedTaskIds.value, taskId])]
    return
  }
  selectedTaskIds.value = selectedTaskIds.value.filter(id => id !== taskId)
}

function toggleAllFiltered(event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  const filteredIds = new Set(filteredTasks.value.map(task => task.id))
  if (checked) {
    selectedTaskIds.value = [...new Set([...selectedTaskIds.value, ...filteredIds])]
    return
  }
  selectedTaskIds.value = selectedTaskIds.value.filter(id => !filteredIds.has(id))
}

function openBulkDelete() {
  if (selectedTaskIds.value.length === 0) return
  bulkDeleteError.value = ''
  bulkDeleteOpen.value = true
}

function closeBulkDelete() {
  if (bulkDeleting.value) return
  bulkDeleteOpen.value = false
  bulkDeleteError.value = ''
}

async function confirmBulkDelete() {
  if (bulkDeleting.value || selectedTaskIds.value.length === 0) return
  bulkDeleting.value = true
  bulkDeleteError.value = ''
  try {
    const base = await workspace.readLatestDocument()
    const next = softDeleteTasks(base, selectedTaskIds.value)
    await workspace.replaceWorkspaceDocument(next, base)
    selectedTaskIds.value = []
    bulkDeleteOpen.value = false
  }
  catch (error) {
    bulkDeleteError.value = error instanceof Error ? error.message : '删除失败，请重试'
  }
  finally {
    bulkDeleting.value = false
  }
}

function projectFor(task: Task) {
  return workspace.projects.value.find(project => project.id === task.projectId) ?? null
}

function priorityLabel(priority: Task['priority']) {
  return priority === 'high' ? '高' : priority === 'medium' ? '中' : priority === 'low' ? '低' : '未设置'
}

function organizationSuggestion(task: Task) {
  if (task.projectId === null) return '补充项目归属'
  if (task.priority === null) return '设置优先级'
  if (task.dueDate === null) return '补充到期时间'
  return '信息完整，可安排执行'
}

function localDateKey(date: Date) {
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function groupFor(task: Task): TaskGroup {
  if (task.completedAt !== null) return 'completed'
  return task.isFocus ? 'focus' : 'later'
}

function tasksForGroup(group: TaskGroup) {
  if (group === 'focus') return workspace.focusTasks.value
  if (group === 'completed') return workspace.completedTasks.value
  return workspace.laterTasks.value
}

async function moveWithinGroup(task: Task, direction: -1 | 1) {
  const group = groupFor(task)
  const ids = tasksForGroup(group).map(item => item.id)
  const index = ids.indexOf(task.id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  openMenuId.value = null
  await workspace.reorderTasks(group, ids)
}
</script>

<template>
  <main class="dashboard-page inbox-page suite-inbox">
    <SuiteHeader section="收集箱" />
    <DashboardTopbar
      section="工作台"
      title="收集箱"
      action-label="添加任务"
      @action="ui.openNewTask(inboxProject?.id ?? null)"
    />

    <div class="dashboard-content">
      <section class="dashboard-heading">
        <div>
          <p>INBOX · 先收集，再整理</p>
          <h1>收集箱</h1>
          <span>把零散事项统一放在这里，再补齐优先级、项目和时间。</span>
        </div>
      </section>

      <section class="suite-capture"><form @submit.prevent="captureTask"><input v-model="capture" aria-label="快速记录收集箱" placeholder="快速记录，例如：下周跟进供应商报价" maxlength="160"><VoiceInputButton @transcript="text=>capture=[capture,text].filter(Boolean).join(' ')" /><button :disabled="capturing||!capture.trim()" aria-label="保存记录"><UIcon name="i-lucide-arrow-up" /></button></form><div><button @click="ui.openDataImport"><UIcon name="i-lucide-file-text" />导入 Word</button><button @click="ui.openDataImport"><UIcon name="i-lucide-table" />导入 Excel</button><button @click="ui.openNewTask(inboxProject?.id??null)">详细新建</button></div><p v-if="captureError" role="alert">{{captureError}}</p></section>
      <section class="dashboard-metric-grid" aria-label="收集箱概览">
        <MetricCard
          data-metric="unorganized"
          label="待整理"
          :value="activeInboxTasks.length"
          hint="仍需安排"
          tone="violet"
          icon="i-lucide-inbox"
        />
        <MetricCard
          data-metric="today-added"
          label="今日新增"
          :value="todayAdded"
          hint="刚刚收集"
          tone="teal"
          icon="i-lucide-sparkles"
        />
        <MetricCard
          data-metric="no-project"
          label="无项目"
          :value="noProjectCount"
          hint="需要归档"
          tone="orange"
          icon="i-lucide-folder"
        />
      </section>

      <section class="dashboard-panel inbox-panel">
        <header class="dashboard-toolbar">
          <div>
            <h2>待整理任务</h2>
            <span>{{ filteredTasks.length }} / {{ inboxTasks.length }} 项</span>
          </div>
          <div class="inbox-bulk-actions" aria-label="批量操作">
            <label class="inbox-select-all">
              <input
                data-select-all
                type="checkbox"
                :checked="allFilteredSelected"
                :indeterminate="someFilteredSelected"
                :disabled="filteredTasks.length === 0"
                @change="toggleAllFiltered"
              >
              <span>{{ allFilteredSelected ? '取消全选' : '全选当前' }}</span>
            </label>
            <button data-bulk-delete type="button" :disabled="selectedTaskIds.length === 0" @click="openBulkDelete">
              <UIcon name="i-lucide-trash-2" />
              删除所选<span v-if="selectedTaskIds.length">({{ selectedTaskIds.length }})</span>
            </button>
          </div>
          <div class="dashboard-filters">
            <label class="dashboard-search">
              <UIcon name="i-lucide-search" />
              <input v-model="search" data-filter="search" type="search" aria-label="搜索收集箱" placeholder="搜索任务">
            </label>
            <select v-model="statusFilter" data-filter="status" aria-label="按状态筛选">
              <option value="all">全部状态</option>
              <option value="active">进行中</option>
              <option value="completed">已完成</option>
            </select>
            <select v-model="priorityFilter" data-filter="priority" aria-label="按优先级筛选">
              <option value="all">全部优先级</option>
              <option value="none">未设置</option>
              <option value="high">高优先级</option>
              <option value="medium">中优先级</option>
              <option value="low">低优先级</option>
            </select>
          </div>
        </header>

        <div v-if="workspace.loading.value" class="dashboard-loading">
          <UIcon name="i-lucide-loader-circle" />正在加载收集箱…
        </div>
        <div v-else-if="filteredTasks.length" class="inbox-table">
          <article
            v-for="(task, index) in filteredTasks"
            :key="task.id"
            data-inbox-task
            class="inbox-task-row"
            :class="{ selected: selectedTaskIdSet.has(task.id) }"
          >
            <label class="inbox-row-select">
              <input
                data-task-select
                type="checkbox"
                :checked="selectedTaskIdSet.has(task.id)"
                :aria-label="`选择 ${task.title}`"
                @change="toggleTaskSelection(task.id, $event)"
              >
            </label>
            <button
              type="button"
              class="task-check"
              :class="{ checked: task.completedAt !== null }"
              :aria-label="`${task.completedAt ? '恢复' : '完成'} ${task.title}`"
              @click="workspace.setTaskCompleted(task.id, task.completedAt === null)"
            >
              <UIcon v-if="task.completedAt" name="i-lucide-check" />
            </button>
            <div class="inbox-task-main">
              <button class="suite-inbox-title" @click="ui.openEditTask(task.id)"><strong :class="{ completed: task.completedAt !== null }">{{ task.title }}</strong></button>
              <span>
                <i :style="{ background: projectFor(task)?.color ?? '#9297a1' }" />
                {{ projectFor(task)?.name ?? '无项目' }}
              </span>
            </div>
            <span class="inbox-priority" :class="task.priority ?? 'none'">{{ priorityLabel(task.priority) }}</span>
            <span class="inbox-due">
              <UIcon name="i-lucide-calendar-days" />
              {{ task.dueDate ?? '未安排' }}
            </span>
            <button
              type="button"
              data-organize-suggestion
              class="organize-suggestion"
              @click="ui.openEditTask(task.id)"
            >
              <UIcon name="i-lucide-wand-sparkles" />{{ organizationSuggestion(task) }}
            </button>
            <div class="task-menu-wrap">
              <button
                type="button"
                class="task-menu-toggle"
                :aria-expanded="openMenuId === task.id"
                :aria-label="`${task.title} 操作菜单`"
                @click="openMenuId = openMenuId === task.id ? null : task.id"
              >
                <UIcon name="i-lucide-ellipsis" />
              </button>
              <TaskActionsMenu
                v-if="openMenuId === task.id"
                :task="task"
                :first="index === 0"
                :last="index === filteredTasks.length - 1"
                @edit="openMenuId = null; ui.openEditTask(task.id)"
                @move="openMenuId = null; workspace.moveTask(task.id, !task.isFocus)"
                @start="openMenuId = null; workspace.startTask(task.id)"
                @pause="openMenuId = null; workspace.updateTask(task.id, { status: 'todo' })"
                @snooze="openMenuId = null; workspace.snoozeTask(task.id, new Date(Date.now() + 10 * 60_000).toISOString())"
                @move-up="moveWithinGroup(task, -1)"
                @move-down="moveWithinGroup(task, 1)"
                @delete="openMenuId = null; ui.askDeleteTask(task.id)"
              />
            </div>
          </article>
        </div>
        <EmptyDashboardState
          v-else
          icon="i-lucide-inbox"
          title="没有符合条件的任务"
          description="调整筛选条件，或把一个新想法先放进收集箱。"
          action-label="添加任务"
          @action="ui.openNewTask(inboxProject?.id ?? null)"
        />
      </section>
    </div>

    <Teleport to="body">
      <div v-if="bulkDeleteOpen" class="dialog-backdrop" @mousedown.self="closeBulkDelete">
        <section class="workspace-dialog delete-dialog inbox-bulk-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="inbox-bulk-delete-title">
          <div class="danger-symbol"><UIcon name="i-lucide-trash-2" /></div>
          <h2 id="inbox-bulk-delete-title">删除 {{ selectedTaskIds.length }} 项任务？</h2>
          <p>所选任务将移入回收站，之后仍可恢复。</p>
          <p v-if="bulkDeleteError" class="inbox-bulk-delete-error" role="alert">{{ bulkDeleteError }}</p>
          <div class="dialog-actions">
            <button type="button" class="secondary-action" :disabled="bulkDeleting" @click="closeBulkDelete">取消</button>
            <button data-confirm-bulk-delete type="button" class="danger-button" :disabled="bulkDeleting" @click="confirmBulkDelete">{{ bulkDeleting ? '正在删除…' : '移入回收站' }}</button>
          </div>
        </section>
      </div>
    </Teleport>
  </main>
</template>

<style scoped>
.inbox-bulk-delete-dialog{width:min(100%,420px)}
.inbox-bulk-delete-error{padding:9px 10px;border-left:3px solid #c34f4f;background:#fff3f3;color:#a33f3f!important}
</style>
