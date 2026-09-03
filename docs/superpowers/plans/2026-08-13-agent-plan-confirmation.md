# Agent Plan Confirmation Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn MiniMax answers into persistent, editable, dependency-aware plans that users review item by item and execute atomically against real project, milestone, and task data.

**Architecture:** Keep MiniMax as a proposal generator and place all authority in local typed code. Parse model output into a versioned draft, persist it independently from credentials, validate references/conflicts against the latest workspace, simulate selected actions on a cloned v3 document, then perform one gateway document replacement. Present the draft in a dedicated Huly-style `/agent-plan` workspace with a left review list and right editor.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Zod, Vitest, Tauri/Rust, MiniMax OpenAI-compatible API, existing WorkspaceGateway.

---

## Dependency and repository constraint

Execute `docs/superpowers/plans/2026-08-13-project-milestones.md` first and require its complete verification to pass. This checkout has no `.git`; do not create `.git`. Use passing test checkpoints instead of commits unless execution occurs later in a real Git worktree.

## File structure map

**Protocol and model response**

- Modify `app/services/minimax.ts`: v3 context and expanded action transport types.
- Modify `src-tauri/src/minimax.rs`: strict raw action parsing, normalization, prompt rules, v3 context.
- Create `app/services/agent-plan-schema.ts`: canonical draft/action Zod schemas and TypeScript types.

**Draft lifecycle and execution**

- Create `app/services/agent-plan-storage.ts`: local persistent draft store with no credentials.
- Create `app/services/agent-plan-validation.ts`: field, dependency, selection, conflict, and dangerous-action validation.
- Create `app/services/agent-plan-executor.ts`: topological draft-reference resolution and pure document simulation.
- Create `app/data/workspace-transaction.ts`: one-write gateway transaction contract.
- Modify all WorkspaceGateway implementations to expose `replaceWorkspaceDocument` with validation and rollback behavior.
- Create `supabase/migrations/202608130002_replace_workspace_document.sql`: owner-scoped atomic replacement RPC for the optional server adapter; never execute it against a database in this task.
- Create `app/composables/useAgentPlan.ts`: load/edit/select/discard/replan/execute state.

**Confirmation center**

- Create `app/pages/agent-plan.vue`: wide confirmation workspace.
- Modify `app/layouts/default.vue`: collapse the normal AI context panel while reviewing a plan so the list/editor receives the full workspace width.
- Create `app/components/agent/AgentPlanHeader.vue`.
- Create `app/components/agent/AgentActionList.vue`.
- Create `app/components/agent/AgentActionEditor.vue`.
- Create `app/components/agent/AgentPlanFooter.vue`.
- Create `app/components/agent/AgentDeleteConfirmDialog.vue`.
- Create `app/components/agent/AgentDependencyDialog.vue`.
- Modify `app/components/app/ConnectedContextPanel.vue`: save returned plan and link to review instead of directly applying it.
- Modify `app/assets/css/main.css`: confirmation center layout, readable type, narrow-window drawer.

## Task 1: Define the versioned Agent plan schema

**Files:**
- Create: `app/services/agent-plan-schema.ts`
- Create: `tests/unit/agent-plan-schema.spec.ts`

- [ ] **Step 1: Write failing schema tests**

```ts
it('defaults delete actions to unselected', () => {
  const parsed = agentPlanDraftSchema.parse(deleteTaskDraft)
  expect(parsed.actions[0]).toMatchObject({ selected: false, dangerous: true })
})

it('rejects permanent deletion', () => {
  expect(() => agentActionSchema.parse({ type: 'purgeTask', actionId: 'a1' })).toThrow()
})

it('accepts draft references for a new project and milestone', () => {
  expect(agentPlanDraftSchema.parse(linkedDraft).actions).toHaveLength(3)
})
```

- [ ] **Step 2: Verify red state**

Run: `pnpm test -- tests/unit/agent-plan-schema.spec.ts`

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement canonical schemas**

