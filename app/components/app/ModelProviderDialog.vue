<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  createModelProvider,
  deleteModelProvider,
  listModelProviders,
  replaceModelProviderCredential,
  retryModelProviderCredentialCleanup,
  testModelProviderConnection,
  updateModelProvider,
} from '../../services/model-provider'
import type { ModelProviderList, ModelProviderProfile } from '../../services/model-provider'

type ProviderForm = {
  id: string | null
  name: string
  baseUrl: string
  modelId: string
  apiKey: string
}

const props = withDefaults(defineProps<{
  open: boolean
  selectedProfileId?: string | null
  embedded?: boolean
}>(), { selectedProfileId: null })

const emit = defineEmits<{
  close: []
  fallback: []
  change: [value: ModelProviderList]
}>()

const providers = ref<ModelProviderProfile[]>([])
const pendingCredentialDeletes = ref<string[]>([])
const form = reactive<ProviderForm>(emptyForm())
const dialog = ref<HTMLElement | null>(null)
const loading = ref(false)
const mutationPending = ref(false)
const testing = ref(false)
const editing = ref(false)
const rekeyingId = ref<string | null>(null)
const rekeyValue = ref('')
const rekeyError = ref<string | null>(null)
const deleteConfirmationId = ref<string | null>(null)
const validationError = ref<string | null>(null)
const operationError = ref<string | null>(null)
const testResult = ref<string | null>(null)
let opener: { session: number, element: HTMLElement } | null = null
let sessionGeneration = 0
let listGeneration = 0
let connectionTestGeneration = 0
let activeOpenSession = 0

const isBusy = computed(() => loading.value || mutationPending.value || testing.value)

watch(() => props.open, open => {
  if (!import.meta.client) return
  if (!open) {
    closeOpenSession()
    return
  }
  const generation = ++sessionGeneration
  activeOpenSession = generation
  invalidateTransientOperations()
  opener = document.activeElement instanceof HTMLElement ? { session: generation, element: document.activeElement } : null
  resetDraft()
  void focusThenRefresh(generation)
}, { immediate: true, flush: 'post' })

onUnmounted(() => {
  closeOpenSession()
})

onMounted(() => {
  if (props.open) dialog.value?.querySelector<HTMLElement>('[data-provider-close]')?.focus()
})

async function focusThenRefresh(generation: number) {
  await nextTick()
  if (!isCurrent(generation)) return
  dialog.value?.querySelector<HTMLElement>('[data-provider-close]')?.focus()
  void refresh(generation)
}

function emptyForm(): ProviderForm {
  return { id: null, name: '', baseUrl: '', modelId: '', apiKey: '' }
}

function applyList(next: ModelProviderList) {
  providers.value = next.profiles
  pendingCredentialDeletes.value = next.pendingCredentialDeletes
  emit('change', next)
}

function isCurrent(generation: number) {
  return props.open && generation === sessionGeneration
}

async function refresh(generation: number) {
  if (loading.value) return
  const request = ++listGeneration
  loading.value = true
  operationError.value = null
  try {
    const next = await listModelProviders()
    if (isCurrent(generation) && request === listGeneration) applyList(next)
  }
  catch (error) {
    if (isCurrent(generation) && request === listGeneration) operationError.value = message(error, '无法读取服务商设置')
  }
  finally {
    if (isCurrent(generation) && request === listGeneration) loading.value = false
  }
}

function resetDraft() {
  Object.assign(form, emptyForm())
  editing.value = false
  rekeyingId.value = null
  rekeyValue.value = ''
  rekeyError.value = null
  deleteConfirmationId.value = null
  validationError.value = null
  operationError.value = null
  testResult.value = null
}

function beginCreate() {
  if (isBusy.value) return
  resetDraft()
}

function beginEdit(profile: ModelProviderProfile) {
  if (isBusy.value) return
  hydrateEdit(profile)
}

function hydrateEdit(profile: ModelProviderProfile) {
  Object.assign(form, {
    id: profile.id,
    name: profile.name,
    baseUrl: profile.baseUrl,
    modelId: profile.modelId,
    apiKey: '',
  })
  editing.value = true
  rekeyingId.value = null
  rekeyError.value = null
  validationError.value = null
  operationError.value = null
  testResult.value = null
}

