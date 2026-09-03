# MiniMax M3 and OpenAI-Compatible Providers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MiniMax M3 as the safe default and let users securely manage and use multiple OpenAI-compatible model profiles without exposing credentials or bypassing Agent plan review.

**Architecture:** Keep MiniMax as the built-in provider and add a Rust-owned versioned registry for custom provider metadata plus one Windows Credential Manager entry per profile. Frontend callers persist only a discriminated model target and pass only a trusted profile ID to Rust; Rust resolves the endpoint, model and credential, performs a no-redirect bounded Chat Completions request, then reuses the existing strict brief/Agent normalization pipeline.

**Tech Stack:** Nuxt 4, Vue 3, TypeScript, Zod, Tauri 2, Rust, reqwest 0.13, serde/serde_json, Windows Credential Manager, Vitest, Rust unit tests.

---

## Execution constraints

- The checkout has no `.git` directory. Do not create or modify Git metadata. Replace commit checkpoints with a scoped report and fresh test evidence.
- Use `apply_patch` for source changes.
- Do not read existing credentials or `.env` files.
- Do not call real MiniMax, OpenAI-compatible services, Supabase or production databases.
- Do not install or update dependencies from the network. `uuid 1.24.0` and `url 2.5.8` already exist in `src-tauri/Cargo.lock`; if direct declarations are needed, pin those exact locked versions and verify with `cargo check --locked`.
- Do not start, stop or duplicate `pnpm desktop:dev`, Nuxt or Tauri processes. Browser/desktop visual acceptance belongs only to the final task and only when an isolated fixture is available.
- Keep credentials, provider settings and model selection outside workspace documents and Agent draft payloads.

## File map

### New Rust units

- `src-tauri/src/model_provider.rs` — versioned provider registry, profile validation, atomic file writes, corruption recovery, lifecycle queue and Tauri CRUD commands.
- `src-tauri/src/provider_credential_store.rs` — namespaced credential targets and secret save/read/exists/delete operations; no read command is exposed to the frontend.
- `src-tauri/src/openai_compatible.rs` — validated URL policy, bounded no-redirect transport, standard response parsing and safe error mapping.

### New frontend units

- `app/services/ai-model-target.ts` — built-in/custom discriminated selection, v1-to-v2 migration and persistence.
- `app/services/model-provider.ts` — strict DTO schemas and Tauri command wrappers that never accept or return stored secrets.
- `app/components/app/ModelProviderDialog.vue` — provider list, create/edit/rekey/delete/test UI.

### Existing units to modify

- `app/services/minimax-model.ts` — add M3 and make it the fallback default.
- `app/services/minimax.ts` — expose provider-neutral ask/brief wrappers while retaining strict context and Agent action parsing.
- `app/components/app/ConnectedContextPanel.vue` — grouped target selector, provider manager entry and provider-neutral request path.
- `app/assets/css/interaction-uplift.css` and component scoped styles — readable provider management layout.
- `src-tauri/src/minimax.rs` — accept M3, return owned model labels and expose reusable prompt/normalization entry points.
- `src-tauri/src/main.rs` — initialize/manage the registry and register provider/AI commands.
- `src-tauri/Cargo.toml` — direct declarations for already-locked `uuid` and `url` only if compilation requires them.

### Tests

- `tests/unit/minimax-model-selection.spec.ts`
- `tests/unit/ai-model-target.spec.ts`
- `tests/unit/model-provider-service.spec.ts`
- `tests/unit/model-provider-dialog.spec.ts`
- `tests/unit/minimax-panel.spec.ts`
- `tests/unit/minimax-agent-plan-integration.spec.ts`
- `tests/unit/clear-workspace-data-dialog.spec.ts`
- Rust `#[cfg(test)]` modules in the three new Rust files and `src-tauri/src/minimax.rs`.

---

### Task 1: Add MiniMax M3 and migrate the selected target

**Files:**
- Modify: `app/services/minimax-model.ts`
- Create: `app/services/ai-model-target.ts`
- Modify: `src-tauri/src/minimax.rs`
- Modify: `tests/unit/minimax-model-selection.spec.ts`
- Create: `tests/unit/ai-model-target.spec.ts`

