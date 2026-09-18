<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { UI_SCALE_OPTIONS } from '../../composables/useUiPreferences'
import { checkDesktopUpdate, currentAppVersion } from '../../services/app-updater'
import type { DesktopUpdateCheck } from '../../services/app-updater'
import ClearWorkspaceDataDialog from './ClearWorkspaceDataDialog.vue'
defineProps<{ embedded?: boolean, section?: 'data'|'updates' }>()
const workspace = useWorkspace()
const ui = useWorkspaceUi()
const preferences = useUiPreferences()
const appVersion = ref('读取中…')
const updateResult = ref<DesktopUpdateCheck | null>(null)
const updateError = ref<string | null>(null)
const checkingUpdate = ref(false)
const installingUpdate = ref(false)
const updateProgress = ref({ downloaded: 0, total: null as number | null })
const storageStatus = ref<{ driver: string, databasePath: string, schemaVersion: number } | null>(null)
const clearDialogOpen = ref(false)
const availableUpdate = computed(() => updateResult.value?.status === 'available' ? updateResult.value : null)
const updatePercent = computed(() => updateProgress.value.total
  ? Math.min(100, Math.round(updateProgress.value.downloaded / updateProgress.value.total * 100))
  : null)

onMounted(async () => {
  appVersion.value = await currentAppVersion()
  if (isTauri() && workspace.backendMode.value === 'sqlite') {
    try {
      storageStatus.value = await invoke('workspace_storage_status')
    }
    catch {
      storageStatus.value = null
    }
  }
})

async function checkUpdate() {
  checkingUpdate.value = true
  updateError.value = null
  updateResult.value = null
  try {
    updateResult.value = await checkDesktopUpdate()
    appVersion.value = updateResult.value.currentVersion
  }
  catch (cause) {
    updateError.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    checkingUpdate.value = false
  }
}

async function installUpdate() {
  if (!availableUpdate.value || installingUpdate.value) return
  installingUpdate.value = true
  updateError.value = null
  updateProgress.value = { downloaded: 0, total: null }
  try {
    await availableUpdate.value.install(progress => {
      updateProgress.value = progress
    })
  }
  catch (cause) {
    updateError.value = cause instanceof Error ? cause.message : String(cause)
    installingUpdate.value = false
  }
}

function createTask() {
  ui.closeWorkspaceInfo()
  ui.openNewTask()
}

function openSearch() {
  ui.closeWorkspaceInfo()
  ui.openSearch()
}

