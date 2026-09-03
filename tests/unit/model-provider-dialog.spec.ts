import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ModelProviderDialog from '../../app/components/app/ModelProviderDialog.vue'

const service = vi.hoisted(() => ({
  listModelProviders: vi.fn(),
  createModelProvider: vi.fn(),
  updateModelProvider: vi.fn(),
  replaceModelProviderCredential: vi.fn(),
  deleteModelProvider: vi.fn(),
  retryModelProviderCredentialCleanup: vi.fn(),
  testModelProviderConnection: vi.fn(),
}))

vi.mock('../../app/services/model-provider', () => service)

const PROFILE_ID = '550e8400-e29b-41d4-a716-446655440000'
const OTHER_PROFILE_ID = '550e8400-e29b-41d4-a716-446655440001'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: PROFILE_ID,
    name: 'MiniMax M3',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'MiniMax-M3',
    credentialGeneration: 0,
    hasCredential: true,
    isLocal: false,
    createdAt: '2026-08-17T08:30:45.123Z',
    updatedAt: '2026-08-17T08:30:45.123Z',
    ...overrides,
  }
}

const flush = async () => {
  await Promise.resolve()
  await nextTick()
}

const wrappers: Array<Awaited<ReturnType<typeof mountDialog>>> = []

async function mountDialog(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(ModelProviderDialog, {
    attachTo: document.body,
    props: { open: true, selectedProfileId: null, ...props },
    global: { stubs: { Teleport: true } },
  })
  wrappers.push(wrapper)
  await flush()
  return wrapper
}

async function startCreate(wrapper: Awaited<ReturnType<typeof mountDialog>>) {
  await wrapper.get('[data-provider-create]').trigger('click')
  await wrapper.get('[name="name"]').setValue('  New endpoint  ')
  await wrapper.get('[name="baseUrl"]').setValue('https://new.example.com/v1')
  await wrapper.get('[name="modelId"]').setValue('new-model')
}

