<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { deriveQuarterMetrics } from '#shared/workspace'
import ProjectActionsMenu from '../workspace/ProjectActionsMenu.vue'
import { getCurrentQuarter } from '../../utils/today-view'

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const route = useRoute()
const currentQuarter = getCurrentQuarter(new Date())
const selectedProjectId = computed(() => typeof route.query.project === 'string' ? route.query.project : null)
const openMenuId = ref<string | null>(null)
const quarterProgress = computed(() =>
  deriveQuarterMetrics(workspace.document.value, currentQuarter, new Date()).averageProgress,
)
const inbox = computed(() => workspace.projects.value.find(project => project.name === '收集箱') ?? null)
const visibleProjects = computed(() => workspace.projects.value.filter(project => project.name !== '收集箱'))

onMounted(() => {
  if (!workspace.ready.value) void workspace.load()
})

async function moveProject(projectId: string, direction: -1 | 1) {
  const ids = workspace.projects.value.map(project => project.id)
  const index = ids.indexOf(projectId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  openMenuId.value = null
  await workspace.reorderProjects(ids)
}
</script>

<template>
  <div class="sidebar-inner">
    <header class="workspace-switcher">
      <div><span class="eyebrow">WORKSPACE</span><strong>我的工作台</strong></div>
      <button aria-label="查看本机工作区信息" @click="ui.openWorkspaceInfo"><UIcon name="i-lucide-info" /></button>
    </header>
    <nav class="sidebar-nav" aria-label="工作区导航">
      <NuxtLink to="/" class="sidebar-link"><UIcon name="i-lucide-sun" /><span>Today</span><kbd>G T</kbd></NuxtLink>
      <NuxtLink to="/inbox" class="sidebar-link"><UIcon name="i-lucide-inbox" /><span>收集箱</span><b data-inbox-count>{{ inbox ? workspace.projectCounts.value[inbox.id] ?? 0 : 0 }}</b></NuxtLink>
      <NuxtLink to="/quarter" class="sidebar-link"><UIcon name="i-lucide-goal" /><span>季度追踪</span><em data-quarter-progress>{{ quarterProgress }}%</em></NuxtLink>
      <NuxtLink to="/review" class="sidebar-link"><UIcon name="i-lucide-panels-top-left" /><span>年终总结</span></NuxtLink>
      <NuxtLink to="/trash" class="sidebar-link"><UIcon name="i-lucide-trash-2" /><span>回收站</span><b data-trash-count>{{ workspace.trashCount.value }}</b></NuxtLink>
    </nav>
    <section class="project-section">
      <div class="section-heading"><span>项目</span><button data-new-project aria-label="新建项目" @click="ui.openNewProject"><UIcon name="i-lucide-plus" /></button></div>
      <div v-for="(project, index) in visibleProjects" :key="project.id" data-project-row class="project-row">
        <NuxtLink :to="{ path: '/', query: { project: project.id } }" class="project-link" :class="{ active: selectedProjectId === project.id }">
          <span class="project-dot" :style="{ background: project.color }" />
          <span>{{ project.name }}</span>
          <small>{{ workspace.projectCounts.value[project.id] ?? 0 }}</small>
        </NuxtLink>
        <button data-project-menu-toggle class="project-menu-toggle" :aria-expanded="openMenuId === project.id" aria-label="项目菜单" @click="openMenuId = openMenuId === project.id ? null : project.id"><UIcon name="i-lucide-ellipsis" /></button>
        <ProjectActionsMenu
          v-if="openMenuId === project.id"
          :project="project"
          :first="index === 0"
          :last="index === visibleProjects.length - 1"
          @edit="openMenuId = null; ui.openEditProject(project.id)"
          @move-up="moveProject(project.id, -1)"
          @move-down="moveProject(project.id, 1)"
          @delete="openMenuId = null; ui.askDeleteProject(project.id)"
        />
      </div>
    </section>
    <div class="sidebar-bridge-actions" aria-label="资料工具">
      <button type="button" @click="ui.openDataImport"><UIcon name="i-lucide-file-input" />导入资料</button>
      <button type="button" @click="ui.openFeishuLinks"><UIcon name="i-lucide-external-link" />飞书</button>
    </div>
    <button class="sidebar-create" @click="ui.openNewTask()"><UIcon name="i-lucide-plus" />新建任务<kbd>C</kbd></button>
  </div>
</template>

<style scoped>
.sidebar-bridge-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:auto}
.sidebar-bridge-actions button{display:flex;min-width:0;min-height:36px;gap:6px;align-items:center;justify-content:center;padding:0 7px;border:1px solid rgb(255 255 255 / 8%);border-radius:8px;background:rgb(255 255 255 / 3%);color:#aeb2bb;font-size:12px;cursor:pointer}
.sidebar-bridge-actions button:hover{background:rgb(255 255 255 / 8%);color:#fff}
.sidebar-bridge-actions .iconify{font-size:15px}
.sidebar-create{margin-top:8px}
</style>
