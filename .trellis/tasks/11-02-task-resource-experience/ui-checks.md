# 第三批界面与导入检查

## 实现范围

- 仍只在用户点击引用时增加 `contextRefs` / `annotationRefs`。标签显示来源对象名称、发送时读取最新，或图层/对象名称与固定修订；可用键盘返回地图和移除。同层同名附对象标识。
- 原对象编辑器新增可选资源区：含义、类别、粒度、数量及单位/口径/范围、当前任务关系、状态、位置，以及逐项依据、报告/生效/失效时间、条件。不填资源区不会补默认资源字段；保留其他任务关系、旧隐藏字段和来源关联。
- `edit-changes` 补入 resource 的逐项差异与三方合并。不同事实分别合并；同一事实并发冲突仍需明确选择，不抹除最新字段。
- 来源详情增加明确导入入口。新增薄 HTTP `POST /api/sessions/:id/annotation/from-source`，直接调用既有 `AnnotationService.fromSource`，复用认证、范围、CAS、来源修订和回执；浏览器不传可信实体关联，没有手工旧标注补绑接口。
- 工具消息从授权 `resourceResult` 显示查询/统计/读取卡。显示固定口径、完整结果统计、逐条事实依据和时间，并分别显示来源、关系、位置缺口。数量保持原来的单位/含义，不重新计算总数。

## 分页实现说明

现有 HTTP 没有模型工具 `read` 的独立端点。按根代理确认，翻页/重新读取使用已有授权 `GET /api/sessions/:id`，在投影中找到同一 `resultRef` 后本地切页；统计始终使用完整固定 summary。它与计划的固定结果 read 分页目的相同，不重新查来源，不创建 Agent 消息、不调用模型、不写入数据。读取失败或授权投影移除结果后清除卡内旧数据，不从浏览器旧结果恢复。

## 检查命令与结果

- `npm run typecheck`：通过（最终执行 exit 0）。
- `npm run lint`：通过，包含 Pi/browser dependency boundaries。
- `npx vitest run --configLoader runner tests/annotation-edit-changes.test.ts tests/task-resources.test.ts`：2 文件、25 项通过。
- `AXON_E2E_PORT=5189 npx playwright test tests/e2e/annotations.spec.ts --grep 'resource form|resource result card|explicit source import|map references remain explicit|resource statistic card|failed send restores only explicit' --workers=1`：最终 6/6 通过，52.2 秒。随后只针对说明文本中的内部定位可读化再跑 statistic card 1 项，通过，11.6 秒；截图已替换。
- 旧回归定向运行：annotations 的 independent drafts、overlapping draft、explicit saved reference、object edit preserves；references 的 seat-scoped drafts、changed selection fails、workspace navigation preserves；situation-map 的 object draft loads，共 8/8 通过。与当时的来源导入复查一起执行时曾为 8 通过、1 失败；来源导入的真实完成状态问题已单独修复，最终六项中再次通过，不能把先前整批记成全通过。
- 共执行并通过 14 个不同的浏览器用例（6 新增、8 原回归）。浏览器为桌面 Chrome，1440×960 及 1280×960；测试不覆盖手机布局。

## 验收证据对应

| 检查点 | 实际证据 |
|---|---|
| T01 来源引用 | situation-map object draft loads：浏览器显式发送 → 真实 ContextService/Pi，原生消息带实际来源查询；标签显示发送时读取最新；不存点击时新快照 |
| T02 固定修订 | independent drafts / explicit saved reference：发布与草稿固定版本、草稿前进后旧引用不跟随 |
| T03—06 主动引用与未保存 | 新 map references case：单击不添加、再次点击引用去重、移除不复活、键盘回地图、未保存编辑仍能普通聊天且请求不带 annotationRefs；overlapping draft 和旧 object edit case 核对精确选中/未保存引用保护 |
| T07—08 恢复隔离 | 新 failed send case：503 前置失败后原文本与 r2 引用恢复，切另一会话无引用，返回恢复原输入；原 seat/workspace/changed-selection 三项回归通过 |
| T09—10 资源表单 | 新 resource form case：个体数量 2 被拒且未写；空数量 null，四类事实各自声明/报告/生效/失效/条件保存；后台补另一个任务关系后普通改名完整保留 |
| T11 并发保留 | annotation-edit-changes 单元实际覆盖资源事实独立合并/同事实冲突/隐藏字段；旧 object edit 浏览器回归核对真实三方合并流程 |
| T12 受控导入 | 新 explicit source import：真实 HTTP/AnnotationService 导入，关联后端生成，body 不含 resourceAssociation，未发布/未采用；task-resources 单元覆盖无身份/复制/刷新/权限/CAS |
| T13—14 数量与缺口 | 真实原生 resource query 的 12 项固定结果分页，数量 null/单位/口径保持；真实 query→classify→summarize 显示来源部分、任务关系部分、位置未知三缺口和 interior/assigned/available 口径；25 项单元含数量契约 |
| T15 历史和撤权 | card 从真实原生 session 重开读取；下一页重新 GET snapshot 无新模型调用，403 清掉旧名单；原历史/权限完整矩阵另见主任务离线检查 |
| T16 不隐式写入 | 浏览器单击/查看/普通聊天不写；只明确导入保存一次，不发布不采用；HTTP 重复 action 复用回执，不重复来源查询 |
| T25 桌面 | 新长名1280三栏/键盘引用移除、1440资源核心与依据表单、来源导入、卡片；无页面横向溢出。截图见下方 |

