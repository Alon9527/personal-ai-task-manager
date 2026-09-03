# MiniMax M3 与多 OpenAI 兼容模型供应商设计

日期：2026-08-14  
状态：待用户最终确认

## 1. 目标

在不削弱现有“AI 只生成计划、用户确认后才写入工作区”安全边界的前提下：

1. 正式支持官方模型 `MiniMax-M3`，并将其作为新安装或无有效历史选择时的默认模型。
2. 允许用户新增、编辑、删除和切换最多 20 套 OpenAI 兼容模型配置。
3. 每套配置的 API Key 独立保存在 Windows 凭据管理器中，不进入工作区、计划草稿、日志、导出文件或前端可读状态。
4. 支持无需 API Key 的本机 Ollama、LM Studio 等 OpenAI 兼容服务。
5. 保留现有 MiniMax 国内/国际区域、旧模型选择和 Agent 计划审阅流程。

## 2. 非目标

- 本阶段不原生适配 Anthropic Messages、Gemini GenerateContent 等非 OpenAI 协议。
- 不支持自定义请求头、查询参数、代理脚本或供应商插件。
- 不自动发现或同步供应商模型列表；模型 ID 由用户明确填写。
- 不把 API Key 随工作区迁移到另一台电脑。
- 不调用真实用户密钥进行开发验收，不访问真实 MiniMax、OpenAI 兼容服务或 Supabase。
- 不生成安装包；源码和桌面开发模式验证完成后，由用户决定何时制作发行版。

## 3. 用户体验

### 3.1 模型选择

AI 右侧面板的模型选择器分为两组：

- `MiniMax`：M3、M2.7、M2.7 高速版、M2.5、M2.5 高速版及现有兼容旧模型。
- `自定义模型`：显示“配置名称 / 模型 ID”。

`MiniMax-M3` 是新默认值。若用户已有 `personal-ai-minimax-model:v1` 的有效选择，则首次升级时保留该选择，不强制切换到 M3。

选择器旁提供“管理模型 API”入口。当前选中的自定义配置被删除后，选择自动回退到 `MiniMax-M3`。

### 3.2 供应商管理窗口

窗口提供配置列表与新增/编辑表单。每套配置包含：

- 配置名称：1–40 个字符，去除首尾空白后不允许与其他配置名称重复，比较时忽略大小写。
- Base URL：OpenAI 兼容 API 的根地址，例如 `https://api.openai.com/v1` 或 `http://127.0.0.1:11434/v1`。
- 模型 ID：1–160 个字符，例如 `gpt-5-mini`、`deepseek-chat`、`qwen3:8b`。
- API Key：远程服务必填；本机回环地址可留空。

交互规则：

- 保存配置不联网。
- 已保存的 API Key 永不回显，只显示“已安全保存”。
- 编辑名称、Base URL 或模型 ID 时，不要求重新输入已有 Key。
- “更换 API Key”是独立操作。
- 删除配置需要二次确认；确认后删除配置元数据及对应凭据。
- “测试连接”是显式联网动作。按钮旁明确说明会发送一次最小请求并可能产生少量费用；测试不会生成计划、修改任务或改变当前选择。
- 本机无 Key 配置显示“本机服务，无凭据”。

管理窗口延续当前 Huly 工作台视觉：正文不低于 16px、辅助信息不低于 13px、输入框和按钮高度不低于 40px；不使用缩小字体容纳更多字段。

### 3.3 调用结果

- 普通问答读取 OpenAI 兼容响应中的 `choices[0].message.content`。
- 今日简报和 Agent 请求继续使用现有结构化提示及严格计划 Schema。
- 模型返回 Markdown 代码围栏时，只允许围栏内存在一个完整 JSON 对象；未知字段、丢失动作、超过 30 项、非法引用或部分可解析计划均整提案拒绝。
- 无论使用 MiniMax 还是自定义模型，模型都没有直接工作区写权限。合法计划必须持久化到审阅页，用户确认后才进行一次原子替换。

## 4. 数据模型与持久化

### 4.1 非敏感配置

Rust 管理版本化设置文件：

`<app-data>/model-providers-v1.json`

