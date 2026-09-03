# Secondary Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留第一版 Huly 外壳和无登录本地优先体验的前提下，实现收集箱、季度追踪、年终总结三个中文版仪表盘，并为季度目标补齐本地与 Supabase 完整 CRUD、排序和软删除。

**Architecture:** 将 `WorkspaceDocument` 从 v1 升级到 v2，在现有项目、任务旁加入一层 `QuarterGoal` 聚合；共享领域层负责迁移、季度风险和年度总结等纯派生，浏览器继续通过统一 `WorkspaceGateway` 使用本地或 Nuxt API 数据源。页面只消费 `WorkspaceModel`，年终总结不持久化，Supabase 通过一份新的增量迁移增加目标表和排序 RPC。

**Tech Stack:** Nuxt 4、Vue 3、TypeScript、Zod、Vitest、Nuxt Test Utils、Playwright、原生 `localStorage`、Nuxt `$fetch`、PostgreSQL/Supabase SQL、原生 SVG/CSS。

---

## 执行约束

- 当前目录没有 `.git` 元数据；不得执行 `git init`、不得修改 `.git`。每个任务末尾使用本地验证检查点，不运行 `git add` 或 `git commit`。
- 不安装新依赖；图表只使用 Vue、SVG 和 CSS。
- 不读取任何密钥文件，不连接真实 Supabase，不执行数据库迁移。
- 默认数据源保持 `local`；单元测试和页面不得发起外部网络请求。
- 所有生产代码遵循红—绿—重构：先写一个会因缺少当前行为而失败的测试，运行并确认失败原因，再写最小实现并重新运行。
- 删除均为软删除。禁止物理删除项目、任务或季度目标。
- 外层深色工具栏、深色项目侧栏、浅色主工作区和白色 AI 面板不变；方案 B 只增强三个页面内部的信息层级。
- 现有本地存储键 `personal-ai-workspace:v1` 暂不更名。读取 v1 文档后原地写回 v2，避免用户因换键而看不到旧数据。

## 文件职责映射

### 共享领域与数据访问

- Modify: `shared/workspace.ts` — `QuarterGoal` Schema、v1→v2 迁移、季度和年度纯派生。
- Modify: `app/data/demo-workspace.ts` — v2 演示文档与三个 `2026-Q3` 目标。
- Modify: `app/data/workspace-gateway.ts` — 季度目标输入类型和四个网关命令。
- Modify: `app/data/local-workspace-gateway.ts` — v1 迁移、目标 CRUD、排序与软删除。
- Modify: `app/data/api-workspace-gateway.ts` — 四个季度目标 API 调用。
- Modify: `app/models/workspace-model.ts` — 目标状态、命令和乐观排序回滚。

### 服务端与 SQL

- Modify: `server/utils/workspace-api.ts` — 目标创建、更新和排序 Zod 输入。
- Modify: `server/utils/supabase-workspace-repository.ts` — 目标行映射、固定 owner 过滤、CRUD 和排序 RPC。
- Create: `server/api/quarter-goals/index.post.ts` — 新建季度目标。
- Create: `server/api/quarter-goals/[id].patch.ts` — 编辑季度目标。
- Create: `server/api/quarter-goals/[id].delete.ts` — 软删除季度目标。
- Create: `server/api/quarter-goals/reorder.post.ts` — 同一季度目标排序。
- Create: `supabase/migrations/202607290001_quarter_goals.sql` — 目标表、约束、索引、触发器、RLS 和 RPC。
- Modify: `supabase/seed.sql` — 三个固定 UUID 的 `2026-Q3` 目标。

### 界面

- Modify: `app/composables/useWorkspaceUi.ts` — 目标编辑器和删除请求状态。
- Create: `app/components/workspace/QuarterGoalEditorDialog.vue` — 目标新建/编辑表单。
- Create: `app/components/workspace/QuarterGoalActionsMenu.vue` — 编辑、状态、排序和删除入口。
- Modify: `app/components/workspace/DeleteConfirmDialog.vue` — 支持目标删除文案。
- Modify: `app/components/workspace/WorkspaceOverlays.vue` — 挂载目标编辑器和目标软删除。
- Create: `app/components/dashboard/DashboardTopbar.vue` — 三个页面共享的面包屑、数据源和主操作。
- Create: `app/components/dashboard/MetricCard.vue` — 可复用指标卡。
- Create: `app/components/dashboard/EmptyDashboardState.vue` — 可操作空状态。
- Create: `app/pages/inbox.vue` — 收集箱指标、筛选、任务表和规则建议。
- Create: `app/pages/quarter.vue` — 季度指标、目标卡片、CRUD、状态、进度和排序。
- Create: `app/pages/review.vue` — 年度指标、季度趋势、项目分布和里程碑。
- Modify: `app/components/app/ProjectSidebar.vue` — 当前路由高亮、真实季度进度。
- Modify: `app/components/app/AppRail.vue` — 桌面/手机端真实导航链接。
- Modify: `app/assets/css/main.css` — 仪表盘 B 视觉和响应式规则。

### 测试

- Modify: `tests/unit/workspace-domain.spec.ts`
- Modify: `tests/unit/local-workspace-gateway.spec.ts`
- Modify: `tests/unit/workspace-model.spec.ts`
- Modify: `tests/unit/api-workspace-gateway.spec.ts`
- Modify: `tests/unit/supabase-workspace-repository.spec.ts`
- Modify: `tests/unit/workspace-api-contract.spec.ts`
- Modify: `tests/unit/supabase-sql.spec.ts`
- Modify: `tests/unit/workspace-dialogs.spec.ts`
- Create: `tests/unit/secondary-dashboard-pages.spec.ts`
- Modify: `tests/unit/app-shell.spec.ts`
- Create: `tests/e2e/secondary-dashboards.spec.ts`

## Task 1: 升级领域文档并实现确定性统计

**Files:**
- Modify: `shared/workspace.ts`
- Modify: `tests/unit/workspace-domain.spec.ts`

- [ ] **Step 1: 为 Schema、v1 迁移、季度风险和年度口径写失败测试**

在 `tests/unit/workspace-domain.spec.ts` 增加固定日期测试，覆盖下面的真实导出：

