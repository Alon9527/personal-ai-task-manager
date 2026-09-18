<script setup lang="ts">
const ui = useWorkspaceUi()
const tools = [
  { label: 'Today', icon: 'sun', to: '/' },
  { label: '收集箱', icon: 'inbox', to: '/inbox' },
  { label: '任务与日程', icon: 'calendar', to: '/calendar' },
  { label: '项目', icon: 'folder', to: '/project' },
] as const
</script>

<template>
  <nav class="rail-inner" aria-label="应用导航">
    <NuxtLink to="/" class="brand-mark" aria-label="返回 Today" title="返回 Today">
      <svg class="focus-logo" viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M19 19H10a9 9 0 1 1 9-9v9Z" fill="#A78BFA"/><path d="M21 19V10a9 9 0 1 1 9 9h-9Z" fill="#8B5CF6"/><path d="M21 21h9a9 9 0 1 1-9 9v-9Z" fill="#6D4AFF"/><path d="M19 21v9a9 9 0 1 1-9-9h9Z" fill="#8965FF"/></svg>
    </NuxtLink>

    <div class="rail-tools">
      <NuxtLink
        v-for="tool in tools"
        :key="tool.label"
        :to="tool.to"
        class="rail-button"
        :aria-label="tool.label"
        :title="tool.label"
      >
        <AppRailIcon :name="tool.icon" />
      </NuxtLink>
    </div>

    <div class="rail-bottom">
      <button class="rail-button" aria-label="导入资料与飞书" title="导入资料与飞书" @click="ui.openDataImport()">
        <AppRailIcon name="bridge" />
      </button>
      <button class="rail-button" aria-label="全局搜索" title="全局搜索 · Ctrl+K" @click="ui.openSearch()">
        <AppRailIcon name="search" />
      </button>
      <NuxtLink class="rail-button" to="/settings" aria-label="设置" title="设置"><UIcon name="i-lucide-settings" /></NuxtLink>
    </div>
  </nav>
</template>
