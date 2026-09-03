<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

const workspace = useWorkspace()
const ui = useWorkspaceUi()
const router = useRouter()
const input = ref<HTMLInputElement | null>(null)

const query = computed({
  get: () => ui.searchPalette.value.query,
  set: value => { ui.searchPalette.value = { open: true, query: value } },
})
const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('zh-CN'))
const taskResults = computed(() => workspace.tasks.value
  .filter(task => matches(`${task.title} ${task.description}`))
  .slice(0, 8))
const projectResults = computed(() => workspace.projects.value
  .filter(project => matches(project.name))
  .slice(0, 5))
const goalResults = computed(() => workspace.quarterGoals.value
  .filter(goal => matches(`${goal.title} ${goal.description}`))
  .slice(0, 5))
const hasResults = computed(() => taskResults.value.length + projectResults.value.length + goalResults.value.length > 0)

watch(() => ui.searchPalette.value.open, async (open) => {
  if (!open) return
  if (!workspace.ready.value) await workspace.load()
  await nextTick()
  input.value?.focus()
})

function matches(value: string) {
  return !normalizedQuery.value || value.toLocaleLowerCase('zh-CN').includes(normalizedQuery.value)
}

function editTask(id: string) {
  ui.closeSearch()
  ui.openEditTask(id)
}

async function openProject(id: string) {
  ui.closeSearch()
  await router.push({ path: '/', query: { project: id } })
}

function editGoal(id: string) {
  ui.closeSearch()
  ui.openEditQuarterGoal(id)
}

async function go(path: string) {
  ui.closeSearch()
  await router.push(path)
}
</script>

<template>
  <Teleport to="body">
    <div v-if="ui.searchPalette.value.open" class="command-backdrop" @mousedown.self="ui.closeSearch">
      <section data-command-palette class="command-palette" role="dialog" aria-modal="true" aria-label="全局搜索">
        <header class="command-search">
          <UIcon name="i-lucide-search" />
          <input ref="input" v-model="query" aria-label="搜索任务、项目和目标" placeholder="搜索任务、项目和目标…" @keydown.esc="ui.closeSearch">
          <kbd>Esc</kbd>
        </header>

        <div class="command-results">
          <section v-if="!normalizedQuery" class="command-section">
            <small>快速操作</small>
            <button @click="ui.closeSearch(); ui.openNewTask()"><UIcon name="i-lucide-plus" /><span><b>新建任务</b><em>打开完整任务编辑器</em></span></button>
            <button @click="ui.closeSearch(); ui.openNewProject()"><UIcon name="i-lucide-folder-plus" /><span><b>新建项目</b><em>添加到当前工作区</em></span></button>
            <button @click="go('/inbox')"><UIcon name="i-lucide-inbox" /><span><b>打开收集箱</b><em>整理尚未归档的任务</em></span></button>
          </section>

          <section v-if="taskResults.length" class="command-section">
            <small>任务 · {{ taskResults.length }}</small>
            <button v-for="task in taskResults" :key="task.id" data-search-task @click="editTask(task.id)">
              <UIcon :name="task.completedAt ? 'i-lucide-circle-check' : 'i-lucide-circle'" />
              <span><b>{{ task.title }}</b><em>{{ task.dueDate ?? '未安排日期' }} · {{ task.priority ?? '无优先级' }}</em></span>
            </button>
          </section>

          <section v-if="projectResults.length" class="command-section">
            <small>项目 · {{ projectResults.length }}</small>
            <button v-for="project in projectResults" :key="project.id" data-search-project @click="openProject(project.id)">
              <span class="command-project-dot" :style="{ background: project.color }" />
              <span><b>{{ project.name }}</b><em>{{ workspace.projectCounts.value[project.id] ?? 0 }} 项任务</em></span>
            </button>
          </section>

          <section v-if="goalResults.length" class="command-section">
            <small>季度目标 · {{ goalResults.length }}</small>
            <button v-for="goal in goalResults" :key="goal.id" data-search-goal @click="editGoal(goal.id)">
              <UIcon name="i-lucide-goal" />
              <span><b>{{ goal.title }}</b><em>{{ goal.quarter }} · {{ goal.progress }}%</em></span>
            </button>
          </section>

          <div v-if="normalizedQuery && !hasResults" class="command-empty">
            <UIcon name="i-lucide-search-x" />
            <b>没有匹配结果</b>
            <span>换个关键词，或直接创建新任务。</span>
            <button @click="ui.closeSearch(); ui.openNewTask()">创建任务</button>
          </div>
        </div>

        <footer><span><kbd>Ctrl</kbd><kbd>K</kbd> 打开搜索</span><span>结果来自本机工作区</span></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.command-backdrop{position:fixed;z-index:130;inset:0;display:flex;align-items:flex-start;justify-content:center;padding:11vh 18px 18px;background:rgb(13 15 19 / 50%);backdrop-filter:blur(4px)}
.command-palette{width:min(100%,620px);overflow:hidden;border:1px solid #d9dbe1;border-radius:14px;background:#fff;box-shadow:0 28px 90px rgb(12 16 26 / 30%);color:#292c33}
.command-search{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:58px;padding:0 16px;border-bottom:1px solid #e8e9ed;color:#696e78}
.command-search input{width:100%;border:0;outline:0;background:transparent;color:#272a31;font-size:14px}.command-search kbd,.command-palette footer kbd{padding:3px 6px;border:1px solid #dfe1e6;border-radius:5px;background:#f7f7f9;color:#858a93;font-family:inherit;font-size:11px}
.command-results{max-height:min(60vh,520px);overflow:auto;padding:8px}.command-section{display:grid;gap:2px;padding:5px 0}.command-section>small{padding:6px 10px;color:#969aa2;font-size:11px;font-weight:750;letter-spacing:.08em;text-transform:uppercase}
.command-section>button{display:grid;grid-template-columns:22px minmax(0,1fr);gap:9px;align-items:center;min-height:46px;padding:6px 10px;border:0;border-radius:8px;background:transparent;color:#666b75;text-align:left;cursor:pointer}.command-section>button:hover,.command-section>button:focus-visible{outline:0;background:#f1f0fb;color:#5f56c8}.command-section>button>span:last-child{display:grid;gap:2px}.command-section b{overflow:hidden;color:#363a42;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.command-section em{color:#969aa2;font-size:11px;font-style:normal}.command-project-dot{width:9px;height:9px;margin-left:3px;border-radius:50%}
.command-empty{display:grid;place-items:center;min-height:220px;padding:30px;color:#9a9ea7;text-align:center}.command-empty>svg{font-size:28px}.command-empty b{margin-top:10px;color:#4e525a;font-size:15px}.command-empty span{margin-top:4px;font-size:12px}.command-empty button{margin-top:14px;padding:7px 12px;border:1px solid #665bd8;border-radius:7px;background:#6b61df;color:#fff;font-size:12px;cursor:pointer}
.command-palette footer{display:flex;justify-content:space-between;padding:10px 14px;border-top:1px solid #e8e9ed;background:#fafafd;color:#999da5;font-size:11px}.command-palette footer span:first-child{display:flex;gap:4px;align-items:center}
@media(max-width:760px){.command-backdrop{padding:12px;align-items:center}.command-results{max-height:65vh}.command-palette footer span:last-child{display:none}}
</style>