Define `AgentPlanDraftV1` with `version: 1`, `id`, `question`, `model`, `createdAt`, `updatedAt`, `status`, `actions`, and validation summary. Every action has `actionId`, `type`, `reason`, `selected`, `dangerous`, optional `targetId`, optional `expectedUpdatedAt`, optional `draftRef`, and a type-specific payload.

Use exactly these action names:

```ts
export const agentActionTypeSchema = z.enum([
  'createProject', 'updateProject', 'setProjectCompleted', 'deleteProject',
  'createMilestone', 'updateMilestone', 'setMilestoneCompleted', 'deleteMilestone',
  'createTask', 'updateTask', 'setTaskCompleted', 'deleteTask',
])
```

Creation payload relationships accept `{ kind: 'existing', id }`, `{ kind: 'draft', ref }`, or `null`. Delete schemas use `selected: z.boolean().default(false)` and `dangerous: z.literal(true).default(true)`; other action schemas default to selected and non-dangerous. Parsing a previously saved delete selection must preserve an explicit `selected: true`.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-schema.spec.ts`

Expected: PASS.

## Task 2: Expand MiniMax context and normalize project/milestone/task actions

**Files:**
- Modify: `app/services/minimax.ts`
- Modify: `src-tauri/src/minimax.rs`
- Modify: `tests/unit/minimax-context.spec.ts`
- Modify: `tests/unit/minimax-agent.spec.ts`

- [ ] **Step 1: Write failing transport tests**

Assert the context includes extended project fields, real milestones, task `milestoneId`, and that the Rust-facing result retains `actionId`, `reason`, `expectedUpdatedAt`, and draft references.

```ts
expect(context.milestones[0]).toMatchObject({
  projectId: PROJECT_ID,
  title: '完成首页评审',
  status: 'planned',
  progressMode: 'auto',
})
expect(context.tasks[0]?.milestoneId).toBe(MILESTONE_ID)
```

- [ ] **Step 2: Verify frontend tests fail**

Run: `pnpm test -- tests/unit/minimax-context.spec.ts tests/unit/minimax-agent.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Expand TypeScript transport types**

Replace the task-only `MiniMaxAgentAction` union with the canonical normalized action shape returned by Rust. Continue to validate again with `agentPlanDraftSchema` before saving a draft.

- [ ] **Step 4: Expand the Rust prompt and action normalizer**

The system prompt must state in Chinese:

```text
你只能提出计划，不能声称已经执行。
只允许创建、修改、完成或移入回收站项目、项目里程碑和任务。
禁止永久删除、清空回收站、输出密钥或执行外部操作。
新建记录使用 draftRef；引用新建记录时使用 draftRef，不得伪造 UUID。
对现有记录的修改、完成、删除必须回传目标 updatedAt。
```

Normalize all strings, enum values, dates, progress, and IDs. Cap actions at 30. Reject the whole plan when an action type is unknown instead of silently converting it.

- [ ] **Step 5: Add Rust normalization tests**

Test a linked create-project/create-milestone/create-task response, an unknown action, invalid date, and forbidden permanent delete.

Run: `cargo test --manifest-path src-tauri/Cargo.toml minimax --locked`

Expected: PASS.

- [ ] **Step 6: Run frontend tests and checkpoint**

Run: `pnpm test -- tests/unit/minimax-context.spec.ts tests/unit/minimax-agent.spec.ts`

Expected: PASS.

## Task 3: Persist and restore one pending Agent draft

**Files:**
- Create: `app/services/agent-plan-storage.ts`
- Create: `tests/unit/agent-plan-storage.spec.ts`
- Modify: `app/models/workspace-model.ts`
- Modify: `tests/unit/clear-workspace-data-dialog.spec.ts`

- [ ] **Step 1: Write failing storage tests**

