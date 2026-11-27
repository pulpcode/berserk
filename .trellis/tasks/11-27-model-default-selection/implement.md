# 执行计划：多对话模型选择与默认模型机制优化

> 状态：方案文档（`prd.md`、`design.md`）已获用户审阅批准。
> 交接说明：本计划供实施 Agent 按序落地功能与测试；全部完成后将由审阅阶段进行全面复核、细节调整与前端视觉交互优化。实施时请先执行 `python3 ./.trellis/scripts/task.py start 11-27-model-default-selection`。

## 1. 有序实施清单

### 阶段 1：共享契约与后端系统默认模型指针化
- [x] 更新 `experiments/harness-lab/src/contracts/index.ts`：
  - `ModelCatalog` 增加 `defaultModelId: string`；
  - 新增 `UserModelPreferenceChoice`、`UserModelPreference`、`UserModelPreferenceUpdate`。
- [x] 更新 `experiments/harness-lab/src/server/model-settings.ts`：
  - 支持读取 schema 1–7（内存中 `defaultModelId = 'default'`）并写入 schema 8（含 `defaultModelId`）；
  - 内部统一以 `profiles: Map<string, StoredSettings>` + `defaultModelId` 管理；
  - 新增 `defaultModelId()`、`prepareDefaultModel(modelId, expectedVersion)`、`saveDefaultModel(...)`；
  - 更新 `deletePlatform`、`choices()`、`catalog()`、`info()`、`config()`、`prepare()`，均以 `this.defaultModelId` 替代硬编码 `'default'`。
- [x] 更新 `experiments/harness-lab/src/pi/lab.ts`、`experiments/harness-lab/src/server/app.ts`、`experiments/harness-lab/src/server/auth.ts`：
  - `PiLab.create` 启动加载 `this.settings.defaultModelId()` 及全部 profile runtime；
  - 新增 `PiLab.setDefaultModel(modelId, expectedVersion, authorize)` 与路由 `PUT /api/settings/default-model`；
  - `auth.ts` 的 `modelSettingsPath` 放行 `/api/settings/default-model`；
  - `PiLab.createSession` 未传 `modelId` 时解析为 `this.settings.defaultModelId()` 并显式持久化 `MODEL_SELECTION`（同时保持历史无 `MODEL_SELECTION` 会话仍解析为 `'default'` 不漂移）；
  - 后台作业/预处理/service 会话改用 `this.settings.defaultModelId()`。

### 阶段 2：用户级个人默认模型后端持久化与前端 Hook
- [x] 在 `experiments/harness-lab/src/access/store.ts` 初始化 `user_model_preferences` 表并提供读写方法（带事务内 `expectedRevision` 并发检查，冲突抛出 `409 PREFERENCE_CONFLICT`）。
- [x] 在 `experiments/harness-lab/src/pi/lab.ts` 新增 `getUserModelPreference(userId)` / `saveUserModelPreference(userId, input)`（`mode === 'model'` 时校验 `requestModel` 与非 `settingsUpdating`）。
- [x] 在 `experiments/harness-lab/src/server/app.ts` 注册 `GET/PUT /api/me/preferences/model`（仅正式登录模式可用），在 `experiments/harness-lab/src/server/auth.ts` 的 `personalPath` 中放行 `/api/me/preferences/model`。
- [x] 新增 `experiments/harness-lab/src/web/useModelPreference.ts`（正式模式走 `/api/me/preferences/model`，无登录测试模式回退 `localStorage` `storageKey('berserk.user-default-model')`）。

### 阶段 3：前端统一默认解析与全入口修复
- [x] 新增 `experiments/harness-lab/src/web/model-default.ts`，实现 `resolveNewSessionModel` 与 `resolveBaseDefaultModel` 纯函数（覆盖草稿 > 个人默认 > 系统默认 > 首个可用兜底预选 + 温和提示 > 全部不可用）。
- [x] 更新 `experiments/harness-lab/src/web/useChat.ts`：
  - 接入 `useModelPreference`（含窗口 `focus` 静默刷新）；
  - 新建对话草稿按统一优先级解析默认模型与温和提示；
  - `create()` 支持显式 `useDraft?: boolean`（默认 `true`，无草稿入口传 `false`）；
  - 暴露 `defaultModelResolution`、`baseDefaultModel` 与共享的 `modelPreference`，由偏好控制器提供显式设置和恢复操作。