```ts
import {
  deriveAnnualReview,
  deriveQuarterMetrics,
  migrateWorkspaceDocument,
  quarterGoalSchema,
  workspaceDocumentSchema,
} from '../../shared/workspace'

it('migrates a version 1 document without changing projects or tasks', () => {
  const legacy = {
    version: 1 as const,
    projects: createDemoWorkspace().projects,
    tasks: createDemoWorkspace().tasks,
  }

  const migrated = migrateWorkspaceDocument(legacy)

  expect(migrated.version).toBe(2)
  expect(migrated.projects).toEqual(legacy.projects)
  expect(migrated.tasks).toEqual(legacy.tasks)
  expect(migrated.quarterGoals).toEqual([])
  expect(workspaceDocumentSchema.parse(migrated)).toEqual(migrated)
})

it('validates quarter goal progress and quarter format', () => {
  const goal = createDemoWorkspace().quarterGoals[0]!
  expect(quarterGoalSchema.safeParse({ ...goal, quarter: '2026-Q5' }).success).toBe(false)
  expect(quarterGoalSchema.safeParse({ ...goal, progress: 101 }).success).toBe(false)
  expect(quarterGoalSchema.safeParse({ ...goal, progress: 68.5 }).success).toBe(false)
})

it('marks only active goals more than twenty points behind quarter time as risk', () => {
  const document = createDemoWorkspace()
  document.quarterGoals[0]!.progress = 10
  document.quarterGoals[1]!.progress = 40
  document.quarterGoals[2]!.progress = 40
  document.quarterGoals[2]!.status = 'paused'

  const metrics = deriveQuarterMetrics(document, '2026-Q3', new Date('2026-08-15T00:00:00.000Z'))

  expect(metrics.totalGoals).toBe(3)
  expect(metrics.riskGoalIds).toEqual([document.quarterGoals[0]!.id])
  expect(metrics.averageProgress).toBe(30)
})

it('uses due year with created year fallback for the annual completion rate', () => {
  const document = createDemoWorkspace()
  document.tasks.push({
    ...document.tasks[0]!,
    id: '20000000-0000-4000-8000-000000000099',
    dueDate: null,
    createdAt: '2025-12-31T23:00:00.000Z',
    completedAt: '2026-01-02T08:00:00.000Z',
  })

  const review = deriveAnnualReview(document, 2026)

  expect(review.annualTaskCount).toBe(7)
  expect(review.completedTaskCount).toBe(2)
  expect(review.completionRate).toBe(29)
  expect(review.averageGoalProgress).toBe(68)
})
```

- [ ] **Step 2: 运行领域测试并确认预期失败**

Run:

```powershell
pnpm vitest run tests/unit/workspace-domain.spec.ts
```

Expected: FAIL，原因是 `QuarterGoal`、v2 Schema 和统计函数尚不存在；不得接受语法错误或测试夹具错误作为红灯。

- [ ] **Step 3: 实现 v1/v2 Schema 和迁移入口**

在 `shared/workspace.ts` 增加以下稳定契约：

```ts
export const quarterKeySchema = z.string().regex(/^\d{4}-Q[1-4]$/)
export const quarterGoalStatusSchema = z.enum(['active', 'completed', 'paused'])

export const quarterGoalSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  quarter: quarterKeySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  progress: z.number().int().min(0).max(100),
  status: quarterGoalStatusSchema,
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})

export const workspaceDocumentV1Schema = z.object({
  version: z.literal(1),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
})

export const workspaceDocumentSchema = z.object({
  version: z.literal(2),
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  quarterGoals: z.array(quarterGoalSchema),
})

export type QuarterGoal = z.infer<typeof quarterGoalSchema>
export type QuarterGoalStatus = z.infer<typeof quarterGoalStatusSchema>
export type QuarterKey = z.infer<typeof quarterKeySchema>
export type WorkspaceDocument = z.infer<typeof workspaceDocumentSchema>

export function migrateWorkspaceDocument(input: unknown): WorkspaceDocument {
  const current = workspaceDocumentSchema.safeParse(input)
  if (current.success) return current.data
  const legacy = workspaceDocumentV1Schema.parse(input)
  return workspaceDocumentSchema.parse({ ...legacy, version: 2, quarterGoals: [] })
}
```

`deriveWorkspace()` 必须继续返回原项目/任务字段，并新增按 `sortOrder` 排序且排除 `deletedAt` 的 `quarterGoals`。

- [ ] **Step 4: 实现季度与年度纯派生**

实现并导出：

```ts
export function goalsForQuarter(document: WorkspaceDocument, quarter: QuarterKey): QuarterGoal[]
export function quarterElapsedPercent(quarter: QuarterKey, now: Date): number
export function deriveQuarterMetrics(
  document: WorkspaceDocument,
  quarter: QuarterKey,
  now: Date,
): {
  averageProgress: number
  totalGoals: number
  completedGoals: number
  riskGoalIds: string[]
  remainingDays: number
}

export function deriveAnnualReview(
  document: WorkspaceDocument,
  year: number,
): {
  year: number
  annualTaskCount: number
  completedTaskCount: number
  completionRate: number
  averageGoalProgress: number
  milestoneCount: number
  quarterTrend: Array<{ quarter: QuarterKey, progress: number }>
  projectDistribution: Array<{
    projectId: string
    name: string
    color: string
    total: number
    completed: number
    completionRate: number
  }>
  milestones: Array<{
    id: string
    kind: 'task' | 'goal'
    title: string
    date: string
  }>
}
```

实现口径：

- 季度起点为 `Date.UTC(year, (quarterNumber - 1) * 3, 1)`，结束点为下一季度第一天；时间进度和剩余天数夹在合法范围内。
- 风险条件严格为 `status === 'active' && progress < elapsedPercent - 20`。
- 年度任务先按 `dueDate.slice(0, 4)` 归年；`dueDate === null` 时使用 `createdAt` 的 UTC 年份。
- 完成数只计算年度任务中 `completedAt` 的 UTC 年份等于目标年份的任务。
- 所有百分比四舍五入为整数；空分母返回 0。
- 季度趋势固定返回 Q1–Q4 四点，空季度进度为 0。
- 项目分布仅包含未软删除项目，并仅统计相应有效任务。
- 里程碑由当年完成的任务与状态为 `completed` 的当年季度目标组成，按日期降序。

- [ ] **Step 5: 重新运行领域测试**

Run:

```powershell
pnpm vitest run tests/unit/workspace-domain.spec.ts
```

Expected: 所有领域测试 PASS。

- [ ] **Step 6: 本地检查点**

记录 `shared/workspace.ts` 与 `tests/unit/workspace-domain.spec.ts` 已通过定向测试。当前无 Git 元数据，不运行提交命令。

## Task 2: 升级演示数据并实现本地季度目标 CRUD

**Files:**
- Modify: `app/data/demo-workspace.ts`
- Modify: `app/data/workspace-gateway.ts`
- Modify: `app/data/local-workspace-gateway.ts`
- Modify: `tests/unit/local-workspace-gateway.spec.ts`

- [ ] **Step 1: 写 v1 原地迁移和目标 CRUD 失败测试**

增加测试：

```ts
it('persists a version 1 document as version 2 without replacing user data', async () => {
  const legacy = createDemoWorkspace()
  localStorage.setItem('personal-ai-workspace:v1', JSON.stringify({
    version: 1,
    projects: legacy.projects.slice(0, 1),
    tasks: legacy.tasks.slice(0, 1),
  }))

  const document = await new LocalWorkspaceGateway(localStorage, () => NOW).loadWorkspace()
  const persisted = JSON.parse(localStorage.getItem('personal-ai-workspace:v1')!)

  expect(document).toMatchObject({ version: 2, quarterGoals: [] })
  expect(document.tasks[0]?.id).toBe(legacy.tasks[0]?.id)
  expect(persisted.version).toBe(2)
})

it('persists quarter goal create, update, reorder, and soft delete', async () => {
  const gateway = new LocalWorkspaceGateway(
    localStorage,
    () => NOW,
    () => '30000000-0000-4000-8000-000000000099',
  )
  const created = await gateway.createQuarterGoal({
    quarter: '2026-Q3',
    title: '完成季度复盘',
    description: '形成可复用流程',
    progress: 20,
    status: 'active',
  })
  await gateway.updateQuarterGoal(created.id, { progress: 55, status: 'paused' })

  const activeIds = (await gateway.loadWorkspace()).quarterGoals
    .filter(goal => goal.quarter === '2026-Q3')
    .map(goal => goal.id)
    .reverse()
  await gateway.reorderQuarterGoals('2026-Q3', activeIds)
  await gateway.deleteQuarterGoal(created.id)

  expect((await gateway.loadWorkspace()).quarterGoals.some(goal => goal.id === created.id)).toBe(false)
  const deleted = (await gateway.loadWorkspace({ includeDeleted: true })).quarterGoals
    .find(goal => goal.id === created.id)
  expect(deleted).toMatchObject({ progress: 55, status: 'paused', deletedAt: NOW })
})
```

