# Supabase-ready CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不需要 Supabase 密钥和网络的前提下，为项目与任务实现完整 CRUD、软删除、排序和本地持久化，并准备好可切换的 Nuxt 服务端 Supabase 数据层。

**Architecture:** 页面通过单一 `WorkspaceModel` 使用 `WorkspaceGateway`；浏览器默认使用版本化 `localStorage` 网关，配置 Supabase 时改用 Nuxt API 网关。Nuxt API 在服务端通过私有配置调用 Supabase REST/RPC，界面不接触数据库密钥。

**Tech Stack:** Nuxt 4、Vue 3、TypeScript、Zod、Vitest、Nuxt Test Utils、原生 `localStorage`、Nuxt `$fetch`、PostgreSQL/Supabase SQL。

---

## 执行约束

- 当前目录是无 `.git` 元数据的解压副本；不得执行 `git init`，也不得修改 `.git`。各任务中的提交命令只在恢复到原 Git checkout 后执行。
- 不安装新依赖；全部实现使用现有 Nuxt、Vue、Zod 与测试工具。
- 默认 `NUXT_PUBLIC_DATA_BACKEND=local`，本地模式不得发起网络请求。
- 所有生产代码严格遵循红—绿—重构；每个测试必须先出现预期失败，再写最小实现。
- 视觉以第一版效果图为基准：深色工具栏和侧栏、浅色主工作区、白色 AI 面板，仅收紧任务行并细化分隔线。

## 文件结构

### 共享领域与数据层

- Create: `shared/workspace.ts` — Zod 模型、领域类型、固定演示用户、分组与统计纯函数。
- Create: `app/data/demo-workspace.ts` — 可重复的初始项目和任务数据。
- Create: `app/data/workspace-gateway.ts` — CRUD 网关接口、输入类型和应用错误。
- Create: `app/data/local-workspace-gateway.ts` — 版本化本地存储实现。
- Create: `app/data/api-workspace-gateway.ts` — Nuxt API 客户端实现。
- Create: `app/models/workspace-model.ts` — UI 状态、派生数据、乐观更新与回滚。
- Create: `app/plugins/workspace.ts` — 选择网关并注入共享模型。
- Create: `app/composables/useWorkspace.ts` — 类型安全地读取注入模型。
- Create: `app/types/workspace-injection.d.ts` — Nuxt 注入类型声明。

### 界面

- Create: `app/composables/useWorkspaceUi.ts` — 编辑器与确认框状态。
- Create: `app/components/workspace/TaskEditorDialog.vue` — 任务新建/编辑表单。
- Create: `app/components/workspace/ProjectEditorDialog.vue` — 项目新建/编辑表单。
- Create: `app/components/workspace/DeleteConfirmDialog.vue` — 软删除确认。
- Create: `app/components/workspace/TaskActionsMenu.vue` — 任务编辑、移动、排序、删除入口。
- Create: `app/components/workspace/ProjectActionsMenu.vue` — 项目编辑、排序、删除入口。
- Create: `app/components/workspace/WorkspaceOverlays.vue` — 统一挂载弹层并调用模型。
- Modify: `app/layouts/default.vue` — 挂载弹层。
- Modify: `app/pages/index.vue` — 动态任务、指标、CRUD 和空状态。
- Modify: `app/components/app/ProjectSidebar.vue` — 动态项目、计数和项目操作。
- Modify: `app/assets/css/main.css` — 第一版视觉下的表单、菜单、状态和紧凑列表样式。

### Nuxt API 与 Supabase

- Modify: `nuxt.config.ts` — 增加私有 Supabase 配置与公共数据源开关。
- Create: `server/utils/supabase-workspace-repository.ts` — REST/RPC 映射及错误转换。
- Create: `server/utils/workspace-repository.ts` — 从事件配置创建服务端仓库。
- Create: `server/api/workspace.get.ts` — 加载项目与任务。
- Create: `server/api/projects/index.post.ts` — 新建项目。
- Create: `server/api/projects/[id].patch.ts` — 编辑项目。
- Create: `server/api/projects/[id].delete.ts` — 软删除项目及任务。
- Create: `server/api/projects/reorder.post.ts` — 项目排序。
- Create: `server/api/tasks/index.post.ts` — 新建任务。
- Create: `server/api/tasks/[id].patch.ts` — 编辑任务。
- Create: `server/api/tasks/[id].delete.ts` — 软删除任务。
- Create: `server/api/tasks/[id]/complete.post.ts` — 完成状态切换。
- Create: `server/api/tasks/reorder.post.ts` — 任务排序。
- Create: `supabase/migrations/202607220001_workspace.sql` — 表、索引、触发器、RLS 与 RPC。
- Create: `supabase/seed.sql` — 固定演示用户数据。
- Create: `.env.example` — 只包含变量名和安全说明，不包含真实密钥。