文件结构：

```ts
type ModelProviderRegistryV1 = {
  version: 1
  profiles: Array<{
    id: string
    name: string
    baseUrl: string
    modelId: string
    createdAt: string
    updatedAt: string
  }>
  pendingCredentialDeletes: string[]
}
```

约束：

- `id` 由 Rust 生成 UUID，更新时不可修改。
- 最多 20 项；未知字段、重复 ID、重复名称、无效时间戳或超长文件均拒绝。
- `hasCredential` 只存在于 Rust 返回给前端的只读 DTO 中，并从凭据存储状态派生，不写入 registry。
- `pendingCredentialDeletes` 最多 20 项，只能包含已不在 profiles 中的 UUID；用于在删除凭据失败后安全重试。
- 写入采用同目录临时文件、完整校验、原子替换；失败时保留旧文件。
- 损坏文件不被静默覆盖。原始内容先写入单一有界恢复文件，再返回明确错误。

### 4.2 凭据

每套自定义配置使用独立 Windows Credential Manager target：

`com.focusai.taskmanager/model-provider/<profile-uuid>`

Rust 仅暴露“保存、替换、删除、是否存在”能力；绝不向前端暴露读取密钥的命令。

内置 MiniMax 继续使用现有凭据和区域存储，避免升级后要求用户重新输入 Key。

### 4.3 当前选择迁移

新增本地选择键 `personal-ai-model-selection:v2`：

```ts
type ModelSelection =
  | { kind: 'minimax', modelId: MiniMaxModel }
  | { kind: 'custom', profileId: string }
```

加载顺序：

1. 解析有效的 v2 选择。
2. 若没有 v2，读取旧 `personal-ai-minimax-model:v1`；有效时迁移为内置 MiniMax 选择。
3. 其余情况使用 `{ kind: 'minimax', modelId: 'MiniMax-M3' }`。
4. 自定义 profile 不存在时回退 M3，并覆盖失效选择。

## 5. Rust 安全边界

### 5.1 可信调用目标

前端调用自定义模型时只传 `profileId` 和业务请求，不传 Base URL、模型 ID或 API Key。Rust 从已验证 registry 中读取 URL/模型，并按 profile ID 从 Windows 凭据管理器读取密钥，防止前端临时替换域名后借用已存密钥。

### 5.2 URL 规则

- 将 Base URL 标准化为无末尾 `/` 的 URL，并固定请求 `<baseUrl>/chat/completions`。
- 禁止 URL 中的用户名、密码、查询参数和 fragment。
- 远程地址只允许 HTTPS。
- HTTP 只允许主机名 `localhost`、IP `127.0.0.1` 或 `[::1]`；端口和路径可自定义。
- 本机 HTTP 配置允许无 Key；远程 HTTPS 配置必须存在 Key 才能调用。
- HTTP 客户端禁止自动重定向，避免 Authorization 被转发至另一来源。
- DNS、连接、TLS 和总请求均设置超时；响应体设置硬上限。

### 5.3 请求与日志

- 使用标准 `POST /chat/completions`、Bearer Authorization、JSON messages。
- 未配置 Key 的本机服务不发送 Authorization header。
- “测试连接”发送 `stream: false`、`max_tokens: 8` 和单条 `user: Reply with OK.`，只验证能够获得非空文本响应；不附带任何工作区上下文。
- 日志不得包含 Key、Authorization、完整请求正文、完整响应正文或用户工作区上下文。
- 对外错误经过裁剪和净化，不回传服务端可能反射出的密钥或大段响应。

## 6. 服务边界

前端新增统一 AI target 层，调用方不再判断供应商：

```ts
type AiModelTarget =
  | { kind: 'minimax', modelId: MiniMaxModel }
  | { kind: 'custom', profileId: string }
```

统一服务提供：

- `getModelTargets()`
- `generateBrief(context, target)`
- `askWorkspace(question, context, target)`
- `testProvider(profileId)`
- `list/create/update/deleteProvider(...)`
- `replaceProviderCredential(profileId, apiKey)`

