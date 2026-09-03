# Project Milestones and Workspace V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a version-3 local-first workspace with real project milestones, extended project tracking, task-to-milestone linking, complete CRUD, soft deletion, recovery, and usable project/Today views.

**Architecture:** Keep the existing `WorkspaceGateway` boundary and single-document desktop SQLite persistence. Migrate v1/v2 documents to v3 in the shared schema, implement all relationship rules in the local gateway so desktop persistence reuses them, and mirror the contract in Nuxt API/Supabase without connecting to production. Compute project and automatic milestone progress from live records rather than storing duplicate truth.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript 5.9, Zod, Vitest, Tauri 2, Rust, rusqlite, Supabase SQL.

---

## Repository constraint

This checkout currently has no `.git` metadata, and project safety rules prohibit creating or modifying `.git`. Do not run `git init` or fabricate commits. Each task ends with a verified checkpoint: targeted tests must pass and the exact changed-file list must be recorded before continuing. If the plan is later executed in an existing Git worktree, use one commit per task with the suggested task title.

## File structure map

**Shared domain**

- Modify `shared/workspace.ts`: v3 schemas, migrations, domain types, relationship-aware derivation.
- Create `shared/project-progress.ts`: milestone/project progress and upcoming-milestone calculations.
- Modify `shared/workspace-analytics.ts`: consume v3 document without treating quarter goals as project milestones.

**Persistence and application state**

- Modify `app/data/workspace-gateway.ts`: milestone CRUD and extended project/task inputs.
- Modify `app/data/local-workspace-gateway.ts`: relationship enforcement, CRUD, soft-delete/restore semantics.
- Modify `app/data/desktop-workspace-gateway.ts`: delegate new contract through the serialized SQLite write queue.
- Modify `app/data/api-workspace-gateway.ts`: call new milestone API routes.
- Modify `app/models/workspace-model.ts`: expose milestone state/actions and 8-second undo lifecycle.
- Modify `app/data/demo-workspace.ts`: valid v3 demonstration document with no fake/test milestones.

**Nuxt API and Supabase compatibility**

- Modify `server/utils/workspace-api.ts`: request schemas.
- Modify `server/utils/supabase-workspace-repository.ts`: v3 mapping and milestone methods.
- Create `server/api/milestones/index.post.ts`.
- Create `server/api/milestones/[id].patch.ts`.
- Create `server/api/milestones/[id].delete.ts`.
- Create `server/api/milestones/[id]/restore.post.ts`.
- Create `server/api/milestones/reorder.post.ts`.
- Create `supabase/migrations/202608130001_project_milestones.sql`: additive tables/columns plus replacement clear/empty functions; keep prior migration history immutable and do not execute SQL against any database.

**UI**

- Modify `app/composables/useWorkspaceUi.ts`: milestone editor/delete state.
- Modify `app/components/workspace/WorkspaceOverlays.vue`: wire milestone dialogs and delete counts.
- Modify `app/components/workspace/ProjectEditorDialog.vue`: extended project fields.
- Modify `app/components/workspace/TaskEditorDialog.vue`: milestone selection constrained by project.
- Create `app/components/workspace/MilestoneEditorDialog.vue`.
- Create `app/components/workspace/MilestoneActionsMenu.vue`.
- Create `app/components/projects/ProjectProgressPanel.vue`.
- Create `app/components/projects/MilestoneRow.vue`.
- Modify `app/pages/index.vue`: render selected-project progress panel and milestone-filtered tasks.
- Create `app/components/dashboard/UpcomingMilestones.vue`.
- Modify `app/pages/index.vue`: render due/overdue reminders when no project is selected.
- Modify `app/pages/trash.vue`: milestone recovery and counts.
- Modify `app/assets/css/main.css`: Huly-style tracking area and minimum readable type sizes.

**Desktop document validation**

- Modify `src-tauri/src/workspace_store.rs`: validate v3 milestone array and use v3 fixture.