describe('model provider dialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    service.listModelProviders.mockResolvedValue({ profiles: [profile()], pendingCredentialDeletes: [] })
    service.createModelProvider.mockResolvedValue(profile({ id: OTHER_PROFILE_ID, name: 'New endpoint', modelId: 'new-model' }))
    service.updateModelProvider.mockResolvedValue(profile({ name: 'Renamed endpoint' }))
    service.replaceModelProviderCredential.mockResolvedValue(profile())
    service.deleteModelProvider.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [] })
    service.retryModelProviderCredentialCleanup.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [] })
    service.testModelProviderConnection.mockResolvedValue({ ok: true, modelId: 'MiniMax-M3', latencyMs: 12 })
  })

  afterEach(() => {
    while (wrappers.length) wrappers.pop()?.unmount()
    document.body.innerHTML = ''
  })

  it('renders provider facts and truthful status without rendering a key', async () => {
    const wrapper = await mountDialog()

    expect(wrapper.text()).toContain('MiniMax M3')
    expect(wrapper.text()).toContain('MiniMax-M3')
    expect(wrapper.text()).toContain('https://api.example.com/v1')
    expect(wrapper.text()).toContain('凭据已保存')
    expect(wrapper.text()).not.toMatch(/api\s*key|密钥值|synthetic-test-secret/i)
  })

  it('validates the create form before saving', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-create]').trigger('click')
    await wrapper.get('form').trigger('submit')

    expect(service.createModelProvider).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toContain('服务商名称')
  })

  it('requires a key for remote creation but permits keyless localhost', async () => {
    const wrapper = await mountDialog()
    await startCreate(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toContain('远程服务')
    expect(service.createModelProvider).not.toHaveBeenCalled()

    await wrapper.get('[name="baseUrl"]').setValue('http://localhost:11434/v1')
    await wrapper.get('form').trigger('submit')
    await flush()
    expect(service.createModelProvider).toHaveBeenCalledWith({
      name: 'New endpoint', baseUrl: 'http://localhost:11434/v1', modelId: 'new-model', apiKey: undefined,
    })
  })

  it.each([
    ['https://api.example.com/v1', true],
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:8080/v1', true],
    ['http://[::1]:8080/v1', true],
    ['http://api.example.com/v1', false],
    ['http://localhost.example.com/v1', false],
    ['http://127.0.0.2/v1', false],
    ['http://[::2]/v1', false],
    ['ftp://api.example.com/v1', false],
    ['https://user:secret@api.example.com/v1', false],
    ['https://api.example.com/v1?debug=true', false],
    ['https://api.example.com/v1#models', false],
    ['https://api.example.com/v1?', false],
    ['https://api.example.com/v1#', false],
  ])('matches the Rust Base URL policy for %s', async (baseUrl, accepted) => {
    const wrapper = await mountDialog()
    await startCreate(wrapper)
    await wrapper.get('[name="baseUrl"]').setValue(baseUrl)
    await wrapper.get('[name="apiKey"]').setValue('one-time-synthetic-key')
    await wrapper.get('form').trigger('submit')
    await flush()

    if (accepted) expect(service.createModelProvider).toHaveBeenCalledTimes(1)
    else {
      expect(service.createModelProvider).not.toHaveBeenCalled()
      expect(wrapper.get('[role="alert"]').text()).toContain('Base URL')
    }
  })

  it('edits metadata without requesting or sending the prior key', async () => {
    service.updateModelProvider.mockResolvedValue(profile({
      name: 'Canonical endpoint', baseUrl: 'https://api.example.com/v1', modelId: 'canonical-model',
    }))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-edit]').trigger('click')

    expect(wrapper.find('[name="apiKey"]').exists()).toBe(false)
    await wrapper.get('[name="name"]').setValue('  Renamed endpoint ')
    await wrapper.get('form').trigger('submit')
    await flush()

    expect(service.updateModelProvider).toHaveBeenCalledWith(PROFILE_ID, {
      name: 'Renamed endpoint', baseUrl: 'https://api.example.com/v1', modelId: 'MiniMax-M3',
    })
    expect(JSON.stringify(service.updateModelProvider.mock.calls)).not.toContain('apiKey')
    expect((wrapper.get('[name="name"]').element as HTMLInputElement).value).toBe('Canonical endpoint')
    expect((wrapper.get('[name="baseUrl"]').element as HTMLInputElement).value).toBe('https://api.example.com/v1')
    expect((wrapper.get('[name="modelId"]').element as HTMLInputElement).value).toBe('canonical-model')
  })

  it('rekeys through a password input and clears it after success', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-rekey]').trigger('click')
    const key = wrapper.get('[name="rekey"]')
    expect(key.attributes('type')).toBe('password')
    await key.setValue('one-time-synthetic-key')
    await wrapper.get('[data-provider-rekey-save]').trigger('click')
    await flush()

    expect(service.replaceModelProviderCredential).toHaveBeenCalledWith(PROFILE_ID, 'one-time-synthetic-key')
    expect(wrapper.find('[name="rekey"]').exists()).toBe(false)
  })

  it('keeps a rekey failure next to the password field with ARIA details', async () => {
    service.replaceModelProviderCredential.mockRejectedValue(new Error('凭据存储不可用'))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-rekey]').trigger('click')
    const key = wrapper.get('[name="rekey"]')
    await key.setValue('one-time-synthetic-key')
    await wrapper.get('[data-provider-rekey-save]').trigger('click')
    await flush()

    const error = wrapper.get('[data-provider-rekey-error]')
    const failedKey = wrapper.get('[name="rekey"]')
    expect(failedKey.attributes('aria-invalid')).toBe('true')
    expect(failedKey.attributes('aria-describedby')).toBe(error.attributes('id'))
    expect(error.text()).toContain('凭据存储不可用')
  })

  it('reconciles the authoritative credential generation after a failed rekey', async () => {
    service.listModelProviders
      .mockResolvedValueOnce({ profiles: [profile()], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce({
        profiles: [profile({ credentialGeneration: 1 })],
        pendingCredentialDeletes: [],
      })
    service.replaceModelProviderCredential.mockRejectedValue(new Error('凭据写入结果不确定'))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-rekey]').trigger('click')
    await wrapper.get('[name="rekey"]').setValue('one-time-synthetic-key')
    await wrapper.get('[data-provider-rekey-save]').trigger('click')
    await flush()

    expect(service.listModelProviders).toHaveBeenCalledTimes(2)
    const changes = wrapper.emitted('change') ?? []
    expect(changes.at(-1)?.[0]).toEqual({
      profiles: [profile({ credentialGeneration: 1 })],
      pendingCredentialDeletes: [],
    })
    expect(wrapper.get('[data-provider-rekey-error]').text()).toContain('凭据写入结果不确定')
  })

  it('disables the rekey input while its mutation is in flight', async () => {
    let resolveRekey: (value: ReturnType<typeof profile>) => void = () => undefined
    service.replaceModelProviderCredential.mockImplementation(() => new Promise(resolve => { resolveRekey = resolve }))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-rekey]').trigger('click')
    const key = wrapper.get('[name="rekey"]')
    await key.setValue('one-time-synthetic-key')
    await wrapper.get('[data-provider-rekey-save]').trigger('click')
    await flush()
    expect(wrapper.get('[name="rekey"]').attributes('disabled')).toBeDefined()
    resolveRekey(profile())
    await flush()
  })

  it('clears a stale operation error before and after a successful rekey', async () => {
    service.deleteModelProvider.mockRejectedValue(new Error('清理失败'))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-delete]').trigger('click')
    await wrapper.get('[data-provider-delete-confirm]').trigger('click')
    await flush()
    expect(wrapper.get('.model-provider-dialog__error').text()).toContain('清理失败')

    await wrapper.get('[data-provider-rekey]').trigger('click')
    await wrapper.get('[name="rekey"]').setValue('one-time-synthetic-key')
    await wrapper.get('[data-provider-rekey-save]').trigger('click')
    await flush()

    expect(wrapper.find('.model-provider-dialog__error').exists()).toBe(false)
    expect(wrapper.find('[data-provider-rekey-error]').exists()).toBe(false)
  })

  it('requires a second delete click before removing a profile', async () => {
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-delete]').trigger('click')
    expect(service.deleteModelProvider).not.toHaveBeenCalled()
    await wrapper.get('[data-provider-delete-confirm]').trigger('click')
    await flush()

    expect(service.deleteModelProvider).toHaveBeenCalledWith(PROFILE_ID)
    expect(wrapper.text()).not.toContain('MiniMax M3')
  })

  it('emits the fallback event when deletion removes the selected profile', async () => {
    const wrapper = await mountDialog({ selectedProfileId: PROFILE_ID })
    await wrapper.get('[data-provider-delete]').trigger('click')
    await wrapper.get('[data-provider-delete-confirm]').trigger('click')
    await flush()

    expect(wrapper.emitted('fallback')).toHaveLength(1)
  })

  it('reconciles a registry-first create when credential save fails and shows the retry path', async () => {
    const committed = profile({
      id: OTHER_PROFILE_ID,
      name: 'New endpoint',
      baseUrl: 'https://new.example.com/v1',
      modelId: 'new-model',
      hasCredential: false,
    })
    service.listModelProviders
      .mockResolvedValueOnce({ profiles: [profile()], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce({ profiles: [profile(), committed], pendingCredentialDeletes: [] })
    service.createModelProvider.mockRejectedValue(new Error('保存 Windows 凭据失败'))
    const wrapper = await mountDialog()

    await startCreate(wrapper)
    await wrapper.get('[name="baseUrl"]').setValue('https://new.example.com/v1///')
    await wrapper.get('[name="apiKey"]').setValue('one-time-synthetic-key')
    await wrapper.get('form').trigger('submit')
    await flush()

    expect(service.listModelProviders).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('New endpoint')
    expect(wrapper.text()).toContain('未保存凭据')
    expect(wrapper.get('.model-provider-dialog__error').text()).toMatch(/已同步|更换 Key|重试/)
  })

  it('reconciles a registry-first delete failure, exposes cleanup, and falls back if selected', async () => {
    service.listModelProviders
      .mockResolvedValueOnce({ profiles: [profile()], pendingCredentialDeletes: [] })
      .mockResolvedValueOnce({ profiles: [], pendingCredentialDeletes: [PROFILE_ID] })
    service.deleteModelProvider.mockRejectedValue(new Error('删除 Windows 凭据失败'))
    const wrapper = await mountDialog({ selectedProfileId: PROFILE_ID })

    await wrapper.get('[data-provider-delete]').trigger('click')
    await wrapper.get('[data-provider-delete-confirm]').trigger('click')
    await flush()

    expect(service.listModelProviders).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('MiniMax M3')
    expect(wrapper.get('[data-provider-cleanup]').text()).toContain('凭据清理待重试')
    expect(wrapper.get('.model-provider-dialog__error').text()).toMatch(/已停用|已同步|重试/)
    expect(wrapper.emitted('fallback')).toHaveLength(1)
  })

  it('keeps cleanup failure visible and retries it', async () => {
    service.listModelProviders.mockResolvedValue({ profiles: [], pendingCredentialDeletes: [PROFILE_ID] })
    const wrapper = await mountDialog()
    expect(wrapper.get('[data-provider-cleanup]').text()).toContain('凭据清理待重试')
    await wrapper.get('[data-provider-cleanup-retry]').trigger('click')
    await flush()

    expect(service.retryModelProviderCredentialCleanup).toHaveBeenCalledWith(PROFILE_ID)
  })

  it('uses the exact local status copy when no credential is needed', async () => {
    service.listModelProviders.mockResolvedValue({
      profiles: [profile({ hasCredential: false, isLocal: true })], pendingCredentialDeletes: [],
    })
    const wrapper = await mountDialog()
    expect(wrapper.get('.model-provider-dialog__status-rail').text()).toBe('本机服务，无凭据')
  })

  it('tests only after an explicit click, prevents double submit, and preserves selection', async () => {
    let resolveTest: (value: { ok: boolean, modelId: string, latencyMs: number }) => void = () => undefined
    service.testModelProviderConnection.mockImplementation(() => new Promise(resolve => { resolveTest = resolve }))
    const wrapper = await mountDialog({ selectedProfileId: OTHER_PROFILE_ID })
    const test = wrapper.get('[data-provider-test]')
    expect(test.element.nextElementSibling).toBe(wrapper.get('[data-provider-test-warning]').element)
    expect(wrapper.get('[data-provider-test-warning]').text()).toBe('发送最小请求，可能产生少量费用')
    expect(service.testModelProviderConnection).not.toHaveBeenCalled()

    const first = test.trigger('click')
    const second = test.trigger('click')
    await flush()
    expect(service.testModelProviderConnection).toHaveBeenCalledTimes(1)
    resolveTest({ ok: true, modelId: 'MiniMax-M3', latencyMs: 12 })
    await Promise.all([first, second])
    await flush()

    expect(wrapper.get('[data-provider-test-result]').text()).toContain('连接成功')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('renders a connection error without changing the selected profile', async () => {
    service.testModelProviderConnection.mockRejectedValue(new Error('连接被拒绝'))
    const wrapper = await mountDialog({ selectedProfileId: OTHER_PROFILE_ID })
    await wrapper.get('[data-provider-test]').trigger('click')
    await flush()

    expect(wrapper.get('[data-provider-test-result]').text()).toContain('连接被拒绝')
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('returns focus on close and refuses Escape while a mutation is running', async () => {
    let resolveCreate: (value: ReturnType<typeof profile>) => void = () => undefined
    service.createModelProvider.mockImplementation(() => new Promise(resolve => { resolveCreate = resolve }))
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountDialog()
    await startCreate(wrapper)
    await wrapper.get('[name="apiKey"]').setValue('one-time-synthetic-key')
    const save = wrapper.get('[data-provider-save]')
    const pending = save.trigger('click')
    await flush()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toBeUndefined()

    resolveCreate(profile())
    await pending
    await flush()
    await wrapper.get('[data-provider-close]').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(document.activeElement).toBe(opener)
  })

  it('closes on idle Escape, restores opener focus, and cycles keyboard focus', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountDialog()
    const close = wrapper.get('[data-provider-close]')
    const save = wrapper.get('[data-provider-save]')

    ;(close.element as HTMLElement).focus()
    await close.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save.element)
    await save.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(close.element)

    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('restores opener focus when the parent externally closes the dialog', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountDialog()
    expect(document.activeElement).toBe(wrapper.get('[data-provider-close]').element)

    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('does not override a meaningful parent focus target before queued opener restoration', async () => {
    const opener = document.createElement('button')
    const workflowTarget = document.createElement('button')
    document.body.append(opener, workflowTarget)
    opener.focus()
    const wrapper = await mountDialog()

    const close = wrapper.setProps({ open: false })
    workflowTarget.focus()
    await close
    await nextTick()

    expect(document.activeElement).toBe(workflowTarget)
  })

  it('restores a connected opener when the dialog unmounts externally', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountDialog()
    expect(document.activeElement).toBe(wrapper.get('[data-provider-close]').element)

    wrapper.unmount()
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('does not let a rapid close and reopen restore focus to the prior session opener', async () => {
    const priorOpener = document.createElement('button')
    document.body.append(priorOpener)
    priorOpener.focus()
    const wrapper = await mountDialog()

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await nextTick()
    await nextTick()

    expect(document.activeElement).not.toBe(priorOpener)
  })

  it('does not steal focus on unmount after an externally closed dialog has already restored it', async () => {
    const opener = document.createElement('button')
    const laterFocus = document.createElement('button')
    document.body.append(opener, laterFocus)
    opener.focus()
    const wrapper = await mountDialog()
    await wrapper.setProps({ open: false })
    await nextTick()
    expect(document.activeElement).toBe(opener)

    laterFocus.focus()
    wrapper.unmount()
    await nextTick()
    expect(document.activeElement).toBe(laterFocus)
  })

  it('closes only from a backdrop mousedown and restores its exact opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = await mountDialog()
    await wrapper.get('[role="dialog"]').trigger('mousedown')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('.model-provider-dialog').trigger('mousedown')
    expect(wrapper.emitted('close')).toHaveLength(1)
    await nextTick()
    expect(document.activeElement).toBe(opener)
  })

  it('focuses and traps the dialog before a deferred list resolves, blocks mutations, and ignores the late list after close', async () => {
    let resolveList: (value: { profiles: ReturnType<typeof profile>[], pendingCredentialDeletes: string[] }) => void = () => undefined
    service.listModelProviders.mockImplementation(() => new Promise(resolve => { resolveList = resolve }))
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const wrapper = await mountDialog()
    await nextTick()
    const close = wrapper.get('[data-provider-close]')
    expect(wrapper.get('[role="dialog"]').exists()).toBe(true)
    expect(document.activeElement).toBe(close.element)
    await close.trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(close.element)

    await wrapper.get('[data-provider-save]').trigger('click')
    expect(service.createModelProvider).not.toHaveBeenCalled()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('close')).toHaveLength(1)
    await nextTick()
    expect(document.activeElement).toBe(opener)

    resolveList({ profiles: [profile()], pendingCredentialDeletes: [] })
    await flush()
    expect(wrapper.text()).not.toContain('MiniMax M3')
  })

  it('resets deferred list loading across a real close and reopen so a fresh list can replace it', async () => {
    const listResolvers: Array<(value: { profiles: ReturnType<typeof profile>[], pendingCredentialDeletes: string[] }) => void> = []
    service.listModelProviders.mockImplementation(() => new Promise(resolve => { listResolvers.push(resolve) }))
    const wrapper = await mountDialog()
    await nextTick()
    expect(listResolvers).toHaveLength(1)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flush()
    await flush()
    expect(listResolvers).toHaveLength(2)

    listResolvers[0]!({ profiles: [profile({ name: '旧列表' })], pendingCredentialDeletes: [] })
    await flush()
    expect(wrapper.text()).not.toContain('旧列表')

    listResolvers[1]!({ profiles: [profile({ name: '新列表' })], pendingCredentialDeletes: [] })
    await flush()
    expect(wrapper.text()).toContain('新列表')
    expect(wrapper.get('[data-provider-create]').attributes('disabled')).toBeUndefined()
  })

  it('resets deferred connection testing across a real close and reopen without allowing the old result to clobber the new one', async () => {
    const testResolvers: Array<(value: { ok: boolean, modelId: string, latencyMs: number }) => void> = []
    service.testModelProviderConnection.mockImplementation(() => new Promise(resolve => { testResolvers.push(resolve) }))
    const wrapper = await mountDialog()
    await wrapper.get('[data-provider-test]').trigger('click')
    await flush()
    expect(testResolvers).toHaveLength(1)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flush()
    await flush()
    const freshTest = wrapper.get('[data-provider-test]')
    expect(freshTest.attributes('disabled')).toBeUndefined()
    await freshTest.trigger('click')
    await flush()
    expect(testResolvers).toHaveLength(2)

    testResolvers[1]!({ ok: true, modelId: 'fresh-model', latencyMs: 8 })
    await flush()
    expect(wrapper.get('[data-provider-test-result]').text()).toContain('fresh-model')
    testResolvers[0]!({ ok: true, modelId: 'stale-model', latencyMs: 9 })
    await flush()
    expect(wrapper.get('[data-provider-test-result]').text()).toContain('fresh-model')
    expect(wrapper.get('[data-provider-test-result]').text()).not.toContain('stale-model')
  })

  it('keeps 16px value text while retaining 13px metadata', async () => {
    const wrapper = await mountDialog()
    const input = wrapper.get('[name="name"]').element
    const control = wrapper.get('[data-provider-close]').element
    expect(getComputedStyle(input).fontSize).toBe('16px')
    expect(getComputedStyle(control).fontSize).toBe('16px')
    const css = await readFile(resolve(process.cwd(), 'app/assets/css/interaction-uplift.css'), 'utf8')
    expect(css).toMatch(/\.model-provider-dialog input,[\s\S]*?font-size:\s*16px/s)
    expect(css).toMatch(/\.model-provider-dialog__meta,[\s\S]*?font-size:\s*13px/s)
  })
})