### 测试

- Create: `tests/unit/workspace-domain.spec.ts`
- Create: `tests/unit/local-workspace-gateway.spec.ts`
- Create: `tests/unit/workspace-model.spec.ts`
- Create: `tests/unit/workspace-dialogs.spec.ts`
- Create: `tests/unit/project-sidebar.spec.ts`
- Create: `tests/unit/supabase-workspace-repository.spec.ts`
- Create: `tests/unit/supabase-sql.spec.ts`
- Modify: `tests/unit/today-workspace.spec.ts`
- Modify: `tests/unit/app-shell.spec.ts`

### Task 1: 建立并记录干净基线

**Files:**
- Verify: `package.json`
- Verify: `tests/unit/app-shell.spec.ts`
- Verify: `tests/unit/today-workspace.spec.ts`

- [ ] **Step 1: 确认依赖是否已经存在**

Run:

```powershell
Test-Path node_modules
pnpm --version
```

Expected: `Test-Path` 为 `True`，并显示 pnpm 版本。若依赖不存在，停止；安装依赖属于网络和写入操作，需单独取得用户确认。

- [ ] **Step 2: 运行现有单元测试**

Run:

```powershell
pnpm test
```

Expected: 现有 3 个测试全部通过。若失败，记录原始错误并先判断是否为现有基线问题。

- [ ] **Step 3: 运行现有类型检查与构建**

Run:

```powershell
pnpm typecheck
pnpm build
```

Expected: 两条命令退出码均为 0。

### Task 2: 领域模型、种子数据与纯函数

**Files:**
- Create: `shared/workspace.ts`
- Create: `app/data/demo-workspace.ts`
- Test: `tests/unit/workspace-domain.spec.ts`

- [ ] **Step 1: 写领域行为失败测试**

Create `tests/unit/workspace-domain.spec.ts` with tests that exercise real schemas and pure functions:

```ts
import { describe, expect, it } from 'vitest'
import { createDemoWorkspace } from '../../app/data/demo-workspace'
import { deriveWorkspace, workspaceDocumentSchema } from '../../shared/workspace'

describe('workspace domain', () => {
  it('seeds active projects and all three task groups', () => {
    const document = workspaceDocumentSchema.parse(createDemoWorkspace())
    const view = deriveWorkspace(document)

    expect(view.projects.map(project => project.name)).toContain('收集箱')
    expect(view.focusTasks).toHaveLength(3)
    expect(view.laterTasks).toHaveLength(2)
    expect(view.completedTasks).toHaveLength(2)
    expect(view.metrics).toEqual({ focus: 3, active: 5, completed: 2 })
  })

  it('excludes soft-deleted records and counts tasks by project', () => {
    const document = createDemoWorkspace()
    document.projects[0]!.deletedAt = '2026-07-22T00:00:00.000Z'
    document.tasks[0]!.deletedAt = '2026-07-22T00:00:00.000Z'

    const view = deriveWorkspace(document)

    expect(view.projects.some(project => project.id === document.projects[0]!.id)).toBe(false)
    expect(view.tasks.some(task => task.id === document.tasks[0]!.id)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试并确认缺少模块导致失败**

Run:

```powershell
pnpm vitest run tests/unit/workspace-domain.spec.ts
```

Expected: FAIL，提示无法解析 `shared/workspace` 或 `demo-workspace`。

- [ ] **Step 3: 实现共享类型、校验和派生数据**

Create `shared/workspace.ts` with these exported contracts:

```ts
import { z } from 'zod'

export const DEMO_OWNER_ID = '00000000-0000-4000-8000-000000000001'
const isoTimestamp = z.string().datetime()
const nullableTimestamp = isoTimestamp.nullable()

export const projectSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const taskSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  priority: z.enum(['low', 'medium', 'high']).nullable(),
  dueDate: z.string().date().nullable(),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  isFocus: z.boolean(),
  sortOrder: z.number().int().nonnegative(),
  completedAt: nullableTimestamp,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const workspaceDocumentSchema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
})

export type Project = z.infer<typeof projectSchema>
export type Task = z.infer<typeof taskSchema>
export type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>
export type TaskGroup = 'focus' | 'later' | 'completed'