## 最终截图

- `screenshots/resource-form-1440.png`：资源核心字段，无旧错误。
- `screenshots/resource-form-evidence-1440.png`：数量依据、时间与条件。
- `screenshots/resource-controlled-import-1440.png`：明确导入及完成状态。
- `screenshots/resource-card-1440.png`：固定结果第二页与具体依据。
- `screenshots/resource-statistic-gaps-1440.png`：真实空间统计、三类缺口及可读定位标签。
- `screenshots/resource-explicit-reference-1280.png`：桌面三栏、长名称和主动引用核对。

已实际打开资源核心、长名三栏和三缺口统计截图核对，剩余截图可由独立审核继续复核。

## 已保留的失败及修复

1. 第一次 typecheck 碰到并行代理的 readSkills 类型暂态错误；其代理修复后后续检查通过。我们新增原生浏览器测试最初误用 fake.reply 和 start 参数，编译发现并修正为闭包及 actorUserId。
2. 第一次 lint 发现旧 chips 删除后 annotationKey/annotationLabel 导入未删除，已清理。
3. Vite 默认 bundle 配置尝试写共享 node_modules/.vite-temp 被沙箱拒绝；改 runner，配置在 /tmp，缓存 `/tmp/resource-ui-vite-cache`。临时配置直接绝对 import React 插件触发 runner 对 vite/internal 的扫描，改 createRequire 复用已安装插件。127.0.0.1:5189 监听和 Chrome 均经过工具批准后执行。
4. 首次两个 UI 用例超时来自测试定位：精确 getByLabel 不能匹配含选项文本的 select、工具外层处理过程未展开。改按 combobox 可访问名称和明确展开处理过程，后续通过。
5. 来源导入首次未展开来源筛选折叠区；第二次来源夹具把 HTTP 查询默认 limit 20 写成 100，被真实 ContextService 拒绝，未写草稿。修正夹具后暴露真正界面问题：保存成功刷新时 canWrite 暂时 false 导致导入组件卸载，完成提示丢失。现保持组件、在刷新期间禁用按钮，成功提示保留，重测通过。
6. 视觉复核发现覆盖/位置缺口直接显示内部 JSON 定位；已格式化为固定版本和对象名称/标识，底层事实不变。资源表单改输入后清掉旧验证错误，重新截图有效状态。

初次浏览器 trace 留在 `/tmp/resource-ui-first-failures`、`/tmp/resource-ui-second-run`、`/tmp/resource-ui-third-run`、`/tmp/resource-ui-fourth-run`；两次导入错误的完整页面与失败断言另保存在本任务 diagnostics，便于仓库内复核。

## 边界

全部使用临时数据库、真实本地服务和确定性 Pi provider；来源响应为明确的本地测试夹具。真实模型调用为 0，不能据此宣称模型主动读取 Skill 或理解正确率提高。未部署、未 push、未提交 git。

## 独立审核补充

- `ResourceFields`“资源粒度”改为“单个资源还是汇总”；引用名称夹到两行，DOM完整文本与title保留，核对/移除仍可键盘操作。两项受影响浏览器复验通过，原长名/表单截图保留diagnostics。
- 新增model-selection设置页用例首次抓到HTTP schema漏thinkingMode，修复后实际保存high通过，fake provider调用0；最终HTTP三路验证见review。
- 桌面不同用例总数为15（原14+模型设置1），不把本次重复运行累加。
- 原生125%缩放通过隔离有头Chromium和仅/tmp扩展执行。使用chrome.tabs.setZoom/getZoom核验factor=1.25，并断言devicePixelRatio变化，已目视检查截图；未用CSS zoom或模拟viewport冒充。首次快捷键无效、首次扩展默认禁用的失败也保留。
- 新增截图 `model-thinking-settings-1440.png`、`model-settings-native-zoom-125.png`。缩放复验使用同一模型设置用例，不新增测试分母。