- [ ] **Step 2: 运行定向测试并确认预期失败**

Run:

```powershell
pnpm vitest run tests/unit/local-workspace-gateway.spec.ts
```

Expected: FAIL，缺少 v2 文档和目标网关方法。

- [ ] **Step 3: 增加网关输入与方法**

在 `app/data/workspace-gateway.ts` 增加：

```ts
export type CreateQuarterGoalInput = Pick<
  QuarterGoal,
  'quarter' | 'title' | 'description' | 'progress' | 'status'
>
export type UpdateQuarterGoalInput = Partial<CreateQuarterGoalInput>

export interface WorkspaceGateway {
  // 保留所有现有方法
  createQuarterGoal(input: CreateQuarterGoalInput): Promise<QuarterGoal>
  updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput): Promise<QuarterGoal>
  deleteQuarterGoal(id: string): Promise<void>
  reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]): Promise<void>
}
```

- [ ] **Step 4: 把演示文档升级到 v2**

`app/data/demo-workspace.ts` 设置 `version: 2` 并加入三个固定目标：

```ts
quarterGoals: [
  {
    id: '30000000-0000-4000-8000-000000000001',
    ownerId: DEMO_OWNER_ID,
    quarter: '2026-Q3',
    title: '完成个人效率系统 1.0',
    description: '让任务、项目与复盘形成稳定闭环',
    progress: 72,
    status: 'active',
    sortOrder: 0,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  },
  {
    id: '30000000-0000-4000-8000-000000000002',
    ownerId: DEMO_OWNER_ID,
    quarter: '2026-Q3',
    title: '建立每周复盘习惯',
    description: '连续执行并沉淀一套固定复盘模板',
    progress: 68,
    status: 'active',
    sortOrder: 1,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  },
  {
    id: '30000000-0000-4000-8000-000000000003',
    ownerId: DEMO_OWNER_ID,
    quarter: '2026-Q3',
    title: '恢复稳定训练节奏',
    description: '每周完成三次力量或有氧训练',
    progress: 64,
    status: 'active',
    sortOrder: 2,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
  },
]
```

平均值必须为 68。

- [ ] **Step 5: 实现本地迁移和目标变更**

`readDocument()` 改为：

```ts
const parsed = migrateWorkspaceDocument(JSON.parse(raw))
if (parsed.version === 2 && JSON.parse(raw).version === 1) this.persist(parsed)
return parsed
```

只解析一次原始 JSON，保存前仍以 `workspaceDocumentSchema.parse()` 校验。`loadWorkspace()` 返回 `version: 2` 和按 `includeDeleted` 过滤后的 `quarterGoals`。

目标行为：

- 新目标的 `sortOrder` 只在同一季度的有效目标中取最大值加一。
- 标题 `trim()`；所有记录固定 `ownerId = DEMO_OWNER_ID`。
- 更新只改传入字段并刷新 `updatedAt`。
- 删除只写 `deletedAt` 和 `updatedAt`。
- 排序只接受指定季度全部有效目标的同一 ID 集合，复用 `ensureSameIds()`。

- [ ] **Step 6: 运行定向测试和旧领域回归**

Run:

```powershell
pnpm vitest run tests/unit/local-workspace-gateway.spec.ts tests/unit/workspace-domain.spec.ts
```

Expected: 两个测试文件全部 PASS，现有项目/任务 CRUD 行为不回退。

- [ ] **Step 7: 本地检查点**

记录四个数据层文件和两个测试文件的通过结果；不运行 Git 提交。

## Task 3: 将季度目标接入 API 网关和 WorkspaceModel

**Files:**
- Modify: `app/data/api-workspace-gateway.ts`
- Modify: `app/models/workspace-model.ts`
- Modify: `tests/unit/api-workspace-gateway.spec.ts`
- Modify: `tests/unit/workspace-model.spec.ts`

- [ ] **Step 1: 写 API 映射和模型回滚失败测试**

`tests/unit/api-workspace-gateway.spec.ts` 增加：

```ts
it('maps quarter goal CRUD and reorder to resource routes', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce({ id: GOAL_ID })
    .mockResolvedValueOnce({ id: GOAL_ID, progress: 80 })
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true })
  const gateway = new ApiWorkspaceGateway(fetcher)

  await gateway.createQuarterGoal({
    quarter: '2026-Q3',
    title: '目标',
    description: '',
    progress: 20,
    status: 'active',
  })
  await gateway.updateQuarterGoal(GOAL_ID, { progress: 80 })
  await gateway.deleteQuarterGoal(GOAL_ID)
  await gateway.reorderQuarterGoals('2026-Q3', [GOAL_ID])

  expect(fetcher).toHaveBeenNthCalledWith(1, '/api/quarter-goals', expect.objectContaining({ method: 'POST' }))
  expect(fetcher).toHaveBeenNthCalledWith(2, `/api/quarter-goals/${GOAL_ID}`, expect.objectContaining({ method: 'PATCH' }))
  expect(fetcher).toHaveBeenNthCalledWith(3, `/api/quarter-goals/${GOAL_ID}`, expect.objectContaining({ method: 'DELETE' }))
  expect(fetcher).toHaveBeenNthCalledWith(4, '/api/quarter-goals/reorder', {
    method: 'POST',
    body: { quarter: '2026-Q3', orderedIds: [GOAL_ID] },
  })
})
```

`tests/unit/workspace-model.spec.ts` 增加：

```ts
it('refreshes quarter goals after create and rolls back failed reorder', async () => {
  const gateway = new LocalWorkspaceGateway(localStorage)
  const model = createWorkspaceModel(gateway)
  await model.load()
  await model.createQuarterGoal({
    quarter: '2026-Q3',
    title: '新目标',
    description: '',
    progress: 0,
    status: 'active',
  })
  expect(model.quarterGoals.value.some(goal => goal.title === '新目标')).toBe(true)

  const before = model.quarterGoals.value.map(goal => goal.id)
  gateway.reorderQuarterGoals = async () => { throw new Error('goal order unavailable') }
  await expect(model.reorderQuarterGoals('2026-Q3', [...before].reverse()))
    .rejects.toThrow('goal order unavailable')
  expect(model.quarterGoals.value.map(goal => goal.id)).toEqual(before)
})
```

- [ ] **Step 2: 运行两个测试文件并确认预期失败**

Run:

```powershell
pnpm vitest run tests/unit/api-workspace-gateway.spec.ts tests/unit/workspace-model.spec.ts
```