## Task 1: Upgrade the shared workspace document to v3

**Files:**
- Modify: `shared/workspace.ts`
- Modify: `tests/unit/workspace-domain.spec.ts`

- [ ] **Step 1: Write failing migration and schema tests**

Add tests that parse a v3 document, migrate the current v2 shape, and preserve v1 records:

```ts
it('migrates v2 to v3 without inventing milestones', () => {
  const migrated = migrateWorkspaceDocument({
    version: 2,
    projects: [legacyProject],
    tasks: [legacyTask],
    quarterGoals: [legacyQuarterGoal],
  })
  expect(migrated).toMatchObject({ version: 3, milestones: [] })
  expect(migrated.projects[0]).toMatchObject({
    description: '', priority: null, status: 'active', targetDate: null,
  })
  expect(migrated.tasks[0]?.milestoneId).toBeNull()
  expect(migrated.quarterGoals).toHaveLength(1)
})

it('rejects an invalid milestone progress value', () => {
  expect(() => workspaceDocumentSchema.parse({
    ...emptyV3,
    milestones: [{ ...milestone, progress: 101 }],
  })).toThrow()
})
```

- [ ] **Step 2: Run the tests and verify red state**

Run: `pnpm test -- tests/unit/workspace-domain.spec.ts`

Expected: FAIL because v3, `milestones`, new project fields, and `milestoneId` do not exist.

- [ ] **Step 3: Add the v3 schemas and types**

Define and export these exact schemas/types in `shared/workspace.ts`:

```ts
export const projectStatusSchema = z.enum(['planned', 'active', 'paused', 'completed'])
export const milestoneStatusSchema = z.enum(['planned', 'in_progress', 'blocked', 'completed'])
export const milestoneProgressModeSchema = z.enum(['auto', 'manual'])

export const milestoneSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(4000),
  targetDate: z.iso.date().nullable(),
  status: milestoneStatusSchema,
  progressMode: milestoneProgressModeSchema,
  progress: z.number().int().min(0).max(100),
  sortOrder: z.number().int().nonnegative(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  deletedAt: nullableTimestamp,
})
```

Extend `projectSchema` with `description`, `priority`, `status`, `targetDate`; extend `taskSchema` with `milestoneId`; define `workspaceDocumentV2Schema`; change the current schema to literal version 3 and add `milestones`.

- [ ] **Step 4: Implement explicit v1/v2 migration**

Use a single canonical migration path:

```ts
function upgradeProject(project: z.infer<typeof projectV2Schema>): Project {
  return { ...project, description: '', priority: null, status: 'active', targetDate: null }
}

function upgradeTask(task: z.infer<typeof taskV2Schema>): Task {
  return { ...task, milestoneId: null }
}

export function migrateWorkspaceDocument(input: unknown): WorkspaceDocument {
  const current = workspaceDocumentSchema.safeParse(input)
  if (current.success) return current.data
  const v2 = workspaceDocumentV2Schema.safeParse(input)
  if (v2.success) return workspaceDocumentSchema.parse({
    version: 3,
    projects: v2.data.projects.map(upgradeProject),
    milestones: [],
    tasks: v2.data.tasks.map(upgradeTask),
    quarterGoals: v2.data.quarterGoals,
  })
  const v1 = workspaceDocumentV1Schema.parse(input)
  return workspaceDocumentSchema.parse({
    version: 3,
    projects: v1.projects.map(upgradeProject),
    milestones: [],
    tasks: v1.tasks.map(upgradeTask),
    quarterGoals: [],
  })
}
```

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/workspace-domain.spec.ts`

Expected: PASS. Record changes to `shared/workspace.ts` and `tests/unit/workspace-domain.spec.ts`.

## Task 2: Add progress and upcoming-milestone derivation

**Files:**
- Create: `shared/project-progress.ts`
- Modify: `shared/workspace.ts`
- Modify: `shared/workspace-analytics.ts`
- Create: `tests/unit/project-progress.spec.ts`

- [ ] **Step 1: Write failing calculation tests**

```ts
it('uses completed linked tasks for automatic milestone progress', () => {
  expect(deriveMilestoneProgress(autoMilestone, [doneTask, openTask])).toBe(50)
})