内置 MiniMax 继续走受审查的官方 endpoint 与区域逻辑；自定义 target 走 OpenAI 兼容 endpoint。两者在 Rust 内最终复用同一套响应大小限制、结构化计划规范化和安全错误映射。

## 7. 一致性与失败语义

- 新建配置时先验证全部输入并发布非敏感 profile，再保存凭据。远程凭据保存失败时 profile 保持不可调用并显示“需要 API Key”，用户可安全重试；不会产生一个有密钥但无 profile 的孤儿凭据。本机无 Key profile 发布后即可使用。
- 更新配置不允许改变 ID。若只修改元数据，原凭据保持不变。
- 更换 Key 只更新对应 target，不改 registry 其他字段。
- 删除时用一次原子 registry 写入移除 profile 并加入 `pendingCredentialDeletes`，使配置立即不可选；随后删除凭据并再次原子移除清理项。凭据删除失败时显示“配置已停用，但凭据清理失败”，应用下次启动及用户手动重试都会处理该项，已删除配置不能继续调用。
- 同一配置的保存、改 Key、删除与测试连接通过 Rust 串行队列执行，避免交错状态。
- registry 损坏、凭据缺失、模型调用失败均不修改工作区或现有 Agent 草稿。

## 8. 错误文案分类

界面使用稳定中文错误，不直接展示未净化服务端正文：

- API Key 无效或无权访问当前模型。
- 模型 ID 不存在或当前账号不可用。
- Base URL 不是兼容的 OpenAI Chat Completions 接口。
- 连接超时、TLS 或网络不可达。
- 响应不是合法的 OpenAI 兼容格式。
- 模型没有生成完整合法计划；未修改任何任务。
- 本机模型服务未启动。
- 配置已保存，但凭据清理需要重试。

保留 HTTP 状态码和经过裁剪的安全错误摘要，便于排查。

## 9. 测试与验收

### 9.1 前端

- 模型清单包含 M3，默认 M3，旧选择迁移保持。
- 内置与自定义模型分组、切换和失效回退。
- 供应商新增、编辑、换 Key、删除二次确认、最多 20 项。
- Key 不回显，不进入前端持久化、计划草稿和工作区。
- 保存不联网；测试连接只在明确点击时触发且有进行中锁。
- 自定义问答和计划生成均使用 profile ID，不传 URL/Key。
- 清空工作区保留供应商配置和当前模型选择。

### 9.2 Rust

- `MiniMax-M3` 被允许并成为默认；现有 M2 模型仍兼容。
- registry 全量解析、限制、原子写入、损坏隔离和失败回滚。
- 凭据 target 隔离；无任何读取密钥的 Tauri command。
- HTTPS/localhost 规则、URL 标准化和恶意 URL 拒绝。
- 禁止重定向；远程无 Key、localhost 无 Key行为正确。
- profile ID 绑定可信 endpoint，前端无法注入临时 URL。
- 超时、响应上限和安全错误映射。
- OpenAI 标准文本响应、空 choices、非字符串 content、超大响应和非法计划。
- 配置变更并发串行且失败不毒化后续操作。

### 9.3 完成验证

- 聚焦前端与 Rust 单元测试。
- 全量 Vitest。
- `pnpm typecheck`。
- `pnpm build`，不执行桌面安装包构建。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`。
- `cargo check --manifest-path src-tauri/Cargo.toml --locked`。
- 使用模拟 HTTP server 验证 header、路径、重定向、超时和响应，不访问真实模型服务。
- 独立代码审查 Critical 0 / Important 0。

## 10. 验收标准

1. 用户能选择 `MiniMax-M3`，新默认值为 M3，旧选择不被强制覆盖。
2. 用户能管理并切换多套 OpenAI 兼容模型配置。
3. 每套密钥隔离保存且永不回显；远程和本机 URL规则生效。
4. 保存配置不联网；测试连接必须由用户明确触发。
5. 自定义模型可生成普通回答和严格 Agent 计划。
6. 任何解析、凭据、网络或模型错误均不会直接或部分修改工作区。
7. 清空工作区不删除模型配置、模型选择或密钥。
8. 全部自动化验证通过，且不调用真实用户密钥、真实模型或生产数据库。