- [ ] **Step 1: Write the failing frontend M3/default/migration tests**

Add assertions equivalent to:

```ts
it('offers official M3 and uses it for a fresh install', () => {
  expect(MINIMAX_MODELS[0]?.id).toBe('MiniMax-M3')
  expect(DEFAULT_MINIMAX_MODEL).toBe('MiniMax-M3')
})

it('migrates an existing M2 selection without forcing M3', () => {
  localStorage.setItem('personal-ai-minimax-model:v1', 'MiniMax-M2.7')
  expect(loadAiModelTarget()).toEqual({ kind: 'minimax', modelId: 'MiniMax-M2.7' })
  expect(JSON.parse(localStorage.getItem(AI_MODEL_SELECTION_KEY)!)).toEqual({
    kind: 'minimax',
    modelId: 'MiniMax-M2.7',
  })
})

it('falls back to M3 for malformed or missing selections', () => {
  localStorage.setItem(AI_MODEL_SELECTION_KEY, '{bad')
  expect(loadAiModelTarget()).toEqual({ kind: 'minimax', modelId: 'MiniMax-M3' })
})
```

- [ ] **Step 2: Run the focused tests and capture RED**

Run:

```powershell
pnpm exec vitest run tests/unit/minimax-model-selection.spec.ts tests/unit/ai-model-target.spec.ts --reporter=verbose --hookTimeout=180000
```

Expected: FAIL because `MiniMax-M3` and `ai-model-target.ts` do not exist.

- [ ] **Step 3: Implement the strict target schema and migration**

Use these public contracts:

```ts
export const aiModelTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('minimax'), modelId: miniMaxModelSchema }).strict(),
  z.object({ kind: z.literal('custom'), profileId: z.string().uuid() }).strict(),
])

export type AiModelTarget = z.infer<typeof aiModelTargetSchema>
export const AI_MODEL_SELECTION_KEY = 'personal-ai-model-selection:v2'
export const DEFAULT_AI_MODEL_TARGET: AiModelTarget = {
  kind: 'minimax',
  modelId: 'MiniMax-M3',
}
```

`loadAiModelTarget(storage)` must parse v2 first, migrate a valid legacy MiniMax selection second, and otherwise save/return the M3 target. `saveAiModelTarget` must parse before writing.

Add this model first in `MINIMAX_MODELS`:

```ts
{ id: 'MiniMax-M3', label: 'M3', description: '最新旗舰 Agent 模型，支持超长上下文与复杂规划' }
```

Change the Rust default and validator:

```rust
const MINIMAX_MODEL: &str = "MiniMax-M3";

fn validate_model(value: &str) -> Result<&'static str, String> {
    match value {
        "MiniMax-M3" => Ok("MiniMax-M3"),
        // retain every existing reviewed M2 entry
        _ => Err("不支持的 MiniMax 模型，请重新选择".to_string()),
    }
}
```

- [ ] **Step 4: Add/adjust Rust allowlist tests**

The test must assert exact acceptance of M3 and rejection of `MiniMax-M3-highspeed` until MiniMax documents that ID:

```rust
assert_eq!(validate_model("MiniMax-M3").unwrap(), "MiniMax-M3");
assert!(validate_model("MiniMax-M3-highspeed").is_err());
assert_eq!(MINIMAX_MODEL, "MiniMax-M3");
```

- [ ] **Step 5: Run GREEN verification**

```powershell
pnpm exec vitest run tests/unit/minimax-model-selection.spec.ts tests/unit/ai-model-target.spec.ts --reporter=verbose --hookTimeout=180000
cargo test --manifest-path src-tauri/Cargo.toml minimax --locked
pnpm typecheck
```

Expected: all commands exit 0.

---

### Task 2: Build the versioned provider registry

**Files:**
- Create: `src-tauri/src/model_provider.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write Rust RED tests for registry validation and recovery**

Cover:

```rust
#[test]
fn rejects_duplicate_names_case_insensitively_and_more_than_twenty_profiles() { /* exact fixtures */ }

#[test]
fn normalizes_base_url_and_rejects_credentials_query_and_fragment() { /* exact URL cases */ }

