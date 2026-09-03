<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  appendImportedTasks,
  buildImportCandidates,
  parseOfficeDocument,
} from '../../services/document-import'
import type { ImportTaskCandidate, ParsedOfficeDocument } from '../../services/document-import'
import {
  createFeishuLinkStore,
  openFeishuLink,
} from '../../services/feishu-links'
import type { FeishuLink } from '../../services/feishu-links'

const props = defineProps<{
  open: boolean
  initialTab: 'import' | 'feishu'
}>()
const emit = defineEmits<{ close: [] }>()

const workspace = useWorkspace()
const activeTab = ref<'import' | 'feishu'>('import')
const fileInput = ref<HTMLInputElement | null>(null)
const parsedDocument = ref<ParsedOfficeDocument | null>(null)
const candidates = ref<ImportTaskCandidate[]>([])
const parsing = ref(false)
const importing = ref(false)
const error = ref('')
const success = ref('')
const links = ref<FeishuLink[]>([])
const linkLabel = ref('')
const linkUrl = ref('')
const selectedCount = computed(() => candidates.value.filter(candidate => candidate.selected).length)

let linkStore: ReturnType<typeof createFeishuLinkStore> | null = null

watch(
  () => props.open,
  (open) => {
    if (!open) return
    activeTab.value = props.initialTab
    error.value = ''
    success.value = ''
    loadLinks()
  },
)

onMounted(loadLinks)

function loadLinks() {
  if (!import.meta.client) return
  linkStore ??= createFeishuLinkStore(localStorage)
  links.value = linkStore.list()
}

function chooseFile() {
  error.value = ''
  success.value = ''
  fileInput.value?.click()
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  parsing.value = true
  error.value = ''
  success.value = ''
  parsedDocument.value = null
  candidates.value = []
  try {
    const parsed = await parseOfficeDocument(file)
    const nextCandidates = buildImportCandidates(parsed, workspace.projects.value)
    if (nextCandidates.length === 0) throw new Error('文件中没有识别到可导入的任务')
    parsedDocument.value = parsed
    candidates.value = nextCandidates
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法解析该文件'
  }
  finally {
    parsing.value = false
  }
}

function selectAll(selected: boolean) {
  for (const candidate of candidates.value) candidate.selected = selected
}

function applyPriority(candidate: ImportTaskCandidate) {
  candidate.importance = candidate.priority === 'high' ? 'important' : 'normal'
  if (candidate.priority === 'high') candidate.isFocus = true
}

async function importSelected() {
  importing.value = true
  error.value = ''
  success.value = ''
  try {
    const base = await workspace.readLatestDocument()
    const next = appendImportedTasks(base, candidates.value)
    await workspace.replaceWorkspaceDocument(next, base)
    const count = selectedCount.value
    success.value = `已导入 ${count} 项任务，可在 Today 与收集箱继续安排。`
    parsedDocument.value = null
    candidates.value = []
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导入任务失败'
  }
  finally {
    importing.value = false
  }
}

function addLink() {
  error.value = ''
  success.value = ''
  try {
    if (!linkStore) loadLinks()
    const link = linkStore!.add({ label: linkLabel.value, url: linkUrl.value })
    links.value = [...links.value, link]
    linkLabel.value = ''
    linkUrl.value = ''
    success.value = '飞书链接已保存'
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存飞书链接失败'
  }
}

function removeLink(id: string) {
  if (!linkStore) loadLinks()
  linkStore!.remove(id)
  links.value = links.value.filter(link => link.id !== id)
}

async function openLink(link: FeishuLink) {
  error.value = ''
  try {
    await openFeishuLink(link.url)
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '无法打开飞书链接'
  }
}

function close() {
  if (parsing.value || importing.value) return
  emit('close')
}
</script>

