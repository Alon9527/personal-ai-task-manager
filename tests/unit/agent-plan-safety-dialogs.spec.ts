import { mountSuspended } from '@nuxt/test-utils/runtime'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import type { WorkspaceDocument } from '../../shared/workspace'
import AgentPlanPage from '../../app/pages/agent-plan.vue'
import { createAgentPlanController } from '../../app/composables/useAgentPlan'
import type { AgentPlanDraftV1 } from '../../app/services/agent-plan-schema'
import type { AgentPlanStorage } from '../../app/services/agent-plan-storage'

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

const OWNER_ID = '00000000-0000-4000-8000-000000000001'
const PLAN_ID = '10000000-0000-4000-8000-000000000001'
const PROJECT_A = '20000000-0000-4000-8000-000000000001'
const PROJECT_B = '20000000-0000-4000-8000-000000000002'
const MILESTONE_A = '30000000-0000-4000-8000-000000000001'
const MILESTONE_B = '30000000-0000-4000-8000-000000000002'
const MILESTONE_DELETED = '30000000-0000-4000-8000-000000000003'
const TASK_A = '40000000-0000-4000-8000-000000000001'
const TASK_B = '40000000-0000-4000-8000-000000000002'
const TASK_C = '40000000-0000-4000-8000-000000000003'
const TASK_D = '40000000-0000-4000-8000-000000000004'
const TASK_DELETED = '40000000-0000-4000-8000-000000000005'
const CREATED_AT = '2026-08-13T08:00:00.000Z'
const MUTATED_AT = '2026-08-13T09:00:00.000Z'
const DELETED_AT = '2026-08-12T08:00:00.000Z'

function project(id: string, name: string) {
  return {
    id, ownerId: OWNER_ID, name, color: '#6C63E8', description: '', priority: null,
    status: 'active' as const, targetDate: null, sortOrder: 0,
    createdAt: CREATED_AT, updatedAt: CREATED_AT, deletedAt: null,
  }
}

function milestone(id: string, projectId: string, title: string, deletedAt: string | null = null) {
  return {
    id, ownerId: OWNER_ID, projectId, title, description: '', targetDate: null,
    status: 'planned' as const, progressMode: 'auto' as const, progress: 0, sortOrder: 0,
    createdAt: CREATED_AT, updatedAt: deletedAt ?? CREATED_AT, deletedAt,
  }
}

function task(
  id: string,
  title: string,
  projectId: string | null,
  milestoneId: string | null,
  deletedAt: string | null = null,
) {
  return {
    id, ownerId: OWNER_ID, projectId, milestoneId, title, description: '', priority: null,
    dueDate: null, dueTime: null, isFocus: false, status: 'todo' as const,
    importance: 'normal' as const, estimatedMinutes: null, reminderAt: null,
    snoozedUntil: null, lastRemindedAt: null, sortOrder: 0, completedAt: null,
    createdAt: CREATED_AT, updatedAt: deletedAt ?? CREATED_AT, deletedAt,
  }
}

function workspaceDocument(): WorkspaceDocument {
  return {
    version: 3,
    projects: [project(PROJECT_A, '官网改版'), project(PROJECT_B, '增长计划')],
    milestones: [
      milestone(MILESTONE_A, PROJECT_A, '首页上线'),
      milestone(MILESTONE_B, PROJECT_B, '数据复盘'),
      milestone(MILESTONE_DELETED, PROJECT_A, '旧里程碑', DELETED_AT),
    ],
    tasks: [
      task(TASK_A, '首页验收', PROJECT_A, MILESTONE_A),
      task(TASK_B, '分析数据', PROJECT_B, MILESTONE_B),
      task(TASK_C, '独立任务', null, null),
      task(TASK_D, '补充报告', PROJECT_B, MILESTONE_B),
      task(TASK_DELETED, '旧任务', PROJECT_A, MILESTONE_A, DELETED_AT),
    ],
    quarterGoals: [],
  }
}

function createProjectAction(actionId = 'parent', draftRef = 'project:new') {
  return {
    actionId, type: 'createProject' as const, reason: '建立官网改版项目', selected: true,
    dangerous: false as const, draftRef,
    payload: { name: '官网改版', color: '#6C63E8', description: '', priority: null, status: 'active' as const, targetDate: null },
  }
}