function parseForm() {
  const name = form.name.trim()
  const baseUrl = form.baseUrl.trim()
  const modelId = form.modelId.trim()
  const apiKey = form.apiKey
  if (!name || unicodeScalarLength(name) > 40) return '服务商名称不能为空，且最多 40 个字符'
  if (!modelId || unicodeScalarLength(modelId) > 160) return '模型名称不能为空，且最多 160 个字符'
  const urlError = validateBaseUrl(baseUrl)
  if (urlError) return urlError
  const url = new URL(baseUrl)
  if (!form.id && (!apiKey || /[\s\0]/u.test(apiKey) || apiKey.length > 4096) && !isExactLoopback(url)) {
    return '远程服务需要不含空白字符的 Key'
  }
  if (apiKey && (/[\s\0]/u.test(apiKey) || apiKey.length > 4096)) return 'Key 不能包含空白或控制字符'
  return null
}

function unicodeScalarLength(value: string) {
  return [...value].length
}

function isExactLoopback(url: URL) {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
}

function validateBaseUrl(value: string) {
  const trimmed = value.trim()
  if (trimmed.includes('?')) return 'Base URL 不能包含查询参数'
  if (trimmed.includes('#')) return 'Base URL 不能包含片段'
  let url: URL
  try { url = new URL(trimmed) } catch { return '请输入有效的 Base URL' }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return 'Base URL 只支持有效的 HTTP 或 HTTPS 地址'
  if (url.username || url.password) return 'Base URL 不能包含用户名或密码'
  if (url.search) return 'Base URL 不能包含查询参数'
  if (url.hash) return 'Base URL 不能包含片段'
  if (url.protocol === 'http:' && !isExactLoopback(url)) return '远程 Base URL 必须使用 HTTPS；HTTP 仅允许本机回环地址'
  return null
}

async function save() {
  if (isBusy.value) return
  validationError.value = parseForm()
  if (validationError.value) return
  mutationPending.value = true
  operationError.value = null
  const knownProviderIds = new Set(providers.value.map(profile => profile.id))
  try {
    const name = form.name.trim()
    const baseUrl = form.baseUrl.trim()
    const modelId = form.modelId.trim()
    if (form.id) {
      const updated = await updateModelProvider(form.id, { name, baseUrl, modelId })
      providers.value = providers.value.map(profile => profile.id === updated.id ? updated : profile)
      emit('change', { profiles: providers.value, pendingCredentialDeletes: pendingCredentialDeletes.value })
      hydrateEdit(updated)
    }
    else {
      const apiKey = form.apiKey || undefined
      const created = await createModelProvider({ name, baseUrl, modelId, apiKey })
      providers.value = [...providers.value, created]
      emit('change', { profiles: providers.value, pendingCredentialDeletes: pendingCredentialDeletes.value })
      resetDraft()
    }
  }
  catch (error) {
    const failure = message(error, '无法保存服务商设置')
    const next = await reconcileAuthoritativeList()
    const committed = !form.id && next?.profiles.some(profile =>
      !knownProviderIds.has(profile.id)
      && profile.name === form.name.trim()
      && profile.modelId === form.modelId.trim())
    operationError.value = committed
      ? `配置元数据已保存并同步，但 Key 保存失败。请对该配置使用“更换 Key”重试。${failure}`
      : failure
  }
  finally {
    mutationPending.value = false
  }
}

async function saveRekey(profile: ModelProviderProfile) {
  if (isBusy.value) return
  operationError.value = null
  if (!rekeyValue.value || /[\s\0]/u.test(rekeyValue.value)) {
    rekeyError.value = '请输入不含空白字符的 Key'
    return
  }
  mutationPending.value = true
  rekeyError.value = null
  try {
    const updated = await replaceModelProviderCredential(profile.id, rekeyValue.value)
    providers.value = providers.value.map(item => item.id === updated.id ? updated : item)
    emit('change', { profiles: providers.value, pendingCredentialDeletes: pendingCredentialDeletes.value })
    rekeyValue.value = ''
    rekeyingId.value = null
    operationError.value = null
  }
  catch (error) {
    await reconcileAuthoritativeList()
    rekeyError.value = message(error, '无法更新 Key')
  }
  finally {
    mutationPending.value = false
  }
}

async function confirmDelete(profile: ModelProviderProfile) {
  if (isBusy.value) return
  mutationPending.value = true
  operationError.value = null
  try {
    const next = await deleteModelProvider(profile.id)
    applyList(next)
    if (props.selectedProfileId === profile.id) emit('fallback')
    if (form.id === profile.id) resetDraft()
    deleteConfirmationId.value = null
  }
  catch (error) {
    const failure = message(error, '无法删除服务商')
    const next = await reconcileAuthoritativeList()
    const committed = Boolean(next && !next.profiles.some(item => item.id === profile.id))
    if (committed) {
      if (props.selectedProfileId === profile.id) emit('fallback')
      if (form.id === profile.id) resetDraft()
      deleteConfirmationId.value = null
      operationError.value = next?.pendingCredentialDeletes.includes(profile.id)
        ? `配置已停用并同步，但凭据清理失败。请点击“重试清理”。${failure}`
        : `配置已停用并同步。${failure}`
    }
    else {
      operationError.value = failure
    }
  }
  finally {
    mutationPending.value = false
  }
}