export function deriveWorkspace(document: WorkspaceDocument) {
  const projects = document.projects.filter(project => project.deletedAt === null).sort((a, b) => a.sortOrder - b.sortOrder)
  const tasks = document.tasks.filter(task => task.deletedAt === null)
  const focusTasks = tasks.filter(task => task.completedAt === null && task.isFocus).sort((a, b) => a.sortOrder - b.sortOrder)
  const laterTasks = tasks.filter(task => task.completedAt === null && !task.isFocus).sort((a, b) => a.sortOrder - b.sortOrder)
  const completedTasks = tasks.filter(task => task.completedAt !== null).sort((a, b) => a.sortOrder - b.sortOrder)
  const counts = Object.fromEntries(projects.map(project => [project.id, tasks.filter(task => task.projectId === project.id).length]))

  return {
    projects,
    tasks,
    focusTasks,
    laterTasks,
    completedTasks,
    projectCounts: counts as Record<string, number>,
    metrics: { focus: focusTasks.length, active: focusTasks.length + laterTasks.length, completed: completedTasks.length },
  }
}
```

Create `app/data/demo-workspace.ts` using fixed UUIDs and the seven tasks already visible in Today. Every record must set `ownerId` to `DEMO_OWNER_ID`, `deletedAt` to `null`, and stable `sortOrder` values.

- [ ] **Step 4: 运行领域测试并确认通过**

Run:

```powershell
pnpm vitest run tests/unit/workspace-domain.spec.ts
```

Expected: 2 tests PASS。

- [ ] **Step 5: Git checkout 可用时提交**

```powershell
git add shared/workspace.ts app/data/demo-workspace.ts tests/unit/workspace-domain.spec.ts
git commit -m "feat: add workspace domain model"
```

### Task 3: 本地数据网关与完整 CRUD

**Files:**
- Create: `app/data/workspace-gateway.ts`
- Create: `app/data/local-workspace-gateway.ts`
- Test: `tests/unit/local-workspace-gateway.spec.ts`

- [ ] **Step 1: 写本地网关失败测试**

Create `tests/unit/local-workspace-gateway.spec.ts` with one fresh storage per test and assertions for create, update, complete, reorder, and cascade soft deletion:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'

describe('LocalWorkspaceGateway', () => {
  beforeEach(() => localStorage.clear())

  it('persists project and task CRUD across instances', async () => {
    const first = new LocalWorkspaceGateway(localStorage, () => '2026-07-22T08:00:00.000Z')
    const project = await first.createProject({ name: '新项目', color: '#3366FF' })
    const task = await first.createTask({
      title: '新任务', description: '', projectId: project.id, priority: null,
      dueDate: null, dueTime: null, isFocus: false,
    })
    await first.updateTask(task.id, { title: '已编辑任务' })
    await first.setTaskCompleted(task.id, true)

    const second = new LocalWorkspaceGateway(localStorage, () => '2026-07-22T09:00:00.000Z')
    const saved = await second.loadWorkspace()
    const savedTask = saved.tasks.find(item => item.id === task.id)

    expect(savedTask?.title).toBe('已编辑任务')
    expect(savedTask?.completedAt).toBe('2026-07-22T08:00:00.000Z')
  })

  it('soft-deletes a project and its active tasks atomically', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage, () => '2026-07-22T08:00:00.000Z')
    const document = await gateway.loadWorkspace()
    const project = document.projects.find(item => item.name === '个人效率系统')!

    await gateway.deleteProject(project.id)
    const saved = await gateway.loadWorkspace({ includeDeleted: true })

    expect(saved.projects.find(item => item.id === project.id)?.deletedAt).not.toBeNull()
    expect(saved.tasks.filter(item => item.projectId === project.id).every(item => item.deletedAt !== null)).toBe(true)
  })

  it('backs up invalid local data before reseeding', async () => {
    localStorage.setItem('personal-ai-workspace:v1', '{invalid')
    const gateway = new LocalWorkspaceGateway(localStorage, () => '2026-07-22T08:00:00.000Z')

    const document = await gateway.loadWorkspace()

    expect(document.projects.length).toBeGreaterThan(0)
    expect(localStorage.getItem('personal-ai-workspace:backup:2026-07-22T08:00:00.000Z')).toBe('{invalid')
  })
})
```

- [ ] **Step 2: 运行测试并确认类缺失导致失败**

Run:

```powershell
pnpm vitest run tests/unit/local-workspace-gateway.spec.ts
```