function linkedCreateActions() {
  return [
    createProjectAction(),
    {
      actionId: 'child', type: 'createMilestone' as const, reason: '建立交付节点', selected: true,
      dangerous: false as const, draftRef: 'milestone:new',
      payload: {
        projectId: { kind: 'draft' as const, ref: 'project:new' }, title: '首页上线', description: '',
        targetDate: null, status: 'planned' as const, progressMode: 'auto' as const, progress: 0,
      },
    },
    {
      actionId: 'grandchild', type: 'createTask' as const, reason: '完成首页验收', selected: true,
      dangerous: false as const, draftRef: 'task:new',
      payload: {
        projectId: { kind: 'draft' as const, ref: 'project:new' },
        milestoneId: { kind: 'draft' as const, ref: 'milestone:new' },
        title: '首页验收', description: '', priority: null, dueDate: null, dueTime: null,
        isFocus: false, status: 'todo' as const, importance: 'normal' as const,
        estimatedMinutes: 30, reminderAt: null, snoozedUntil: null, lastRemindedAt: null,
      },
    },
  ]
}

function deleteAction(
  type: 'deleteProject' | 'deleteMilestone' | 'deleteTask',
  actionId: string,
  targetId: string,
  selected = true,
) {
  return {
    actionId, type, reason: `${actionId} 不再需要`, selected, dangerous: true as const,
    targetId, expectedUpdatedAt: CREATED_AT, payload: {},
  }
}

function draft(actions: AgentPlanDraftV1['actions']): AgentPlanDraftV1 {
  return {
    version: 1, id: PLAN_ID, question: '整理本周工作', model: 'MiniMax-M2.7',
    createdAt: CREATED_AT, updatedAt: CREATED_AT, status: 'draft', actions,
    validation: { executable: false, selectedCount: 0, dangerousCount: 0, estimatedMinutes: 0, issueCount: 0, issues: [] },
  }
}

function installHarness(options: {
  plan?: AgentPlanDraftV1
  latest?: WorkspaceDocument
  replace?: (next: WorkspaceDocument) => Promise<WorkspaceDocument>
} = {}) {
  const initial = options.plan ?? draft(linkedCreateActions())
  const latest = options.latest ?? workspaceDocument()
  let stored: AgentPlanDraftV1 | null = structuredClone(initial)
  const storage: AgentPlanStorage = {
    load: vi.fn(() => stored === null ? null : structuredClone(stored)),
    save: vi.fn((next) => { stored = structuredClone(next) }),
    clear: vi.fn(() => { stored = null }),
  }
  const visible = ref(structuredClone(latest))
  const workspace = {
    document: visible,
    readLatestDocument: vi.fn(async () => structuredClone(latest)),
    replaceWorkspaceDocument: vi.fn(options.replace ?? (async (next: WorkspaceDocument) => {
      visible.value = structuredClone(next)
      return structuredClone(next)
    })),
  }
  const controller = createAgentPlanController({ storage, workspace, now: () => MUTATED_AT })
  injected.controller = controller
  injected.workspace = {
    ...workspace,
    ready: ref(true), loading: ref(false), saving: ref(false), error: ref(null),
    projects: ref(latest.projects), milestones: ref(latest.milestones), tasks: ref(latest.tasks),
    quarterGoals: ref([]), projectCounts: ref({}), trashCount: ref(0), load: vi.fn(),
    backendLabel: ref('本机数据'), backendMode: ref('local'), fallbackReason: ref(null), lastDeleted: ref(null),
  }
  return { controller, storage, workspace, stored: () => stored }
}

async function mountPage() {
  const wrapper = await mountSuspended(AgentPlanPage, {
    route: '/agent-plan',
    attachTo: document.body,
    global: { stubs: { UIcon: { template: '<span class="icon-stub" />' } } },
  })
  await nextTick()
  return wrapper
}

