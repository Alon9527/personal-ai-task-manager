<script setup lang="ts">
defineProps<{ section: string }>()
const ui = useWorkspaceUi()
</script>
<template>
  <header class="suite-topbar"><div>工作空间 <span>/</span> <b>{{ section }}</b></div><nav><button class="suite-search" @click="ui.openSearch()"><UIcon name="i-lucide-search" /><span>搜索任务、项目或内容…</span><kbd>Ctrl K</kbd></button><NuxtLink to="/settings?tab=notifications" aria-label="通知设置"><UIcon name="i-lucide-bell" /></NuxtLink><NuxtLink to="/settings" class="suite-avatar" aria-label="设置">L</NuxtLink></nav></header>
</template>