Expected: FAIL，提示 `LocalWorkspaceGateway` 不存在。

- [ ] **Step 3: 定义网关契约**

Create `app/data/workspace-gateway.ts` exporting `CreateProjectInput`, `UpdateProjectInput`, `CreateTaskInput`, `UpdateTaskInput`, `LoadWorkspaceOptions`, and:

```ts
import type { Project, Task, TaskGroup, WorkspaceDocument } from '../../shared/workspace'

export interface WorkspaceGateway {
  readonly mode: 'local' | 'supabase'
  loadWorkspace(options?: { includeDeleted?: boolean }): Promise<WorkspaceDocument>
  createProject(input: { name: string; color: string }): Promise<Project>
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'color'>>): Promise<Project>
  deleteProject(id: string): Promise<void>
  reorderProjects(orderedIds: string[]): Promise<void>
  createTask(input: Pick<Task, 'title' | 'description' | 'projectId' | 'priority' | 'dueDate' | 'dueTime' | 'isFocus'>): Promise<Task>
  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'description' | 'projectId' | 'priority' | 'dueDate' | 'dueTime' | 'isFocus'>>): Promise<Task>
  deleteTask(id: string): Promise<void>
  setTaskCompleted(id: string, completed: boolean): Promise<Task>
  reorderTasks(group: TaskGroup, orderedIds: string[]): Promise<void>
}

export class WorkspaceError extends Error {
  constructor(public readonly code: 'validation' | 'not-found' | 'conflict' | 'unavailable' | 'unexpected', message: string) {
    super(message)
  }
}
```

- [ ] **Step 4: 实现本地网关**

Create `app/data/local-workspace-gateway.ts`. The class must parse every read and write with `workspaceDocumentSchema`, clone the demo seed, generate UUIDs with `crypto.randomUUID()`, update timestamps through an injected clock, and persist once per operation. Use this mutation helper so failed serialization never changes storage:

```ts
private async mutate<T>(operation: (draft: WorkspaceDocument) => T): Promise<T> {
  const current = await this.loadWorkspace({ includeDeleted: true })
  const draft = structuredClone(current)
  const result = operation(draft)
  const validated = workspaceDocumentSchema.parse(draft)
  this.storage.setItem(this.key, JSON.stringify(validated))
  return result
}
```

Implement each interface method with owner checks, not-found errors, stable integer ordering, soft-delete timestamps, and project cascade deletion. `loadWorkspace()` filters deleted rows unless `includeDeleted` is true. Invalid JSON or schema data must be copied to the timestamped backup key before seeding a fresh document.

- [ ] **Step 5: 运行本地网关测试并确认通过**

Run:

```powershell
pnpm vitest run tests/unit/local-workspace-gateway.spec.ts
```

Expected: 3 tests PASS。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add app/data/workspace-gateway.ts app/data/local-workspace-gateway.ts tests/unit/local-workspace-gateway.spec.ts
git commit -m "feat: persist workspace CRUD locally"
```

### Task 4: 共享工作区模型、派生状态与回滚

**Files:**
- Create: `app/models/workspace-model.ts`
- Create: `app/plugins/workspace.ts`
- Create: `app/composables/useWorkspace.ts`
- Create: `app/types/workspace-injection.d.ts`
- Test: `tests/unit/workspace-model.spec.ts`

- [ ] **Step 1: 写状态模型失败测试**

Create `tests/unit/workspace-model.spec.ts` using a real local gateway for success and a small gateway wrapper that rejects reorder for rollback:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { createWorkspaceModel } from '../../app/models/workspace-model'
import { LocalWorkspaceGateway } from '../../app/data/local-workspace-gateway'

describe('workspace model', () => {
  beforeEach(() => localStorage.clear())

  it('loads derived metrics and project counts', async () => {
    const model = createWorkspaceModel(new LocalWorkspaceGateway(localStorage))
    await model.load()

    expect(model.metrics.value.active).toBe(5)
    expect(model.focusTasks.value).toHaveLength(3)
    expect(model.backendLabel.value).toBe('本地演示')
  })

  it('rolls back an optimistic reorder when persistence fails', async () => {
    const gateway = new LocalWorkspaceGateway(localStorage)
    const model = createWorkspaceModel(gateway)
    await model.load()
    const before = model.focusTasks.value.map(task => task.id)
    gateway.reorderTasks = async () => { throw new Error('storage unavailable') }

    await expect(model.reorderTasks('focus', [...before].reverse())).rejects.toThrow('storage unavailable')
    expect(model.focusTasks.value.map(task => task.id)).toEqual(before)
  })
})
```

