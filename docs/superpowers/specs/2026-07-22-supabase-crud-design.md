# Supabase-ready project and task CRUD design

Date: 2026-07-22
Status: approved design

## Objective

Replace the Today page's component-local demo arrays with a testable data layer that supports complete project and task CRUD, manual ordering, completion, and recoverable deletion. The application must remain fully usable without Supabase credentials and must be ready to switch to a server-side Supabase adapter later without rewriting the interface.

## Scope

This phase includes:

- Project create, read, update, soft delete, and manual ordering.
- Task create, read, update, soft delete, completion toggle, focus/later movement, and manual ordering.
- A local browser-storage backend with initial demo data.
- A Nuxt server API and Supabase REST repository that remain dormant until configured.
- PostgreSQL migration and seed SQL for Supabase.
- Dynamic Today metrics, task groups, and project counts.
- Forms, action menus, confirmations, loading states, empty states, and error feedback.

This phase does not include login, registration, password recovery, a recycle-bin interface, real MiniMax calls, multi-user collaboration, or verified execution against a live PostgreSQL instance.

## Architecture

UI components depend on a single `WorkspaceGateway` contract rather than on storage details. A `useWorkspace` composable owns loading, derived groups and metrics, mutations, and error state.

Two browser-facing gateway implementations are provided:

1. `LocalWorkspaceGateway` stores one versioned workspace document in `localStorage`. It is the default and seeds the current demo content on first use.
2. `ApiWorkspaceGateway` calls Nuxt server endpoints when `NUXT_PUBLIC_DATA_BACKEND=supabase`.

Nuxt server endpoints call `SupabaseRepository`. The repository uses Nuxt's built-in fetch support to call Supabase REST and RPC endpoints. Supabase URL and service-role key remain in private runtime configuration and are never serialized to the browser. No new runtime dependency is required.

The backend choice is explicit. Local is the default. If Supabase mode is selected but required private configuration is absent, the client stays in local demo mode and shows why. After a valid Supabase session has been established, request failures do not silently change backends because that could create divergent datasets.

## Domain contract

### Project

- `id`: UUID string
- `ownerId`: UUID string
- `name`: non-empty string
- `color`: validated hex color
- `sortOrder`: non-negative integer
- `createdAt`: ISO timestamp
- `updatedAt`: ISO timestamp
- `deletedAt`: nullable ISO timestamp

### Task

- `id`: UUID string
- `ownerId`: UUID string
- `projectId`: nullable UUID string
- `title`: non-empty string
- `description`: string
- `priority`: `low`, `medium`, `high`, or null
- `dueDate`: nullable ISO date
- `dueTime`: nullable local time
- `isFocus`: boolean
- `sortOrder`: non-negative integer
- `completedAt`: nullable ISO timestamp
- `createdAt`: ISO timestamp
- `updatedAt`: ISO timestamp
- `deletedAt`: nullable ISO timestamp

All gateway methods filter out soft-deleted records by default. A single fixed demo owner UUID is shared by the local seed, server runtime configuration, and SQL seed. The owner field is retained so authentication can replace the fixed value later without changing the page contract.

## Gateway operations

The gateway exposes:

- `loadWorkspace()`
- `createProject(input)`
- `updateProject(id, patch)`
- `deleteProject(id)`
- `reorderProjects(orderedIds)`
- `createTask(input)`
- `updateTask(id, patch)`
- `deleteTask(id)`
- `setTaskCompleted(id, completed)`
- `reorderTasks(group, orderedIds)`

Deleting a project soft-deletes the project and all its active tasks atomically. In local storage this is one document update. In Supabase it is one RPC transaction. The operation requires an interface confirmation that states how many active tasks are affected.

Task groups are derived as follows:

- Completed: `completedAt` is not null.
- Today focus: active and `isFocus` is true.
- Later: active and `isFocus` is false.

Quick add creates a later task in the Inbox project. Manual ordering is represented by integer `sortOrder`; the gateway rewrites the affected group's order in one operation.

## Supabase schema and security

The migration creates `projects` and `tasks` tables with UUID primary keys, timestamps, soft-delete columns, ordering columns, validation constraints, owner indexes, active-record indexes, and a foreign key from tasks to projects.