it('uses milestone average before task completion for project progress', () => {
  expect(deriveProjectProgress(project, [manual20, manual80], [doneTask])).toBe(50)
})

it('marks overdue and upcoming milestones', () => {
  expect(deriveUpcomingMilestones(document, new Date('2026-08-13T08:00:00+08:00'), 7))
    .toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'overdue-id', timing: 'overdue' }),
      expect.objectContaining({ id: 'soon-id', timing: 'upcoming' }),
    ]))
})
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/project-progress.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement pure calculations**

Export exactly:

```ts
export function deriveMilestoneProgress(milestone: Milestone, tasks: Task[]): number
export function deriveProjectProgress(project: Project, milestones: Milestone[], tasks: Task[]): number
export function deriveUpcomingMilestones(
  document: WorkspaceDocument,
  now: Date,
  upcomingDays = 7,
): Array<{ milestone: Milestone, project: Project, timing: 'overdue' | 'upcoming', days: number }>
```

Filter out soft-deleted records, return 100 for completed records, use manual progress in manual mode, and round calculated ratios with `Math.round`.

- [ ] **Step 4: Export derivations from the shared entry point**

Add `export * from './project-progress'` to `shared/workspace.ts`. Update annual analytics so `milestoneCount` continues to mean its existing review timeline metric; do not silently substitute project milestones for quarter goals in historical summaries.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/project-progress.spec.ts tests/unit/workspace-analytics.spec.ts`

Expected: PASS.

## Task 3: Implement local milestone CRUD and relationship invariants

**Files:**
- Modify: `app/data/workspace-gateway.ts`
- Modify: `app/data/local-workspace-gateway.ts`
- Create: `tests/unit/local-milestones.spec.ts`
- Create: `tests/unit/task-milestone-linking.spec.ts`

- [ ] **Step 1: Write failing contract tests**

Cover create/update/delete/restore/reorder, project cascade timestamps, and task linking:

```ts
it('links a task to the milestone project', async () => {
  const task = await gateway.createTask({ ...taskInput, projectId: null, milestoneId: milestone.id })
  expect(task).toMatchObject({ projectId: project.id, milestoneId: milestone.id })
})

it('deleting a milestone keeps tasks and clears their milestone id', async () => {
  await gateway.deleteMilestone(milestone.id)
  const saved = await gateway.loadWorkspace({ includeDeleted: true })
  expect(saved.tasks.find(item => item.id === task.id)).toMatchObject({ deletedAt: null, milestoneId: null })
})

it('restores only children deleted in the same project cascade', async () => {
  await gateway.deleteTask(independentlyDeletedTask.id)
  await gateway.deleteProject(project.id)
  await gateway.restoreProject(project.id)
  const saved = await gateway.loadWorkspace({ includeDeleted: true })
  expect(saved.tasks.find(item => item.id === independentlyDeletedTask.id)?.deletedAt).not.toBeNull()
  expect(saved.milestones.find(item => item.id === milestone.id)?.deletedAt).toBeNull()
})
```

- [ ] **Step 2: Verify the new tests fail**

Run: `pnpm test -- tests/unit/local-milestones.spec.ts tests/unit/task-milestone-linking.spec.ts`

Expected: FAIL because milestone methods and fields are absent.

- [ ] **Step 3: Extend the gateway contract**

Add these exact inputs and methods:

```ts
export type CreateMilestoneInput = Pick<Milestone,
  'projectId' | 'title' | 'description' | 'targetDate' | 'status' | 'progressMode' | 'progress'
>
export type UpdateMilestoneInput = Partial<CreateMilestoneInput>