async function clearWorkspaceData() {
  try {
    await workspace.clearWorkspaceData()
    clearDialogOpen.value = false
  }
  catch {
    // The workspace model owns the visible error and the dialog stays open for retry.
  }
}
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <div v-if="embedded || ui.workspaceInfoOpen.value" :class="embedded ? 'suite-inline-info' : 'dialog-backdrop'" :data-section="section" @mousedown.self="!embedded && ui.closeWorkspaceInfo()">
      <section class="workspace-dialog workspace-info-dialog" :role="embedded ? 'region' : 'dialog'" :aria-modal="embedded ? undefined : true" aria-label="本机工作区信息">
        <header class="dialog-header">
          <div><small>LOCAL WORKSPACE</small><h2>我的工作台</h2></div>
          <button v-if="!embedded" aria-label="关闭" @click="ui.closeWorkspaceInfo"><UIcon name="i-lucide-x" /></button>
        </header>
        <div class="workspace-info-body">
          <div class="local-mode-card">
            <span><UIcon name="i-lucide-hard-drive" /></span>
            <div><b>{{ workspace.backendLabel.value }}</b><small>暂不登录，任务数据保存在当前设备</small></div>
          </div>
          <section v-if="storageStatus" class="storage-card" aria-label="SQLite 数据库位置">
            <div><b>SQLite 数据库文件</b><small>结构版本 {{ storageStatus.schemaVersion }}</small></div>
            <code :title="storageStatus.databasePath">{{ storageStatus.databasePath }}</code>
          </section>
          <div class="workspace-info-metrics">
            <article><strong>{{ workspace.projects.value.length }}</strong><span>项目</span></article>
            <article><strong>{{ workspace.tasks.value.length }}</strong><span>任务</span></article>
            <article><strong>{{ workspace.quarterGoals.value.length }}</strong><span>季度目标</span></article>
          </div>
          <p><UIcon name="i-lucide-shield-check" />当前没有登录和云端同步。删除的任务、项目和目标会进入回收站，可随时恢复。</p>
          <section class="readability-card" aria-label="界面大小">
            <div><b>文字与界面大小</b><small>80% 最小 · 85% 更小 · 90% 小 · 100% 默认；桌面端立即生效并自动保存</small></div>
            <div class="scale-options">
              <button
                v-for="option in UI_SCALE_OPTIONS"
                :key="option"
                type="button"
                :aria-pressed="preferences.scale.value === option"
                :class="{ active: preferences.scale.value === option }"
                @click="preferences.setScale(option)"
              >
                {{ Math.round(option * 100) }}%
              </button>
            </div>
          </section>
          <section class="update-card" aria-label="软件更新" data-update-card>
            <div class="update-heading">
              <span><UIcon name="i-lucide-refresh-cw" /></span>
              <div><b>软件更新</b><small>当前版本 {{ appVersion }}</small></div>
            </div>
            <p v-if="updateError" class="update-error">{{ updateError }}</p>
            <p v-else-if="updateResult?.status === 'current'" class="update-current"><UIcon name="i-lucide-circle-check" />{{ updateResult.message }}</p>
            <p v-else-if="updateResult?.status === 'unavailable'" class="update-copy">{{ updateResult.message }}</p>
            <div v-else-if="availableUpdate" class="update-release">
              <b>发现新版本 {{ availableUpdate.version }}</b>
              <p>{{ availableUpdate.body || '已准备好签名更新包。' }}</p>
              <div v-if="installingUpdate" class="update-progress"><span :style="{ width: `${updatePercent ?? 12}%` }" /></div>
              <small v-if="installingUpdate">{{ updatePercent === null ? '正在下载安装包…' : `已下载 ${updatePercent}%` }}</small>
            </div>
            <button v-if="availableUpdate" type="button" class="update-button primary" :disabled="installingUpdate" @click="installUpdate">
              {{ installingUpdate ? '正在安装…' : `下载并安装 ${availableUpdate.version}` }}
            </button>
            <button v-else type="button" class="update-button" :disabled="checkingUpdate" @click="checkUpdate">
              {{ checkingUpdate ? '检查中…' : '检查更新' }}
            </button>
            <small class="update-note">从 GitHub 下载更新并验证签名，无需手动下载安装包。请先保存正在编辑的内容；安装时软件会关闭，已保存的任务和配置会保留。</small>
          </section>
          <section class="danger-zone" aria-label="危险操作">
            <div>
              <span><UIcon name="i-lucide-triangle-alert" /></span>
              <div><b>危险操作</b><small>清除测试数据，让工作区回到完全空白状态</small></div>
            </div>
            <button type="button" data-open-clear-workspace @click="clearDialogOpen = true">清空工作区数据</button>
          </section>
          <div class="dialog-actions">
            <button class="secondary-action" @click="openSearch"><UIcon name="i-lucide-search" />搜索工作区</button>
            <button class="primary-action" @click="createTask"><UIcon name="i-lucide-plus" />新建任务</button>
          </div>
        </div>
      </section>
    </div>
    <ClearWorkspaceDataDialog
      :open="clearDialogOpen"
      :task-count="workspace.document.value.tasks.length"
      :project-count="workspace.document.value.projects.length"
      :milestone-count="workspace.document.value.milestones.length"
      :quarter-goal-count="workspace.document.value.quarterGoals.length"
      :saving="workspace.saving.value"
      @close="clearDialogOpen = false"
      @confirm="clearWorkspaceData"
    />
  </Teleport>
</template>

