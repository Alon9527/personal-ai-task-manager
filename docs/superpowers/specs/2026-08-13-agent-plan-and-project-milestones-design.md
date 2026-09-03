# Agent 计划确认中心与项目里程碑设计

日期：2026-08-13  
状态：已完成产品设计确认，等待规格审阅  
适用工程：Focus AI 个人任务管理器（Nuxt + Tauri + 本机 SQLite）

## 1. 背景

当前 MiniMax 面板能够回答工作区问题，并能返回少量任务操作，但仍存在以下问题：

- AI 只能操作任务，不能建立项目和真正的项目里程碑。
- 整批操作只能一次确认，用户不能逐项取消或编辑。
- 操作逐条执行，中途失败可能留下只完成一部分的数据。
- 当前“里程碑”只是部分页面对季度目标的展示称呼，并非独立业务实体。
- AI 面板空间较窄，不适合审阅复杂计划。
- 未确认计划在应用关闭后无法可靠延续。

本设计将 MiniMax 从问答面板升级为受控的本地计划 Agent：模型只提出结构化草案，本地应用负责审阅、校验、确认和原子执行。

## 2. 产品原则

1. 先计划，后确认，再执行。
2. AI 不直接写入业务数据。
3. 所有操作必须可见、可选、可编辑、可解释。
4. 整批操作要么全部成功，要么零改动。
5. 删除仅允许软删除，永久删除永远不暴露给 Agent。
6. 当前以单电脑、本机数据为主，同时保留未来接入飞书和云同步的扩展边界。

## 3. 目标

- 支持 Agent 创建和修改项目、项目里程碑与任务。
- 支持 Agent 完成记录及将记录移入回收站。
- 提供 Huly 风格的宽屏计划确认中心。
- 支持逐项勾选、取消、编辑和依赖调整。
- 保存未确认草案，应用重启后可继续审阅。
- 对数据变化进行冲突检测，避免覆盖用户的新修改。
- 让项目进度、下一里程碑和逾期节点成为真实可跟踪数据。
- 保持本地存储、SQLite 桌面存储和备用 Supabase 实现的领域模型一致。

## 4. 非目标

- 本轮不接入飞书多维表格、飞书日历或多电脑云同步。
- 本轮不让 Agent 发送消息、操作网页或执行其他外部工具。
- 本轮不实现后台无人值守 Agent。
- 本轮不允许 Agent 清空回收站或永久删除。
- 本轮不制作新的安装包；完成后使用桌面热更新开发模式验证。

## 5. 领域模型

### 5.1 工作区文档版本

工作区文档由 `version: 2` 升级为 `version: 3`：

```ts
interface WorkspaceDocumentV3 {
  version: 3
  projects: Project[]
  milestones: Milestone[]
  tasks: Task[]
  quarterGoals: QuarterGoal[]
}
```

`v2 -> v3` 迁移规则：

- 保留全部项目、任务和季度目标。
- 为项目补齐新增字段的默认值。
- 为任务补齐 `milestoneId: null`。
- 初始化 `milestones: []`。
- 不把季度目标自动转换为项目里程碑，避免制造错误归属。

### 5.2 项目

在现有 `Project` 基础上新增：

```ts
type ProjectStatus = 'planned' | 'active' | 'paused' | 'completed'

interface Project {
  // 现有字段保留
  description: string
  priority: 'low' | 'medium' | 'high' | null
  status: ProjectStatus
  targetDate: string | null
}
```

默认值：

- `description = ''`
- `priority = null`
- `status = 'active'`
- `targetDate = null`

项目进度不直接保存为独立真值，而是由关联数据计算，避免与任务状态失去同步。

### 5.3 项目里程碑

```ts
type MilestoneStatus = 'planned' | 'in_progress' | 'blocked' | 'completed'
type MilestoneProgressMode = 'auto' | 'manual'

interface Milestone {
  id: string
  ownerId: string
  projectId: string
  title: string
  description: string
  targetDate: string | null
  status: MilestoneStatus
  progressMode: MilestoneProgressMode
  progress: number
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}
```