createMilestone(input: CreateMilestoneInput): Promise<Milestone>
updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone>
deleteMilestone(id: string): Promise<void>
restoreMilestone(id: string): Promise<Milestone>
reorderMilestones(projectId: string, orderedIds: string[]): Promise<void>
```

Include `milestoneId` in `CreateTaskInput`, and replace project inputs with fields `name`, `color`, `description`, `priority`, `status`, `targetDate`.

- [ ] **Step 4: Implement local CRUD and invariants**

Add `ensureActiveMilestone` that returns the milestone and verifies its project. In `createTask`/`updateTask`, normalize relationships using:

```ts
if (nextMilestoneId) {
  const milestone = this.ensureActiveMilestone(draft, nextMilestoneId)
  task.milestoneId = milestone.id
  task.projectId = milestone.projectId
} else if (projectChanged && task.milestoneId) {
  const linked = draft.milestones.find(item => item.id === task.milestoneId && item.deletedAt === null)
  if (!linked || linked.projectId !== task.projectId) task.milestoneId = null
}
```

Implement the exact delete/restore rules from the approved spec, using one timestamp for a project cascade and comparing that timestamp during restoration.

- [ ] **Step 5: Include milestones in load, trash emptying, and workspace clearing**

Every returned/persisted document must be version 3. `emptyTrash` filters `draft.milestones`; `clearWorkspaceData` writes `{ version: 3, projects: [], milestones: [], tasks: [], quarterGoals: [] }`.

- [ ] **Step 6: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/local-milestones.spec.ts tests/unit/task-milestone-linking.spec.ts tests/unit/local-workspace-gateway.spec.ts`

Expected: PASS.

## Task 4: Expose milestone state through desktop, API, and WorkspaceModel

**Files:**
- Modify: `app/data/desktop-workspace-gateway.ts`
- Modify: `app/data/api-workspace-gateway.ts`
- Modify: `app/models/workspace-model.ts`
- Modify: `tests/unit/sqlite-workspace-gateway.spec.ts`
- Modify: `tests/unit/api-workspace-gateway.spec.ts`
- Create: `tests/unit/milestone-state.spec.ts`

- [ ] **Step 1: Write failing adapter and model tests**

```ts
expect(candidate.createMilestone).toBeTypeOf('function')
expect(candidate.updateMilestone).toBeTypeOf('function')
expect(candidate.deleteMilestone).toBeTypeOf('function')
expect(candidate.restoreMilestone).toBeTypeOf('function')
expect(candidate.reorderMilestones).toBeTypeOf('function')
```

Assert that desktop writes once for each mutation and rolls memory back when `saveDocument` rejects. Assert `lastDeleted.kind === 'milestone'` and that its timer clears after 8,000 ms.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/sqlite-workspace-gateway.spec.ts tests/unit/api-workspace-gateway.spec.ts tests/unit/milestone-state.spec.ts`

Expected: FAIL because adapters/model do not expose milestone methods.

- [ ] **Step 3: Delegate through both adapters**

Desktop methods must call `this.persist(() => this.local.<method>())`. API paths must be:

```text
POST   /api/milestones
PATCH  /api/milestones/:id
DELETE /api/milestones/:id
POST   /api/milestones/:id/restore
POST   /api/milestones/reorder
```

- [ ] **Step 4: Extend WorkspaceModel**

Add `milestones`, `trashedMilestones`, the five milestone actions, milestone count in `trashCount`, and `'milestone'` in undo kinds. Set `UNDO_DISMISS_MS = 8_000` as approved. Extend `applyOrder` to `Project | Milestone | QuarterGoal | Task`.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/sqlite-workspace-gateway.spec.ts tests/unit/api-workspace-gateway.spec.ts tests/unit/milestone-state.spec.ts tests/unit/workspace-model.spec.ts`

Expected: PASS.

## Task 5: Implement Nuxt server routes and Supabase repository mapping

