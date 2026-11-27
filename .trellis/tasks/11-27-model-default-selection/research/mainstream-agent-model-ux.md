# 主流 Agent 模型选择与默认模型交互调研

日期：2026-11-27  
任务：`11-27-model-default-selection`

## 1. 主流产品横向对比

| 产品 | 默认模型配置层 | 会话内切换是否改写默认 | 新建对话默认策略 | 选择器与扩展特性 | 社区反馈 / 教训 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Claude Code** (CLI / Desktop) | `--model` / `ANTHROPIC_MODEL` > 项目/企业策略 > `~/.claude/settings.json` | 会话内 `/model` 及 `low/medium/high` effort 会持久化；`max` effort 仅单会话生效并自动回落 | 读取持久化配置；可用环境变量锁死默认 | 模型与推理强度（Effort）合并选择器 + `/model` 命令 | 临时切换容易污染后续默认，高成本档位单次生效防误伤设计值得借鉴 |
| **Codex** (CLI / Desktop App) | `--model` > `.codex/config.toml` > `~/.codex/config.toml` | CLI `/model` **静默回写 `~/.codex/config.toml`** | 继承配置层级；Desktop 中项目级 `config.toml` 常覆盖线程选择器 | 组合式 Model + Reasoning 控件 | 临时切换静默污染全局默认、Desktop 与项目配置抢控制权是典型反面案例 |
| **DeepSeek Harness (`dsh`)** | `~/.dsh/settings.yaml` / profile 中的 `agent-default-model` | 文案称“仅当前会话”，但早期版本（如 `0.2.x`）会副作用改写全局 `agent-default-model` | 继承全局 `agent-default-model`（含后台循环/定时任务） | Web UI 下拉框 + Models 设置页 | 单会话切换污染全局导致后台任务/定时任务涨价，是最直接的前车之鉴 |
| **OpenCode** (TUI / Desktop / Web) | `--model` > `opencode.json` (`model`) > Recent / 内置优先级 | **严格仅作用于当前会话**，不回写配置文件 | 优先配置默认，其次 Recent；支持 Per-Agent 模型与 `small_model` | 命令面板式弹窗：搜索 + Recent + Favorites + 按 Provider 浏览 | “会话内切换”与“修改默认”职责分离清晰，适合多平台多模型目录 |

## 2. 本仓库现状与代码锚点

* **系统默认模型固定在 `id === 'default'` 槽位**：
  * `experiments/harness-lab/src/server/model-settings.ts:186-198`：`choices()` 写死 `defaultModelId: 'default'`。
  * `experiments/harness-lab/src/server/model-settings.ts:285-295`：删除平台时检查 `modelIds.includes('default')`。
  * `experiments/harness-lab/src/web/ModelCatalogSettings.tsx:176-225`：管理界面仅标记 `model.id === 'default'` 为“系统默认”，无法一键将其他已有模型设为系统默认。
* **会话级模型持久化（做得好的基础）**：
  * `experiments/harness-lab/src/pi/model-selection.ts:6-22`：在 Pi 原生会话 jsonl 中通过 `berserk.model-selection.v1` 追加记录，读取时取最后一条；无记录时回退 `'default'`。
  * `experiments/harness-lab/src/pi/lab.ts:439-455`：`selectModel` 校验空闲、无 `recoveryWarning`、模型可用后追加条目。
  * `experiments/harness-lab/src/pi/lab.ts:673, 1168, 1866`：后台作业和预处理强制走默认模型，与前台对话解耦。
  * **潜在隐患**：`experiments/harness-lab/src/pi/lab.ts:608-611` 创建会话时若未传 `modelId`，不写 `MODEL_SELECTION`；若未来切换系统默认指针，需保证老会话历史不漂移且新会话显式固化所用 `modelId`。
* **前端草稿与多入口现状**：
  * `experiments/harness-lab/src/web/useChat.ts:84-86, 123, 366-393, 435-463`：草稿态模型存于 `sessionStorage`（`berserk.draft-models`），创建会话后即删除该 key，导致下次新建对话无条件回到 `'default'`。
  * 多入口新建语义不统一：
    * 聊天页新建（`workspace:<id>`）和任务首页新建（`task-home:<id>`）有 `ModelPicker`，每次用完清空。
    * 能力中心 `createExpertChat`（`src/web/main.tsx:617-631`）与标注派生 `deriveAnnotations`（`src/web/main.tsx:563-571`）固定不带草稿模型，走 `'default'`。
    * 工作待办 `WorkInbox`（`src/web/WorkInbox.tsx:174`）与地图引用 `prepareMapConversation`（`src/web/main.tsx:527-553`）直接调用 `chat.create(workspaceId)` 且未传独立 `draftKey`，会误消费聊天页残余的 `workspace:<id>` 草稿模型。
* **既有个人偏好先例**：
  * `experiments/harness-lab/src/web/Settings.tsx:57-73` 已有「个人偏好」设置页签。
  * `experiments/harness-lab/src/web/ExpertDefaults.tsx:60` 与 `experiments/harness-lab/src/server/capability-management-routes.ts:113` 已有 `/api/me/preferences/expert` 个人默认专家模式（带版本并发保护与明确作用域说明）。
  * `experiments/harness-lab/src/server/auth.ts:66-73` 通过 `personalPath` 允许管理员个人空间与业务席位访问个人类路径。

## 3. 核心结论

1. **必须保持的边界**：单次对话内切模型绝不静默改写默认；后台任务与预处理强制走系统默认；历史对话模型失效不静默回退。
2. **应补齐的三块能力**：
   * 管理员侧支持将任意可用模型一键「设为系统默认」（`defaultModelId` 指针化），彻底解决默认模型停服/欠费时切换繁琐的问题。
   * 用户侧支持显式「个人默认模型」（初始态为“跟随系统默认”），入口同时放在**模型选择器行内**和**设置 → 个人偏好**中，避免默认模型欠费或个人有常驻偏好时每次新建对话重复切换。
   * 统一全站 6 个新建会话入口的默认解析顺序，修复待办/地图引用误吞聊天草稿模型的问题，并在默认模型不可用时提供友好兜底预选与一键改用默认按钮。