#[test]
fn corrupted_registry_is_backed_up_before_any_replacement() { /* temp paths */ }

#[test]
fn failed_atomic_publish_preserves_the_previous_registry() { /* injected writer failure */ }
```

Use explicit paths under `std::env::temp_dir().join("focus-ai-model-provider-tests").join(case_id)` and delete only individual test files during cleanup. Do not connect to app data or Windows Credential Manager.

- [ ] **Step 2: Run Rust tests and confirm RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml model_provider --locked
```

Expected: FAIL because the module/types are absent.

- [ ] **Step 3: Implement registry types and strict validation**

Define:

```rust
const REGISTRY_VERSION: u8 = 1;
const MAX_PROFILES: usize = 20;
const MAX_REGISTRY_BYTES: u64 = 128 * 1024;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderRegistryV1 {
    version: u8,
    profiles: Vec<ProviderProfile>,
    pending_credential_deletes: Vec<String>,
}
```

Use `uuid = { version = "=1.24.0", features = ["v4"] }` and `url = "=2.5.8"`, which are already present in the locked dependency graph. Extend the existing `windows-sys = 0.61.2` declaration only with `Win32_Storage_FileSystem`; do not change its version. Validate UUIDs, ISO timestamps, unique case-folded names, bounded strings, pending-delete membership and all URL rules before publishing.

- [ ] **Step 4: Implement safe file behavior**

`ModelProviderStore::initialize(app)` resolves `<app-data>/model-providers-v1.json`, ensures the app-data directory exists, and constructs the store only. It must not read or parse the registry, so a corrupt registry cannot block desktop shell startup. On the first `load`, reject files over 128 KiB. A malformed file is first copied byte-for-byte to `model-providers-recovery-v1.json` before any replacement; if backup fails, return an explicit settings error, leave the original untouched, and do not replace it. `publish` writes a sibling `.tmp`, calls `sync_all`, validates the just-written bytes, then atomically publishes it. On Windows, use `ReplaceFileW` when the destination exists and `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` for the first publish; never implement replacement as delete-then-rename. Wrap this operation in a `RegistryPublisher` trait so unit tests can deterministically fail before publication and prove the old bytes remain.

- [ ] **Step 5: Register managed state without commands yet**

In `main.rs`:

```rust
let provider_store = model_provider::ModelProviderStore::initialize(app.handle())
    .map_err(std::io::Error::other)?;
app.manage(provider_store);
```

- [ ] **Step 6: Run GREEN and locked dependency checks**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml model_provider --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Expected: exit 0 without downloading or updating the lock file.

---

### Task 3: Add per-profile Windows credential isolation

**Files:**
- Create: `src-tauri/src/provider_credential_store.rs`
- Modify: `src-tauri/src/model_provider.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write credential target and validation RED tests**

```rust
#[test]
fn target_is_namespaced_by_canonical_uuid() {
    assert_eq!(
        credential_target("550e8400-e29b-41d4-a716-446655440000").unwrap(),
        "com.focusai.taskmanager/model-provider/550e8400-e29b-41d4-a716-446655440000"
    );
}

#[test]
fn rejects_non_uuid_ids_and_secret_control_characters() {
    assert!(credential_target("../minimax-api-key").is_err());
    assert!(validate_provider_secret("abc\r\nInjected").is_err());
    assert!(validate_provider_secret(&"x".repeat(4097)).is_err());
}
```

Also add an interface test proving no `provider_read_api_key` command is registered in `main.rs`.

- [ ] **Step 2: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml provider_credential_store --locked
```

Expected: missing module/functions.

- [ ] **Step 3: Implement the credential module**

Expose Rust-internal functions only:

```rust
pub fn exists(profile_id: &str) -> Result<bool, String>;
pub(crate) fn read(profile_id: &str) -> Result<Option<String>, String>;
pub fn save(profile_id: &str, api_key: String) -> Result<(), String>;
pub fn delete(profile_id: &str) -> Result<(), String>;
```

Validate canonical UUID before constructing the target. Accept 1–4096 bytes for custom provider keys, reject NUL/CR/LF and all Unicode whitespace, and zero secret byte buffers immediately after `CredWriteW` or request construction. Non-Windows builds return `unsupported` without storing plaintext.