**Files:**
- Modify: `server/utils/workspace-api.ts`
- Modify: `server/utils/supabase-workspace-repository.ts`
- Create: `server/api/milestones/index.post.ts`
- Create: `server/api/milestones/[id].patch.ts`
- Create: `server/api/milestones/[id].delete.ts`
- Create: `server/api/milestones/[id]/restore.post.ts`
- Create: `server/api/milestones/reorder.post.ts`
- Create: `tests/unit/server-milestones.spec.ts`
- Modify: `tests/unit/supabase-workspace-repository.spec.ts`

- [ ] **Step 1: Write failing API schema and repository tests**

Assert valid milestone input succeeds, an empty patch fails, invalid progress fails, and repository requests use `/rest/v1/milestones` plus the same owner filter as existing entities.

```ts
expect(createMilestoneInputSchema.safeParse({
  projectId: PROJECT_ID,
  title: '完成首页评审',
  description: '',
  targetDate: '2026-08-16',
  status: 'planned',
  progressMode: 'auto',
  progress: 0,
}).success).toBe(true)
expect(updateMilestoneInputSchema.safeParse({}).success).toBe(false)
```

- [ ] **Step 2: Verify red state**

Run: `pnpm test -- tests/unit/server-milestones.spec.ts tests/unit/supabase-workspace-repository.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Add schemas and route handlers**

Build input schemas by picking from `milestoneSchema`; require at least one property in the update schema. Each handler follows the existing project/quarter-goal handler pattern and calls the correspondingly named repository method.

- [ ] **Step 4: Map Supabase rows to v3 domain records**

Add row mappers for snake_case fields, add `milestones` to `loadWorkspace`, return `version: 3`, and include the new project/task fields. Preserve `owner_id = demoOwnerId` on every read and mutation.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/server-milestones.spec.ts tests/unit/supabase-workspace-repository.spec.ts tests/unit/workspace-api-contract.spec.ts`

Expected: PASS.

## Task 6: Add reviewed Supabase migration SQL

**Files:**
- Create: `supabase/migrations/202608130001_project_milestones.sql`
- Create: `tests/unit/project-milestones-sql.spec.ts`
- Modify: `tests/unit/supabase-sql.spec.ts`

- [ ] **Step 1: Write failing SQL contract tests**

Read the SQL as text and assert it contains:

```ts
expect(sql).toContain('create table if not exists public.milestones')
expect(sql).toContain('milestone_id uuid')
expect(sql).toContain('deleted_at')
expect(sql).toContain('soft_delete_milestone')
expect(sql).toContain('restore_milestone')
expect(sql).toContain('create or replace function public.clear_workspace_data')
expect(sql).toContain('create or replace function public.empty_workspace_trash')
expect(sql).toContain('delete from public.milestones')
expect(sql).toContain('deleted_at is not null')
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/project-milestones-sql.spec.ts tests/unit/supabase-sql.spec.ts`

Expected: FAIL because migration SQL is absent.

- [ ] **Step 3: Write the additive migration**

The SQL must:

- alter `projects` with description, priority, status, target_date and checks;
- create `milestones` with owner/project foreign keys, status/progress checks, ordering and timestamps;
- alter `tasks` with nullable `milestone_id` and a foreign key using `on delete set null`;
- add owner/project/deleted/order indexes;
- enable RLS and mirror the existing owner policy model;
- add milestone soft-delete and restore functions;
- replace clear/empty functions using owner-scoped deletes, with milestones deleted before projects.