- [ ] **Step 2: 运行测试并确认工厂缺失导致失败**

Run:

```powershell
pnpm vitest run tests/unit/workspace-model.spec.ts
```

Expected: FAIL，提示 `createWorkspaceModel` 不存在。

- [ ] **Step 3: 实现工作区模型**

Create `app/models/workspace-model.ts` with Vue refs for `document`, `loading`, `saving`, `error`, and computed values from `deriveWorkspace`. Implement `load`, all CRUD commands, completion, and reordering. Use one common optimistic helper:

```ts
async function optimistic(operation: () => void, persist: () => Promise<void>) {
  const snapshot = structuredClone(document.value)
  operation()
  try {
    await persist()
    document.value = await gateway.loadWorkspace()
  } catch (cause) {
    document.value = snapshot
    error.value = cause instanceof Error ? cause.message : '操作失败'
    throw cause
  }
}
```

Completion, focus/later movement, and reorder use `optimistic`; create, edit, and delete wait for gateway success and then call `load`. Return a stable object containing refs, computed refs, and commands.

- [ ] **Step 4: 注入模型并声明类型**

Create `app/plugins/workspace.ts` so server render receives an inert model and the client receives the selected gateway. Local must be the default; API mode is selected only when public config says `supabase`. Provide the model as `$workspace`.

Create `app/composables/useWorkspace.ts`:

```ts
export function useWorkspace() {
  const { $workspace } = useNuxtApp()
  return $workspace
}
```

Create `app/types/workspace-injection.d.ts` augmenting `NuxtApp` and `ComponentCustomProperties` with the return type of `createWorkspaceModel`.

- [ ] **Step 5: 运行状态模型测试和类型检查**

Run:

```powershell
pnpm vitest run tests/unit/workspace-model.spec.ts
pnpm typecheck
```

Expected: 2 tests PASS；类型检查退出码 0。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add app/models app/plugins app/composables/useWorkspace.ts app/types tests/unit/workspace-model.spec.ts
git commit -m "feat: add shared workspace state"
```

### Task 5: 编辑器、菜单和删除确认

**Files:**
- Create: `app/composables/useWorkspaceUi.ts`
- Create: `app/components/workspace/TaskEditorDialog.vue`
- Create: `app/components/workspace/ProjectEditorDialog.vue`
- Create: `app/components/workspace/DeleteConfirmDialog.vue`
- Create: `app/components/workspace/TaskActionsMenu.vue`
- Create: `app/components/workspace/ProjectActionsMenu.vue`
- Create: `app/components/workspace/WorkspaceOverlays.vue`
- Modify: `app/layouts/default.vue`
- Test: `tests/unit/workspace-dialogs.spec.ts`

- [ ] **Step 1: 写弹层行为失败测试**

Create `tests/unit/workspace-dialogs.spec.ts` mounting editors directly with props and asserting emitted validated payloads:

```ts
import { mountSuspended } from '@nuxt/test-utils/runtime'
import TaskEditorDialog from '../../app/components/workspace/TaskEditorDialog.vue'
import ProjectEditorDialog from '../../app/components/workspace/ProjectEditorDialog.vue'