- [ ] **Step 4: Add a testable backend boundary**

Provider lifecycle code must depend on:

```rust
trait ProviderCredentials: Send + Sync {
    fn exists(&self, profile_id: &str) -> Result<bool, String>;
    fn save(&self, profile_id: &str, secret: String) -> Result<(), String>;
    fn delete(&self, profile_id: &str) -> Result<(), String>;
}
```

Use `WindowsProviderCredentials` in Tauri and an in-memory implementation in unit tests. Never expose `read` through this public lifecycle trait; only the HTTP executor may use the crate-private read function.

- [ ] **Step 5: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml provider_credential_store --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Expected: exit 0.

---

### Task 4: Implement provider CRUD and failure-safe cleanup

**Files:**
- Modify: `src-tauri/src/model_provider.rs`
- Modify: `src-tauri/src/main.rs`
- Create: `app/services/model-provider.ts`
- Create: `tests/unit/model-provider-service.spec.ts`

- [ ] **Step 1: Write Rust lifecycle RED tests**

Cover exact observable behavior:

```rust
#[test]
fn remote_create_publishes_missing_key_profile_then_can_rekey() { /* registry + fake creds */ }

#[test]
fn localhost_profile_is_callable_without_a_key() { /* http localhost */ }

#[test]
fn delete_removes_profile_before_secret_and_persists_cleanup_on_failure() { /* ordered events */ }

#[test]
fn cleanup_retry_removes_tombstone_only_after_secret_delete() { /* fake failure then success */ }

#[test]
fn lifecycle_queue_recovers_after_a_failed_operation() { /* fail first, succeed second */ }
```

- [ ] **Step 2: Write frontend command-contract RED tests**

Mock `@tauri-apps/api/core` and assert exact commands/bodies for:

```ts
listModelProviders()
createModelProvider({ name, baseUrl, modelId, apiKey })
updateModelProvider(id, { name, baseUrl, modelId })
replaceModelProviderCredential(id, apiKey)
deleteModelProvider(id)
retryModelProviderCredentialCleanup(id)
```

Assert returned objects never contain `apiKey`, `credential`, `authorization` or raw secret material.

- [ ] **Step 3: Run RED suites**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml model_provider --locked
pnpm exec vitest run tests/unit/model-provider-service.spec.ts --reporter=verbose --hookTimeout=180000
```

- [ ] **Step 4: Implement lifecycle commands**

Public DTO:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfileDto {
    id: String,
    name: String,
    base_url: String,
    model_id: String,
    has_credential: bool,
    is_local: bool,
    created_at: String,
    updated_at: String,
}
```

Register exact commands:

```rust
model_provider::model_provider_list,
model_provider::model_provider_create,
model_provider::model_provider_update,
model_provider::model_provider_replace_api_key,
model_provider::model_provider_delete,
model_provider::model_provider_retry_credential_cleanup,
```

All mutations acquire the store mutex, parse the latest registry, perform one lifecycle operation, publish, then return sanitized DTOs. On app initialization, retry `pendingCredentialDeletes` without blocking startup when Windows returns a recoverable deletion error; expose the remaining cleanup state in the list response.

- [ ] **Step 5: Implement strict TypeScript schemas and wrappers**

```ts
export const modelProviderProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(40),
  baseUrl: z.string().url(),
  modelId: z.string().min(1).max(160),
  hasCredential: z.boolean(),
  isLocal: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()
```

Each wrapper must reject non-desktop use with a stable Chinese error and parse all results. Only create/rekey functions accept an `apiKey`; no getter returns one.

- [ ] **Step 6: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml model_provider --locked
pnpm exec vitest run tests/unit/model-provider-service.spec.ts --reporter=verbose --hookTimeout=180000
pnpm typecheck
```

---

### Task 5: Build the safe OpenAI-compatible transport

**Files:**
- Create: `src-tauri/src/openai_compatible.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Write URL and local-auth RED tests**

Exact accepted/rejected table:

```rust
assert!(normalize_base_url("https://api.openai.com/v1").is_ok());
assert!(normalize_base_url("http://127.0.0.1:11434/v1/").is_ok());
assert!(normalize_base_url("http://[::1]:1234/v1").is_ok());
assert!(normalize_base_url("http://api.example.com/v1").is_err());
assert!(normalize_base_url("https://user:pass@example.com/v1").is_err());
assert!(normalize_base_url("https://example.com/v1?q=1").is_err());
assert!(normalize_base_url("https://example.com/v1#fragment").is_err());
```

- [ ] **Step 2: Write a loopback HTTP harness before transport code**

Use `std::net::TcpListener::bind("127.0.0.1:0")` in a test helper. Capture request line, headers and body, then return controlled responses. Tests must prove:

- request path is exactly `<base path>/chat/completions`;
- remote/key profiles send one Bearer header and logs/errors never contain the key;
- local/no-key profiles send no Authorization header;
- a 302 response is returned as a safe redirect error and the second location is never contacted;
- empty choices, non-string content, oversized body and timeout are rejected;
- a valid response returns content plus normalized usage.

- [ ] **Step 3: Run RED**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml openai_compatible --locked
```

- [ ] **Step 4: Implement bounded transport**

In `Cargo.toml`, retain the existing locked `reqwest` version `0.13.4` and add only its already-locked `stream` feature to support the 2 MiB chunk limit. Do not change the version or update the lock file from the network.

Use:

```rust
let client = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .connect_timeout(Duration::from_secs(10))
    .timeout(Duration::from_secs(90))
    .build()?;
```

Build the URL by appending one `chat/completions` path segment pair to the validated base URL. Limit response bytes to 2 MiB while reading chunks; reject a larger `Content-Length` before reading and abort when accumulated bytes cross the limit. Request body uses `stream: false`; normal calls preserve the existing completion limit/prompt parameters, while connection tests send only `max_tokens: 8` and `user: Reply with OK.`.

Map errors to stable categories: authentication/authorization, model-not-found, incompatible endpoint, timeout/TLS/network, redirect, malformed response and local service unavailable. Include HTTP status and at most 240 sanitized characters; redact exact secret and strings matching Authorization/Bearer patterns.

- [ ] **Step 5: Run GREEN**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml openai_compatible --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

---

### Task 6: Route brief and Agent requests through a trusted model target

**Files:**
- Modify: `src-tauri/src/minimax.rs`
- Modify: `src-tauri/src/openai_compatible.rs`
- Modify: `src-tauri/src/model_provider.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `app/services/minimax.ts`
- Create: `tests/unit/ai-provider-routing.spec.ts`

- [ ] **Step 1: Write frontend routing RED tests**

Assert exact invoke payloads:

```ts
await generateAiBrief(context, { kind: 'minimax', modelId: 'MiniMax-M3' })
expect(invoke).toHaveBeenCalledWith('ai_generate_brief', {
  request: { context, target: { kind: 'minimax', modelId: 'MiniMax-M3' } },
})

await askAi(context, '整理任务', { kind: 'custom', profileId: PROFILE_ID })
expect(invoke).toHaveBeenCalledWith('ai_ask', {
  request: { context, question: '整理任务', target: { kind: 'custom', profileId: PROFILE_ID } },
})
```

Assert no request payload contains `baseUrl` or `apiKey`.

- [ ] **Step 2: Write Rust target and strict-plan RED tests**

Cover:

- MiniMax target delegates to reviewed region endpoint and validates M3.
- Custom target looks up the profile by UUID and ignores any unknown request fields.
- Missing/deleted profile fails before any network call.
- Remote profile without credential fails before network; local profile without credential proceeds.
- Valid custom answer and brief reuse the same strict normalization as MiniMax.
- A response with one invalid action rejects the entire proposal; no action is dropped.
- Model labels in returned `MiniMaxBrief`/`MiniMaxAnswer` are owned `String` values equal to the actual selected model ID.

- [ ] **Step 3: Run RED**

```powershell
pnpm exec vitest run tests/unit/ai-provider-routing.spec.ts tests/unit/minimax-context.spec.ts --reporter=verbose --hookTimeout=180000
cargo test --manifest-path src-tauri/Cargo.toml ai_ --locked
```

- [ ] **Step 4: Implement discriminated Rust requests**

