import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceDocument } from '../../shared/workspace'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'

const injected = vi.hoisted(() => ({
  controller: null as any,
  workspace: null as any,
}))

vi.mock('../../app/composables/useAgentPlan', async (load) => ({
  ...await load<typeof import('../../app/composables/useAgentPlan')>(),
  useAgentPlan: () => injected.controller,
}))

vi.mock('../../app/composables/useWorkspace', () => ({
  useWorkspace: () => injected.workspace,
}))

import DefaultLayout from '../../app/layouts/default.vue'
import AgentPlanPage from '../../app/pages/agent-plan.vue'
import AgentActionEditor from '../../app/components/agent/AgentActionEditor.vue'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import type { AgentPlanStorage } from '../../app/services/agent-plan-storage'

const CREATED_AT = '2026-08-13T08:00:00.000Z'
const PROJECT_ID = '20000000-0000-4000-8000-000000000001'
const MILESTONE_ID = '30000000-0000-4000-8000-000000000001'
const TASK_ID = '40000000-0000-4000-8000-000000000001'
const PROJECT_B_ID = '20000000-0000-4000-8000-000000000002'
const MILESTONE_B_ID = '30000000-0000-4000-8000-000000000002'

const document: WorkspaceDocument = {
  version: 3,
  projects: [{
    id: PROJECT_ID,
    ownerId: '00000000-0000-4000-8000-000000000001',
    name: '已有项目',
    color: '#6C63E8',
    description: '',
    priority: null,
    status: 'active',
    targetDate: null,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }, {
    id: PROJECT_B_ID,
    ownerId: '00000000-0000-4000-8000-000000000001',
    name: '第二项目',
    color: '#3C9270',
    description: '',
    priority: null,
    status: 'active',
    targetDate: null,
    sortOrder: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }],
  milestones: [{
    id: MILESTONE_ID,
    ownerId: '00000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    title: '已有里程碑',
    description: '',
    targetDate: '2026-09-01',
    status: 'planned',
    progressMode: 'auto',
    progress: 0,
    sortOrder: 0,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }, {
    id: MILESTONE_B_ID,
    ownerId: '00000000-0000-4000-8000-000000000001',
    projectId: PROJECT_B_ID,
    title: '第二里程碑',
    description: '',
    targetDate: null,
    status: 'planned',
    progressMode: 'auto',
    progress: 0,
    sortOrder: 1,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }],
  tasks: [{
    id: TASK_ID,
    ownerId: '00000000-0000-4000-8000-000000000001',
    projectId: PROJECT_ID,
    milestoneId: MILESTONE_ID,
    title: '已有任务',
    description: '',
    priority: 'medium',
    dueDate: '2026-08-20',
    dueTime: '10:00',
    isFocus: false,
    status: 'todo',
    importance: 'normal',
    estimatedMinutes: 25,
    reminderAt: null,
    snoozedUntil: null,
    lastRemindedAt: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
  }],
  quarterGoals: [],
}