约束：

- `projectId` 必须指向未删除项目。
- 标题长度为 1 到 160 个字符。
- 说明最多 4000 个字符。
- 进度范围为 0 到 100。
- `auto` 模式下，显示进度由未删除的关联任务完成比例计算。
- `manual` 模式下，显示保存的 `progress`。
- 自动模式没有关联任务时显示 0%。
- 状态变为 `completed` 时显示 100%；从完成状态恢复时重新按当前模式计算。

### 5.4 任务

任务新增：

```ts
milestoneId: string | null
```

约束：

- 里程碑必须存在且未删除。
- 任务的 `projectId` 必须与里程碑的 `projectId` 一致。
- 将任务更换到其他项目时，如果原里程碑不属于新项目，则自动清除 `milestoneId`。
- 将任务绑定里程碑时，项目归属同步为该里程碑所属项目。

### 5.5 项目进度

- 项目存在未删除里程碑时：取所有里程碑显示进度的算术平均值并四舍五入。
- 项目没有里程碑时：使用项目内未删除任务的完成比例。
- 项目既没有里程碑也没有任务时：显示 0%。
- 项目状态为 `completed` 时显示 100%。

## 6. CRUD、软删除与恢复

### 6.1 里程碑 CRUD

所有 Workspace Gateway 增加：

- `createMilestone`
- `updateMilestone`
- `deleteMilestone`
- `restoreMilestone`
- `reorderMilestones`

对应实现覆盖：

- LocalWorkspaceGateway
- DesktopWorkspaceGateway
- ApiWorkspaceGateway
- SupabaseWorkspaceRepository
- Nuxt Server API 与校验 Schema

### 6.2 级联软删除

- 删除项目：软删除项目、其未删除里程碑和未删除任务，使用同一 `deletedAt` 时间戳。
- 恢复项目：恢复与项目删除时间戳一致的里程碑和任务，不恢复此前单独删除的数据。
- 删除里程碑：软删除里程碑；关联任务保留，但清除其 `milestoneId`，项目归属不变。
- 恢复里程碑：恢复里程碑；不自动重新绑定曾经的任务，避免覆盖删除后产生的新归属。
- 删除任务：沿用现有软删除行为。
- 清空回收站：永久移除已软删除的项目、里程碑、任务和季度目标。
- 清空工作区数据：清除以上业务数据和未确认 Agent 草案，保留 MiniMax/API/UI 设置。

## 7. Agent 操作协议

### 7.1 操作类型

结构化动作扩展为：

- `createProject`
- `updateProject`
- `setProjectCompleted`
- `deleteProject`
- `createMilestone`
- `updateMilestone`
- `setMilestoneCompleted`
- `deleteMilestone`
- `createTask`
- `updateTask`
- `setTaskCompleted`
- `deleteTask`

每项动作都必须包含：

- 唯一 `actionId`
- 简短 `reason`
- 目标类型与操作类型
- 要写入的字段
- 对现有数据操作时的目标 ID 和 `expectedUpdatedAt`
- 对草案中新建数据的依赖引用

### 7.2 草案引用

同一计划中，后续动作可通过 `draftRef` 引用前面新建的数据，例如：

```text
project:website-redesign
milestone:homepage-review
task:information-architecture
```

本地执行器在确认执行时生成真实 UUID 并解析引用。模型不能自行指定真实 UUID。

### 7.3 模型边界

- 模型只返回结构化操作草案，不接触 Workspace Gateway。
- 模型不能声明永久删除动作。
- 无法解析、超出枚举范围或字段非法的动作会被拒绝并显示到具体项目。
- 用户在确认中心手动修改草案不会再次调用模型。
- 只有点击“让 AI 重新规划”才产生新的模型请求和 token 消耗。

## 8. 草案持久化

保存独立的 `AgentPlanDraftV1`，内容包括：