async function reconcileAuthoritativeList(): Promise<ModelProviderList | null> {
  try {
    const next = await listModelProviders()
    applyList(next)
    return next
  }
  catch {
    return null
  }
}

async function retryCleanup(id: string) {
  if (isBusy.value) return
  mutationPending.value = true
  operationError.value = null
  try {
    applyList(await retryModelProviderCredentialCleanup(id))
  }
  catch (error) {
    operationError.value = message(error, '凭据清理仍未完成')
  }
  finally {
    mutationPending.value = false
  }
}

async function testConnection(profile: ModelProviderProfile) {
  if (isBusy.value) return
  const generation = sessionGeneration
  const request = ++connectionTestGeneration
  testing.value = true
  testResult.value = null
  operationError.value = null
  try {
    const result = await testModelProviderConnection(profile.id)
    if (!isCurrent(generation) || request !== connectionTestGeneration) return
    testResult.value = `连接成功：${result.modelId}，${result.latencyMs} ms`
  }
  catch (error) {
    if (!isCurrent(generation) || request !== connectionTestGeneration) return
    testResult.value = `连接失败：${message(error, '服务不可用')}`
  }
  finally {
    if (isCurrent(generation) && request === connectionTestGeneration) testing.value = false
  }
}

function requestClose() {
  if (mutationPending.value) return
  closeOpenSession()
  emit('close')
}

function closeOpenSession() {
  const closingSession = activeOpenSession
  activeOpenSession = 0
  invalidateTransientOperations()
  sessionGeneration++
  restoreOpenerFocus(closingSession)
}

function restoreOpenerFocus(closingSession: number) {
  if (!closingSession || opener?.session !== closingSession) return
  const element = opener.element
  const closingDialog = dialog.value
  opener = null
  nextTick(() => {
    if (activeOpenSession !== 0 || !element.isConnected || element.matches(':disabled')) return
    const active = document.activeElement
    const canRestore = active === null
      || active === document.body
      || active === element
      || (active instanceof Node && Boolean(closingDialog?.contains(active)))
    if (!canRestore) return
    element.focus()
  })
}

function invalidateTransientOperations() {
  listGeneration++
  connectionTestGeneration++
  loading.value = false
  testing.value = false
  testResult.value = null
}

function beginRekey(id: string) {
  if (isBusy.value) return
  rekeyingId.value = id
  rekeyValue.value = ''
  rekeyError.value = null
  operationError.value = null
}

function onKeydown(event: KeyboardEvent) {
  if (props.embedded) return
  if (event.key === 'Escape') {
    event.preventDefault()
    requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const nodes = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])]
  if (!nodes.length) return
  const first = nodes[0]!
  const last = nodes[nodes.length - 1]!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