```ts
it('round trips the pending draft without credentials', () => {
  storage.save(draft)
  expect(storage.load()).toEqual(draft)
  expect(backingStore.getItem(KEY)).not.toContain('apiKey')
})

it('quarantines malformed saved data', () => {
  backingStore.setItem(KEY, '{bad json')
  expect(storage.load()).toBeNull()
  expect(backingStore.getItem(KEY)).toBeNull()
})
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-storage.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement storage**

Use key `personal-ai-agent-plan:v1`. Export `load`, `save`, `clear`; parse every load with `agentPlanDraftSchema`; use injected `StorageLike` in tests. Persist only the latest pending/conflicted/failed draft.

- [ ] **Step 4: Clear drafts with workspace data**

After `WorkspaceModel.clearWorkspaceData()` succeeds, call draft storage `clear()`. Do not clear MiniMax region/model/key settings or UI scale.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-storage.spec.ts tests/unit/clear-workspace-data-dialog.spec.ts`

Expected: PASS.

## Task 4: Validate selections, references, fields, and conflicts

**Files:**
- Create: `app/services/agent-plan-validation.ts`
- Create: `tests/unit/agent-plan-validation.spec.ts`

- [ ] **Step 1: Write failing validation tests**

Cover duplicate action IDs/draft refs, missing parent selection, field constraints, missing targets, soft-deleted targets, stale `updatedAt`, and unchecked deletion behavior.

```ts
expect(validateAgentPlan(staleDraft, currentDocument)).toEqual(expect.objectContaining({
  executable: false,
  issues: expect.arrayContaining([
    expect.objectContaining({ actionId: 'update-1', code: 'conflict' }),
  ]),
}))
```

- [ ] **Step 2: Verify red state**

Run: `pnpm test -- tests/unit/agent-plan-validation.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic validation**

Export:

```ts
type AgentPlanIssueCode = 'field' | 'missing-target' | 'conflict' | 'dependency' | 'danger-confirmation'
type AgentPlanIssue = { actionId: string, code: AgentPlanIssueCode, field?: string, message: string }
function validateAgentPlan(draft: AgentPlanDraftV1, document: WorkspaceDocument): {
  executable: boolean
  selectedCount: number
  dangerousCount: number
  estimatedMinutes: number
  issues: AgentPlanIssue[]
}
```

Run validation without mutating draft/document. Unselected actions are ignored except when a selected action depends on them. Compare exact ISO `expectedUpdatedAt` strings.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-validation.spec.ts`

Expected: PASS.

## Task 5: Add a one-write Workspace transaction boundary

**Files:**
- Modify: `app/data/workspace-gateway.ts`
- Modify: `app/data/local-workspace-gateway.ts`
- Modify: `app/data/desktop-workspace-gateway.ts`
- Modify: `app/data/api-workspace-gateway.ts`
- Create: `server/api/workspace.put.ts`
- Modify: `server/utils/supabase-workspace-repository.ts`
- Create: `supabase/migrations/202608130002_replace_workspace_document.sql`
- Create: `app/data/workspace-transaction.ts`
- Create: `tests/unit/workspace-transaction.spec.ts`
- Create: `tests/unit/replace-workspace-document-sql.spec.ts`

- [ ] **Step 1: Write failing atomic replacement tests**

