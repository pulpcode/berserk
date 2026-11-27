# 技术设计：多对话模型选择与默认模型机制优化

> 状态：已按用户批准决策锁定最终方案（正式模式个人偏好存后端 SQLite、测试模式回退 `localStorage`；新建草稿默认不可用时自动预选首个可用模型并给温和提示）。

## 1. 设计目标与架构边界

在现有 `ModelSettingsStore`、`PiLab`、原生 Pi 会话 `berserk.model-selection.v1` 和前端 `useChat` / `ModelPicker` / `Settings` 基础上做增量演进：

* **遵循既有架构约定**：
  * 复用 Pi 公开 SDK 与 `ModelRuntime` 注册表，不新增平行运行时或配置体系。
  * 延续 `model-thinking.md` 的 CAS 版本号、写锁互斥（`reserveModelSettingsUpdate`）、`beforeRename` 权限复检、凭证脱敏和原子落盘契约。
  * 复用既有「个人偏好」设置模式（参考 `/api/me/preferences/expert` 与 `Settings.tsx`）。

---

## 2. 后端设计

### 2.1 `model-settings.json` Schema 8 演进（指针化 `defaultModelId`）

当前 schema 7 结构（[model-settings.ts](../../../experiments/harness-lab/src/server/model-settings.ts#L165-L169)）：
```json
{
  "schemaVersion": 7,
  "version": "<uuid>",
  "platforms": [...],
  "credentials": { "platform:<id>": "..." },
  "models": [{ "id": "default", ... }, { "id": "<uuid>", ... }]
}
```

升级为 **schema 8**（只增不破坏既有模型 ID）：
```json
{
  "schemaVersion": 8,
  "version": "<uuid>",
  "defaultModelId": "default" | "<uuid>",
  "platforms": [...],
  "credentials": { "platform:<id>": "..." },
  "models": [{ "id": "default", ... }, { "id": "<uuid>", ... }]
}
```

**核心兼容性与数据不变量**：
1. **向后读取兼容（Schema 1–7 → 内存态）**：
   * 读取旧版 schema 1–7 时不急切重写磁盘；内存中 `defaultModelId` 固定解析为 `'default'`。
   * 首次发生写操作时原子写入 schema 8。
2. **`models` 列表存储结构**：
   * 将 `ModelSettingsStore` 内部从 `(current: StoredSettings, profiles: Map<string, StoredSettings>)` 重构为统一的 `profiles: Map<string, StoredSettings>` + `defaultModelId: string` + `version: string`（保持 `models` 序列化顺序稳定）。
   * `defaultModelId` 必须满足 `^(default|<uuid-v4>)$` 且必须指向 `profiles` 中存在的模型 ID（解码校验失败抛出 `MODEL_SETTINGS_INVALID`）。
   * 保留老配置文件中已有的 `id === 'default'` 模型记录，不强行重命名其 ID——这样历史上已落盘的 `berserk.model-selection.v1`（或未写该条目而回退 `'default'` 的旧会话）仍然精准指向原来的模型配置，不会在升级或切默认后发生历史漂移。
3. **删除平台与默认模型保护**：
   * `deletePlatform(id, expectedVersion)` 改为检查 `modelIds.includes(this.defaultModelId)`（不再硬编码 `'default'`）。
   * 若系统默认已切换到平台 B 的模型 B1，则平台 A（即使持有旧的 `id === 'default'` 记录）允许被管理员删除；删除后，若仍有老会话引用已删模型 ID，按既有契约保持历史只读并提示用户改选模型。
4. **旧单数模型路由兼容**：
   * `GET /api/settings/model` 和 `PUT /api/settings/model` 改为读写 `this.settings.defaultModelId()` 指向的模型（不再硬编码 `'default'`）。
5. **公开返回契约扩展**（[contracts/index.ts](../../../experiments/harness-lab/src/contracts/index.ts#L236-L238)）：
   * `ModelChoices` 已有 `defaultModelId: string`，直接返回真实的 `this.defaultModelId`。
   * `ModelCatalog` 增加 `defaultModelId: string`，供管理员界面高亮当前系统默认、判断平台是否包含系统默认。

### 2.2 管理员切换系统默认模型 API

* **路由**：`PUT /api/settings/default-model`（使用独立路径彻底避免与 `/api/settings/models/:id` 中 `:id = 'default'` 产生路径歧义）。
  * 挂载 `requireModelSettings` 管理员守卫（复用既有管理员身份校验与 `authorizeModelSettings`）。
  * **同步更新 `auth.ts`**：`modelSettingsPath` 正则放行 `/api/settings/default-model`。
* **请求体**：
  ```ts
  { expectedVersion: string; modelId: string }
  ```
  （Schema 校验：`additionalProperties: false`，`expectedVersion` 为 uuid，`modelId` 复用 `^(default|<uuid-v4>)$`）。
* **校验与执行链路（`PiLab.setDefaultModel(modelId, expectedVersion, authorize)`）**：
  1. `reserveModelSettingsUpdate(authorize)`：检查全局锁、无活跃前台/后台请求、管理员身份有效。
  2. `this.settings.prepareDefaultModel(modelId, expectedVersion)`：
     * 校验 `expectedVersion` CAS（冲突返回 `409 MODEL_SETTINGS_CONFLICT`）。
     * 校验 `modelId` 存在（不存在返回 `404 MODEL_NOT_FOUND`）。
     * 校验目标模型当前**可用**（与 `requestModel` 一致：未启用或未确认用途返回 `503 MODEL_UNAVAILABLE`、缺 Key 返回 `503 MODEL_NOT_CONFIGURED`、缺容量参数返回 `400 MODEL_CONTEXT_REQUIRED`）。
     * 校验 `this.runtimes.get(modelId)` 已就绪。
  3. 原子提交 `this.settings.saveDefaultModel(...)`（含 `beforeRename` 权限与磁盘内容复检），生成新 `version`。
  4. 同步发布内存态：`this.currentConfig = { ...this.currentConfig, ...this.settings.config(modelId) }`，并中止所有会话正在进行的 `prediction` / `workAnalysis`。
  5. 返回最新 `ModelCatalog`（含更新后的 `version` 与 `defaultModelId`）。

### 2.3 新建会话与后台作业的 `defaultModelId` 解析

* **后台作业 / 预处理 / Service 会话**（[lab.ts](../../../experiments/harness-lab/src/pi/lab.ts#L673)、[L1168](../../../experiments/harness-lab/src/pi/lab.ts#L1168)、[L1866](../../../experiments/harness-lab/src/pi/lab.ts#L1866)）：
  * 将硬编码的 `'default'` 全部替换为 `this.settings.defaultModelId()`。
  * 后台执行严格无视任何用户个人默认模型。
* **新建前台会话固化 `modelId`**（[lab.ts](../../../experiments/harness-lab/src/pi/lab.ts#L535-L620)）：
  * `createSession` 入参中 `modelId` 仍为可选；若调用方未传，解析为 `resolvedModelId = modelId ?? this.settings.defaultModelId()`。
  * 校验 `this.requestModel(resolvedModelId)`（注意在 `settingsUpdating` 期间返回 `settingsBusy()`），并将 `resolvedModelId` 纳入 `capabilities.reserveCreation` 的 `input` 摘要，保证幂等重试一致。
  * 在 `createSessionInternal` 中**总是显式写入**一条 `MODEL_SELECTION` 记录 `{ schemaVersion: 1, workspaceId, sessionId, modelId: resolvedModelId }`。
  * **重要兼容性注意**：检查 `createSessionInternal` 中断恢复分支（[lab.ts](../../../experiments/harness-lab/src/pi/lab.ts#L604-L611)）与历史无 `MODEL_SELECTION` 会话的打开逻辑（[model-selection.ts](../../../experiments/harness-lab/src/pi/model-selection.ts#L16-L22)）：
    * 新建会话总是写入 `MODEL_SELECTION`，因此永久固化当时模型，不再受后续切换系统默认影响；
    * 旧版本留存的未写 `MODEL_SELECTION` 会话，在 `selectedModelId()` 中依然回退为 `'default'`（旧默认槽位），保持原模型归属不漂移。
* **启动加载 `PiLab.create`**（[lab.ts](../../../experiments/harness-lab/src/pi/lab.ts#L275-L295)）：
  * 读取 `const defaultId = settings.defaultModelId()`；
  * `config = { ...config, ...settings.config(defaultId) }`；
  * 若调用方注入了测试 `runtime`，注册到 `lab.runtimes.set(defaultId, runtime)`；其余 `settings.catalog().models` 各自构建并注册 `configuredRuntime`。

### 2.4 用户级「个人默认模型」偏好持久化

正式登录模式使用后端 SQLite 持久化（对齐 `/api/me/preferences/expert` 范式），无登录测试席位模式由前端自动回退至 `localStorage`。

* **共享契约**（[contracts/index.ts](../../../experiments/harness-lab/src/contracts/index.ts)）：
  ```ts
  export type UserModelPreferenceChoice =
    | { mode: 'system' }
    | { mode: 'model'; modelId: string };

  export interface UserModelPreference {
    revision: number;
    choice: UserModelPreferenceChoice;
  }

  export interface UserModelPreferenceUpdate {
    expectedRevision: number;
    choice: UserModelPreferenceChoice;
  }
  ```
* **SQLite 存储**（在 `AccessStore` 初始化建表，与 `accounts` / `auth_sessions` 同库，见 [access/store.ts](../../../experiments/harness-lab/src/access/store.ts#L58-L64)）：
  ```sql
  CREATE TABLE IF NOT EXISTS user_model_preferences (
    user_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK(revision >= 0),
    data TEXT NOT NULL CHECK(json_valid(data))
  );
  ```
  * 主键为 `user_id`（`accountIdentityOf(request).userId`），天然覆盖业务席位账号和管理员账号，按账号严格隔离。
  * 无记录时 `GET` 返回 `{ revision: 0, choice: { mode: 'system' } }`。
* **API 路由**（[app.ts](../../../experiments/harness-lab/src/server/app.ts) & [auth.ts](../../../experiments/harness-lab/src/server/auth.ts)）：
  * `GET /api/me/preferences/model`：仅正式登录模式（`lab.access` 存在）生效，返回当前账号的 `UserModelPreference`。
  * `PUT /api/me/preferences/model`：
    * Schema 校验：`additionalProperties: false`，`expectedRevision`（非负整数），`choice`（`{ mode: 'system' }` 或 `{ mode: 'model', modelId }`，其中 `modelId` 匹配 `^(default|<uuid-v4>)$`）。
    * 权限与安全：`auth.ts` 的 `personalPath` 增加 `path === '/api/me/preferences/model'`，使管理员个人空间和业务席位均可访问，同时强制走登录态、Origin、CSRF 与 `X-Axon-View` 校验；`authValid?.()` 复检当前账号有效。
    * 可用性校验：当 `choice.mode === 'model'` 时，校验 `this.settingsUpdating` 非忙且 `this.requestModel(choice.modelId)` 通过（禁止把停用/未配置/不存在的模型设为个人默认）；`choice.mode === 'system'` 始终允许。
    * 并发校验：在事务内比对 `current.revision === input.expectedRevision`，不一致抛出 `409 PREFERENCE_CONFLICT`（`个人默认模型已在其他页面更新，请刷新后重试。`）；一致则写入 `revision + 1` 并返回最新 `UserModelPreference`。
* **无登录测试席位模式（`!lab.access`）**：
  * 前端在 `identity` 不存在时（即无正式登录模式），不请求 `/api/me/preferences/model`，直接读写 `localStorage`（key 为 `storageKey('berserk.user-default-model')`），保持与正式模式完全一致的 `UserModelPreference` 接口语义。

---

## 3. 前端设计

### 3.1 统一的新建模型解析纯函数（单一事实源）

新增 `experiments/harness-lab/src/web/model-default.ts`，集中封装全部默认解析逻辑与降级提示：

```ts
export type NewSessionModelSource =
  | 'draft'
  | 'user_default'
  | 'system_default'
  | 'fallback_available'
  | 'unavailable';

export interface ResolvedNewSessionModel {
  modelId: string;
  model?: ModelChoice;
  source: NewSessionModelSource;
  notice?: string; // 仅在发生降级（个人默认失效 / 系统默认失效兜底预选）时产出温和提示
}
```

解析规则 `resolveNewSessionModel(models, userPreference, draftModelId?)`：
1. `isUsable(m)`: `Boolean(m && m.configured && m.contextReady && m.available !== false)`。
2. 若传入了 `draftModelId`（仅聊天页/任务首页草稿显式手动选过）：
   * 返回 `{ modelId: draftModelId, model: find(draftModelId), source: 'draft' }`（保留用户显式选中的草稿项；若草稿选后该模型被删/停用，仍按既有草稿失效提示，不静默替换用户刚手动点的模型）。
3. 否则调用 `resolveBaseDefaultModel(models, userPreference)`：
   * 若 `userPreference?.mode === 'model'`：
     * 找到 `userModel = find(userPreference.modelId)`；
     * 若 `isUsable(userModel)` → 返回 `{ modelId: userModel.id, model: userModel, source: 'user_default' }`；
     * 否则记录个人默认失效文案（如 `你设为默认的模型已删除/暂不可用，已切换为系统默认…`），继续向下降级。
   * 检查系统默认 `sysModel = find(models.defaultModelId)`：
     * 若 `isUsable(sysModel)` → 返回 `{ modelId: sysModel.id, model: sysModel, source: 'system_default', ...(userNotice ? { notice: userNotice } : {}) }`。
   * 兜底查找 `firstAvailable = models.models.find(isUsable)`：
     * 若存在 → 返回 `{ modelId: firstAvailable.id, model: firstAvailable, source: 'fallback_available', notice: '默认模型暂不可用，已为你预选「平台－模型」。' }`。
   * 全部不可用 → 返回 `{ modelId: models.defaultModelId, model: sysModel, source: 'unavailable' }`。

### 3.2 个人偏好 Hook（`useModelPreference.ts`）

新增 `experiments/harness-lab/src/web/useModelPreference.ts`：
* 入参：`enabled: boolean`、`authenticated: boolean`（正式登录态）。
* 正式模式：通过 `GET /api/me/preferences/model` 读取，窗口 `focus` 时静默刷新；修改时 `PUT /api/me/preferences/model`（携带 `expectedRevision`，若遇 `409` 自动刷新最新偏好并提示）。
* 非登录测试模式：读写 `localStorage`（key 为 `storageKey('berserk.user-default-model')`），解析失败安全回退 `{ mode: 'system' }`。
* 暴露：`preference`、`saving`、`error`、`refresh`、`setPersonalDefault(modelId)`、`resetToSystemDefault()`。

### 3.3 统一 6 个新建会话入口（消除草稿串味）

在 `useChat.ts` 中显式区分“带草稿的新建”与“直接新建”：

| 入口 | 行为 | 传入 `POST /api/sessions` 的 `modelId` |
| :--- | :--- | :--- |
| 聊天页新建对话（发首条消息） | `create(workspaceId)`（`useDraft: true`）读取 `draftModels['workspace:' + wsId]` → 走 `resolveNewSessionModel` | 解析出的可用 `modelId`；创建后清除 `draftModels['workspace:' + wsId]` |
| 任务首页新建对话（`TaskHome`） | `create(workspace.id, undefined, { draftKey: 'task-home:' + taskId, navigate: false })` → 走 `resolveNewSessionModel` | 解析出的可用 `modelId`；创建后清除 `draftModels['task-home:' + taskId]` |
| 工作待办新建会话（`WorkInbox`） | `create(workspace.id, detail.id, { useDraft: false })` | 直接走 `resolveBaseDefaultModel`（**不读取、不清除**聊天页草稿） |
| 态势地图「引用并提问」 | `create(workspaceId, undefined, { useDraft: false })` | 直接走 `resolveBaseDefaultModel`（**不读取、不清除**聊天页草稿） |
| 标注派生新会话（`deriveAnnotations`） | `create(target, undefined, { useDraft: false, navigate: false })` | 直接走 `resolveBaseDefaultModel` |
| 能力中心「与专家协作」（`createExpertChat`） | 调用 `chat.resolveDefaultModelId()` | 显式传解析出的可用 `modelId`（全部不可用时仍不传由服务端统一拦截） |

### 3.4 `ModelPicker` 桌面端 Popover 升级

改造 [ModelPicker.tsx](../../../experiments/harness-lab/src/web/ModelPicker.tsx)（参考 [NewSession.tsx](../../../experiments/harness-lab/src/web/NewSession.tsx) 的浮层键盘与外部点击关闭模式）：

* **触发器按钮**：
  * 保持输入框底部工具栏右侧紧凑样式（`max-width: min(55%, 240px)`，溢出省略），保留 `aria-label="选择模型"`、`aria-haspopup="dialog"` / `listbox`、`aria-expanded`、`title="仅用于当前对话"`。
* **向上弹出的 Popover 面板**（适配桌面窗口缩放与三栏分屏，不溢出视口）：
  * **搜索框**：当 `models.models.length >= 6` 时显示，按 `platformName`、`provider`、`displayName`、`model` 大小写不敏感过滤。
  * **顶部默认策略状态条**：
    * 处于跟随系统默认：`新对话默认：跟随系统默认（平台－模型）`；
    * 已设个人默认：`新对话默认：我的默认（平台－模型）` + 右侧次按钮「恢复跟随系统默认」。
  * **按平台分组列表**：
    * 每行主体按钮（点击切换当前会话/草稿，选后关闭 Popover）：显示模型名、勾选图标、`系统默认` 徽标、`我的默认` 徽标、以及不可用状态文案（`未配置` / `待补齐参数` / `不可用`，置灰不可点击）。
    * 每行右侧独立次按钮（仅对可用模型显示，阻止触发行点击且不强制关闭菜单以便反馈）：`设为默认`（若已是我的默认则显示 `取消默认`，点击切回跟随系统默认）。
  * **键盘与错误反馈**：支持 `Escape` 关闭并焦点回触发器、上下方向键遍历选项、点击面板外关闭；个人默认保存中禁用默认按钮并就地展示轻量错误提示（不干扰当前对话选模）。
* **温和提示与历史会话快捷恢复**：
  * 新建对话草稿发生自动降级（个人默认失效回退系统默认 / 默认模型不可用兜底预选首个可用模型）时，在输入框上方以温和状态条（`role="status"`）展示 `resolution.notice`。
  * 历史对话所选模型被删/停用/未配置完整时，延续既有提示与阻止发送规则，同时在提示条增加按钮 **「改用默认模型」**（仅在存在可用默认/兜底模型且会话空闲、未保存中时可用），点击后调用 `chat.chooseModel(baseDefault.modelId)` 一键恢复。

### 3.5 设置页同步联动

* **个人偏好**（[Settings.tsx](../../../experiments/harness-lab/src/web/Settings.tsx#L63-L73)）：
  * 新增 `ModelDefaultPreferences` 组件（与 `ExpertDefaultPreferences` 并排），展示「跟随系统默认（当前：平台－模型）」及全部可用模型；若当前保存的个人默认已不可用，明确提示“当前个人默认模型不可用，新建对话将自动回退到系统默认”。
  * 与 `useChat` 共享同一份 `useModelPreference` 状态，确保在设置页或模型选择器任意一处修改后立即全局同步。
* **模型管理（管理员）**（[ModelCatalogSettings.tsx](../../../experiments/harness-lab/src/web/ModelCatalogSettings.tsx#L174-L230)）：
  * 平台列表的 `含系统默认` 徽标与平台详情的删除保护均以 `model.id === catalog.defaultModelId` 判断（不再硬编码 `'default'`）。
  * 模型行中：当前默认模型显示 `系统默认` 徽标；其他 `model.available === true` 的模型显示「设为系统默认」按钮，调用 `PUT /api/settings/default-model`，成功后更新目录并触发 `saved()` 刷新前台 `models`。

---

## 4. 风险、兼容性与回滚

1. **旧数据与回滚**：
   * 首次写入 `model-settings.json` schema 8 后，若回退到旧版服务端代码，旧代码不识别 `schemaVersion: 8`，需要配对停服备份（符合 `model-thinking.md` 既有约定）。
   * 仅读取未写入时不会改写磁盘 schema 7 文件。
2. **多标签页并发与鉴权**：
   * 系统默认切换走全局 `expectedVersion` CAS + `reserveModelSettingsUpdate` 写锁 + `beforeRename` 复检；
   * 个人默认保存走 `expectedRevision` 并发校验 + Origin/CSRF/`X-Axon-View` 校验 + 窗口 `focus` 静默刷新。
3. **既有测试适配**：
   * `tests/e2e/model-selection.spec.ts` 中若通过原生 `select` 操作模型选择器，升级为 Popover 后需同步更新定位方式，保持清晰的语义 `aria-label` 与可测试性。
