# 任务首页质量验证与发布

## 检查
- 实施与独立审阅代理分别完成 typecheck、lint（含 dependency boundaries）；通过。
- `npm run build` 通过，保留既有 chunk 大小提示。
- `AXON_E2E_PORT=5197 CI=1 npx playwright test tests/e2e/task-information.spec.ts tests/e2e/access.spec.ts tests/e2e/chat.spec.ts tests/e2e/model-selection.spec.ts --workers=2`：69/69 通过。
- 初轮 task-information/access 18/20 通过：新首页区域标签造成重复 accessible name，已移除并通过全量重跑；跨页登录轮转用例初轮过期，完整重跑通过，未改变认证逻辑。
- 首页用例覆盖默认说明、折叠偏好及问题刷新保留、阅读不创建工作区、真实首条发送、两次独立会话、原会话下一条草稿保留、准备失败和离开任务后的迟到结果、长说明、归档、无可用模型、首次发送失败恢复。
- 独立审阅未发现确定实现缺陷，建议的连续模型选择回归已补充。
- 桌面 / 375px 截图检查通过；无水平溢出。

## 发布方式
- 线上目标：`http://49.232.156.14:4315/`。
- 发布前核对 TaskInformation/main/useChat/styles 的 SHA256 与本地修改前基线相同。
- 仅发布 5 个前端文件：TaskHome、TaskInformation、main、useChat、styles。`git apply --check` 已通过。
- 先备份 src/web 与 dist，服务器独立目录构建，保留旧 hash 资源后最后替换 index.html；无需重启服务或迁移数据。

## 最终验收
- 补充 `task-information/context/situation-map`：22/22 通过，包含两次非默认模型选择隔离、裸任务 URL 默认首页、无 tab 的旧 event/job 深链接。
- 线上首轮发布备份：`/home/ubuntu/axon-map-release-e073df6/backup/task-home-20261011T130142Z/code.tar.gz`（可回退至旧任务页）。
- 线上验收修正键盘跳转文案为“跳至任务详情”；后续构建备份：`/home/ubuntu/axon-map-release-e073df6/backup/task-home-20261011T130244Z/code.tar.gz`。最终 typecheck/lint 通过。
- 服务器构建成功、health 返回 ok；5 个前端源文件 SHA256 与本地最终内容一致。
- 公网浏览器确认：侧栏点击默认说明与新建对话同页、模型选择可用、说明折叠刷新保持、相关信息切换正常、返回说明正常。
- 没有向线上模型发送测试消息；实际首条发送/失败恢复在隔离数据的 E2E 验证。
- 线上截图：`/tmp/axon-task-home-live.png`。