```rust
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum AiModelTarget {
    Minimax { model_id: String },
    Custom { profile_id: String },
}
```

`ai_generate_brief` and `ai_ask` validate context/question first, resolve the target, call the appropriate transport, then invoke the existing `parse_json_content`, `normalize_brief`, `normalize_agent_actions` and `resolve_sources`. Change response `model` fields from `&'static str` to `String` without changing JSON names.

Register:

```rust
minimax::ai_generate_brief,
minimax::ai_ask,
model_provider::model_provider_test_connection,
```

The connection-test command resolves only the stored profile ID and returns `{ ok, modelId, latencyMs }`; it receives no workspace context.

- [ ] **Step 5: Implement provider-neutral frontend wrappers**

Keep `buildMiniMaxWorkspaceContext` for compatibility, but export:

```ts
export async function generateAiBrief(
  context: MiniMaxWorkspaceContext,
  target: AiModelTarget,
): Promise<MiniMaxBrief>

export async function askAi(
  context: MiniMaxWorkspaceContext,
  question: string,
  target: AiModelTarget,
): Promise<MiniMaxAnswer>
```

Parse returned actions with `parseMiniMaxAgentActions`; do not create a custom-provider bypass around the Agent draft schema.

- [ ] **Step 6: Run GREEN**

```powershell
pnpm exec vitest run tests/unit/ai-provider-routing.spec.ts tests/unit/minimax-context.spec.ts tests/unit/agent-plan-schema.spec.ts --reporter=verbose --hookTimeout=180000
cargo test --manifest-path src-tauri/Cargo.toml minimax --locked
cargo test --manifest-path src-tauri/Cargo.toml openai_compatible --locked
pnpm typecheck
```

---

### Task 7: Build the provider management dialog

**Files:**
- Create: `app/components/app/ModelProviderDialog.vue`
- Modify: `app/assets/css/interaction-uplift.css`
- Create: `tests/unit/model-provider-dialog.spec.ts`

- [ ] **Step 1: Write mounted UI RED tests**

Mount with `attachTo: document.body` and clean up every wrapper. Cover:

- list renders name/model/base URL/status but never a Key;
- create form enforces name/Base URL/model/key rules;
- remote create requires Key, localhost create permits empty Key;
- editing metadata does not ask for or send the old Key;
- rekey uses a password input that clears after success;
- delete requires a second explicit click and removes the corresponding profile;
- deleting the selected profile emits a fallback event;
- cleanup failure remains visible with a retry button;
- test connection requires an explicit click, locks against double-click and renders success/error without selecting the profile;
- Escape/close returns focus to the opener and cannot close while a mutation is in flight.

- [ ] **Step 2: Run RED**

```powershell
pnpm exec vitest run tests/unit/model-provider-dialog.spec.ts --reporter=verbose --hookTimeout=180000
```

- [ ] **Step 3: Implement the dialog around one draft form**

Use this form state and never hydrate a secret:

```ts
type ProviderForm = {
  id: string | null
  name: string
  baseUrl: string
  modelId: string
  apiKey: string
}
```

Editing an existing profile sets `apiKey: ''`. Submit create sends the Key once; submit edit sends only name/baseUrl/modelId. Rekey is a separate call and form. Every async handler sets its lock before the first `await` and clears it in `finally`.

The test-connection copy must be exactly clear that the click sends a minimal request and may incur a small charge. Saving metadata must contain copy that it does not connect.

- [ ] **Step 4: Apply readable Huly styling**

CSS contracts:

```css
.model-provider-dialog { font-size: 16px; }
.model-provider-dialog__meta,
.model-provider-dialog small { font-size: 13px; }
.model-provider-dialog input,
.model-provider-dialog select,
.model-provider-dialog button { min-height: 40px; }
```

Use the existing dark rail/light canvas visual language, hairline separators and compact rows. At widths below 900px, render as a bottom sheet with `max-height: calc(100dvh - 64px)` and a sticky action bar; do not shrink text.

- [ ] **Step 5: Run GREEN and typecheck**

```powershell
pnpm exec vitest run tests/unit/model-provider-dialog.spec.ts --reporter=verbose --hookTimeout=180000
pnpm typecheck
```