function draft(status: AgentPlanDraftV1['status'] = 'draft'): AgentPlanDraftV1 {
  return {
    version: 1,
    id: '10000000-0000-4000-8000-000000000001',
    question: '把官网改版拆成可以本周完成的计划',
    model: 'MiniMax-M2.7',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status,
    actions: [
      {
        actionId: 'project-1', type: 'createProject', reason: '先建立清晰的工作边界',
        selected: true, dangerous: false, draftRef: 'project:new',
        payload: { name: '官网改版', color: '#6C63E8', description: '重构官网', priority: 'high', status: 'active', targetDate: '2026-09-30' },
      },
      {
        actionId: 'update-1', type: 'updateProject', reason: '同步既有项目状态',
        selected: true, dangerous: false, targetId: PROJECT_ID, expectedUpdatedAt: CREATED_AT,
        payload: { status: 'paused' },
      },
      {
        actionId: 'milestone-1', type: 'createMilestone', reason: '把首个交付点说清楚',
        selected: true, dangerous: false, draftRef: 'milestone:new',
        payload: { projectId: { kind: 'draft', ref: 'project:new' }, title: '首页信息架构', description: '确定结构', targetDate: '2026-08-25', status: 'planned', progressMode: 'manual', progress: 15 },
      },
      {
        actionId: 'task-1', type: 'createTask', reason: '先完成最小可审查结果',
        selected: true, dangerous: false, draftRef: 'task:new',
        payload: {
          projectId: { kind: 'draft', ref: 'project:new' }, milestoneId: { kind: 'draft', ref: 'milestone:new' },
          title: '整理首页信息架构', description: '输出页面层级', priority: 'high', dueDate: '2026-08-16', dueTime: '14:00',
          isFocus: true, status: 'in_progress', importance: 'important', estimatedMinutes: 90,
          reminderAt: '2026-08-16T05:30:00.000Z', snoozedUntil: null, lastRemindedAt: null,
        },
      },
      {
        actionId: 'complete-1', type: 'setTaskCompleted', reason: '标记已经收尾的工作',
        selected: true, dangerous: false, targetId: TASK_ID, expectedUpdatedAt: CREATED_AT,
        payload: { completed: true },
      },
      {
        actionId: 'delete-1', type: 'deleteTask', reason: '测试记录不属于真实工作',
        selected: false, dangerous: true, targetId: TASK_ID, expectedUpdatedAt: CREATED_AT, payload: {},
      },
    ],
    validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] },
  }
}

function installHarness(initial: AgentPlanDraftV1 | null = draft()) {
  let stored = initial === null ? null : structuredClone(initial)
  const storage: AgentPlanStorage = {
    load: vi.fn(() => stored === null ? null : structuredClone(stored)),
    save: vi.fn((next) => { stored = structuredClone(next) }),
    clear: vi.fn(() => { stored = null }),
  }
  const workspace = {
    document: ref(structuredClone(document)),
    readLatestDocument: vi.fn(async () => structuredClone(document)),
    replaceWorkspaceDocument: vi.fn(async (next: WorkspaceDocument) => next),
  }
  const controller = createAgentPlanController({
    storage,
    workspace,
    now: () => '2026-08-13T09:00:00.000Z',
  })
  injected.controller = controller
  injected.workspace = {
    ...workspace,
    ready: ref(true), loading: ref(false), saving: ref(false), error: ref(null),
    projects: ref(document.projects), milestones: ref(document.milestones), tasks: ref(document.tasks),
    quarterGoals: ref([]), projectCounts: ref({ [PROJECT_ID]: 1 }), trashCount: ref(0),
    load: vi.fn(), backendLabel: ref('本机数据'), backendMode: ref('local'), fallbackReason: ref(null), lastDeleted: ref(null),
  }
  return { controller, storage, workspace }
}

async function mountPage() {
  const wrapper = await mountSuspended(AgentPlanPage, {
    route: '/agent-plan',
    global: { stubs: { UIcon: { template: '<span class="icon-stub" />' } } },
  })
  await nextTick()
  return wrapper
}