describe('Agent plan safety dialogs', () => {
  beforeEach(() => installHarness())
  afterEach(() => { document.body.innerHTML = '' })

  it('defers a linked parent deselection, presents exact descendants, and cancel makes zero changes', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()
    const before = structuredClone(controller.draft.value)
    const checkbox = wrapper.get('[data-agent-action="parent"] input[type="checkbox"]')

    ;(checkbox.element as HTMLElement).focus()
    await checkbox.setValue(false)

    const dialog = wrapper.get('[data-agent-dependency-dialog]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBeTruthy()
    expect(dialog.attributes('aria-describedby')).toBeTruthy()
    expect(dialog.text()).toContain('官网改版')
    expect(dialog.text()).toContain('2 项下属改动')
    expect(dialog.text()).toContain('首页上线')
    expect(dialog.text()).toContain('首页验收')
    expect(controller.draft.value).toEqual(before)
    expect(storage.save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(dialog.get('[data-agent-dependency-cancel]').element)

    await dialog.get('[data-agent-dependency-cancel]').trigger('click')
    expect(controller.draft.value).toEqual(before)
    expect(controller.pendingDependencyDecision.value).toBeNull()
    expect(storage.save).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(checkbox.element)
  })

  it('recursively deselects once, while stale dependency decisions cannot mutate the draft', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()
    await wrapper.get('[data-agent-action="parent"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-agent-dependency-recursive]').trigger('click')

    expect(controller.draft.value?.actions.map(action => action.selected)).toEqual([false, false, false])
    expect(storage.save).toHaveBeenCalledTimes(1)

    controller.toggleAction('parent', true)
    controller.toggleAction('child', true)
    controller.toggleAction('grandchild', true)
    vi.mocked(storage.save).mockClear()
    controller.toggleAction('parent', false)
    controller.updateAction('child', { reason: '依赖状态已经变化' })
    vi.mocked(storage.save).mockClear()

    expect(controller.resolveDeselectedDependency('deselect-dependents')).toBe(false)
    expect(storage.save).not.toHaveBeenCalled()
    expect(controller.draft.value?.actions.map(action => action.selected)).toEqual([true, true, true])
  })

  it('keeps children selected, selects the first issue, and focuses its relation field', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()
    await wrapper.get('[data-agent-action="parent"] input[type="checkbox"]').setValue(false)
    await wrapper.get('[data-agent-dependency-reassign]').trigger('click')
    await nextTick()

    expect(controller.draft.value?.actions.map(action => action.selected)).toEqual([false, true, true])
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(controller.selectedActionId.value).toBe('child')
    const relation = wrapper.get('[data-agent-field="projectId"]')
    expect(relation.attributes('aria-invalid')).toBe('true')
    expect(document.activeElement).toBe(relation.element)
  })

  it('re-enables dependency choices after a persisted resolution fails, then allows retry', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    await wrapper.get('[data-agent-action="parent"] input[type="checkbox"]').setValue(false)
    vi.mocked(storage.save).mockImplementationOnce(() => { throw new Error('storage unavailable') })

    await wrapper.get('[data-agent-dependency-recursive]').trigger('click')
    await nextTick()

    expect(controller.pendingDependencyDecision.value).not.toBeNull()
    expect(wrapper.get('[data-agent-dependency-dialog]').exists()).toBe(true)
    expect(wrapper.get('[data-agent-dependency-recursive]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-agent-dependency-reassign]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-agent-dependency-cancel]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-agent-dependency-recursive]').trigger('click')
    expect(controller.pendingDependencyDecision.value).toBeNull()
    expect(controller.draft.value?.actions.map(action => action.selected)).toEqual([false, false, false])
  })

  it('keeps cancel usable after a failed dependency resolution', async () => {
    const { controller, storage } = installHarness()
    const wrapper = await mountPage()
    await wrapper.get('[data-agent-action="parent"] input[type="checkbox"]').setValue(false)
    vi.mocked(storage.save).mockImplementationOnce(() => { throw new Error('storage unavailable') })

    await wrapper.get('[data-agent-dependency-reassign]').trigger('click')
    await nextTick()
    await wrapper.get('[data-agent-dependency-cancel]').trigger('click')

    expect(controller.pendingDependencyDecision.value).toBeNull()
    expect(controller.draft.value?.actions.every(action => action.selected)).toBe(true)
  })

  it('starts deletion unchecked and adds an icon-plus-text danger state and footer count only after selection', async () => {
    const plan = draft([deleteAction('deleteTask', 'delete-task', TASK_C, false)])
    const { controller } = installHarness({ plan })
    const wrapper = await mountPage()
    const row = wrapper.get('[data-agent-action="delete-task"]')

    expect((row.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
    expect(row.find('[data-agent-danger-marker]').exists()).toBe(false)
    expect(wrapper.get('.agent-footer-summary').text()).toContain('0 项移入回收站')

    await row.get('input[type="checkbox"]').setValue(true)
    expect(controller.validation.value?.dangerousCount).toBe(1)
    expect(wrapper.get('[data-agent-action="delete-task"]').classes()).toContain('is-danger-selected')
    expect(wrapper.get('[data-agent-danger-marker]').text()).toContain('⚠')
    expect(wrapper.get('[data-agent-danger-marker]').text()).toContain('移入回收站')
    expect(wrapper.get('.agent-footer-summary').text()).toContain('1 项移入回收站')
  })

  it('executes a non-danger plan without rendering the deletion dialog', async () => {
    const { workspace } = installHarness({ plan: draft([createProjectAction()]) })
    const wrapper = await mountPage()

    await wrapper.get('[data-confirm-agent-plan]').trigger('click')

    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
    expect(workspace.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
  })

  it('does not open from ambient confirmation refs unless requestExecution reports confirmation-required', async () => {
    const plan = draft([deleteAction('deleteTask', 'delete-task', TASK_C)])
    const { controller } = installHarness({ plan })
    vi.spyOn(controller, 'requestExecution').mockImplementation(async () => {
      controller.dangerConfirmationRequested.value = true
      controller.dangerConfirmationToken.value = 'stale-token'
      controller.dangerConfirmationDocument.value = workspaceDocument()
      return { status: 'invalid' }
    })
    const wrapper = await mountPage()

    await wrapper.get('[data-confirm-agent-plan]').trigger('click')

    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
  })

  it('opens only from confirmation-required and counts overlapping explicit children once in their explicit category', async () => {
    const actions: AgentPlanDraftV1['actions'] = [
      deleteAction('deleteProject', 'delete-project-a', PROJECT_A),
      deleteAction('deleteProject', 'delete-project-a-again', PROJECT_A),
      deleteAction('deleteMilestone', 'delete-milestone-a', MILESTONE_A),
      deleteAction('deleteMilestone', 'delete-milestone-b', MILESTONE_B),
      deleteAction('deleteTask', 'delete-task-a', TASK_A),
      deleteAction('deleteTask', 'delete-task-b', TASK_B),
      deleteAction('deleteTask', 'delete-task-c', TASK_C),
    ]
    const { controller, workspace } = installHarness({ plan: draft(actions) })
    const request = vi.spyOn(controller, 'requestExecution')
    const wrapper = await mountPage()

    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
    await wrapper.get('[data-confirm-agent-plan]').trigger('click')

    expect(request).toHaveReturnedWith(expect.any(Promise))
    expect(workspace.readLatestDocument).toHaveBeenCalledTimes(1)
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
    const dialog = wrapper.get('[data-agent-delete-confirm]')
    expect(dialog.get('[data-agent-delete-count="project"]').text()).toContain('1')
    expect(dialog.get('[data-agent-delete-count="milestone"]').text()).toContain('2')
    expect(dialog.get('[data-agent-delete-count="task"]').text()).toContain('3')
    expect(dialog.get('[data-agent-project-cascade-milestones]').text()).toContain('0')
    expect(dialog.get('[data-agent-project-cascade-tasks]').text()).toContain('0')
    expect(dialog.get('[data-agent-milestone-unlink]').text()).toContain('1')
    expect(dialog.text()).not.toContain('旧里程碑')
    expect(dialog.text()).not.toContain('旧任务')
    expect(dialog.text()).toContain('可以恢复')
    expect(controller.dangerConfirmationToken.value).toBeTruthy()
    expect(controller.dangerConfirmationDocument.value).toEqual(workspaceDocument())
  })

  it('bounds named records and reports the remaining unique items', async () => {
    const latest = workspaceDocument()
    const extras = Array.from({ length: 7 }, (_, index) => {
      const suffix = String(index + 10).padStart(12, '0')
      return task(`40000000-0000-4000-8000-${suffix}`, `额外任务 ${index + 1}`, null, null)
    })
    latest.tasks.push(...extras)
    const plan = draft(extras.map((item, index) => deleteAction('deleteTask', `extra-${index}`, item.id)))
    installHarness({ plan, latest })
    const wrapper = await mountPage()
    await wrapper.get('[data-confirm-agent-plan]').trigger('click')

    expect(wrapper.findAll('[data-agent-delete-name]')).toHaveLength(6)
    expect(wrapper.get('[data-agent-delete-more]').text()).toContain('另 1 项')
  })

  it('binds confirm to the exact revision, cancel preserves selection, and edits invalidate stale confirmation', async () => {
    const plan = draft([deleteAction('deleteTask', 'delete-task', TASK_C)])
    const { controller, storage, workspace } = installHarness({ plan })
    const wrapper = await mountPage()
    vi.mocked(storage.save).mockClear()
    const footer = wrapper.get('[data-confirm-agent-plan]')
    ;(footer.element as HTMLElement).focus()
    await footer.trigger('click')
    const token = controller.dangerConfirmationToken.value!

    await wrapper.get('[data-agent-delete-cancel]').trigger('click')
    expect(controller.draft.value?.actions[0]?.selected).toBe(true)
    expect(controller.dangerConfirmationRequested.value).toBe(false)
    expect(controller.dangerConfirmationToken.value).toBeNull()
    expect(storage.save).toHaveBeenCalledTimes(1)
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(footer.element)

    await footer.trigger('click')
    const staleToken = controller.dangerConfirmationToken.value!
    controller.updateAction('delete-task', { reason: '修改后需要重新确认' })
    await nextTick()
    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
    expect(await controller.confirmDangerousExecution(staleToken)).toMatchObject({ status: 'confirmation-stale' })
    expect(workspace.replaceWorkspaceDocument).not.toHaveBeenCalled()
    expect(token).toBeTruthy()
  })

  it('confirms once despite rapid double click, while a failed write closes the dialog without retrying', async () => {
    const plan = draft([deleteAction('deleteTask', 'delete-task', TASK_C)])
    const replace = vi.fn(async (_next: WorkspaceDocument) => { throw new Error('disk full') })
    const { controller, workspace } = installHarness({ plan, replace })
    const confirm = vi.spyOn(controller, 'confirmDangerousExecution')
    const wrapper = await mountPage()
    await wrapper.get('[data-confirm-agent-plan]').trigger('click')
    const dangerButton = wrapper.get('[data-agent-delete-confirm-button]')

    const first = dangerButton.trigger('click')
    const second = dangerButton.trigger('click')
    await Promise.all([first, second])
    await nextTick()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(workspace.replaceWorkspaceDocument).toHaveBeenCalledTimes(1)
    expect(controller.draft.value?.status).toBe('failed')
    expect(controller.error.value).toContain('disk full')
    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
  })

  it('supports Escape, focus containment and safe language at a narrow scrollable dialog contract', async () => {
    const plan = draft([deleteAction('deleteTask', 'delete-task', TASK_C)])
    installHarness({ plan })
    const wrapper = await mountPage()
    const footer = wrapper.get('[data-confirm-agent-plan]')
    ;(footer.element as HTMLElement).focus()
    await footer.trigger('click')
    const dialog = wrapper.get('[data-agent-delete-confirm]')
    const cancel = dialog.get('[data-agent-delete-cancel]')
    const confirm = dialog.get('[data-agent-delete-confirm-button]')

    expect(document.activeElement).toBe(cancel.element)
    await cancel.trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(confirm.element)
    expect(dialog.text()).not.toMatch(/永久删除|彻底删除|清空回收站|清空数据|purge|empty trash/i)
    await dialog.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[data-agent-delete-confirm]').exists()).toBe(false)
    expect(document.activeElement).toBe(footer.element)

    const css = await readFile(resolve(process.cwd(), 'app/assets/css/main.css'), 'utf8')
    expect(css).toMatch(/\.agent-safety-dialog[^}]*font-size:\s*16px/s)
    expect(css).toMatch(/\.agent-safety-dialog__meta[^}]*font-size:\s*13px/s)
    expect(css).toMatch(/\.agent-safety-dialog__panel[^}]*max-width:\s*calc\(100vw - 24px\)/s)
    expect(css).toMatch(/\.agent-safety-dialog__scroll[^}]*overflow-y:\s*auto/s)
  })
})