```ts
await expect(transaction.replace(nextDocument)).resolves.toEqual(nextDocument)
expect(bridge.saveDocument).toHaveBeenCalledTimes(1)

bridge.saveDocument.mockRejectedValueOnce(new Error('disk full'))
await expect(transaction.replace(nextDocument)).rejects.toThrow('disk full')
expect(await gateway.loadWorkspace({ includeDeleted: true })).toEqual(beforeDocument)
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/workspace-transaction.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Add `replaceWorkspaceDocument` to the contract**

```ts
replaceWorkspaceDocument(document: WorkspaceDocument): Promise<WorkspaceDocument>
```

Local implementation parses `structuredClone(document)` with `workspaceDocumentSchema` then persists once. Desktop wraps the local operation in its serialized `persist` queue, preserving rollback on bridge failure. API uses `PUT /api/workspace`; server repository calls one owner-scoped RPC rather than sequential REST writes.

- [ ] **Step 4: Add the optional Supabase atomic replacement RPC**

The additive SQL migration must define `replace_workspace_document(target_owner_id uuid, payload jsonb)`. Inside one PostgreSQL function transaction it validates `payload->>'version' = '3'`, verifies all four arrays exist, deletes only `target_owner_id` records in child-to-parent order, and inserts projects, milestones, tasks, and quarter goals with their supplied IDs/timestamps. It must reject any row whose `ownerId` differs from `target_owner_id`. Do not edit old migrations, connect to Supabase, or execute this SQL.

Add text-contract assertions:

```ts
expect(sql).toContain('create or replace function public.replace_workspace_document')
expect(sql).toContain("payload->>'version'")
expect(sql).toContain('target_owner_id')
expect(sql).toContain('jsonb_array_elements')
```

- [ ] **Step 5: Implement a transaction helper**

`WorkspaceTransaction.replace` accepts a validated v3 document and delegates once. It contains no MiniMax-specific logic and is reusable by future import/sync features.

- [ ] **Step 6: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/workspace-transaction.spec.ts tests/unit/replace-workspace-document-sql.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts tests/unit/api-workspace-gateway.spec.ts`

Expected: PASS.

## Task 6: Simulate selected actions and resolve draft references

**Files:**
- Create: `app/services/agent-plan-executor.ts`
- Create: `tests/unit/agent-plan-executor.spec.ts`

- [ ] **Step 1: Write failing executor tests**

Test topological create relationships, mixed updates/completions, soft deletes, zero partial writes, and deterministic action results.

```ts
const result = simulateAgentPlan(linkedDraft, currentDocument, {
  now: () => '2026-08-13T08:00:00.000Z',
  createId: ids(['project-id', 'milestone-id', 'task-id']),
})
expect(result.document.tasks[0]).toMatchObject({
  projectId: 'project-id', milestoneId: 'milestone-id',
})
expect(result.results.map(item => item.actionId)).toEqual(['p1', 'm1', 't1'])
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-executor.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement pure simulation**

Clone the document, topologically sort selected actions by draft references, generate UUIDs only for creates, apply every domain invariant used by LocalWorkspaceGateway, then parse the entire result with `workspaceDocumentSchema`.

Export:

```ts
function simulateAgentPlan(
  draft: AgentPlanDraftV1,
  document: WorkspaceDocument,
  environment?: { now?: () => string, createId?: () => string },
): { document: WorkspaceDocument, results: AgentActionResult[] }
```

Throw `AgentPlanSimulationError` with `actionId`, `field`, and user-facing message. Never call persistence from this function.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-executor.spec.ts`

Expected: PASS.

## Task 7: Build the Agent plan composable and execution lifecycle

**Files:**
- Create: `app/composables/useAgentPlan.ts`
- Create: `tests/unit/agent-plan-state.spec.ts`
- Modify: `app/models/workspace-model.ts`

- [ ] **Step 1: Write failing state tests**

Assert save/load, edit without model call, selection, dependency decision, validation refresh, delete confirmation flag, one-write execution, failure retention, success clearing, and workspace refresh.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-state.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement composable state**

Expose:

```ts
draft, validation, selectedActionId, executing, executionResult, error,
loadDraft, setDraft, selectAction, updateAction, toggleAction,
resolveDeselectedDependency, discardDraft, requestExecution, confirmDangerousExecution
```

`updateAction` and `toggleAction` save immediately to draft storage. `requestExecution` re-reads the latest workspace, validates, simulates, and either requests danger confirmation or calls `replaceWorkspaceDocument` once. Success refreshes WorkspaceModel, records results, and clears persistent pending draft. Failure preserves the draft with status `failed` or `conflicted`.