- [x] 更新 `experiments/harness-lab/src/web/main.tsx` 的多入口接线和 `TaskHome.tsx` 的草稿交互：
  - 统一聊天页、任务首页、工作待办、态势地图引用、标注派生、能力中心 `createExpertChat` 的新建默认解析，消除待办/地图引用消费聊天页草稿的问题；
  - 新建对话草稿发生降级时展示温和提示条；
  - 历史会话模型失效提示条新增「改用默认模型」快捷按钮。

### 阶段 4：桌面端模型选择器 Popover 与设置页联动
- [x] 升级 `experiments/harness-lab/src/web/ModelPicker.tsx` 及对应样式（`styles.css`）：
  - 保持触发按钮在输入框底部工具栏紧凑占位；
  - 向上弹出桌面端 Popover 菜单，包含顶部默认策略状态条（含一键恢复跟随系统默认）、≥ 6 个模型时关键词过滤、按平台分组列表、`系统默认`/`我的默认` 徽标、不可用状态原因、行尾独立「设为默认/取消默认」动作及完整键盘无障碍交互（Arrow / Enter / Escape / 外部点击关闭）。
- [x] 更新 `experiments/harness-lab/src/web/Settings.tsx`（在「个人偏好」中新增 `ModelDefaultPreferences`，与 `useChat` 同步）与 `experiments/harness-lab/src/web/ModelCatalogSettings.tsx`（模型行增加「设为系统默认」，平台列表与删除保护改读 `catalog.defaultModelId`）。

### 阶段 5：测试、回归与规范更新
- [x] 后端单测/集成测试：
  - `tests/pi/model-settings.test.ts`、`tests/pi/model-platforms.test.ts`、`tests/pi/model-catalog.test.ts`：schema 7→8 兼容读写、切换系统默认 CAS/忙态/可用性校验、旧平台迁出默认后可删除、历史会话不漂移、新会话显式固化 `MODEL_SELECTION`、后台作业跟随新系统默认；
  - `tests/access.test.ts`：管理员切系统默认鉴权（业务席位 403）、`/api/me/preferences/model` 账号隔离、冲突校验与 CSRF/Origin 守卫。
- [x] 前端单测与桌面端 Playwright E2E：
  - 新增 `model-default.ts` 优先级矩阵与降级提示单测；
  - 更新并扩展 `tests/e2e/model-selection.spec.ts`：管理员一键切系统默认、用户在 Popover 与设置页设个人默认并刷新持久、会话内切换不污染默认、个人默认/系统默认失效降级与温和提示、多入口新建不串草稿、历史会话一键「改用默认模型」。
- [x] 更新 `.trellis/spec/backend/model-thinking.md` 与相关前端 spec。

---

## 2. 验证命令

```bash
cd experiments/harness-lab
npm run typecheck
npm run lint
npx vitest run tests/pi/model-settings.test.ts tests/pi/model-platforms.test.ts tests/pi/model-catalog.test.ts tests/access.test.ts
npm run build
npx playwright test tests/e2e/model-selection.spec.ts
```

（完整收敛前补跑全量 Vitest 回归以确认无回归影响。）

### 2026-11-27 实施验证

- 在已检出 `feat/model-default-selection` 的现有工作区完成实现，任务保持 `in_progress`，待代码复核。
- `typecheck`、`lint`、`build` 与桌面 `model-selection.spec.ts` 的 10 项测试通过。检查了模型设置、任务首页、专家协作、待办和标注入口的相关用例。
- 全量 Vitest 2115 项通过，HTTP 心跳用例的调用次数断言在基线 `7fafbc0` 上复现。补测的空间分析保存标注和普通会话模型调用计数用例也在同一基线复现。
- 兼容离线标注准备流程。原始默认槽未配置 Key 且 API 调用省略模型 ID 时仍可创建空会话，发送时继续校验模型可用性。