The migration also creates transactional functions for project soft deletion and batch reordering. Database triggers maintain `updated_at`.

Row-level security is enabled with no anonymous read or write policies. The server repository uses a private service-role key and adds the fixed `owner_id` filter to every query and mutation. This prevents direct anonymous table access, but the application API itself has no user authentication in this phase. Supabase mode is therefore intended only for local or otherwise access-controlled environments until authentication is added.

The seed file inserts the Inbox project, the three visible demo projects, and the current Today tasks for the fixed demo owner. Seed inserts are idempotent by primary key.

## Interface changes

The existing Huly-style shell and responsive layout remain intact.

- `TaskEditorDialog` handles both creation and editing.
- `ProjectEditorDialog` handles both creation and editing.
- `DeleteConfirmDialog` is shared and requires explicit confirmation.
- Row action menus provide edit, move to focus/later, move up, move down, and delete.
- Project actions provide edit, move up, move down, and delete.
- The top and sidebar task buttons open the task editor.
- Quick add remains an inline form.
- Metrics and project counts are computed from active records.
- A visible badge identifies local demo mode and explains configuration fallback.
- Loading skeletons and actionable empty states prevent layout jumps and dead ends.

Up/down controls are used instead of drag-and-drop so keyboard and mobile users receive the same ordering behavior without adding a dependency.

## State and failure handling

Completion toggles, focus/later moves, and reorder operations update optimistically. `useWorkspace` keeps the prior snapshot and restores it if persistence fails. Create, edit, and delete update visible state only after persistence succeeds, preventing duplicate or prematurely removed records.

Zod validates domain records, form inputs, and the versioned local-storage document. Invalid local data is preserved under a timestamped backup key before a fresh demo document is created, and the user is notified. Storage quota and serialization failures leave the last valid in-memory state intact.

The API repository converts transport and Supabase errors to a small application error set: validation, not found, conflict, unavailable, and unexpected. Components display concise feedback and keep forms open when a save fails.

The first version uses last-write-wins semantics. Conflict detection and collaborative editing are outside this phase.

## Server API

The Nuxt server exposes resource-oriented endpoints for listing, creating, and updating projects and tasks, plus explicit endpoints for project soft deletion, task soft deletion, completion changes, and batch reordering. Every handler validates input, supplies the fixed demo owner on the server, and returns domain-shaped JSON rather than raw database rows.

Requests are never made when local mode is active. No network request is needed to develop or verify this phase.

## Test strategy

Implementation follows red-green-refactor.

- Gateway contract tests cover CRUD, completion, soft deletion, project cascade deletion, and ordering.
- Local gateway tests use the real happy-dom `localStorage`, including first-run seed, reload, invalid payload backup, and quota failure.
- Workspace-state tests cover grouping, metrics, optimistic updates, and rollback.
- Supabase repository tests use an injected transport to verify REST/RPC paths, owner filters, payload mapping, and error conversion without a live network call.
- Component tests cover quick add, editors, completion, deletion confirmation, ordering, dynamic counts, empty states, and the local-mode badge.
- Existing shell and Today workspace tests remain and are updated only where the approved dynamic behavior changes their expectations.

Fresh completion evidence requires:

```bash
pnpm test
pnpm typecheck
pnpm build
```

The SQL files and repository contract can be verified locally, but live migration success cannot be claimed until the migration is executed against PostgreSQL or Supabase in a later, explicitly authorized network-connected phase.

## Acceptance criteria

- The application starts in local mode without credentials or network access.
- Demo projects and tasks appear on first run and persist across reloads.
- Every approved project and task CRUD operation is available through the interface.
- Deleted records disappear from normal reads but remain stored with `deleted_at`.
- Project deletion soft-deletes its active tasks as one confirmed operation.
- Reordering persists and works with pointer, keyboard, and mobile interaction.
- Today metrics, groups, and project counts reflect current active data.
- Supabase mode is isolated behind the same gateway contract and keeps private configuration server-side.
- Tests, type checking, and production build complete with fresh successful output before the implementation is described as complete.

