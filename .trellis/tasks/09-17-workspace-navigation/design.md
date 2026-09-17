# 实施设计

## 变更边界

目前浏览器只加载选定工作区会话，只有打开的会话快照定时刷新。行为缺口位于服务端摘要投影与 useChat 导航状态，两层同时补齐；不把后台状态寄托在页面曾经打开过的缓存上。

## 状态契约

新增 `GET /api/activity` → `ActivityOverview`，包含 WorkspaceList 的工作区字段与 `sessions: SessionActivity[]`。SessionActivity 继承 SessionSummary，增加 `active: RequestState | null`、`lastResult: Pick<RequestResult, 'requestId' | 'status'> | null`、可选 recoveryWarning、`statusUpdatedAt: string`。只返回导航元数据，不返回消息、指令正文、工具参数或原生路径。原 /api/sessions 兼容不变。

RequestState 增加可选 phase（preparing / generating / tool）与 toolName；由真实执行事件更新，正在停止优先于阶段。阶段未知显示处理中，不估算百分比。statusUpdatedAt 表示最近阶段或持久记录时间，不跟每个 token 更新。重启后不得凭旧数据声称仍在执行。

前端使用约 1.8 秒的串行轮询全局摘要；单次失败保留最后数据并显式提示过期，恢复清除。SSE 与选中会话详情保持既有 requestId/token/revision 防护；摘要不能覆盖新流状态，也不能替代聊天正文快照。新会话立即加入，轮询按既有顺序合并，避免每次活动导致侧栏跳动。

## 导航与已读

分组侧栏：每区提供折叠按钮、进入工作区按钮，列出会话及阶段／结果；空区也可进入。顶端“全部动态”展示处理数、新回复数和异常数，点击主区域展示全局列表与筛选。会话点击直接切换所属工作区并恢复它的草稿。新建对话始终绑定当前明确展示的工作区。

已读存储为 sessionStorage 中 sessionId → 最近查看的完成 requestId。仅 succeeded 且 completion requestId 未读显示新回复；失败与恢复提示独立进入需关注。只有对应会话可见且正文已加载、页面在前台且阅读到末尾时标记已读；全局列表轮询不标记已读。不承诺跨浏览器账号同步。

滚动位置和跟随末尾状态按会话保存在标签页内存；离开前记录，返回时恢复，处于末尾者继续跟随新回复。进入全部动态不取消流，也不丢输入草稿。

## 文件职责

- contracts/index.ts、pi/lab.ts、server/app.ts：轻量摘要、事件阶段、GET 入口与后端测试。
- web/useChat.ts：跨区数据刷新、直接选择、已读、与旧快照的竞争处理。
- web/main.tsx、新增 WorkspaceNavigation.tsx、styles.css：分组侧栏、活动列表、当前目标、滚动恢复及窄屏适配。
- tests/e2e/chat.spec.ts：更新确定性服务与旧选择方式，增加跨区状态、筛选、刷新、草稿／滚动、断网与竞争回归。
- scripts/probe-workspace.ts：把现有真实验收脚本的工作区选择器同步为新的工作区入口；本次不调用模型重跑该探针。
- README 与前后端 spec：记录实现后的导航和摘要契约。

验证采用隔离测试数据，无需真实模型调用，不修改用户会话或指令数据。