<style scoped>
.workspace-info-body{padding:18px}.local-mode-card{display:flex;gap:11px;align-items:center;padding:13px;border:1px solid #dedff0;border-radius:10px;background:#f7f6ff}.local-mode-card>span{display:grid;width:36px;height:36px;place-items:center;border-radius:9px;background:#fff;color:#6258d7}.local-mode-card>div{display:grid;gap:3px}.local-mode-card b{font-size:15px}.local-mode-card small{color:#747984;font-size:13px}
.storage-card{display:grid;gap:7px;margin-top:10px;padding:11px 12px;border:1px solid #e3e4ea;border-radius:9px;background:#fbfbfc}.storage-card>div{display:flex;align-items:center;justify-content:space-between;gap:10px}.storage-card b{font-size:13px}.storage-card small{color:#7d828c;font-size:12px}.storage-card code{overflow:hidden;color:#686e78;font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.workspace-info-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}.workspace-info-metrics article{display:grid;place-items:center;min-height:72px;border:1px solid #e6e7eb;border-radius:9px;background:#fbfbfc}.workspace-info-metrics strong{font-size:22px}.workspace-info-metrics span{color:#777d87;font-size:13px}.workspace-info-body>p{display:grid;grid-template-columns:18px 1fr;gap:7px;align-items:start;margin:0;padding:11px;border-radius:8px;background:#f4f7f6;color:#586760;font-size:13px;line-height:1.55}.workspace-info-body>p svg{color:#3d906b}.workspace-info-body .dialog-actions button{display:flex;gap:6px;align-items:center;justify-content:center}
.readability-card{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:14px 0;padding:12px;border:1px solid #e2e3e9;border-radius:9px;background:#fbfbfc}.readability-card>div:first-child{display:grid;gap:3px}.readability-card b{font-size:15px}.readability-card small{color:#747984;font-size:13px}.scale-options{display:flex;gap:5px}.scale-options button{min-width:48px;height:32px;border:1px solid #dedfe5;border-radius:7px;background:#fff;color:#5f6570;font-size:13px;cursor:pointer}.scale-options button.active{border-color:#756ae2;background:#eeeaff;color:#5c52c5;font-weight:700}
.update-card{display:grid;gap:9px;margin:14px 0;padding:12px;border:1px solid #dedff0;border-radius:10px;background:#f8f7ff}.update-heading{display:flex;gap:9px;align-items:center}.update-heading>span{display:grid;width:32px;height:32px;place-items:center;border-radius:8px;background:#fff;color:#6258d7}.update-heading>div{display:grid;gap:2px}.update-heading b{font-size:15px}.update-heading small,.update-note{color:#747984;font-size:12px;line-height:1.45}.update-copy,.update-error,.update-current,.update-release p{margin:0;color:#626872;font-size:13px;line-height:1.5}.update-error{color:#a54444}.update-current{display:flex;gap:5px;align-items:center;color:#32805f}.update-release{display:grid;gap:5px}.update-release>b{font-size:14px}.update-button{min-height:36px;border:1px solid #d9d6f2;border-radius:7px;background:#fff;color:#5f56c7;font-size:13px;font-weight:700;cursor:pointer}.update-button.primary{border-color:#655bd8;background:#6b61df;color:#fff}.update-button:disabled{opacity:.55;cursor:not-allowed}.update-progress{overflow:hidden;height:5px;border-radius:999px;background:#e5e2f7}.update-progress span{display:block;height:100%;border-radius:inherit;background:#6b61df;transition:width .2s}.update-release>small{color:#6f7580;font-size:12px}
.danger-zone{display:flex;gap:12px;align-items:center;justify-content:space-between;margin:14px 0;padding:12px;border:1px solid #efcaca;border-radius:10px;background:#fff8f8}.danger-zone>div{display:flex;gap:9px;align-items:center}.danger-zone>div>span{display:grid;width:32px;height:32px;flex:0 0 auto;place-items:center;border-radius:8px;background:#ffe8e8;color:#bc4949}.danger-zone>div>div{display:grid;gap:2px}.danger-zone b{font-size:14px}.danger-zone small{color:#7d6666;font-size:12px;line-height:1.4}.danger-zone button{min-height:34px;flex:0 0 auto;padding:0 10px;border:1px solid #dc8f8f;border-radius:7px;background:#fff;color:#af3f3f;font-size:12px;font-weight:750;cursor:pointer}.danger-zone button:hover{background:#fff0f0}
</style>