- [ ] **Step 4: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-state.spec.ts tests/unit/workspace-model.spec.ts`

Expected: PASS.

## Task 8: Build the wide review list and right-side editor

**Files:**
- Create: `app/pages/agent-plan.vue`
- Modify: `app/layouts/default.vue`
- Create: `app/components/agent/AgentPlanHeader.vue`
- Create: `app/components/agent/AgentActionList.vue`
- Create: `app/components/agent/AgentActionEditor.vue`
- Create: `app/components/agent/AgentPlanFooter.vue`
- Modify: `app/assets/css/main.css`
- Create: `tests/unit/agent-plan-page.spec.ts`

- [ ] **Step 1: Write failing page tests**

Assert grouped rows, selected count, selected editor, field edits, estimated minutes, disabled execution on validation error, 16px body type marker, keyboard selection, and narrow-window drawer class.

```ts
expect(wrapper.findAll('[data-agent-action]')).toHaveLength(6)
expect(wrapper.get('[data-agent-selected-count]').text()).toContain('5 / 6')
await wrapper.get('[data-agent-action="task-1"]').trigger('click')
expect(wrapper.get('[data-agent-action-editor]').text()).toContain('整理首页信息架构')
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-page.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Build the selected A layout**

The page keeps the app rail/sidebar and uses the content canvas for a two-column review center. Left side groups by entity and displays checkboxes, reason, dates, priority, warnings. Right side uses real project/milestone/task fields. Bottom footer is sticky and shows selected count, total estimate, dangerous count, discard, replan, and confirm actions.

In `app/layouts/default.vue`, compute `isAgentPlan = computed(() => route.path === '/agent-plan')`, add class `agent-review-mode` to `.app-shell`, and do not render the ordinary `AppContextPanel` on that route. CSS makes the content canvas span the released context column; rail and project sidebar remain visible.

- [ ] **Step 4: Implement accessible/narrow behavior**

Rows are buttons with separate checkbox controls, support ArrowUp/ArrowDown selection, and expose issue messages with `aria-describedby`. At widths below 900px, action editor uses a fixed bottom drawer with its own close button and bottom padding prevents footer overlap.

- [ ] **Step 5: Enforce readability styling**

In `main.css`, use body 16px, metadata minimum 13px, headings minimum 20px, controls minimum 40px, thin Huly separators, and compact surfaces rather than oversized cards.

- [ ] **Step 6: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-page.spec.ts tests/unit/ui-preferences.spec.ts`

Expected: PASS.

## Task 9: Add dependency decisions and destructive-operation confirmation

**Files:**
- Create: `app/components/agent/AgentDependencyDialog.vue`
- Create: `app/components/agent/AgentDeleteConfirmDialog.vue`
- Modify: `app/pages/agent-plan.vue`
- Create: `tests/unit/agent-plan-safety-dialogs.spec.ts`

- [ ] **Step 1: Write failing safety tests**

Assert deselecting a new project with selected children opens dependency choices, delete rows start unchecked, selecting delete paints danger state, and final execution cannot proceed until a second confirmation lists exact counts.

```ts
expect(deleteRow.get('input[type="checkbox"]').attributes('checked')).toBeUndefined()
await wrapper.get('[data-confirm-agent-plan]').trigger('click')
expect(wrapper.get('[data-agent-delete-confirm]').text()).toContain('1 个项目')
expect(executor).not.toHaveBeenCalled()
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-safety-dialogs.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement dependency choices**

For deselected created parents, offer exactly:

- “同时取消下属项” — recursively deselect dependent draft actions.
- “保留下属项并重新归属” — keep them selected and require user to select existing/different draft parents before execution.

No selection may leave a dangling reference.

- [ ] **Step 4: Implement delete confirmation**

List selected project/milestone/task delete counts and project cascade child counts. Use “移入回收站” everywhere. The confirm dialog has cancel and one danger button; it never offers permanent deletion or empty-trash operations.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-safety-dialogs.spec.ts tests/unit/agent-plan-validation.spec.ts`

Expected: PASS.

## Task 10: Connect MiniMax answers to the confirmation center

**Files:**
- Modify: `app/components/app/ConnectedContextPanel.vue`
- Modify: `tests/unit/minimax-panel.spec.ts`
- Create: `tests/unit/minimax-agent-plan-integration.spec.ts`

- [ ] **Step 1: Write failing integration tests**

Assert a model answer with actions is saved as a draft, panel shows count and “审阅计划”, clicking navigates to `/agent-plan`, old “确认执行 N 项” direct executor is absent, and a text-only answer creates no draft.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/minimax-panel.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts`