Do not edit older migration files, contact Supabase, or run the migration.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/project-milestones-sql.spec.ts tests/unit/supabase-sql.spec.ts`

Expected: PASS.

## Task 7: Build milestone and extended project/task editors

**Files:**
- Modify: `app/composables/useWorkspaceUi.ts`
- Modify: `app/components/workspace/WorkspaceOverlays.vue`
- Modify: `app/components/workspace/ProjectEditorDialog.vue`
- Modify: `app/components/workspace/TaskEditorDialog.vue`
- Create: `app/components/workspace/MilestoneEditorDialog.vue`
- Create: `app/components/workspace/MilestoneActionsMenu.vue`
- Create: `tests/unit/milestone-dialogs.spec.ts`
- Modify: `tests/unit/workspace-dialogs.spec.ts`

- [ ] **Step 1: Write failing component tests**

Mount each editor and assert submitted payloads. For task editing, select a project then verify only that project's milestones are available. For milestone editing, verify `auto` mode disables the numeric progress input.

```ts
expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
  projectId: PROJECT_ID,
  title: '完成首页评审',
  description: '确认视觉与交互',
  targetDate: '2026-08-16',
  status: 'planned',
  progressMode: 'auto',
  progress: 0,
})
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/milestone-dialogs.spec.ts tests/unit/workspace-dialogs.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Add UI state and overlay wiring**

Add `milestoneEditor: { open, milestoneId, defaultProjectId }`, open/close methods, `'milestone'` delete requests, selected milestone computation, save dispatch, and cascade counts for project deletion.

- [ ] **Step 4: Build validated forms**

Use the shared enum values and Zod limits. `TaskEditorDialog` receives `milestones: Milestone[]`, filters on current `projectId`, clears `milestoneId` when the project changes, and emits both fields. `ProjectEditorDialog` emits all extended fields rather than only name/color.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/milestone-dialogs.spec.ts tests/unit/workspace-dialogs.spec.ts tests/unit/workspace-shell-ui-state.spec.ts`

Expected: PASS.

## Task 8: Render project progress and real milestones in the selected-project view

**Files:**
- Create: `app/components/projects/ProjectProgressPanel.vue`
- Create: `app/components/projects/MilestoneRow.vue`
- Modify: `app/pages/index.vue`
- Modify: `app/assets/css/main.css`
- Create: `tests/unit/project-progress-panel.spec.ts`

- [ ] **Step 1: Write failing project UI tests**

Assert that selecting `?project=<id>` renders overall progress, next milestone, overdue state, milestone rows, linked task counts, and buttons that open real editors.

```ts
expect(wrapper.get('[data-project-progress]').text()).toContain('50%')
expect(wrapper.get('[data-next-milestone]').text()).toContain('完成首页评审')
expect(wrapper.findAll('[data-milestone-row]')).toHaveLength(2)
await wrapper.get('[data-new-milestone]').trigger('click')
expect(ui.milestoneEditor.value).toMatchObject({ open: true, defaultProjectId: PROJECT_ID })
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/project-progress-panel.spec.ts`

Expected: FAIL because components do not exist.

- [ ] **Step 3: Implement the Huly-style tracking panel**

Use thin dividers, one compact progress header, a milestone list, and an adjacent linked-task count; avoid replacing the page with large dashboard cards. Show status, target date, calculated/manual progress, overdue badge, edit menu, and “新增里程碑”.

- [ ] **Step 4: Embed it in the existing query-based project view**

Render the panel below the selected project heading in `app/pages/index.vue`; keep the current task board and project filter behavior. Do not create a competing project route.

- [ ] **Step 5: Apply readability constraints**

In `app/assets/css/main.css`, ensure tracking-body text is at least 16px, metadata at least 13px, titles at least 20px, and interactive controls at least 40px high.

- [ ] **Step 6: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/project-progress-panel.spec.ts tests/unit/today-functional-interactions.spec.ts`

Expected: PASS.

## Task 9: Add upcoming and overdue milestone reminders to Today

**Files:**
- Create: `app/components/dashboard/UpcomingMilestones.vue`
- Modify: `app/pages/index.vue`
- Create: `tests/unit/upcoming-milestones.spec.ts`

- [ ] **Step 1: Write failing reminder tests**

Assert overdue sorts before upcoming, completed milestones are excluded, the panel is shown only in the unfiltered Today view, and clicking a row navigates to `/?project=<projectId>`.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/upcoming-milestones.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement the reminder strip**

