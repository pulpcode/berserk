# 导演台事件融合实施边界

日期：2026-11-05；按用户要求实施供审阅。

现有差距：任务卡片常驻并与事件/预览/通知分栏，任务与事件的编排关系未展示。

- ScenarioDirector.tsx与样式改为单列表、一次展开一条；首事件复用initialize、activate两个显式操作，不新增自动串行请求或持久化工作流。任务创建、启用、预览、应用和发送仍可分别核对，不因打开/刷新执行写入。
- contracts/scenarios.ts与场景来源的detail只读投影补充taskCodes及taskDefinitions。data.ts单独持有导演标签映射，不改sceneWorld、definitionHash、存量快照或消息。host status白名单接受新增只读字段。未知旧版本元数据缺失时不猜测关联。
- 事件中的剧本任务按code解析成当前实例taskId，仅作导演导航；不返回业务来源、工具或通知。普通来源原有作者编号文案仍按SIM-NOTICE-001延后。
- 相关来源/API/权限和桌面回归、typecheck/lint/build；本地真实HTTP检查页面。线上检查须更新本轮明确改动，保留数据备份、原任务与未投放事件，不自动推进业务。

保留父子任务待用户检查，不实施P3—P6。

## 实施和上线结果

源码提交`898688fc62ff7898419bf14fbddf8c31d5e9487e`。34项相关工程测试、7项桌面回归和typecheck/lint/build通过；构建保留既有chunk体积提示。首事件中任务创建、启用、预览、应用继续显式分步执行，复用原操作ID与不确定结果核对；没有新增自动写入或刷新重发。

已在原发布目录更新六个源码文件与构建产物，保留旧静态资源；`release.json.directorUiCommit`记录本次提交，密码规则补丁继续保留。更新前备份：`/home/ubuntu/axon-scenario-release-68dded362074/backup/director-ui-20261105-100743`。回退只恢复该目录source、dist和release.json，保留当前业务数据；需要数据恢复时先保全更新后的业务成果。

线上五席登录/权限验证通过；除登录会话外全部业务表与来源数据库内容哈希保持一致，原生历史字节保留。活动实例仍为`run-92f0bb86-63c1-4c39-89c7-91764fb5d625`、09:10、revision2、stepIndex0；definitionHash保持`e5c3f03f2b1f61674922dbca8a397525551fbb1cbf34237d03f409a7c37747df`，未初始化新轮、推进事件、发送通知或运行模型。

公网真实浏览器已验证：主故事显示5事件，无独立本轮任务卡片；三个事件的剧本任务链接可见且能打开只读任务说明；1440/1080桌面布局无水平溢出，浏览器无运行错误。已查看两张截图，保存在本机`/Users/lau/Documents/Codex/场景演示验收-20261104/director-event-fusion-898688f.png`及`director-event-fusion-1080-898688f.png`。浏览器操作前后场景状态完全一致，等待用户检查。

脱敏证据：[发布](director-ui-deployment-20261105.json)、[公网浏览器](director-ui-browser-20261105.json)。SIM-NOTICE-001继续延后，原来源正文未修改。

## 追加边界：悬停与固定

仅修改ScenarioDirector.tsx、样式及屏幕专用DirectorPopover.tsx；新增状态仅为事件浮层的临时选择、固定状态与开关计时，不增加持久化工作流。250ms开启、180ms离开关闭，固定态不被悬停替换。定位使用当前行坐标，随滚动/缩放更新且限制视口，Portal防止父容器裁切；无新增依赖。记录/数据复用现有Resources.Panel原生dialog及焦点恢复，时间在本机时区显示并保留原始ISO提示。保留现有API、来源定义、任务/通知投放语义。验证悬停只读、固定写入入口、空白/Esc/同项关闭、跨行切换、窄窗、角色隔离与不确定操作恢复，再保留数据更新线上。

## 悬停与记录面板验收

源码提交`37d158dd4637284e42e7d96f3a9deb25913437f8`。最终typecheck、lint/边界、build通过；8项桌面回归通过，覆盖真实HTTP导演隔离与历史、回执恢复、悬停只读/不移动行、移入浮层保持、固定后悬停不换目标、点击切换/同项关闭、Esc与焦点返回、键盘Enter、空白关闭、滚动/1080视口限制、按需记录与技术信息折叠。首次测试服务的整批流程在登录会话阶段失败；全新隔离前端服务重跑8项通过，认证实现未修改；临时诊断输出已移除。

仅发布三个web源码文件及构建产物。新资源先增加，`dist/index.html`最后原子替换，保留所有旧资源；未重启主服务或来源进程，PID分别仍为3244173、3244201。`release.json.directorUiCommit`更新为本提交，上一UI提交为898688f。回退目录：`/home/ubuntu/axon-scenario-release-68dded362074/backup/director-hover-20261105-105327`，可用该目录index.html原子恢复入口及source/release.json恢复元数据；不删除新资源，不触碰业务数据。

第一次发布后重复五席登录校验超过服务每IP每分钟8次的既有限流，收到429后已自动恢复原前端，数据及服务未改动。随后等完整限流窗口结束，将校验改为发布前单导演席、发布后五席，共6次，重新发布成功；未更改或绕过限流。

成功发布前后除登录会话外，业务表与来源数据库快照哈希一致，场景实例/时钟/修订保持相同（09:10、revision2、stepIndex0）。五席登录及导演业务隔离校验通过。公网真实浏览器1440/1080验证通过，无运行错误；查看事件/任务和记录均未产生simulation写入。已逐张查看静止页面、固定浮层、履历表和数据概况截图；真实时间在Asia/Singapore显示为2026/11/4 22:40:36，保留原ISO时间提示。

证据：[发布](director-hover-deployment-20261105.json)、[公网浏览器](director-hover-browser-20261105.json)。截图位于本机`/Users/lau/Documents/Codex/场景演示验收-20261104/director-hover-37d158d-*.png`。当前等待用户检查；没有推进剧情、投放通知或调用模型。