---

### Task 8: Integrate custom targets into the MiniMax panel

**Files:**
- Modify: `app/components/app/ConnectedContextPanel.vue`
- Modify: `app/services/minimax.ts`
- Modify: `app/services/ai-model-target.ts`
- Modify: `tests/unit/minimax-panel.spec.ts`
- Modify: `tests/unit/minimax-agent-plan-integration.spec.ts`

- [ ] **Step 1: Write integration RED tests**

Cover real mounted behavior:

- built-in selector shows M3 first and custom profiles in a separate optgroup;
- legacy M2 selection remains selected after upgrade;
- choosing a custom profile persists only `{ kind: 'custom', profileId }`;
- custom profile readiness depends on localhost or `hasCredential`, not MiniMax status/region;
- generate brief and ask call provider-neutral wrappers with the selected target;
- custom Agent actions still call `agentPlan.setDraft` and make zero workspace CRUD/replace calls before review;
- deleted/missing selected profile falls back to M3 and persists fallback;
- manager open/close focus and profile refresh work;
- all current MiniMax key/region/model behavior and voice input remain operational.

Add a source contract that rejects any `workspace.create*`, `workspace.update*`, `workspace.delete*`, `workspace.replaceWorkspaceDocument`, raw `fetch`, custom `baseUrl` or `apiKey` in the panel request path.

- [ ] **Step 2: Run RED**

```powershell
pnpm exec vitest run tests/unit/minimax-panel.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts --reporter=verbose --hookTimeout=180000
```

- [ ] **Step 3: Replace `selectedModel` with `selectedTarget`**

Use:

```ts
const selectedTarget = ref<AiModelTarget>(DEFAULT_AI_MODEL_TARGET)
const providers = ref<ModelProviderProfile[]>([])

const selectedTargetInfo = computed(() => selectedTarget.value.kind === 'minimax'
  ? builtInTargetInfo(selectedTarget.value.modelId)
  : customTargetInfo(selectedTarget.value.profileId, providers.value))
```

At mount: load Agent draft, load target, fetch MiniMax status and provider list independently. A custom target does not require MiniMax credentials. A built-in target retains current region/setup UI. `generateBrief` and `submitQuestion` call `generateAiBrief`/`askAi`; plan construction uses the returned actual model string unchanged.

- [ ] **Step 4: Integrate the management dialog**

Add a “管理模型 API” button next to the selector. On `profilesChanged`, refresh the list. On `selectedProfileDeleted`, save/select M3, clear stale brief/answer/proposal presentation, and show a stable informational message rather than silently changing while a request is running.

- [ ] **Step 5: Run GREEN and relevant regressions**

```powershell
pnpm exec vitest run tests/unit/minimax-panel.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts tests/unit/agent-plan-state.spec.ts tests/unit/agent-plan-execution-ui.spec.ts --reporter=verbose --hookTimeout=180000
pnpm typecheck
```

---

### Task 9: Lock settings preservation, credential absence and compatibility

**Files:**
- Modify: `tests/unit/clear-workspace-data-dialog.spec.ts`
- Modify: `tests/unit/agent-plan-storage.spec.ts`
- Modify: `tests/unit/sqlite-workspace-gateway.spec.ts`
- Modify: `src-tauri/src/model_provider.rs`
- Modify: `src-tauri/src/provider_credential_store.rs`

- [ ] **Step 1: Add cross-feature RED contracts**

Tests must prove:

- `clearWorkspaceData()` clears business document and Agent draft but leaves v2 target selection and provider registry untouched;
- Agent draft schemas reject provider registry, endpoint, region and credential fields;
- workspace JSON/SQLite backups contain no provider profile or credential material;
- listing/exporting provider profiles never includes secret values;
- moving `focus-ai.db` or workspace JSON to another machine cannot carry a custom Key;
- existing MiniMax credential target and region remain unchanged by custom provider CRUD.

- [ ] **Step 2: Run RED or confirm existing behavior is already GREEN**

```powershell
pnpm exec vitest run tests/unit/clear-workspace-data-dialog.spec.ts tests/unit/agent-plan-storage.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts --reporter=verbose --hookTimeout=180000
cargo test --manifest-path src-tauri/Cargo.toml credential --locked
```

