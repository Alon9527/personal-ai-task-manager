<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import WorkspaceOverlays from '../components/workspace/WorkspaceOverlays.vue'
import SuiteAiPanel from '../components/suite/SuiteAiPanel.vue'

const route = useRoute()
const ui = useWorkspaceUi()
const uiPreferences = useUiPreferences()
const isAgentPlan = computed(() => route.path === '/agent-plan')
const suiteWide = computed(() => ['/calendar','/project','/settings'].includes(route.path))
const suiteAi = computed(() => (route.path === '/' && !route.query.project && !route.query.view) || route.path === '/inbox')
useTaskReminders()

onMounted(() => {
  void uiPreferences.load()
  window.addEventListener('keydown', handleShortcut)
  window.addEventListener('focus-ai:new-task', openTaskFromTray)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut)
  window.removeEventListener('focus-ai:new-task', openTaskFromTray)
})

function openTaskFromTray() {
  ui.openNewTask()
}

function handleShortcut(event: KeyboardEvent) {
  const target = event.target
  const typing = target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable="true"]')
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    ui.openSearch()
    return
  }
  if (event.key === 'Escape') {
    ui.closeSearch()
    ui.closeWorkspaceInfo()
    return
  }
  if (!typing && !event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === 'c') {
    event.preventDefault()
    ui.openNewTask()
  }
}
</script>

<template>
  <div class="app-shell suite-shell" :class="{ 'agent-review-mode': isAgentPlan, 'suite-wide': suiteWide }">
    <aside data-zone="rail" class="app-rail" aria-label="应用导航"><AppRail /></aside>
    <aside data-zone="sidebar" class="project-sidebar"><AppProjectSidebar /></aside>
    <section data-zone="content" class="content-canvas"><slot /></section>
    <aside v-if="!isAgentPlan && !suiteWide" data-zone="context" class="context-panel"><SuiteAiPanel v-if="suiteAi" /><AppContextPanel v-else /></aside>
  </div>
  <WorkspaceOverlays />
</template>
