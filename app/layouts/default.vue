<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import WorkspaceOverlays from '../components/workspace/WorkspaceOverlays.vue'

const route = useRoute()
const ui = useWorkspaceUi()
const uiPreferences = useUiPreferences()
const isAgentPlan = computed(() => route.path === '/agent-plan')
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
  <div class="app-shell" :class="{ 'agent-review-mode': isAgentPlan }">
    <aside data-zone="rail" class="app-rail" aria-label="应用导航"><AppRail /></aside>
    <aside data-zone="sidebar" class="project-sidebar"><AppProjectSidebar /></aside>
    <section data-zone="content" class="content-canvas"><slot /></section>
    <aside v-if="!isAgentPlan" data-zone="context" class="context-panel"><AppContextPanel /></aside>
  </div>
  <WorkspaceOverlays />
</template>