<template>
  <div v-if="open" class="dialog-backdrop data-bridge-backdrop" @click.self="close">
    <section class="workspace-dialog data-bridge-dialog" role="dialog" aria-modal="true" aria-labelledby="data-bridge-title">
      <header class="dialog-header">
        <div>
          <small>DATA BRIDGE</small>
          <h2 id="data-bridge-title">资料导入与飞书</h2>
        </div>
        <button type="button" aria-label="关闭" @click="close"><UIcon name="i-lucide-x" /></button>
      </header>

      <nav class="bridge-tabs" aria-label="数据工具">
        <button type="button" :class="{ active: activeTab === 'import' }" @click="activeTab = 'import'; error = ''; success = ''">
          <UIcon name="i-lucide-file-input" />导入 Word / Excel
        </button>
        <button type="button" :class="{ active: activeTab === 'feishu' }" @click="activeTab = 'feishu'; error = ''; success = ''">
          <UIcon name="i-lucide-external-link" />飞书链接
        </button>
      </nav>

      <div v-if="activeTab === 'import'" class="bridge-content import-content">
        <div class="import-dropzone">
          <div class="import-symbol"><UIcon name="i-lucide-files" /></div>
          <div>
            <strong>从本机资料提取待办</strong>
            <p>支持 .docx 和 .xlsx，文件只在本机解析，确认前不会写入任务库。</p>
          </div>
          <button type="button" class="primary-action" :disabled="parsing" @click="chooseFile">
            {{ parsing ? '正在解析…' : '选择文件' }}
          </button>
          <input ref="fileInput" type="file" accept=".docx,.xlsx" hidden @change="handleFile">
        </div>

        <div v-if="parsedDocument" class="import-summary">
          <span><UIcon :name="parsedDocument.kind === 'docx' ? 'i-lucide-file-text' : 'i-lucide-sheet'" />{{ parsedDocument.sourceName }}</span>
          <strong>{{ candidates.length }} 项候选</strong>
        </div>
        <p v-for="warning in parsedDocument?.warnings ?? []" :key="warning" class="bridge-warning">{{ warning }}</p>

        <div v-if="candidates.length" class="candidate-toolbar">
          <label><input type="checkbox" :checked="selectedCount === candidates.length" @change="selectAll(($event.target as HTMLInputElement).checked)">全选</label>
          <span>已选择 {{ selectedCount }} / {{ candidates.length }}</span>
        </div>

        <div v-if="candidates.length" class="candidate-list">
          <article v-for="candidate in candidates" :key="candidate.id" class="candidate-row" :class="{ muted: !candidate.selected }">
            <input v-model="candidate.selected" type="checkbox" :aria-label="`选择第 ${candidate.sourceRow} 行`">
            <div class="candidate-fields">
              <input v-model="candidate.title" class="candidate-title" maxlength="160" aria-label="任务标题">
              <div class="candidate-meta">
                <select v-model="candidate.projectId" aria-label="所属项目">
                  <option :value="null">不指定项目</option>
                  <option v-for="project in workspace.projects.value" :key="project.id" :value="project.id">{{ project.name }}</option>
                </select>
                <select v-model="candidate.priority" aria-label="优先级" @change="applyPriority(candidate)">
                  <option :value="null">普通优先级</option>
                  <option value="high">高优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="low">低优先级</option>
                </select>
                <input v-model="candidate.dueDate" type="date" aria-label="截止日期">
                <label class="focus-check"><input v-model="candidate.isFocus" type="checkbox">今日重点</label>
              </div>
            </div>
          </article>
        </div>

        <div v-else-if="!parsing" class="bridge-empty">
          <UIcon name="i-lucide-scan-text" />
          <span>选择文件后，这里会显示可编辑的任务预览。</span>
        </div>
      </div>

      <div v-else class="bridge-content feishu-content">
        <div class="feishu-intro">
          <span class="feishu-logo">飞</span>
          <div><strong>飞书工作入口</strong><p>保存常用多维表格、文档或项目空间，点击即可用系统浏览器打开。</p></div>
        </div>
        <form class="feishu-form" @submit.prevent="addLink">
          <label><span>名称</span><input v-model="linkLabel" maxlength="40" placeholder="例如：新品项目排期"></label>
          <label><span>飞书链接</span><input v-model="linkUrl" type="url" placeholder="https://your-team.feishu.cn/base/..." spellcheck="false"></label>
          <button type="submit" class="primary-action"><UIcon name="i-lucide-plus" />保存链接</button>
        </form>
        <div v-if="links.length" class="feishu-links">
          <article v-for="link in links" :key="link.id">
            <button type="button" class="feishu-open" @click="openLink(link)">
              <span><strong>{{ link.label }}</strong><small>{{ link.url }}</small></span>
              <UIcon name="i-lucide-arrow-up-right" />
            </button>
            <button type="button" class="feishu-remove" :aria-label="`删除 ${link.label}`" @click="removeLink(link.id)"><UIcon name="i-lucide-trash-2" /></button>
          </article>
        </div>
        <div v-else class="bridge-empty"><UIcon name="i-lucide-link-2" /><span>还没有保存飞书链接。</span></div>
        <p class="integration-note"><UIcon name="i-lucide-shield-check" />当前版本只保存和打开链接，不读取飞书账号或多维表格数据。</p>
      </div>

      <p v-if="error" class="bridge-message error" role="alert">{{ error }}</p>
      <p v-if="success" class="bridge-message success" role="status">{{ success }}</p>

      <footer class="bridge-footer">
        <span v-if="activeTab === 'import'">单个文件最大 8 MB · 一次最多导入 200 项</span>
        <span v-else>仅允许 feishu.cn 与 larksuite.com</span>
        <button v-if="activeTab === 'import' && candidates.length" type="button" class="primary-action" :disabled="selectedCount === 0 || importing" @click="importSelected">
          {{ importing ? '正在导入…' : `导入 ${selectedCount} 项任务` }}
        </button>
        <button v-else type="button" class="secondary-action" @click="close">完成</button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.data-bridge-backdrop{padding:24px}.data-bridge-dialog{display:flex;width:min(960px,calc(100vw - 48px));max-height:min(820px,calc(100vh - 48px));flex-direction:column}.bridge-tabs{display:flex;gap:4px;padding:10px 18px 0;border-bottom:1px solid #eceef1}.bridge-tabs button{display:flex;gap:7px;align-items:center;padding:10px 12px;border:0;border-bottom:2px solid transparent;background:transparent;color:#737780;font-size:14px;font-weight:700;cursor:pointer}.bridge-tabs button.active{border-bottom-color:#7167df;color:#4f46b8}.bridge-content{min-height:360px;overflow:auto;padding:18px 20px}.import-dropzone{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:13px;align-items:center;padding:16px;border:1px dashed #cfd2da;border-radius:10px;background:#fafafd}.import-symbol{display:grid;width:44px;height:44px;place-items:center;border-radius:10px;background:#eceaff;color:#6258d7;font-size:22px}.import-dropzone strong,.feishu-intro strong{font-size:15px}.import-dropzone p,.feishu-intro p{margin:4px 0 0;color:#747984;font-size:13px;line-height:1.5}.primary-action:disabled{opacity:.5;cursor:not-allowed}.import-summary,.candidate-toolbar{display:flex;align-items:center;justify-content:space-between;margin-top:16px}.import-summary span{display:flex;gap:7px;align-items:center;font-size:14px}.import-summary strong{color:#6258d7;font-size:13px}.bridge-warning{margin:8px 0 0;color:#9a6b21;font-size:12px}.candidate-toolbar{padding:9px 11px;border:1px solid #e4e5e9;border-radius:8px;background:#f7f8fa;color:#696e77;font-size:12px}.candidate-toolbar label{display:flex;gap:7px;align-items:center}.candidate-list{display:grid;gap:8px;margin-top:9px}.candidate-row{display:grid;grid-template-columns:22px 1fr;gap:9px;align-items:start;padding:11px;border:1px solid #e3e4e9;border-radius:9px;background:#fff}.candidate-row.muted{opacity:.5}.candidate-row>input{margin-top:8px}.candidate-fields{display:grid;gap:8px}.candidate-title{width:100%;height:34px;padding:0 9px;border:1px solid #dfe1e6;border-radius:7px;font-size:14px;font-weight:650}.candidate-meta{display:grid;grid-template-columns:minmax(130px,1fr) 130px 145px auto;gap:8px}.candidate-meta select,.candidate-meta>input{height:32px;min-width:0;padding:0 8px;border:1px solid #dfe1e6;border-radius:7px;background:#fff;color:#555b65;font-size:12px}.focus-check{display:flex;gap:6px;align-items:center;padding:0 7px;color:#5d626b;font-size:12px;white-space:nowrap}.bridge-empty{display:grid;min-height:150px;place-items:center;align-content:center;gap:9px;color:#92969e;font-size:13px}.bridge-empty>.iconify{font-size:28px;color:#b3b5bd}.feishu-intro{display:flex;gap:12px;align-items:center;padding:14px;border-radius:10px;background:linear-gradient(135deg,#f0f8ff,#f6f5ff)}.feishu-logo{display:grid;width:44px;height:44px;flex:0 0 44px;place-items:center;border-radius:12px;background:#3370ff;color:#fff;font-size:20px;font-weight:800}.feishu-form{display:grid;grid-template-columns:180px minmax(260px,1fr) auto;gap:10px;align-items:end;margin-top:16px}.feishu-form label{display:grid;gap:6px}.feishu-form label span{color:#656a73;font-size:12px;font-weight:700}.feishu-form input{height:36px;padding:0 10px;border:1px solid #dfe1e6;border-radius:7px;font-size:13px}.feishu-form button{display:flex;gap:6px;align-items:center;height:36px}.feishu-links{display:grid;gap:8px;margin-top:16px}.feishu-links article{display:grid;grid-template-columns:minmax(0,1fr) 38px;gap:5px}.feishu-open{display:flex;min-width:0;align-items:center;justify-content:space-between;padding:11px 12px;border:1px solid #e1e3e8;border-radius:9px;background:#fff;color:#343841;text-align:left;cursor:pointer}.feishu-open:hover{border-color:#a9c1ff;background:#f8faff}.feishu-open>span{display:grid;min-width:0;gap:3px}.feishu-open small{overflow:hidden;color:#838893;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.feishu-remove{display:grid;place-items:center;border:1px solid #ececef;border-radius:8px;background:#fff;color:#a0a3aa;cursor:pointer}.feishu-remove:hover{border-color:#f0caca;color:#c44e4e}.integration-note{display:flex;gap:7px;align-items:center;margin:15px 0 0;color:#6f7580;font-size:12px}.bridge-message{margin:0 20px 12px;padding:9px 11px;border-radius:7px;font-size:13px}.bridge-message.error{background:#fff0f0;color:#ad4141}.bridge-message.success{background:#edf9f2;color:#287052}.bridge-footer{display:flex;min-height:62px;align-items:center;justify-content:space-between;padding:12px 20px;border-top:1px solid #eceef1;background:#fafafd}.bridge-footer>span{color:#858a94;font-size:12px}.bridge-footer button{min-height:36px;padding:0 14px;border-radius:7px}@media(max-width:760px){.data-bridge-backdrop{padding:0}.data-bridge-dialog{width:100%;max-height:100vh;border-radius:0}.import-dropzone{grid-template-columns:40px 1fr}.import-dropzone>button{grid-column:1/-1}.candidate-meta{grid-template-columns:1fr 1fr}.feishu-form{grid-template-columns:1fr}.bridge-footer{position:sticky;bottom:0}.bridge-footer>span{display:none}}
</style>