Expected: FAIL because the panel still executes task actions directly.

- [ ] **Step 3: Replace direct execution with draft creation**

Remove `applyMiniMaxAgentActions` from the panel. Convert normalized returned actions into `AgentPlanDraftV1`, save through `useAgentPlan().setDraft`, display safe summary, and navigate through Nuxt router. Preserve answer sources and token usage.

- [ ] **Step 4: Add recovery entry**

When a pending draft exists after restart, panel displays “继续审阅上次计划” with last updated time. Do not call MiniMax while reopening it.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/minimax-panel.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts`

Expected: PASS.

## Task 11: Add execution results, transient feedback, and conflict recovery

**Files:**
- Modify: `app/pages/agent-plan.vue`
- Create: `app/components/agent/AgentExecutionResult.vue`
- Create: `tests/unit/agent-plan-execution-ui.spec.ts`

- [ ] **Step 1: Write failing result/conflict tests**

Assert success lists actual records, toast disappears after 8 seconds, conflicts locate the action row and keep the draft, “按当前数据重新载入” updates target payload/timestamp, and “让 AI 重新规划” returns the question to the panel without silently executing.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm test -- tests/unit/agent-plan-execution-ui.spec.ts`

Expected: FAIL.

- [ ] **Step 3: Implement result display**

Render result groups for created, updated, completed, and moved-to-trash records using the real IDs returned by simulation/execution. Auto-dismiss the compact success banner after 8,000 ms and provide an explicit close button.

- [ ] **Step 4: Implement conflict recovery**

Scroll/focus the first conflicted action. “按当前数据重新载入” replaces only that action's editable payload and `expectedUpdatedAt` from the current record; it does not change other actions. Replan requires a new explicit MiniMax submission.

- [ ] **Step 5: Run tests and checkpoint**

Run: `pnpm test -- tests/unit/agent-plan-execution-ui.spec.ts tests/unit/agent-plan-state.spec.ts`

Expected: PASS.

## Task 12: Run complete Agent and desktop verification

**Files:**
- No implementation files unless a check exposes a defect.

- [ ] **Step 1: Run focused Agent tests**

Run:

```powershell
pnpm test -- tests/unit/agent-plan-schema.spec.ts tests/unit/agent-plan-storage.spec.ts tests/unit/agent-plan-validation.spec.ts tests/unit/workspace-transaction.spec.ts tests/unit/agent-plan-executor.spec.ts tests/unit/agent-plan-state.spec.ts tests/unit/agent-plan-page.spec.ts tests/unit/agent-plan-safety-dialogs.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts tests/unit/agent-plan-execution-ui.spec.ts
```

Expected: all selected tests PASS.

- [ ] **Step 2: Run complete frontend verification**

Run: `pnpm test`

Expected: all tests PASS.

Run: `pnpm typecheck`

Expected: exit code 0.

Run: `pnpm build`

Expected: Nuxt production build completes successfully.

- [ ] **Step 3: Run Rust verification**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --locked`

Expected: all Rust tests PASS.

Run: `cargo check --manifest-path src-tauri/Cargo.toml --locked`

Expected: exit code 0.

- [ ] **Step 4: Run desktop hot-reload acceptance**

Run: `pnpm desktop:dev`

Expected manual path:

1. Ask MiniMax to plan one project, one milestone, and two tasks.
2. Confirm that no data changes before review.
3. Edit one item and deselect another.
4. Close/reopen the dev app and confirm draft recovery.
5. Confirm execution and verify real data appears once.
6. Generate a deletion plan, verify it starts unchecked and requires second confirmation.
7. Modify a target outside the draft, then verify conflict blocking and recovery.

Do not build or install a release package.