function status(profile: ModelProviderProfile) {
  if (profile.isLocal && !profile.hasCredential) {
    return pendingCredentialDeletes.value.includes(profile.id) ? '本机服务，无凭据；凭据清理待重试' : '本机服务，无凭据'
  }
  const credential = profile.hasCredential ? '凭据已保存' : '未保存凭据'
  const service = profile.isLocal ? '本地服务' : '远程服务'
  const cleanup = pendingCredentialDeletes.value.includes(profile.id) ? '；凭据清理待重试' : ''
  return `${credential} · ${service}${cleanup}`
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <div v-if="open" class="model-provider-dialog" :class="{'suite-inline-models':embedded}" @mousedown.self="!embedded && requestClose()">
      <section ref="dialog" class="model-provider-dialog__panel" :role="embedded ? 'region' : 'dialog'" :aria-modal="embedded ? undefined : true" aria-labelledby="model-provider-title" @keydown="onKeydown">
        <header class="model-provider-dialog__header">
          <div>
            <small>AI ENDPOINTS</small>
            <h2 id="model-provider-title">管理模型服务商</h2>
          </div>
          <button v-if="!embedded" type="button" data-provider-close aria-label="关闭服务商管理" :disabled="mutationPending" @click="requestClose">关闭</button>
        </header>

        <div class="model-provider-dialog__scroll">
          <p class="model-provider-dialog__meta">服务商设置仅保存在此电脑；保存元数据不会连接服务。</p>
          <p v-if="operationError" role="alert" class="model-provider-dialog__error">{{ operationError }}</p>

          <div class="model-provider-dialog__list" aria-label="已保存的模型服务商">
            <p v-if="loading" class="model-provider-dialog__meta">正在读取服务商设置…</p>
            <p v-else-if="!providers.length" class="model-provider-dialog__meta">尚未添加自定义服务商。</p>
            <article v-for="profile in providers" :key="profile.id" class="model-provider-dialog__row">
              <div class="model-provider-dialog__row-main">
                <strong>{{ profile.name }}</strong>
                <span class="model-provider-dialog__meta">{{ profile.modelId }} · {{ profile.baseUrl }}</span>
              </div>
              <aside class="model-provider-dialog__status-rail" :class="{ 'is-local': profile.isLocal, 'is-cleanup': pendingCredentialDeletes.includes(profile.id) }">
                {{ status(profile) }}
              </aside>
              <div class="model-provider-dialog__row-actions">
                <button type="button" data-provider-edit :disabled="isBusy" @click="beginEdit(profile)">编辑</button>
                <button type="button" data-provider-rekey :disabled="isBusy" @click="beginRekey(profile.id)">更换 Key</button>
                <button type="button" data-provider-test :disabled="isBusy" @click="testConnection(profile)">测试连接</button>
                <span data-provider-test-warning class="model-provider-dialog__test-warning">发送最小请求，可能产生少量费用</span>
                <button type="button" data-provider-delete :disabled="isBusy" @click="deleteConfirmationId = profile.id">删除</button>
              </div>
              <div v-if="rekeyingId === profile.id" class="model-provider-dialog__rekey">
                <label><span>新 Key</span><input v-model="rekeyValue" name="rekey" type="password" autocomplete="new-password" :disabled="isBusy" :aria-invalid="rekeyError ? 'true' : undefined" :aria-describedby="rekeyError ? `provider-rekey-error-${profile.id}` : undefined"></label>
                <p v-if="rekeyError" :id="`provider-rekey-error-${profile.id}`" data-provider-rekey-error class="model-provider-dialog__rekey-error" role="alert">{{ rekeyError }}</p>
                <button type="button" data-provider-rekey-save :disabled="isBusy" @click="saveRekey(profile)">保存新 Key</button>
              </div>
              <div v-if="deleteConfirmationId === profile.id" class="model-provider-dialog__confirm" role="alert">
                <span>删除后将移除此服务商；如凭据清理失败，可在下方重试。</span>
                <button type="button" data-provider-delete-confirm :disabled="isBusy" @click="confirmDelete(profile)">再次确认删除</button>
                <button type="button" :disabled="isBusy" @click="deleteConfirmationId = null">取消</button>
              </div>
            </article>
          </div>

          <div v-for="id in pendingCredentialDeletes" :key="id" data-provider-cleanup class="model-provider-dialog__cleanup">
            <span>凭据清理待重试。服务商资料已移除，未显示任何 Key。</span>
            <button type="button" data-provider-cleanup-retry :disabled="isBusy" @click="retryCleanup(id)">重试清理</button>
          </div>

          <p v-if="testResult" data-provider-test-result class="model-provider-dialog__test-result" role="status">{{ testResult }}</p>

          <form class="model-provider-dialog__form" @submit.prevent="save">
            <div class="model-provider-dialog__form-heading">
              <h3>{{ editing ? '编辑服务商元数据' : '添加服务商' }}</h3>
              <button type="button" data-provider-create :disabled="isBusy" @click="beginCreate">新建</button>
            </div>
            <label><span>服务商名称</span><input v-model="form.name" name="name" :disabled="isBusy" autocomplete="off"></label>
            <label><span>Base URL</span><input v-model="form.baseUrl" name="baseUrl" :disabled="isBusy" placeholder="https://example.com/v1" autocomplete="url"></label>
            <label><span>模型</span><input v-model="form.modelId" name="modelId" :disabled="isBusy" autocomplete="off"></label>
            <label v-if="!editing"><span>Key <small>远程服务必填；localhost 可留空</small></span><input v-model="form.apiKey" name="apiKey" type="password" :disabled="isBusy" autocomplete="new-password"></label>
            <p v-if="validationError" role="alert" class="model-provider-dialog__error">{{ validationError }}</p>
            <div class="model-provider-dialog__actions">
              <span class="model-provider-dialog__meta">保存元数据不会连接服务。</span>
              <button type="submit" data-provider-save :disabled="isBusy">{{ mutationPending ? '正在保存…' : (editing ? '保存元数据' : '添加服务商') }}</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  </Teleport>
</template>