Expected: FAIL，原因是 API 网关与模型尚未暴露目标方法。

- [ ] **Step 3: 实现 API 网关映射**

在 `ApiWorkspaceGateway` 增加四个方法，返回类型分别为 `QuarterGoal`、`QuarterGoal`、`void`、`void`，路径和请求体与测试完全一致。

- [ ] **Step 4: 扩展 WorkspaceModel**

空文档改为：

```ts
const emptyWorkspace = (): WorkspaceDocument => ({
  version: 2,
  projects: [],
  tasks: [],
  quarterGoals: [],
})
```

增加 `quarterGoals` computed，以及：

```ts
async function createQuarterGoal(input: CreateQuarterGoalInput) {
  await commit(() => requireGateway().createQuarterGoal(input))
}

async function updateQuarterGoal(id: string, patch: UpdateQuarterGoalInput) {
  await commit(() => requireGateway().updateQuarterGoal(id, patch))
}

async function deleteQuarterGoal(id: string) {
  await commit(() => requireGateway().deleteQuarterGoal(id))
}

async function reorderQuarterGoals(quarter: QuarterKey, orderedIds: string[]) {
  await optimistic(
    () => applyOrder(document.value.quarterGoals, orderedIds),
    () => requireGateway().reorderQuarterGoals(quarter, orderedIds),
  )
}
```

将 `QuarterGoal` 加入 `applyOrder` 泛型并在返回对象暴露全部状态和命令。

- [ ] **Step 5: 运行测试和类型检查**

Run:

```powershell
pnpm vitest run tests/unit/api-workspace-gateway.spec.ts tests/unit/workspace-model.spec.ts
pnpm typecheck
```

Expected: 定向测试 PASS，类型检查退出码 0。

- [ ] **Step 6: 本地检查点**

记录 API 网关、模型和测试通过结果；不运行 Git 提交。

## Task 4: 实现服务端目标仓库、校验和路由

**Files:**
- Modify: `server/utils/workspace-api.ts`
- Modify: `server/utils/supabase-workspace-repository.ts`
- Create: `server/api/quarter-goals/index.post.ts`
- Create: `server/api/quarter-goals/[id].patch.ts`
- Create: `server/api/quarter-goals/[id].delete.ts`
- Create: `server/api/quarter-goals/reorder.post.ts`
- Modify: `tests/unit/supabase-workspace-repository.spec.ts`
- Modify: `tests/unit/workspace-api-contract.spec.ts`

- [ ] **Step 1: 写服务端失败测试**

仓库测试要把 `loadWorkspace()` 的 transport mock 扩展为三次读取，并断言第三次为：

```ts
expect(transport).toHaveBeenCalledWith(
  expect.stringContaining(`/rest/v1/quarter_goals?select=*&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
  expect.any(Object),
)
```

再增加：

```ts
it('maps quarter goal rows and uses owner-scoped writes', async () => {
  const transport = vi.fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([GOAL_ROW])
    .mockResolvedValueOnce([{ ...GOAL_ROW, progress: 80 }])
    .mockResolvedValueOnce([{ ...GOAL_ROW, deleted_at: NOW }])
    .mockResolvedValueOnce(null)
  const repository = createRepository(transport)

  const document = await repository.loadWorkspace()
  expect(document).toMatchObject({
    version: 2,
    quarterGoals: [expect.objectContaining({ quarter: '2026-Q3', progress: 68 })],
  })
  await repository.updateQuarterGoal(GOAL_ID, { progress: 80 })
  await repository.deleteQuarterGoal(GOAL_ID)
  await repository.reorderQuarterGoals('2026-Q3', [GOAL_ID])

  expect(transport).toHaveBeenCalledWith(
    expect.stringContaining(`quarter_goals?id=eq.${GOAL_ID}&owner_id=eq.${DEMO_OWNER_ID}&deleted_at=is.null`),
    expect.objectContaining({ method: 'PATCH' }),
  )
  expect(transport).toHaveBeenCalledWith(
    expect.stringContaining('/rest/v1/rpc/reorder_quarter_goals'),
    expect.objectContaining({
      body: { p_owner_id: DEMO_OWNER_ID, p_quarter: '2026-Q3', p_ordered_ids: [GOAL_ID] },
    }),
  )
})
```

API 契约测试增加：

```ts
expect(createQuarterGoalInputSchema.safeParse({
  quarter: '2026-Q5',
  title: '目标',
  description: '',
  progress: 20,
  status: 'active',
}).success).toBe(false)

expect(updateQuarterGoalInputSchema.safeParse({}).success).toBe(false)
expect(reorderQuarterGoalsInputSchema.safeParse({
  quarter: '2026-Q3',
  orderedIds: [GOAL_ID, GOAL_ID],
}).success).toBe(false)
```

- [ ] **Step 2: 运行失败测试**

Run:

```powershell
pnpm vitest run tests/unit/supabase-workspace-repository.spec.ts tests/unit/workspace-api-contract.spec.ts
```

Expected: FAIL，缺少第三类记录、目标方法与输入 Schema。

- [ ] **Step 3: 实现仓库映射和 owner 范围**

新增 `QuarterGoalRow` 及 `mapQuarterGoal()`：

```ts
type QuarterGoalRow = {
  id: string
  owner_id: string
  quarter: string
  title: string
  description: string
  progress: number
  status: QuarterGoalStatus
  sort_order: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}
```

`loadWorkspace()` 第三次读取 `quarter_goals`，返回 `version: 2` 和映射后的 `quarterGoals`。创建时只在输入季度中计算下一个 `sort_order`。更新和删除必须带 `id`、固定 `owner_id`、`deleted_at=is.null`；删除 PATCH `{ deleted_at: new Date().toISOString() }`。排序调用 `/rest/v1/rpc/reorder_quarter_goals`。

- [ ] **Step 4: 实现 Zod 输入和四个路由**

在 `workspace-api.ts` 增加：

```ts
const quarterGoalFields = {
  quarter: quarterKeySchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  progress: z.number().int().min(0).max(100),
  status: quarterGoalStatusSchema,
}