Call `deriveUpcomingMilestones(document, now, 7)`, display at most five rows, label negative days as “逾期 N 天” and non-negative days as “N 天后”, and use project colors as compact markers.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/upcoming-milestones.spec.ts tests/unit/today-workspace.spec.ts`

Expected: PASS.

## Task 10: Integrate milestones with trash, reset, demo data, and Rust validation

**Files:**
- Modify: `app/pages/trash.vue`
- Modify: `app/data/demo-workspace.ts`
- Modify: `app/components/workspace/WorkspaceInfoDialog.vue`
- Modify: `app/components/workspace/ClearWorkspaceDataDialog.vue`
- Modify: `src-tauri/src/workspace_store.rs`
- Modify: `tests/unit/trash-page.spec.ts`
- Modify: `tests/unit/clear-workspace-data-dialog.spec.ts`
- Modify: `tests/unit/sqlite-workspace-gateway.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Assert trash renders/restores milestones, reset counts them, demo data parses as v3 without titles containing `test`, and Rust validation rejects a v3 document without `milestones`.

- [ ] **Step 2: Verify frontend tests fail**

Run: `pnpm test -- tests/unit/trash-page.spec.ts tests/unit/clear-workspace-data-dialog.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Update trash/reset and demo document**

Add milestone sections and counts. The reset confirmation phrase remains exactly `清空数据`; settings remain untouched. Build the demo document with `version: 3`, valid new fields, and either zero real milestones or intentional user-facing examples—never synthetic `test` records.

- [ ] **Step 4: Update Rust document validation**

Change test fixtures to:

```rust
r#"{"version":3,"projects":[],"milestones":[],"tasks":[],"quarterGoals":[]}"#
```

Require `version == 3` for newly saved documents and require arrays `projects`, `milestones`, `tasks`, `quarterGoals`. Loading old JSON remains possible because the frontend migration canonicalizes it before resaving.

- [ ] **Step 5: Run frontend and Rust tests**

Run: `pnpm test -- tests/unit/trash-page.spec.ts tests/unit/clear-workspace-data-dialog.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace_store --locked`

Expected: PASS.

- [ ] **Step 6: Checkpoint**

Record the exact trash/reset/demo/Rust files changed. Do not build an installer.

## Task 11: Run phase-one verification

**Files:**
- No implementation files unless a failing check exposes a defect.

- [ ] **Step 1: Run the focused milestone suite**

Run:

```powershell
pnpm test -- tests/unit/workspace-domain.spec.ts tests/unit/project-progress.spec.ts tests/unit/local-milestones.spec.ts tests/unit/task-milestone-linking.spec.ts tests/unit/milestone-state.spec.ts tests/unit/server-milestones.spec.ts tests/unit/project-milestones-sql.spec.ts tests/unit/milestone-dialogs.spec.ts tests/unit/project-progress-panel.spec.ts tests/unit/upcoming-milestones.spec.ts tests/unit/trash-page.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run the complete frontend suite**

Run: `pnpm test`

Expected: all tests PASS with no unhandled promise rejections.

- [ ] **Step 3: Run type and build checks**

Run: `pnpm typecheck`

Expected: exit code 0.

Run: `pnpm build`

Expected: Nuxt production build completes successfully.

- [ ] **Step 4: Run Rust checks**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --locked`

Expected: all Rust tests PASS.

Run: `cargo check --manifest-path src-tauri/Cargo.toml --locked`

Expected: exit code 0.

- [ ] **Step 5: Start the hot-reload desktop build for manual acceptance**

Run: `pnpm desktop:dev`

Expected: desktop window opens against the development server. Verify: v2 data appears unchanged; create/edit/delete/restore a milestone; link a task; view progress; view Today reminder; reset test data only after using the exact confirmation phrase.

Do not run `pnpm desktop:build` and do not install an NSIS package.
