<script setup lang="ts">
const ui = useWorkspaceUi()
const tools = [
  { label: 'Today', icon: 'sun', to: '/' },
  { label: '收集箱', icon: 'inbox', to: '/inbox' },
  { label: '季度', icon: 'quarter', to: '/quarter' },
  { label: '总结', icon: 'review', to: '/review' },
] as const
</script>

<template>
  <nav class="rail-inner" aria-label="应用导航">
    <NuxtLink to="/" class="brand-mark" aria-label="返回 Today" title="返回 Today">
      <span>F</span>
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
      <button class="avatar" aria-label="本机工作区信息" title="本机工作区信息" @click="ui.openWorkspaceInfo">L</button>
    </div>
  </nav>
</template>