export const createQuarterGoalInputSchema = z.object(quarterGoalFields)
export const updateQuarterGoalInputSchema = z.object(quarterGoalFields).partial().refine(
  value => Object.keys(value).length > 0,
  '至少提供一个季度目标字段',
)
export const reorderQuarterGoalsInputSchema = z.object({
  quarter: quarterKeySchema,
  orderedIds: uniqueIds,
})
```

路由采用现有模式：

```ts
// server/api/quarter-goals/index.post.ts
export default defineEventHandler(async (event) => {
  const input = await readValidatedBody(event, body => createQuarterGoalInputSchema.parse(body))
  return await getWorkspaceRepository(event).createQuarterGoal(input)
})
```

PATCH/DELETE 用 `z.string().uuid().parse(getRouterParam(event, 'id'))`；DELETE 返回 `{ ok: true }`；reorder 解析 `reorderQuarterGoalsInputSchema` 后调用仓库并返回 `{ ok: true }`。

- [ ] **Step 5: 运行服务端测试和类型检查**

Run:

```powershell
pnpm vitest run tests/unit/supabase-workspace-repository.spec.ts tests/unit/workspace-api-contract.spec.ts
pnpm typecheck
```

Expected: 所有定向测试 PASS，类型检查退出码 0；不产生真实 Supabase 请求。

- [ ] **Step 6: 本地检查点**

记录仓库、Schema、四个路由和测试通过结果；不运行 Git 提交。

## Task 5: 增加 Supabase 增量迁移和幂等目标种子

**Files:**
- Create: `supabase/migrations/202607290001_quarter_goals.sql`
- Modify: `supabase/seed.sql`
- Modify: `tests/unit/supabase-sql.spec.ts`

- [ ] **Step 1: 写 SQL 契约失败测试**

```ts
it('defines owner-scoped soft-deletable quarter goals and validated reorder RPC', async () => {
  const sql = (await readFile(
    'supabase/migrations/202607290001_quarter_goals.sql',
    'utf8',
  )).toLowerCase()

  expect(sql).toContain('create table if not exists public.quarter_goals')
  expect(sql).toContain("quarter ~ '^\\d{4}-q[1-4]$'")
  expect(sql).toContain('progress between 0 and 100')
  expect(sql).toContain("status in ('active', 'completed', 'paused')")
  expect(sql).toContain('quarter_goals_owner_quarter_active_idx')
  expect(sql).toContain('enable row level security')
  expect(sql).toContain('reorder_quarter_goals')
  expect(sql).toContain('cardinality(p_ordered_ids)')
  expect(sql).toContain('grant execute on function public.reorder_quarter_goals')
})