### 4316 发布记录

2026-11-27 14:42（北京时间），用户授权更新线上 4316。现役服务切换至 `axon-model-default-20261127T064232Z-d0190a70`，源码快照 SHA-256 为 `d0190a70d71386ce5bc6c5169376a567701aec026ef80798fa9094a015669e80`。沿用原启动脚本、沙盒运行时和持久数据路径。

候选通过 66 项 Linux 定向测试、类型检查、Lint 和生产构建。在线上数据副本中验证正式登录、历史任务和会话读取，以及模型目录和个人偏好接口。切换后核对健康检查、登录入口和线上前端资源，确认 96 份既有会话历史、7 个账号和 45 个任务保留。SQLite 检查通过，个人偏好表已建立，原模型配置内容保留。停服备份、上一版指针信息和验证回执保存在 `/srv/axon-archive/axon-model-default-20261127T064232Z-d0190a70`。

### 2026-11-27 复核优化与 4316 更新

2026-11-27 15:16（北京时间），按用户要求将复核修复与前端优化（消除全不可用时重复提示条、修复个人默认设置加载闪烁、草稿切回默认时解除草稿锁定、升级 `ModelPicker` 徽标/高亮/搜索回车/行尾降噪与 `ModelCatalogSettings` 默认标签样式）更新至线上 4316。

- 现役发布切换至 `axon-model-default-20261127T071000Z-738dee04`（基于 `axon-model-default-20261127T064232Z-d0190a70` 叠加 8 个前端文件，增量归档 SHA-256 为 `738dee041fd557add2658368902eab7338ba5090ef168a6880f0020f11ac18ba`）。
- 远端 Linux 通过 `tsc --noEmit`、`eslint . && node scripts/check-boundaries.mjs` 与 `vite build`，产出一版新前端包 `index-5vAg8T9x.js` 与 `index-ClLMXqqt.css`。
- 停服备份与回滚指针保存在 `/srv/axon-archive/axon-model-default-20261127T071000Z-738dee04`；切换后验证 `axon-4316.service` 为 `active`、`/api/health` 返回 `{"ok":true}`、登录入口（6 业务席 + 1 管理员）与静态资源返回 200、`model-settings.json` 哈希一致、`collaboration.sqlite` `quick_check=ok`（7 账号、45 任务、`user_model_preferences` 就绪）。
- 15:30 精简调整：按用户反馈移除 `ModelPicker` 顶部常驻的“新对话默认 / 跟随系统默认”冗余栏，仅在个人默认模型失效/删除时按需显示“恢复跟随系统默认”提示条；通过本地 10 项 Playwright 回归并更新 4316 至 `axon-model-default-20261127T072100Z-ee09ae5c`（新产物 `index-C506ICkV.js` / `index-Cjq7GVLG.css` HTTP 200，`/api/health` 正常，`model-settings.json` 哈希一致，回滚指针存 `/srv/axon-archive/axon-model-default-20261127T072100Z-ee09ae5c`）。

---

## 3. 高风险文件与回滚点

* **高风险文件**：
  * `experiments/harness-lab/src/server/model-settings.ts`（schema 8 序列化与 schema 1–7 兼容读取、CAS 与平台删除保护）
  * `experiments/harness-lab/src/pi/lab.ts`（`createSession` 幂等意图与 `MODEL_SELECTION` 固化、后台默认隔离）
  * `experiments/harness-lab/src/server/auth.ts`（`modelSettingsPath` 与 `personalPath` 白名单精确匹配）
  * `experiments/harness-lab/src/web/useChat.ts`（草稿状态机、多入口 `create` 语义与会话切换锁）
* **回滚点**：
  * 建议按「后端系统默认指针化 → 后端个人偏好持久化 → 前端统一解析与 Popover/设置页 → 测试与 spec」分批逻辑提交，便于独立复核与按段回退。