- 原始用户问题
- 使用模型
- 创建与更新时间
- 动作清单
- 每项勾选状态
- 用户编辑后的字段
- 依赖关系
- 生成计划时涉及记录的 `updatedAt`
- 当前校验结果与计划状态

不保存：

- MiniMax API Key
- 模型内部推理过程
- Windows 凭据内容

状态包括：

- `draft`
- `conflicted`
- `applied`
- `failed`

未确认草案保存于本机应用数据，桌面应用重启后自动恢复。执行成功或用户明确放弃后移除待确认草案。清空工作区数据时也必须清除草案。

## 9. 原子执行与冲突检测

采用原子化工作区事务，不逐条直接提交到持久层。

执行顺序：

1. 读取最新完整工作区。
2. 校验所有已选动作、字段、引用和删除确认状态。
3. 对更新、完成、删除动作比较 `expectedUpdatedAt`。
4. 在内存副本中按依赖拓扑排序执行动作。
5. 对生成结果运行完整 `WorkspaceDocumentV3` Schema 校验。
6. 一次写入 LocalStorage 或桌面 SQLite 工作区文档。
7. 写入成功后刷新 WorkspaceModel，并返回逐项结果。

任何步骤失败：

- 不保存副本。
- 真实数据保持原样。
- 草案保持可编辑状态。
- UI 定位第一个失败动作，并显示所有校验问题。

冲突处理：

- 目标不存在、已在回收站或 `updatedAt` 变化时标记冲突。
- 冲突计划禁止执行。
- 用户可以按当前真实数据重新载入该项，或让 AI 重新规划。
- 不静默覆盖较新的本地修改。

## 10. 删除安全

- Agent 的 `delete*` 语义始终是“移入回收站”。
- 删除动作在草案中默认不勾选，并显示红色危险样式。
- 用户勾选任意删除动作后，最终执行前出现第二次确认。
- 二次确认明确列出将被移入回收站的项目、里程碑和任务数量。
- 项目级删除同时展示会被级联软删除的子项数量。
- Agent API 与执行器都不定义永久删除动作。

## 11. 确认中心 UI

采用已确认的“A：审阅清单 + 右侧编辑器”。

### 11.1 入口

- MiniMax 右侧面板继续承载问答。
- 有结构化计划时显示摘要和“审阅计划”按钮。
- 不在狭窄右栏直接堆放完整表单。

### 11.2 宽屏布局

- 顶部：计划标题、模型、生成时间、操作总数和冲突状态。
- 左侧：按项目、里程碑、任务分组的动作清单。
- 每项包含复选框、操作类型、标题、关键时间、优先级和原因。
- 点击某项后，右侧显示与真实 CRUD 表单一致的字段编辑器。
- 底部固定栏显示选中数量、预计任务总时长、危险操作数量和确认按钮。

### 11.3 窄屏布局

- 清单保持全宽。
- 编辑器改为底部抽屉。
- 固定操作栏不得遮挡最后一项内容。

### 11.4 字号和视觉

- 正文以 16px 为基准。
- 主要标题不低于 20px。
- 辅助信息不低于 13px。
- 控件点击高度不低于 40px。
- 延续第一版 Huly 风格：深色工具区、紧凑分隔线、清晰层级，减少无意义大卡片。

### 11.5 依赖交互

- 取消新项目时，要求选择“同时取消下属项”或“保留下属项并重新归属”。
- 取消新里程碑时，关联任务可保留在项目下或重新绑定。
- 不能留下指向未选草案项的悬空引用。

## 12. 项目跟踪 UI

项目详情增加“进度与里程碑”区域：

- 项目总体进度。
- 下一里程碑及剩余天数。
- 逾期与阻塞里程碑。
- 里程碑下的任务完成情况。
- 里程碑真实创建、编辑、完成、软删除和恢复入口。

Today 页面增加：

- 临近里程碑提醒。
- 逾期里程碑提醒。
- 点击提醒进入对应项目详情。

季度目标保持独立，不再在业务文案中冒充项目里程碑。

## 13. 执行结果与提示