it('seeds the three demo quarter goals idempotently', async () => {
  const sql = (await readFile('supabase/seed.sql', 'utf8')).toLowerCase()
  expect(sql).toContain('insert into public.quarter_goals')
  expect(sql.match(/30000000-0000-4000-8000-00000000000[1-3]/g)).toHaveLength(3)
  expect(sql).toContain('on conflict (id) do update')
})
```

- [ ] **Step 2: 运行 SQL 测试并确认文件缺失失败**

Run:

```powershell
pnpm vitest run tests/unit/supabase-sql.spec.ts
```

Expected: FAIL，明确指向新的增量迁移不存在或缺少目标 SQL。

- [ ] **Step 3: 编写增量迁移**

迁移必须在 `begin;` / `commit;` 中完成并包含：

```sql
create table if not exists public.quarter_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  quarter text not null check (quarter ~ '^\d{4}-Q[1-4]$'),
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 4000),
  progress integer not null default 0 check (progress between 0 and 100),
  status text not null default 'active'
    check (status in ('active', 'completed', 'paused')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists quarter_goals_owner_quarter_active_idx
  on public.quarter_goals (owner_id, quarter, sort_order)
  where deleted_at is null;

create trigger quarter_goals_set_updated_at
before update on public.quarter_goals
for each row execute function public.set_workspace_updated_at();

alter table public.quarter_goals enable row level security;
```

先 `drop trigger if exists` 保证迁移可重放。`reorder_quarter_goals(p_owner_id uuid, p_quarter text, p_ordered_ids uuid[])` 使用 `security definer` 和 `set search_path = public`，验证：

- `p_quarter` 格式合法。
- ID 数组非空且无重复。
- 数组数量等于该 owner/quarter 的有效目标数量。
- 每个 ID 都属于该 owner/quarter 且未删除。
- 使用 `unnest(... with ordinality)` 一次性写入 `sort_order`。

最后从 `public` 撤销执行权并只授予 `service_role`。

- [ ] **Step 4: 扩展幂等种子**

在现有 tasks insert 后、`commit` 前插入 Task 2 的三个目标。`on conflict (id) do update` 更新 owner、quarter、标题、说明、进度、状态和排序，并设置 `deleted_at = null`。

- [ ] **Step 5: 运行 SQL 契约测试**

Run:

```powershell
pnpm vitest run tests/unit/supabase-sql.spec.ts
```

Expected: 全部 PASS。结果只证明静态契约，不能宣称真实数据库迁移已验证。

- [ ] **Step 6: 本地检查点**

记录增量迁移、种子和静态测试通过；不运行 Git 提交、不执行迁移。

## Task 6: 实现季度目标弹层、菜单和软删除确认

**Files:**
- Modify: `app/composables/useWorkspaceUi.ts`
- Create: `app/components/workspace/QuarterGoalEditorDialog.vue`
- Create: `app/components/workspace/QuarterGoalActionsMenu.vue`
- Modify: `app/components/workspace/DeleteConfirmDialog.vue`
- Modify: `app/components/workspace/WorkspaceOverlays.vue`
- Modify: `tests/unit/workspace-dialogs.spec.ts`

- [ ] **Step 1: 写目标弹层和菜单失败测试**

```ts
it('normalizes and submits a quarter goal', async () => {
  const wrapper = await mountSuspended(QuarterGoalEditorDialog, {
    props: { open: true, goal: null, defaultQuarter: '2026-Q3' },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.get('[name="title"]').setValue('  完成季度复盘  ')
  await wrapper.get('[name="description"]').setValue('形成模板')
  await wrapper.get('[name="progress"]').setValue('68')
  await wrapper.get('form').trigger('submit')

  expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
    quarter: '2026-Q3',
    title: '完成季度复盘',
    description: '形成模板',
    progress: 68,
    status: 'active',
  })
})

it('rejects progress outside zero to one hundred', async () => {
  const wrapper = await mountSuspended(QuarterGoalEditorDialog, {
    props: { open: true, goal: null, defaultQuarter: '2026-Q3' },
    global: { stubs: { Teleport: true } },
  })
  await wrapper.get('[name="title"]').setValue('目标')
  await wrapper.get('[name="progress"]').setValue('101')
  await wrapper.get('form').trigger('submit')
  expect(wrapper.emitted('save')).toBeUndefined()
  expect(wrapper.get('[role="alert"]').text()).toContain('0 到 100')
})

it('offers edit, state changes, ordering, and delete from the goal menu', async () => {
  const wrapper = await mountSuspended(QuarterGoalActionsMenu, {
    props: { goal: createDemoWorkspace().quarterGoals[0], first: false, last: false },
  })
  expect(wrapper.find('[data-action="edit"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="complete"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="pause"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="move-up"]').exists()).toBe(true)
  expect(wrapper.find('[data-action="delete"]').exists()).toBe(true)
})
```

- [ ] **Step 2: 运行弹层测试并确认组件缺失失败**

Run:

```powershell
pnpm vitest run tests/unit/workspace-dialogs.spec.ts
```

Expected: FAIL，缺少季度目标组件。

- [ ] **Step 3: 扩展 UI 状态**

`DeleteRequest` 增加 `quarter-goal`：

```ts
type DeleteRequest =
  | { kind: 'project' | 'task' | 'quarter-goal', id: string }
  | null
```

增加 `quarterGoalEditor` 状态与：

```ts
openNewQuarterGoal(defaultQuarter: QuarterKey)
openEditQuarterGoal(goalId: string)
askDeleteQuarterGoal(id: string)
closeQuarterGoalEditor()
```

新建状态同时保存 `defaultQuarter`，保证 `/quarter` 当前选中的季度传入弹窗。

- [ ] **Step 4: 实现目标表单和菜单**

目标表单字段固定为季度、标题、说明、进度和状态。进度使用 `type="number" min="0" max="100" step="1"`，Zod 转为数字后校验整数。保存中由父级 `workspace.saving` 禁用按钮，表单只负责发出规范化输入。

菜单 emits：

```ts
edit: []
complete: []
activate: []
pause: []
'move-up': []
'move-down': []
delete: []
```

根据当前状态隐藏无意义的同状态动作；排序边界按钮 disabled。

- [ ] **Step 5: 接入统一弹层与删除确认**

`WorkspaceOverlays.vue` 根据目标 ID 解析 `selectedQuarterGoal`；保存时调用 create/update，删除时调用 `deleteQuarterGoal`。`DeleteConfirmDialog` 的 kind 类型加入 `quarter-goal`，文案为“季度目标会移入回收数据，可由未来恢复功能处理”，不声称物理删除。

- [ ] **Step 6: 运行弹层测试和类型检查**

Run:

```powershell
pnpm vitest run tests/unit/workspace-dialogs.spec.ts
pnpm typecheck
```

Expected: 弹层测试 PASS，类型检查退出码 0。

- [ ] **Step 7: 本地检查点**

记录四个 UI 文件和测试通过；不运行 Git 提交。

## Task 7: 建立共享仪表盘组件并实现收集箱

**Files:**
- Create: `app/components/dashboard/DashboardTopbar.vue`
- Create: `app/components/dashboard/MetricCard.vue`
- Create: `app/components/dashboard/EmptyDashboardState.vue`
- Create: `app/pages/inbox.vue`
- Modify: `app/composables/useWorkspaceUi.ts`
- Modify: `app/components/workspace/TaskEditorDialog.vue`
- Modify: `tests/unit/workspace-dialogs.spec.ts`
- Create: `tests/unit/secondary-dashboard-pages.spec.ts`
- Modify: `app/assets/css/main.css`

- [ ] **Step 1: 写收集箱页面失败测试**

测试注入真实本地模型，并固定系统时间或使用页面导出的日期计算输入：

```ts
it('renders inbox metrics, filters tasks, and opens task CRUD', async () => {
  const seed = createDemoWorkspace()
  const inbox = seed.projects.find(project => project.name === '收集箱')!
  seed.tasks.find(task => task.title.includes('MiniMax'))!.projectId = inbox.id
  localStorage.setItem('personal-ai-workspace:v1', JSON.stringify(seed))
  const wrapper = await mountSuspended(InboxPage)
  await vi.waitFor(() => expect(wrapper.find('[data-inbox-dashboard]').exists()).toBe(true))

  expect(wrapper.get('[data-metric="unorganized"]').text()).toContain('待整理')
  expect(wrapper.get('[data-metric="no-project"]').text()).toContain('无项目')
  expect(wrapper.findAll('[data-inbox-task]').length).toBeGreaterThan(0)

  await wrapper.get('[data-filter="search"]').setValue('MiniMax')
  expect(wrapper.findAll('[data-inbox-task]')).toHaveLength(1)

  await wrapper.get('[data-new-inbox-task]').trigger('click')
  expect(useWorkspaceUi().taskEditor.value.open).toBe(true)
})
```

再测试状态与优先级筛选不会改变持久数据，并断言“整理建议”文本来自规则：

```ts
expect(wrapper.get('[data-organize-suggestion]').text())
  .toMatch(/补充项目|设置优先级|补充到期时间/)
```

- [ ] **Step 2: 运行页面测试并确认路由组件缺失失败**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts
```

Expected: FAIL，提示 `app/pages/inbox.vue` 不存在。

- [ ] **Step 3: 实现三个共享展示组件**

- `DashboardTopbar` props：`section`、`title`、`actionLabel`、`actionIcon`；emit `action`；显示 `workspace.backendLabel` 的 mode badge。
- `MetricCard` props：`label`、`value: string | number`、`hint`、`tone: 'violet' | 'teal' | 'orange' | 'neutral'`、`icon`；根节点带透传的 `data-metric`。
- `EmptyDashboardState` props：`icon`、`title`、`description`、`actionLabel`；emit `action`。

- [ ] **Step 4: 实现收集箱派生和完整任务操作**

`/inbox` 数据范围定义为：

- `inboxProject` 是名称为“收集箱”的有效项目。
- 收集箱任务为 `projectId === inboxProject.id` 或 `projectId === null` 的有效任务。
- “待整理”为未完成的收集箱任务数量。
- “今日新增”为 `createdAt` 在当前本地日历日内的收集箱任务数量。
- “无项目”为 `projectId === null` 的有效任务数量。

筛选状态使用 `'all' | 'active' | 'completed'`，优先级使用 `'all' | 'none' | 'low' | 'medium' | 'high'`，搜索对标题和说明做不区分大小写包含匹配。

表格每行复用：

- `workspace.setTaskCompleted`
- `ui.openEditTask`
- `workspace.updateTask` 进行项目整理
- `TaskActionsMenu`
- `ui.askDeleteTask`

新建按钮先调用 `ui.openNewTask()`；同时扩展 UI 状态和 `TaskEditorDialog` 支持可选 `defaultProjectId`，使从 `/inbox` 新建时默认选择收集箱，但用户仍可改为其他项目。

整理建议纯规则：

- 无项目 → “补充项目归属”
- `priority === null` → “设置优先级”
- `dueDate === null` → “补充到期时间”
- 全部具备 → “信息完整，可安排执行”

- [ ] **Step 5: 添加方案 B 样式**

在 `main.css` 增加统一类：

```text
.dashboard-page
.dashboard-topbar
.dashboard-content
.dashboard-heading
.dashboard-metric-grid
.dashboard-metric-card
.dashboard-panel
.dashboard-toolbar
.filter-control
.inbox-table
.inbox-task-row
.organize-suggestion
```

桌面指标三列，浅色画布、白色卡片、11–12px 圆角、细边框和轻阴影；violet/teal/orange 只用于指标、状态和进度，不使用全屏渐变或玻璃模糊。

- [ ] **Step 6: 运行收集箱测试和类型检查**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts tests/unit/workspace-dialogs.spec.ts
pnpm typecheck
```

Expected: 收集箱和弹层测试 PASS，类型检查退出码 0。

- [ ] **Step 7: 本地检查点**

记录共享组件、收集箱和样式通过；不运行 Git 提交。

## Task 8: 实现季度追踪仪表盘和目标交互

**Files:**
- Create: `app/pages/quarter.vue`
- Modify: `tests/unit/secondary-dashboard-pages.spec.ts`
- Modify: `app/assets/css/main.css`

- [ ] **Step 1: 写季度页面失败测试**

```ts
it('renders 2026-Q3 metrics and supports goal actions', async () => {
  const wrapper = await mountSuspended(QuarterPage)
  await vi.waitFor(() => expect(wrapper.find('[data-quarter-dashboard]').exists()).toBe(true))

  expect(wrapper.get('[data-quarter-select]').element.value).toBe('2026-Q3')
  expect(wrapper.get('[data-metric="quarter-progress"]').text()).toContain('68%')
  expect(wrapper.findAll('[data-quarter-goal]')).toHaveLength(3)

  await wrapper.get('[data-quarter-goal]').find('[data-goal-menu-toggle]').trigger('click')
  expect(wrapper.find('[data-action="edit"]').exists()).toBe(true)
})
```

增加一个真实模型测试：点击完成状态后 `workspace.quarterGoals` 更新；软删除后卡片从有效视图消失；排序失败时顺序回滚。空目标文档时断言 CTA 调用 `openNewQuarterGoal('2026-Q3')`。

- [ ] **Step 2: 运行测试并确认页面缺失失败**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts
```

Expected: FAIL，缺少 `/quarter` 页面。

- [ ] **Step 3: 实现季度选择和指标**

可选季度集合为有效目标中出现的季度，再确保包含 `'2026-Q3'`，按字符串升序。默认选中 `'2026-Q3'`；若 URL 带合法 `?quarter=YYYY-Qn` 则使用查询值。指标由：

```ts
const quarterMetrics = computed(() =>
  deriveQuarterMetrics(workspace.document.value, selectedQuarter.value, now.value),
)
```

页面挂载时设置一次 `now = new Date()`，不要使用持续计时器。

- [ ] **Step 4: 实现目标卡片和完整 CRUD**

每个卡片包含：

- 标题、说明、状态标签、更新时间。
- 数字进度和 `<div role="progressbar">`，设置 `aria-valuenow/min/max`。
- 风险目标使用橙色边线和“落后季度节奏”提示。
- 菜单编辑、active/completed/paused 切换、上移、下移、软删除。

状态变化调用 `workspace.updateQuarterGoal(id, { status })`；进度的 `-10`/`+10` 快捷按钮把数值夹到 0–100；编辑弹窗允许精确输入。排序只提交当前季度完整有效 ID 集合：

```ts
async function moveGoal(id: string, direction: -1 | 1) {
  const ids = goals.value.map(goal => goal.id)
  const index = ids.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return
  ;[ids[index], ids[target]] = [ids[target]!, ids[index]!]
  await workspace.reorderQuarterGoals(selectedQuarter.value, ids)
}
```

- [ ] **Step 5: 添加季度卡片响应式样式**

桌面卡片网格 `repeat(2, minmax(0, 1fr))`，目标进度使用 teal，风险使用 orange，状态 paused 使用 neutral。窄屏改单列，菜单不能被卡片 `overflow` 裁切。

- [ ] **Step 6: 运行季度页面、模型和弹层测试**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts tests/unit/workspace-model.spec.ts tests/unit/workspace-dialogs.spec.ts
pnpm typecheck
```

Expected: 所有定向测试 PASS，类型检查退出码 0。

- [ ] **Step 7: 本地检查点**

记录季度页面行为、样式和回归结果；不运行 Git 提交。

## Task 9: 实现实时派生的年终总结

**Files:**
- Create: `app/pages/review.vue`
- Modify: `tests/unit/secondary-dashboard-pages.spec.ts`
- Modify: `app/assets/css/main.css`

- [ ] **Step 1: 写年终页面失败测试**

```ts
it('renders annual metrics, four-quarter trend, distribution, and milestones', async () => {
  const wrapper = await mountSuspended(ReviewPage)
  await vi.waitFor(() => expect(wrapper.find('[data-review-dashboard]').exists()).toBe(true))

  expect(wrapper.get('[data-year-select]').element.value).toBe('2026')
  expect(wrapper.get('[data-metric="completed-tasks"]').text()).toContain('2')
  expect(wrapper.findAll('[data-quarter-trend-point]')).toHaveLength(4)
  expect(wrapper.findAll('[data-project-distribution]').length).toBeGreaterThan(0)
  expect(wrapper.find('[data-milestone-timeline]').exists()).toBe(true)
})

it('updates the annual summary after workspace data changes', async () => {
  const wrapper = await mountSuspended(ReviewPage)
  const workspace = useWorkspace()
  const task = workspace.tasks.value.find(item => item.dueDate?.startsWith('2026'))!
  await workspace.setTaskCompleted(task.id, true)
  await nextTick()
  expect(wrapper.get('[data-metric="completed-tasks"]').text()).toContain('3')
})
```

空任务或空目标时分别断言页面显示“创建任务”和“创建季度目标”，且对应按钮调用现有 UI 命令。

- [ ] **Step 2: 运行测试并确认页面缺失失败**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts
```

Expected: FAIL，缺少 `/review` 页面。

- [ ] **Step 3: 实现年份选择和实时派生**

年份集合来自有效任务的 due/created 年份和有效目标的 quarter 年份，并确保包含 2026。默认 2026；合法 `?year=YYYY` 可覆盖。使用：

```ts
const review = computed(() =>
  deriveAnnualReview(workspace.document.value, selectedYear.value),
)
```

页面不创建任何 review 写入方法，也不把总结写入 localStorage。

- [ ] **Step 4: 使用原生 SVG/CSS 绘制三类可视化**

- 季度趋势：`svg viewBox="0 0 400 160"`；把四个点映射为 x=`40 + index * 106`，y=`130 - progress * 1.05`，绘制一条 polyline、四个 circle 和文本标签；每点带 `data-quarter-trend-point`。
- 项目分布：用水平 CSS bar，宽度为 `completionRate%`，显示完成数/总数；每项带 `data-project-distribution`。
- 里程碑：按日期降序的时间线，任务和目标用不同图标；容器带 `data-milestone-timeline`。

所有图形同时提供可读文本，不只依赖颜色。

- [ ] **Step 5: 添加总结页样式和空状态**

桌面主区为趋势图 2/3 宽、项目分布 1/3 宽，时间线另起一行；窄屏全部单列。四个大指标使用现有四卡网格。无目标时趋势图仍显示四个 0 点并给出创建目标 CTA；无任务时分布区域显示创建任务 CTA。

- [ ] **Step 6: 运行总结页和领域测试**

Run:

```powershell
pnpm vitest run tests/unit/secondary-dashboard-pages.spec.ts tests/unit/workspace-domain.spec.ts
pnpm typecheck
```

Expected: 页面与领域测试 PASS，类型检查退出码 0。

- [ ] **Step 7: 本地检查点**

记录总结页和实时联动测试通过；不运行 Git 提交。

## Task 10: 完成导航高亮、真实侧栏指标和手机端底部导航

**Files:**
- Modify: `app/components/app/ProjectSidebar.vue`
- Modify: `app/components/app/AppRail.vue`
- Modify: `app/assets/css/main.css`
- Modify: `tests/unit/app-shell.spec.ts`

- [ ] **Step 1: 写导航失败测试**

在外壳测试中断言侧栏和 rail 具有真实链接：

```ts
expect(wrapper.find('a[href="/inbox"]').exists()).toBe(true)
expect(wrapper.find('a[href="/quarter"]').exists()).toBe(true)
expect(wrapper.find('a[href="/review"]').exists()).toBe(true)
```

为 `ProjectSidebar` 增加定向挂载断言：

```ts
expect(wrapper.get('[data-quarter-progress]').text()).toContain('68%')
expect(wrapper.find('.sidebar-link.router-link-active').exists()).toBe(true)
```

- [ ] **Step 2: 运行外壳测试并确认预期失败**

Run:

```powershell
pnpm vitest run tests/unit/app-shell.spec.ts
```

Expected: FAIL，因为 AppRail 当前为按钮，季度进度仍是硬编码且 Today 使用固定 `active` class。

- [ ] **Step 3: 实现真实导航和侧栏进度**

`ProjectSidebar`：

- 移除 Today 固定 `active` class，依赖 Nuxt `router-link-active` / 精确匹配。
- 从 `deriveQuarterMetrics(workspace.document.value, '2026-Q3', new Date())` 读取平均进度，显示在 `data-quarter-progress`。
- 保留项目 CRUD 和计数。

`AppRail` 把主要工具配置改为：

```ts
const tools = [
  { label: 'Today', icon: 'i-lucide-sun', to: '/' },
  { label: '收集箱', icon: 'i-lucide-inbox', to: '/inbox' },
  { label: '季度', icon: 'i-lucide-chart-no-axes-combined', to: '/quarter' },
  { label: '总结', icon: 'i-lucide-panels-top-left', to: '/review' },
]
```

使用 `<NuxtLink>`，由当前路由决定 active；搜索和头像仍为按钮。

- [ ] **Step 4: 完成响应式规则**

`max-width: 760px`：

- 隐藏项目侧栏和 AI 面板。
- rail 固定为 64px 底部导航，四个链接等宽。
- 仪表盘内容底部留出至少 80px。
- 指标卡两列；季度目标、趋势/分布、筛选工具栏改为单列。
- 任务表隐藏次要说明但保留完成按钮和操作菜单。
- 弹出菜单定位在安全视口内，不被底部 rail 遮挡。

- [ ] **Step 5: 运行外壳和页面回归**

Run:

```powershell
pnpm vitest run tests/unit/app-shell.spec.ts tests/unit/secondary-dashboard-pages.spec.ts
pnpm typecheck
```

Expected: 导航、页面和类型检查全部 PASS，不再有未匹配路由。

- [ ] **Step 6: 本地检查点**

记录导航和响应式测试结果；不运行 Git 提交。

## Task 11: 全量验证和真实 Edge 视觉验收

**Files:**
- Create: `tests/e2e/secondary-dashboards.spec.ts`
- Verify: all implementation files
- Create by test runner: `output/playwright/inbox-desktop.png`
- Create by test runner: `output/playwright/quarter-desktop.png`
- Create by test runner: `output/playwright/review-desktop.png`
- Create by test runner: `output/playwright/quarter-mobile.png`

- [ ] **Step 1: 编写端到端烟测**

测试在每个 case 前清空 `personal-ai-workspace:v1`，并覆盖：

```ts
test('inbox task CRUD persists after reload', async ({ page }) => {
  await page.goto('/inbox')
  await page.getByRole('button', { name: '添加任务' }).click()
  await page.getByLabel('任务标题').fill('收集箱验收任务')
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByText('收集箱验收任务')).toBeVisible()
  await page.reload()
  await expect(page.getByText('收集箱验收任务')).toBeVisible()
})

test('quarter goal create update and soft delete changes the review', async ({ page }) => {
  await page.goto('/quarter')
  await page.getByRole('button', { name: '创建季度目标' }).click()
  await page.getByLabel('目标标题').fill('季度验收目标')
  await page.getByLabel('进度').fill('80')
  await page.getByRole('button', { name: '创建目标' }).click()
  await expect(page.getByText('季度验收目标')).toBeVisible()

  await page.goto('/review')
  await expect(page.locator('[data-metric="goal-progress"]')).not.toContainText('68%')
})
```

再用菜单删除该目标，回到 `/quarter` 后确认不可见，读取 localStorage JSON 确认同 ID 仍存在且 `deletedAt` 非空。

- [ ] **Step 2: 运行桌面 E2E 并记录接线结果**

Run:

```powershell
pnpm exec playwright test tests/e2e/secondary-dashboards.spec.ts --project=desktop
```

Expected: 若前序单元测试没有覆盖到可访问名称、路由或保存后刷新，测试应在对应真实行为上失败；若直接 PASS，记录为前序实现已满足端到端契约，不制造人为失败。

- [ ] **Step 3: 修复仅由 E2E 暴露的最小问题**

只修复测试暴露的真实接线、可访问名称、保存后刷新或布局问题。不得扩大功能范围，不引入新依赖。

- [ ] **Step 4: 运行完整单元测试**

Run:

```powershell
pnpm test
```

Expected: 所有测试文件 PASS，零失败、零未处理异常。

- [ ] **Step 5: 运行类型检查和生产构建**

Run:

```powershell
pnpm typecheck
pnpm build
```

Expected: 两条命令退出码均为 0。

- [ ] **Step 6: 运行桌面和手机端 E2E**

Run:

```powershell
pnpm exec playwright test tests/e2e/secondary-dashboards.spec.ts
```

Expected: desktop 和 mobile 项目全部 PASS。测试只能访问 `127.0.0.1` 本地开发服务器，不调用外部服务。

- [ ] **Step 7: 在真实 Edge 中视觉验收并保存截图**

用 1600×1000 视口依次打开 `/inbox`、`/quarter`、`/review`，用 390×844 打开 `/quarter`。截图保存到上述 `output/playwright` 路径，并检查：

```text
[ ] 第一版 Huly 外壳未改变
[ ] 指标数字与当前数据一致
[ ] 收集箱筛选和行菜单可操作
[ ] 季度卡片、进度、状态和风险提示可读
[ ] 年度 SVG/CSS 图表有文本标签
[ ] 1600px 下无横向滚动
[ ] 390px 下侧栏和 AI 面板隐藏
[ ] 390px 下底部导航不遮挡主要操作
[ ] 弹层和菜单都在视口内
```

- [ ] **Step 8: 最终范围检查**

Run:

```powershell
rg -n "TODO|TBD|FIXME|placeholder|待实现|稍后实现" app shared server supabase tests
rg --files app/pages app/components/dashboard server/api/quarter-goals supabase/migrations tests/e2e
```

Expected: 第一条没有本阶段新增的未完成占位；第二条列出三个页面、共享组件、四个路由、增量迁移和 E2E。

- [ ] **Step 9: 最终本地检查点**

汇总实际测试数、类型检查、构建、E2E 和截图路径；明确“未连接真实 Supabase、未执行 SQL”。当前无 Git 元数据，不创建提交。

## 完成定义

- `/inbox`、`/quarter`、`/review` 均为可直接访问的真实路由。
- 收集箱任务创建、编辑、完成、移动、排序和软删除复用现有完整 CRUD。
- 季度目标在本地模式具备创建、读取、更新、状态、进度、排序和软删除。
- v1 本地数据自动升级为 v2，原项目和任务保持不变。
- API 网关、Nuxt 路由、Supabase 仓库和 SQL 契约与本地目标能力一致。
- 年终总结完全实时派生，不持久化 summary 记录。
- 侧栏季度百分比来自真实目标数据，不再硬编码。
- 桌面和 390px 手机视口均无阻断操作的遮挡或溢出。
- 全量单元测试、类型检查、生产构建和本地 E2E 全部通过。
- 不访问真实 Supabase，不执行迁移，不安装依赖，不修改 Git 元数据。
