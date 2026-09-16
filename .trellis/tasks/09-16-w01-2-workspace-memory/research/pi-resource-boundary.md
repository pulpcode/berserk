# S2a 代码与 Pi 资源接入核验

日期：2026-09-16。方式：只读仓库代码、已安装 Pi 0.85.1 的公开类型及运行实现，并核对相同版本的官方文档；没有执行新功能、调用真实模型或修改依赖。

## 1. 当前工程事实

- `src/contracts/index.ts` 的 SessionSummary 没有 workspaceId；AppInfo.sources 是全局资料清单。
- `src/pi/lab.ts` 扫描 `.local/sessions`，每会话有独立 SessionManager，保存首个空 header；open() 缓存 AgentSession。
- ResourceLoader 使用 noContextFiles/noSkills/noExtensions；唯一 source_read 工具读取全局固定 fixture；执行层已有请求串行、取消、模型／工具次数与错误脱敏。
- `src/server/app.ts` 当前没有工作区或指令接口，响应直接返回公开结构；`start` 在异步准备前保留 active，适合继续在该边界固定 workspaceId 和资源范围。
- 浏览器状态与 draft 已按会话隔离，可扩展区级资源缓存；不能把侧栏选中工作区直接当服务端工具上下文。

以上是提交 `b50a919` 的事实，不代表已实现本期方案。现有规范见 [后端契约](../../../spec/backend/harness-lab.md)、[前端契约](../../../spec/frontend/harness-lab.md)。

## 2. 版本与官方接口

固定版本参考：[Pi SDK v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/sdk.md)、[Skill 文档 v0.85.1](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md)。这里验证安装版本，不推断未来版本兼容。

| 观察到的接口／行为 | 本方案用途及限制 |
| --- | --- |
| DefaultResourceLoader 的 agentsFilesOverride | 提供精确 path/content 清单；本地 resource-loader.js 在 noContextFiles 的空清单之后执行 override，可关闭自动发现同时注入受控内容 |
| buildSystemPrompt 的 contextFiles | 将上述指令加入实际系统提示；需要在 P0 断言最终模型输入，不只检查返回对象 |
| buildSystemPrompt 的 Skill 目录条件 | 本地 system-prompt.js 只识别 read／bash 作为 Skill 文件读取工具；只有 skill_read 不会自动展示内置 Skill 目录 |
| SessionManager.appendCustomEntry | 保存宿主数据；custom entries 不参加 buildSessionContext 消息构建，适合实验加载记录，不能冒充正式平台数据库 |
| createAgentSession + SessionManager | 可以传已有 SessionManager；本方案每请求重新装配，复用原生历史；具体保存／取消效果仍需测试 |
| AgentSession.reload | 本地实现重载 settings、resources、工具并调用 resetApiProviders；不选作每请求刷新指令的默认路径，避免引入无必要的全局运行时变化 |

本地核验文件均在 `experiments/harness-lab/node_modules/@earendil-works/pi-coding-agent/dist/core/`：resource-loader.d.ts/js、system-prompt.js、agent-session.js、session-manager.d.ts/js。实现者应读取锁定版本，不把路径中的内部私有方法作为产品调用接口。

## 3. 方案选择与替换边界

工作区索引、指令编辑、Skill 清单和工具业务函数由宿主定义；Pi 负责模型循环与历史。宿主在限定资源范围后给 Pi 装配上下文；这不等于自研一套 Memory 引擎。文件式 Skill 通过受控目录提示和正文读取工具接入，是当前禁用任意读文件工具条件下的最小桥接。

原生 custom entry 只用于实验的实际加载证据，解析在 Pi 模块内；宿主使用不含 Pi entry ID 的公开字段。未来内核切换仍需 S4 的平台记录与导出契约，本期不宣称新 custom entry 已内核无关。

不选整个会话调用 reload，也不直接调用 Pi 私有的 _rebuildSystemPrompt。短期每请求新建实例的取舍是少量装配开销换明确的版本边界；没有性能保证，后续有实际开销证据再优化。

## 4. 实现时必须验证

1. 同一原生会话三轮：旧指令 → 更新 → 新指令，消息恰好一次，工具结果完整。
2. 同时两会话：不同 request resources、工具闭包和 stream wrapper 无共享可变上下文。
3. 配置错误／取消发生在资源准备或实例创建期间：active 最终释放、用户草稿保留、无迟到写入。
4. 空会话、只有资源 custom entry、已完成／已取消会话的落盘与重启；加载记录缺失时明确 unknown，不伪造当前文件快照。
5. 真实模型能按受控 Skill 提示调用 skill_read，而不会尝试不存在的 read／bash；保留来源和方法要求。

这些结论中的“接口存在”已核验；组合方案的运行效果尚未验证，退出标准由 A01～A12 决定。