- 成功后展示实际创建、修改、完成和移入回收站的记录。
- WorkspaceModel 立即刷新，项目和任务列表必须显示真实结果。
- 成功提示约 8 秒后消失，不长期遮挡界面。
- 错误提示可关闭，并与失败动作关联。
- 执行结果不得使用模拟数据或仅前端假状态。

## 14. 存储实现边界

### 14.1 本机 SQLite

当前 SQLite 物理层保存单份 `workspace_document.document_json`。

- 不需要拆分或重建物理业务表。
- SQLite `user_version` 可保持不变，因为物理 Schema 未改变。
- `document_version` 升为 3。
- Rust 校验器必须要求 `milestones` 数组，并继续校验项目、任务和季度目标数组存在。
- 桌面持久化仍使用一次事务写入单份文档，满足原子提交要求。

### 14.2 本地浏览器模式

- LocalWorkspaceGateway 使用同一 `v3` Schema 和迁移逻辑。
- 原子执行先在结构化副本完成，最后只调用一次持久化。

### 14.3 Supabase 备用实现

虽然当前阶段不启用登录和云同步，仓库中的 Supabase 路径仍需保持可编译和领域一致：

- 增加 `milestones` 表及索引。
- `tasks` 增加可空 `milestone_id` 外键。
- `projects` 增加新的跟踪字段。
- 增加里程碑 CRUD、软删除、恢复和排序 RPC/REST 支持。
- 更新清空回收站与清空工作区 SQL，将里程碑纳入范围。
- 不访问或修改任何生产数据库；仅提交项目内 SQL 迁移文件和测试。

## 15. 扩展边界

本地执行器采用工具注册结构：

- 本轮只注册 Workspace 数据工具。
- 工具声明自身输入 Schema、危险级别、校验器和执行函数。
- 未来飞书多维表格或日历工具必须继续经过同一确认中心。
- 外部工具不得绕过用户确认和危险操作规则。

## 16. 测试与验收

### 16.1 数据与迁移

- `v1 -> v3`、`v2 -> v3` 无损迁移。
- 新字段默认值正确。
- Schema 拒绝悬空项目/里程碑关系。
- Rust 文档校验接受 v3、拒绝缺失 `milestones` 的 v3 文档。

### 16.2 CRUD 与软删除

- 项目、里程碑、任务完整创建、读取、修改、删除、恢复。
- 项目级联软删除和同批恢复正确。
- 单独删除的子项不会被项目恢复误恢复。
- 删除里程碑后任务保留且解除绑定。
- 清空回收站和清空工作区覆盖里程碑。

### 16.3 Agent

- 解析所有动作类型。
- 正确解析草案临时引用。
- 逐项选择与编辑生效。
- 危险动作默认不选并要求二次确认。
- 中途校验或持久化失败时零改动。
- `updatedAt` 冲突阻止执行。
- 关闭和重开应用后恢复未确认草案。
- 执行成功后清除待确认草案并刷新真实数据。

### 16.4 UI

- 宽屏为清单加右侧编辑器。
- 窄屏编辑器为底部抽屉。
- 字号和点击区域达到设计下限。
- 键盘可选择项目、编辑字段和确认执行。
- 成功/撤销提示不会永久停留。

### 16.5 验证命令

- 定向 Vitest 单元测试。
- 全量单元测试。
- TypeScript 类型检查。
- Nuxt 生产构建。
- Rust `cargo test` 与 `cargo check`。
- `pnpm desktop:dev` 桌面开发版冒烟验证。

不在本轮构建或安装发布版安装包。

## 17. 实施顺序建议

1. 工作区 v3 Schema、迁移和领域计算。
2. 里程碑及项目扩展字段的 Gateway CRUD。
3. 软删除、恢复、清空与 Supabase SQL。
4. 项目详情和 Today 里程碑 UI。
5. MiniMax 动作协议与严格解析。
6. 可持久化 Agent 草案。
7. 确认中心 UI 与依赖编辑。
8. 原子执行、冲突检测与删除二次确认。
9. 全量验证和桌面开发版冒烟测试。
