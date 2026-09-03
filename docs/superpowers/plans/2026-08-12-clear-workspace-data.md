# Clear Workspace Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded action that permanently clears all workspace tasks, projects, milestones, and trash while preserving AI credentials, model selection, and UI preferences.

**Architecture:** Extend the existing `WorkspaceGateway` boundary with one atomic `clearWorkspaceData` operation, then expose it through the workspace model. Local and SQLite modes replace only the workspace document with a valid empty document; Supabase uses one owner-scoped transaction. A focused confirmation dialog owns typed confirmation and the workspace information panel only opens it.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Vitest, Tauri 2, SQLite JSON document store, Supabase PostgreSQL.

---

### Task 1: Local and SQLite clearing contract

**Files:**
- Modify: `app/data/workspace-gateway.ts`
- Modify: `app/data/local-workspace-gateway.ts`
- Modify: `app/data/desktop-workspace-gateway.ts`
- Test: `tests/unit/local-workspace-gateway.spec.ts`
- Test: `tests/unit/sqlite-workspace-gateway.spec.ts`

- [x] Add failing tests asserting `clearWorkspaceData()` leaves `{ version: 2, projects: [], tasks: [], quarterGoals: [] }`, preserves `personal-ai-minimax-model:v1` and `personal-ai-ui-scale:v4`, and rolls SQLite memory back when `saveDocument` rejects.
- [x] Run `pnpm vitest run tests/unit/local-workspace-gateway.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts`; expect failures because `clearWorkspaceData` is absent.
- [x] Add `clearWorkspaceData(): Promise<void>` to `WorkspaceGateway`. Implement local clearing with one validated document write, and desktop clearing through the existing serialized `persist` transaction.
- [x] Re-run the two test files; expect all tests to pass.

### Task 2: Supabase and Nuxt API clearing path

**Files:**
- Modify: `app/data/api-workspace-gateway.ts`
- Modify: `server/utils/supabase-workspace-repository.ts`
- Create: `server/api/workspace-data.delete.ts`
- Create: `supabase/migrations/202608120001_clear_workspace_data.sql`
- Test: `tests/unit/api-workspace-gateway.spec.ts`
- Test: `tests/unit/supabase-workspace-repository.spec.ts`
- Test: `tests/unit/supabase-sql.spec.ts`

- [x] Add failing tests for `DELETE /api/workspace-data`, the `clear_workspace_data` RPC with `{ p_owner_id }`, and SQL that deletes tasks, quarter goals, then projects inside an owner-scoped function.
- [x] Run the three test files; expect missing method, route, and migration failures.
- [x] Implement the API gateway method, server route, repository RPC call, and security-definer SQL function. Revoke public access and grant execution only to `service_role`.
- [x] Re-run the three test files; expect all tests to pass.

### Task 3: Workspace model state transition

**Files:**
- Modify: `app/models/workspace-model.ts`
- Test: `tests/unit/workspace-model.spec.ts`

- [x] Add a failing test that deletes a task, calls `clearWorkspaceData()`, and asserts active collections, trash collections, counts, and `lastDeleted` are all empty/null.
- [x] Run `pnpm vitest run tests/unit/workspace-model.spec.ts`; expect `clearWorkspaceData` to be absent.
- [x] Add the model action using the existing `commit` flow, then clear the pending undo state after a successful persistence. Do not clear it on failure.
- [x] Re-run the model test; expect all tests to pass.

### Task 4: Typed destructive confirmation UI

**Files:**
- Create: `app/components/workspace/ClearWorkspaceDataDialog.vue`
- Modify: `app/components/workspace/WorkspaceInfoDialog.vue`
- Test: `tests/unit/clear-workspace-data-dialog.spec.ts`

- [x] Add failing component tests: the confirm button is disabled until the exact text `清空数据` is entered; counts are visible; cancel emits `close`; confirmed submit emits `confirm`; saving disables inputs and close actions.
- [x] Run `pnpm vitest run tests/unit/clear-workspace-data-dialog.spec.ts`; expect the component to be missing.
- [x] Implement the focused dialog with `role="alertdialog"`, exact typed confirmation, irreversible-warning copy, and task/project/milestone counts.
- [x] Add a “危险操作” section to `WorkspaceInfoDialog.vue`; opening the confirmation must not close the workspace information dialog, and successful clearing closes only the confirmation.
- [x] Re-run the component test and `tests/unit/workspace-model.spec.ts`; expect all tests to pass.

### Task 5: Full verification and development preview

**Files:**
- Verify only; no installer/version file changes.

- [x] Run `pnpm typecheck`; expect exit code 0.
- [x] Run `pnpm test`; expect zero failed test files and tests.
- [x] Run `cargo check --locked` in `src-tauri`; expect exit code 0.
- [x] Run `pnpm desktop:dev`, wait for Nuxt and Tauri readiness, verify the app process stays alive, and leave the preview running for user review.
- [x] Report the development preview result and explicitly state that no installer was generated.

## Execution note

This workspace is not a Git repository, so commit steps are intentionally omitted. The implementation must not initialize Git or modify any `.git` directory.