describe('Agent plan confirmation workspace', () => {
  beforeEach(() => installHarness())

  it('releases the context panel only for the exact review route', async () => {
    const stubs = {
      AppRail: { template: '<div>rail</div>' }, AppProjectSidebar: { template: '<div>sidebar</div>' },
      AppContextPanel: { template: '<div>context</div>' }, WorkspaceOverlays: { template: '<div />' },
    }
    const review = await mountSuspended(DefaultLayout, { route: '/agent-plan', slots: { default: '<main>review</main>' }, global: { stubs } })
    expect(review.get('.app-shell').classes()).toContain('agent-review-mode')
    expect(review.find('[data-zone="context"]').exists()).toBe(false)

    const ordinary = await mountSuspended(DefaultLayout, { route: '/', global: { stubs } })
    expect(ordinary.get('.app-shell').classes()).not.toContain('agent-review-mode')
    expect(ordinary.find('[data-zone="context"]').exists()).toBe(true)
  })

  it('loads the persistent draft and renders grouped rows, counts, proposal order, and real dependency spines', async () => {
    const { storage } = installHarness()
    const wrapper = await mountPage()

    expect(storage.load).toHaveBeenCalledTimes(1)
    expect(wrapper.findAll('[data-agent-action]')).toHaveLength(6)
    expect(wrapper.findAll('[data-agent-action]').map(row => row.attributes('data-agent-action'))).toEqual([
      'project-1', 'update-1', 'milestone-1', 'task-1', 'complete-1', 'delete-1',
    ])
    expect(wrapper.get('[data-agent-selected-count]').text()).toContain('5 / 6')
    expect(wrapper.get('[data-agent-estimate]').text()).toContain('90 分钟')
    expect(wrapper.findAll('[data-agent-dependency-spine]').map(row => row.attributes('data-agent-action'))).toEqual([
      'project-1', 'milestone-1', 'task-1',
    ])
    expect(wrapper.get('[data-agent-action="update-1"]').attributes('data-agent-dependency-spine')).toBeUndefined()
    expect(wrapper.get('[data-agent-action="update-1"]').text()).toContain('已有项目')
    expect(wrapper.get('[data-agent-action="complete-1"]').text()).toContain('已有任务')
  })

  it('selects by row click and keyboard without toggling selection', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()

    await wrapper.get('[data-agent-action="task-1"] [data-agent-row-select]').trigger('click')
    expect(controller.selectedActionId.value).toBe('task-1')
    expect((wrapper.get('[data-agent-field="title"]').element as HTMLInputElement).value).toBe('整理首页信息架构')

    await wrapper.get('[data-agent-action="task-1"] [data-agent-row-select]').trigger('keydown', { key: 'ArrowUp' })
    expect(controller.selectedActionId.value).toBe('milestone-1')
    await wrapper.get('[data-agent-action="milestone-1"] [data-agent-row-select]').trigger('keydown', { key: 'End' })
    expect(controller.selectedActionId.value).toBe('delete-1')
    expect(storage.save).not.toHaveBeenCalled()
  })

  it('toggles a checkbox once and only paints selected deletion as dangerous', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()
    const deleteRow = wrapper.get('[data-agent-action="delete-1"]')

    expect((deleteRow.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(deleteRow.classes()).not.toContain('is-danger-selected')
    await deleteRow.get('input[type="checkbox"]').setValue(true)

    expect(controller.draft.value?.actions.find(action => action.actionId === 'delete-1')?.selected).toBe(true)
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-agent-action="delete-1"]').classes()).toContain('is-danger-selected')
  })

  it('initializes all task fields and persists one exact canonical action update', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    controller.selectAction('task-1')
    await nextTick()
    vi.mocked(storage.save).mockClear()

    for (const field of ['title', 'description', 'projectId', 'milestoneId', 'importance', 'priority', 'status', 'estimatedMinutes', 'dueDate', 'dueTime', 'reminderAt', 'isFocus']) {
      expect(wrapper.find(`[data-agent-field="${field}"]`).exists(), field).toBe(true)
    }
    await wrapper.get('[data-agent-field="title"]').setValue('完成首页信息架构')
    await wrapper.get('[data-agent-field="estimatedMinutes"]').setValue('120')
    await wrapper.get('[data-agent-save-action]').trigger('click')

    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(controller.draft.value?.actions.find(action => action.actionId === 'task-1')).toMatchObject({
      actionId: 'task-1',
      type: 'createTask',
      payload: {
        title: '完成首页信息架构', estimatedMinutes: 120, importance: 'important', isFocus: true,
        projectId: { kind: 'draft', ref: 'project:new' },
        milestoneId: { kind: 'draft', ref: 'milestone:new' },
      },
    })
  })

  it('keeps execution disabled and the field error visible until the parent confirms a durable save', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    controller.selectAction('task-1')
    await nextTick()
    const originalSave = vi.mocked(storage.save).getMockImplementation()!
    vi.mocked(storage.save).mockImplementationOnce(() => { throw new Error('storage unavailable') })

    await wrapper.get('[data-agent-field="title"]').setValue('持久化后的标题')
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()

    expect(controller.draft.value?.actions.find(action => action.actionId === 'task-1')).toMatchObject({ payload: { title: '整理首页信息架构' } })
    expect(wrapper.get('[data-agent-save-error]').text()).toContain('storage unavailable')
    expect(wrapper.get('[data-confirm-agent-plan]').attributes('disabled')).toBeDefined()

    vi.mocked(storage.save).mockImplementation(originalSave)
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()
    expect(controller.draft.value?.actions.find(action => action.actionId === 'task-1')).toMatchObject({ payload: { title: '持久化后的标题' } })
    expect(wrapper.find('[data-agent-save-error]').exists()).toBe(false)
  })

  it('rejects a non-canonical reminder locally and persists only the corrected ISO value', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    controller.selectAction('task-1')
    await nextTick()
    vi.mocked(storage.save).mockClear()

    const reminder = wrapper.get('[data-agent-field="reminderAt"]')
    await reminder.setValue('明天下午提醒')
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()
    expect(storage.save).not.toHaveBeenCalled()
    expect(reminder.attributes('aria-invalid')).toBe('true')
    expect(wrapper.get(`#${reminder.attributes('aria-describedby')}`).text()).toContain('提醒时间')
    expect(wrapper.get('[data-confirm-agent-plan]').attributes('disabled')).toBeDefined()
    expect(controller.draft.value?.actions.find(action => action.actionId === 'task-1')).toMatchObject({
      payload: { reminderAt: '2026-08-16T05:30:00.000Z' },
    })

    await reminder.setValue('2026-08-17T05:30:00.000Z')
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(controller.draft.value?.actions.find(action => action.actionId === 'task-1')).toMatchObject({
      payload: { reminderAt: '2026-08-17T05:30:00.000Z' },
    })
  })

  it('loads sparse update relations, permits valid existing reparenting, and never offers draft refs to updates', async () => {
    const sparse = draft()
    sparse.actions = [{
      actionId: 'update-task-sparse', type: 'updateTask', reason: '调整标题', selected: true, dangerous: false,
      targetId: TASK_ID, expectedUpdatedAt: CREATED_AT, payload: { title: '更新后的已有任务' },
    }]
    const { controller } = installHarness(sparse)
    const wrapper = await mountPage()

    expect((wrapper.get('[data-agent-field="projectId"]').element as HTMLSelectElement).value).toBe(`existing:${PROJECT_ID}`)
    expect((wrapper.get('[data-agent-field="milestoneId"]').element as HTMLSelectElement).value).toBe(`existing:${MILESTONE_ID}`)
    expect(wrapper.findAll('[data-agent-field="projectId"] option').some(option => option.attributes('value')?.startsWith('draft:'))).toBe(false)
    expect(wrapper.findAll('[data-agent-field="milestoneId"] option').some(option => option.attributes('value')?.startsWith('draft:'))).toBe(false)

    await wrapper.get('[data-agent-field="projectId"]').setValue(`existing:${PROJECT_B_ID}`)
    await nextTick()
    const milestoneValues = wrapper.findAll('[data-agent-field="milestoneId"] option').map(option => option.attributes('value'))
    expect(milestoneValues).toContain(`existing:${MILESTONE_B_ID}`)
    expect(milestoneValues).not.toContain(`existing:${MILESTONE_ID}`)
    await wrapper.get('[data-agent-field="milestoneId"]').setValue(`existing:${MILESTONE_B_ID}`)
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()

    expect(controller.draft.value?.actions[0]).toMatchObject({
      type: 'updateTask',
      payload: { title: '更新后的已有任务', projectId: PROJECT_B_ID, milestoneId: MILESTONE_B_ID },
    })
  })

  it('loads and reparents a sparse milestone update using existing UUIDs only', async () => {
    const sparse = draft()
    sparse.actions = [{
      actionId: 'update-milestone-sparse', type: 'updateMilestone', reason: '调整标题', selected: true, dangerous: false,
      targetId: MILESTONE_ID, expectedUpdatedAt: CREATED_AT, payload: { title: '更新后的已有里程碑' },
    }]
    const { controller } = installHarness(sparse)
    const wrapper = await mountPage()

    expect((wrapper.get('[data-agent-field="projectId"]').element as HTMLSelectElement).value).toBe(`existing:${PROJECT_ID}`)
    expect(wrapper.findAll('[data-agent-field="projectId"] option').some(option => option.attributes('value')?.startsWith('draft:'))).toBe(false)
    await wrapper.get('[data-agent-field="projectId"]').setValue(`existing:${PROJECT_B_ID}`)
    await wrapper.get('[data-agent-save-action]').trigger('click')
    await nextTick()

    expect(controller.draft.value?.actions[0]).toMatchObject({
      type: 'updateMilestone', payload: { title: '更新后的已有里程碑', projectId: PROJECT_B_ID },
    })
  })

  it('initializes project, milestone, completion, and delete editors from actual values', async () => {
    const { controller } = installHarness()
    const wrapper = await mountPage()

    controller.selectAction('project-1')
    await nextTick()
    for (const field of ['name', 'color', 'description', 'priority', 'status', 'targetDate']) {
      expect(wrapper.find(`[data-agent-field="${field}"]`).exists(), `project.${field}`).toBe(true)
    }

    controller.selectAction('milestone-1')
    await nextTick()
    for (const field of ['title', 'projectId', 'description', 'status', 'progressMode', 'progress', 'targetDate']) {
      expect(wrapper.find(`[data-agent-field="${field}"]`).exists(), `milestone.${field}`).toBe(true)
    }

    controller.selectAction('complete-1')
    await nextTick()
    expect((wrapper.get('[data-agent-field="completed"]').element as HTMLInputElement).checked).toBe(true)

    controller.selectAction('delete-1')
    await nextTick()
    expect(wrapper.get('[data-agent-action-editor]').text()).toContain('只会移入回收站')
    expect(wrapper.find('[data-agent-save-action]').exists()).toBe(false)
  })

  it('shows local field errors with accessible wiring and disables confirmation with a readable reason', async () => {
    const { controller } = installHarness()
    const wrapper = await mountPage()
    controller.selectAction('project-1')
    await nextTick()

    const name = wrapper.get('[data-agent-field="name"]')
    await name.setValue('')
    await wrapper.get('[data-agent-save-action]').trigger('click')

    expect(name.attributes('aria-invalid')).toBe('true')
    const errorId = name.attributes('aria-describedby')
    expect(errorId).toBeTruthy()
    expect(wrapper.get(`#${errorId}`).text()).toContain('不能为空')
    expect(wrapper.get('[data-confirm-agent-plan]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-agent-confirm-reason]').text()).toContain('修正')
  })

  it('wires every editable schema issue to its actual field control', async () => {
    const actions = draft().actions
    const cases = [
      { action: actions[0]!, fields: ['reason', 'name', 'color', 'description', 'priority', 'status', 'targetDate'] },
      { action: actions[2]!, fields: ['reason', 'projectId', 'title', 'description', 'targetDate', 'status', 'progressMode', 'progress'] },
      { action: actions[3]!, fields: ['reason', 'projectId', 'milestoneId', 'title', 'description', 'importance', 'priority', 'status', 'estimatedMinutes', 'dueDate', 'dueTime', 'reminderAt', 'isFocus'] },
      { action: actions[4]!, fields: ['reason', 'completed'] },
    ]

    for (const item of cases) {
      const issues = item.fields.map(field => ({
        actionId: item.action.actionId,
        code: 'field' as const,
        field: field === 'reason' ? field : `payload.${field}`,
        message: `${field} 无效`,
      }))
      const editor = await mountSuspended(AgentActionEditor, {
        props: {
          action: item.action,
          actions,
          document,
          issues,
          saveAction: vi.fn(async () => ({ ok: true as const })),
        },
        global: { stubs: { UIcon: { template: '<span />' } } },
      })
      for (const field of item.fields) {
        const control = editor.get(`[data-agent-field="${field}"]`)
        expect(control.attributes('aria-invalid'), field).toBe('true')
        const describedBy = control.attributes('aria-describedby')
        expect(describedBy, field).toBeTruthy()
        expect(editor.get(`#${describedBy}`).text()).toContain(`${field} 无效`)
      }
      editor.unmount()
    }
  })

  it('prevents rapid duplicate execution from the footer', async () => {
    const { controller } = installHarness()
    let release!: () => void
    const request = vi.spyOn(controller, 'requestExecution').mockImplementation(() => new Promise(resolve => {
      release = () => resolve({ status: 'executed', results: [] })
    }))
    const wrapper = await mountPage()

    const confirm = wrapper.get('[data-confirm-agent-plan]')
    await confirm.trigger('click')
    await confirm.trigger('click')
    expect(request).toHaveBeenCalledTimes(1)
    expect(wrapper.get('[data-confirm-agent-plan]').text()).toContain('执行中')
    release()
    await nextTick()
  })

  it.each([
    ['conflicted', '发现数据冲突'],
    ['failed', '上次执行失败'],
  ] as const)('renders an explicit %s state without collapsing the workbench', async (status, label) => {
    installHarness(draft(status))
    const wrapper = await mountPage()
    expect(wrapper.get('[data-agent-plan-state]').attributes('data-agent-plan-state')).toBe(status)
    expect(wrapper.text()).toContain(label)
    expect(wrapper.find('[data-agent-action-list]').exists()).toBe(true)
  })

  it('renders purposeful no-draft and storage-error states without a fake editor', async () => {
    installHarness(null)
    const empty = await mountPage()
    expect(empty.get('[data-agent-empty]').text()).toContain('返回 AI 面板')
    expect(empty.find('[data-agent-action-editor]').exists()).toBe(false)

    const { controller } = installHarness(null)
    vi.spyOn(controller, 'loadDraft').mockImplementation(() => {
      controller.error.value = '无法读取计划草稿。'
      return null
    })
    const failed = await mountPage()
    expect(failed.get('[data-agent-storage-error]').text()).toContain('无法读取计划草稿')
  })

  it('defines readable Huly density, drawer safety, focus, and reduced-motion contracts', async () => {
    const css = await readFile(resolve(process.cwd(), 'app/assets/css/main.css'), 'utf8')
    expect(css).toMatch(/\.agent-plan-page\s*\{[^}]*font-size:\s*16px/s)
    expect(css).toMatch(/\.agent-plan-meta[^}]*font-size:\s*13px/s)
    expect(css).toMatch(/\.agent-plan-heading[^}]*font-size:\s*(?:20px|clamp\([^)]*20px)/s)
    expect(css).toMatch(/\.agent-control[^}]*min-height:\s*40px/s)
    expect(css).toMatch(/@media\s*\(max-width:\s*899px\)[\s\S]*\.agent-action-editor[^}]*position:\s*fixed/s)
    expect(css).toContain('env(safe-area-inset-bottom)')
    expect(css).toMatch(/padding-bottom:\s*[^;]*--agent-footer-overlap/s)
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/)

    const mediumShell = css.slice(
      css.indexOf('@media (min-width: 761px) and (max-width: 900px)'),
      css.indexOf('@media (max-width: 899px)'),
    )
    expect(mediumShell).toMatch(/\.agent-plan-footer\s*\{[^}]*left:\s*60px/s)
    const compactDesktop = css.slice(
      css.indexOf('@media (min-width: 901px) and (max-width: 1100px)'),
      css.indexOf('@media (min-width: 901px) and (max-width: 1360px)'),
    )
    expect(compactDesktop).toMatch(/\.agent-plan-footer\s*\{[^}]*left:\s*276px/s)
  })
})