If a new assertion is already GREEN because the architecture already separates settings, record that as a characterization test; do not force an artificial production change.

- [ ] **Step 3: Apply only required compatibility fixes**

Allowed fixes are limited to excluding new provider keys from workspace clear/export/import and retaining legacy MiniMax targets. Do not add provider data to `WorkspaceDocument`, `focus-ai.db` workspace JSON, Agent drafts or Supabase schemas.

- [ ] **Step 4: Run GREEN**

```powershell
pnpm exec vitest run tests/unit/clear-workspace-data-dialog.spec.ts tests/unit/agent-plan-storage.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts --reporter=verbose --hookTimeout=180000
cargo test --manifest-path src-tauri/Cargo.toml credential --locked
pnpm typecheck
```

---

### Task 10: Final verification and independent review

**Files:**
- Create: `.superpowers/sdd/2026-08-14-openai-compatible-providers/task-10-report.md`
- Modify only if verification exposes a scoped regression.

- [ ] **Step 1: Verify no live-service path is used**

Read-only search:

```powershell
rg -n "apiKey|Authorization|baseUrl|providerProfile" app tests src-tauri/src --glob '!**/target/**'
```

Inspect every hit. Confirm no key appears in Vue refs after a successful save, persisted target JSON, workspace JSON, Agent draft, error logs or command responses.

- [ ] **Step 2: Run all focused feature suites**

```powershell
pnpm exec vitest run tests/unit/minimax-model-selection.spec.ts tests/unit/ai-model-target.spec.ts tests/unit/model-provider-service.spec.ts tests/unit/model-provider-dialog.spec.ts tests/unit/ai-provider-routing.spec.ts tests/unit/minimax-panel.spec.ts tests/unit/minimax-agent-plan-integration.spec.ts tests/unit/agent-plan-schema.spec.ts tests/unit/agent-plan-state.spec.ts tests/unit/clear-workspace-data-dialog.spec.ts tests/unit/agent-plan-storage.spec.ts tests/unit/sqlite-workspace-gateway.spec.ts --reporter=verbose --hookTimeout=180000
```

Expected: all selected files and tests pass.

- [ ] **Step 3: Run full frontend verification serially**

```powershell
pnpm exec vitest run --reporter=verbose --hookTimeout=180000
pnpm typecheck
pnpm build
```

Expected: all exit 0. Existing upstream Node deprecation warnings may be reported but must not be described as build failures.

- [ ] **Step 4: Run full Rust verification serially**

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo check --manifest-path src-tauri/Cargo.toml --locked
```

Expected: all tests pass and check exits 0. Do not download formatters or other components if `cargo fmt --check` is unavailable on this Windows toolchain.

- [ ] **Step 5: Perform isolated UI acceptance only if safe**

Before browser work, confirm an existing reachable dev listener and a fixture mode that cannot read/write user SQLite, localStorage credentials or provider settings. If either condition is absent, report visual acceptance as not verified and do not start a second dev process.

If safe, test 1440px and 899px widths with fixture profiles only:

- M3 selected by default on a fresh fixture.
- custom provider list/create/edit/rekey/delete/test states;
- no Key value rendered after save;
- grouped selector and fallback after deletion;
- 16px body, 13px metadata, 40px controls and non-overlapping mobile sheet.

- [ ] **Step 6: Request independent broad review**

Review must inspect these Critical/Important axes:

- credential exfiltration via injected URL, redirect or logs;
- profile/credential lifecycle partial failures;
- local HTTP and remote HTTPS boundary;
- strict whole-plan rejection for custom providers;
- no direct workspace write before Agent confirmation;
- legacy MiniMax settings migration and M3 default;
- clear/export/import credential separation;
- double-click/concurrent mutation safety;
- UI readability and destructive confirmations.

Do not close the feature until the verdict is Critical 0 / Important 0 or all findings have completed TDD fix/re-review rounds.

- [ ] **Step 7: Write the final report**

Record exact commands, exit codes, test totals, files changed, independent verdict and explicit limitations. State that real MiniMax/custom-provider credentials and production services were not used. Do not claim installer or live-model acceptance.