describe('workspace editors', () => {
  it('submits a normalized task payload', async () => {
    const wrapper = await mountSuspended(TaskEditorDialog, { props: { open: true, task: null, projects: [] } })
    await wrapper.get('[name="title"]').setValue('  写实施计划  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ title: '写实施计划', isFocus: false })
  })

  it('rejects an empty project name', async () => {
    const wrapper = await mountSuspended(ProjectEditorDialog, { props: { open: true, project: null } })
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain('请输入项目名称')
  })
})
```

- [ ] **Step 2: 运行测试并确认组件缺失导致失败**

Run:

```powershell
pnpm vitest run tests/unit/workspace-dialogs.spec.ts
```

Expected: FAIL，提示编辑器组件无法解析。

- [ ] **Step 3: 实现 UI 状态和三个弹层**

`useWorkspaceUi.ts` uses `useState` for open state and selected IDs, and exports `openNewTask`, `openEditTask`, `openNewProject`, `openEditProject`, `askDeleteTask`, `askDeleteProject`, and `closeAll`.

Task and project editors render only when `open` is true, use `role="dialog"`, keep a local reactive form, validate with Zod on submit, show one `role="alert"` message, and emit `save` and `close`. Delete confirmation renders affected task count for project deletion and emits `confirm` only from its destructive button.

- [ ] **Step 4: 实现操作菜单与统一弹层挂载**

Task menu emits `edit`, `move`, `move-up`, `move-down`, and `delete`. Project menu emits `edit`, `move-up`, `move-down`, and `delete`. Both menus close after one action and provide `aria-label` attributes.

`WorkspaceOverlays.vue` resolves selected records from `useWorkspace`, calls model commands, and closes only after successful saves. Modify `app/layouts/default.vue` to render `<WorkspaceOverlays />` once after the four workspace zones.

- [ ] **Step 5: 添加第一版视觉样式并运行测试**

Append focused classes to `main.css`: `.dialog-backdrop`, `.workspace-dialog`, `.form-field`, `.dialog-actions`, `.action-menu`, `.danger-action`, `.mode-badge`, `.empty-state`, and `.inline-error`. Use the existing white canvas, 8–10px radii, thin `var(--line)` borders, subtle shadows, and violet focus rings.

Run:

```powershell
pnpm vitest run tests/unit/workspace-dialogs.spec.ts
```

Expected: 2 tests PASS。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add app/composables/useWorkspaceUi.ts app/components/workspace app/layouts/default.vue app/assets/css/main.css tests/unit/workspace-dialogs.spec.ts
git commit -m "feat: add workspace CRUD dialogs"
```

### Task 6: 动态 Today 页面与项目侧栏

**Files:**
- Modify: `app/pages/index.vue`
- Modify: `app/components/app/ProjectSidebar.vue`
- Modify: `app/assets/css/main.css`
- Modify: `tests/unit/today-workspace.spec.ts`
- Create: `tests/unit/project-sidebar.spec.ts`

- [ ] **Step 1: 将页面测试改为动态行为并确认失败**

Update `today-workspace.spec.ts` to load the injected workspace, assert the local mode badge, submit quick add, toggle a task, and open its action menu:

```ts
it('loads persisted groups and supports quick capture', async () => {
  const wrapper = await mountSuspended(TodayPage)
  await vi.waitFor(() => expect(wrapper.findAll('[data-task-row]').length).toBe(7))
  expect(wrapper.get('[data-backend-mode]').text()).toContain('本地演示')

  await wrapper.get('[data-quick-add] input').setValue('整理本周复盘')
  await wrapper.get('[data-quick-add]').trigger('submit')
  await vi.waitFor(() => expect(wrapper.text()).toContain('整理本周复盘'))
})
```

Create `project-sidebar.spec.ts` and assert project names/counts come from the injected model, clicking the plus button opens project creation, and one project action menu includes edit and delete.

Run:

```powershell
pnpm vitest run tests/unit/today-workspace.spec.ts tests/unit/project-sidebar.spec.ts
```

Expected: FAIL because the current components still use hard-coded arrays.

- [ ] **Step 2: 重构 Today 页面**

Replace local task arrays with `useWorkspace()`. Call `load()` on mount only when not ready. Bind metrics, focus/later/completed groups, quick add, completion, action menus, empty states, and reorder commands to the model. The top add button opens `useWorkspaceUi().openNewTask()`. Keep the existing headings, metric cards, quarterly card, list/calendar tabs, and AI refresh button.

For each task group, compute neighbors and disable up/down at boundaries. Completed rows remain expandable rather than permanently collapsed so CRUD remains reachable.

- [ ] **Step 3: 重构项目侧栏**

Replace the hard-coded `projects` array with `useWorkspace().projects` and `projectCounts`. Keep the navigation section unchanged. Add a project menu per row and wire the section plus button to `openNewProject`. The bottom task button calls `openNewTask`.

- [ ] **Step 4: 收紧任务列表视觉**

Reduce desktop `.task-row` minimum height from 58px to 52px, use thinner row separators, keep existing light canvas and card boundaries, and add compact action-menu anchoring without adopting the all-dark second mockup. Mobile rules must keep menus reachable rather than hiding all row actions.

- [ ] **Step 5: 运行页面、侧栏和外壳测试**

Run:

```powershell
pnpm vitest run tests/unit/today-workspace.spec.ts tests/unit/project-sidebar.spec.ts tests/unit/app-shell.spec.ts
```

Expected: all selected tests PASS。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add app/pages/index.vue app/components/app/ProjectSidebar.vue app/assets/css/main.css tests/unit/today-workspace.spec.ts tests/unit/project-sidebar.spec.ts
git commit -m "feat: connect CRUD workspace UI"
```

### Task 7: API 客户端、Supabase 仓库和服务端路由

**Files:**
- Create: `app/data/api-workspace-gateway.ts`
- Modify: `nuxt.config.ts`
- Create: `server/utils/supabase-workspace-repository.ts`
- Create: `server/utils/workspace-repository.ts`
- Create: resource routes listed in the file structure
- Test: `tests/unit/supabase-workspace-repository.spec.ts`

- [ ] **Step 1: 写 Supabase 映射失败测试**

Create `tests/unit/supabase-workspace-repository.spec.ts` with an injected transport spy:

```ts
import { describe, expect, it, vi } from 'vitest'
import { DEMO_OWNER_ID } from '../../shared/workspace'
import { SupabaseWorkspaceRepository } from '../../server/utils/supabase-workspace-repository'

describe('SupabaseWorkspaceRepository', () => {
  it('filters workspace reads by the fixed owner and active rows', async () => {
    const transport = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.loadWorkspace()

    expect(transport).toHaveBeenCalledWith(expect.stringContaining(`/rest/v1/projects?owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`), expect.any(Object))
    expect(transport).toHaveBeenCalledWith(expect.stringContaining(`/rest/v1/tasks?owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`), expect.any(Object))
  })

  it('uses the project soft-delete RPC', async () => {
    const transport = vi.fn().mockResolvedValue(null)
    const repository = new SupabaseWorkspaceRepository({
      url: 'https://example.supabase.co', key: 'server-secret', ownerId: DEMO_OWNER_ID, transport,
    })

    await repository.deleteProject('10000000-0000-4000-8000-000000000001')

    expect(transport).toHaveBeenCalledWith(expect.stringContaining('/rest/v1/rpc/soft_delete_project'), expect.objectContaining({ method: 'POST' }))
  })
})
```

- [ ] **Step 2: 运行测试并确认仓库缺失导致失败**

Run:

```powershell
pnpm vitest run tests/unit/supabase-workspace-repository.spec.ts
```

Expected: FAIL，提示仓库模块不存在。

- [ ] **Step 3: 实现 Supabase 仓库**

Create `server/utils/supabase-workspace-repository.ts` implementing `WorkspaceGateway`. Constructor receives `{ url, key, ownerId, transport }`; default transport is `$fetch`. Build headers only on the server:

```ts
private request<T>(path: string, options: Record<string, unknown> = {}) {
  return this.transport<T>(`${this.url}${path}`, {
    ...options,
    headers: {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  })
}
```

Map snake_case database rows to domain records and back. Every table request includes `owner_id=eq.<fixed UUID>`. Project deletion and both reorder operations call RPC endpoints. Convert HTTP 400 to `validation`, 404 to `not-found`, 409 to `conflict`, and connection/5xx failures to `unavailable`.

- [ ] **Step 4: 实现 API 客户端和路由**

`ApiWorkspaceGateway` maps every gateway method to the resource endpoints through `$fetch` and sets `mode = 'supabase'`.

`nuxt.config.ts` adds:

```ts
runtimeConfig: {
  supabaseUrl: '',
  supabaseServiceRoleKey: '',
  demoOwnerId: '00000000-0000-4000-8000-000000000001',
  public: { dataBackend: 'local' },
},
```

`workspace-repository.ts` reads runtime config from the event, throws a 503 configuration error when private values are absent, and returns `SupabaseWorkspaceRepository`. Each route uses `readValidatedBody` with the shared or input-specific Zod schema, reads `id` with `getRouterParam`, invokes one repository method, and returns domain JSON or `{ ok: true }`.

- [ ] **Step 5: 运行仓库测试、类型检查和路由生成检查**

Run:

```powershell
pnpm vitest run tests/unit/supabase-workspace-repository.spec.ts
pnpm typecheck
```

Expected: 2 tests PASS；类型检查退出码 0。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add app/data/api-workspace-gateway.ts nuxt.config.ts server tests/unit/supabase-workspace-repository.spec.ts
git commit -m "feat: add Supabase workspace API"
```

### Task 8: PostgreSQL 迁移、种子数据与静态契约测试

**Files:**
- Create: `supabase/migrations/202607220001_workspace.sql`
- Create: `supabase/seed.sql`
- Create: `.env.example`
- Create: `tests/unit/supabase-sql.spec.ts`

- [ ] **Step 1: 写 SQL 契约失败测试**

Create `tests/unit/supabase-sql.spec.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Supabase workspace migration', () => {
  it('defines soft deletion, owner indexes, RLS, and transactional RPCs', async () => {
    const sql = await readFile('supabase/migrations/202607220001_workspace.sql', 'utf8')

    expect(sql).toContain('create table if not exists public.projects')
    expect(sql).toContain('create table if not exists public.tasks')
    expect(sql).toContain('deleted_at timestamptz')
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('soft_delete_project')
    expect(sql).toContain('reorder_projects')
    expect(sql).toContain('reorder_tasks')
  })

  it('uses the fixed demo owner in idempotent seed inserts', async () => {
    const sql = await readFile('supabase/seed.sql', 'utf8')
    expect(sql).toContain('00000000-0000-4000-8000-000000000001')
    expect(sql.toLowerCase()).toContain('on conflict')
  })
})
```

- [ ] **Step 2: 运行测试并确认 SQL 文件缺失导致失败**

Run:

```powershell
pnpm vitest run tests/unit/supabase-sql.spec.ts
```

Expected: FAIL with `ENOENT` for the migration file.

- [ ] **Step 3: 编写迁移 SQL**

The migration must run inside a transaction and define:

```sql
begin;
create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null check (char_length(trim(name)) between 1 and 80),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  project_id uuid references public.projects(id),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '',
  priority text check (priority in ('low', 'medium', 'high')),
  due_date date,
  due_time time,
  is_focus boolean not null default false,
  sort_order integer not null default 0 check (sort_order >= 0),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
commit;
```

Between table creation and `commit`, add active owner indexes, the updated-at trigger, RLS enablement with no anonymous policies, `security definer` RPCs that verify `owner_id`, atomically soft-delete projects/tasks, and batch-rewrite sort order from UUID arrays.

- [ ] **Step 4: 编写幂等种子和环境变量示例**

`seed.sql` inserts the Inbox and three visible projects plus seven tasks with fixed UUIDs and `on conflict (id) do update`. `.env.example` contains only:

```dotenv
NUXT_PUBLIC_DATA_BACKEND=local
NUXT_SUPABASE_URL=
NUXT_SUPABASE_SERVICE_ROLE_KEY=
NUXT_DEMO_OWNER_ID=00000000-0000-4000-8000-000000000001
```

Add comments warning that the service-role key is server-only and must never be exposed through `NUXT_PUBLIC_` variables.

- [ ] **Step 5: 运行 SQL 契约测试**

Run:

```powershell
pnpm vitest run tests/unit/supabase-sql.spec.ts
```

Expected: 2 tests PASS。报告中明确说明这不是实库迁移验证。

- [ ] **Step 6: Git checkout 可用时提交**

```powershell
git add supabase .env.example tests/unit/supabase-sql.spec.ts
git commit -m "feat: add Supabase workspace schema"
```

### Task 9: 全量回归、构建与验收核对

**Files:**
- Modify if required: `tests/unit/app-shell.spec.ts`
- Verify: all implementation and test files

- [ ] **Step 1: 运行完整单元测试**

Run:

```powershell
pnpm test
```

Expected: all test files PASS with zero failures and no unhandled errors.

- [ ] **Step 2: 运行严格类型检查**

Run:

```powershell
pnpm typecheck
```

Expected: exit code 0 and no TypeScript errors.

- [ ] **Step 3: 运行 Nuxt 生产构建**

Run:

```powershell
pnpm build
```

Expected: exit code 0 and successful client/server bundle generation.

- [ ] **Step 4: 核对验收清单**

Verify from tests and code:

```text
[ ] local is the default and performs no network request
[ ] first load seeds projects and tasks
[ ] refresh reloads local data
[ ] project and task CRUD are accessible
[ ] completion and focus/later movement persist
[ ] project deletion soft-deletes active tasks
[ ] task and project ordering persist
[ ] metrics and counts are derived from active data
[ ] private Supabase configuration remains server-only
[ ] SQL live execution is not claimed
```

- [ ] **Step 5: 检查工作区改动范围**

If Git metadata is restored, run:

```powershell
git status --short
git diff --check
git diff --stat
```

Expected: only planned files changed; `git diff --check` reports no whitespace errors. In the current archive, use `rg --files` plus the test outputs instead and do not create Git metadata.

- [ ] **Step 6: Git checkout 可用时提交最终调整**

```powershell
git add app shared server supabase tests nuxt.config.ts .env.example docs/superpowers
git commit -m "feat: complete local-first Supabase CRUD"
```

