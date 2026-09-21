# Journal - bobot (Part 1)

> AI development session journal
> Started: 2026-09-16

---



## Session 1: 实施 W01-1 本地多轮对话入口

**Date**: 2026-09-16
**Task**: 实施 W01-1 本地多轮对话入口
**Branch**: `main`

### Summary

建立 Pi 0.85.1、React/Vite、Fastify 首增量；多会话、流式、只读工具、停止和原生历史已落地。本地检查通过，用户已选 deepseek-flash，无10条验收总量限制；等待本地 API Key 完成真实验收。任务保持 in_progress，不归档，不提交。

### Main Changes

- 新增 experiments/harness-lab 和首增量运行说明、验证记录、前后端接口规范

### Git Commits

(No commits - planning session)

### Testing

- [OK] 19项真实Pi循环/API确定性测试；4项浏览器测试；typecheck、lint、build、文档链接和Trellis清单检查通过

### Status

[OK] **Completed**

### Next Steps

- 用户配置 experiments/harness-lab/.env.local 的 LLM_API_KEY 后进行真实 DeepSeek 验收


## Session 2: 完成 W01-1 真实模型与进程重启验收

**Date**: 2026-09-16
**Task**: 完成 W01-1 真实模型与进程重启验收
**Branch**: `main`

### Summary

用户配置 API Key 后完成 DeepSeek Flash 的13条真实探针和2条实际浏览器请求；C01-C06通过。独立Node进程重启保留完整历史且刷新不重发。修复实际输出表格的GFM渲染并通过5项浏览器回归。W01后续S2-S5未启动，任务保持in_progress，不归档。

### Main Changes

- 更新首增量验收记录、阶段状态、文档与表格渲染

### Git Commits

(No commits - planning session)

### Testing

- [OK] 15条真实用户请求（含1次成功取消）、独立进程重启、无密钥泄漏；5项浏览器测试、类型检查、lint、构建通过
- [OK] npm审计650包0漏洞；原19项Pi/API测试通过，后端本轮未改动

### Status

[OK] **Completed**

### Next Steps

- 审阅W01-1交付并按需启动S2具体设计


## Session 3: 完成工作区与指令文件阶段

**Date**: 2026-09-17
**Task**: 完成工作区与指令文件阶段
**Branch**: `main`

### Summary

完成W01-2/S2a：最小工作区、会话归属、AGENTS.md受控编辑与冲突处理、固定Skill和迁移。44项确定性测试、12项浏览器回归与最终18次真实请求通过；记录五轮模型验证及修复，原有2会话备份升级且原字节保留。中文提交约定持久化，Trellis自动提交关闭；S2b/S2c及完整W01仍未完成。

### Git Commits

| Hash | Message |
|------|---------|
| `50e103e` | (see git log) |
| `0316a74` | (see git log) |

### Status

[OK] **Completed**


## Session 4: 工作区分组导航与全部动态

**Date**: 2026-09-17
**Task**: 工作区分组导航与全部动态
**Branch**: `main`

### Summary

交付分组侧栏、全局动态、跨区实时摘要与已读/滚动保留；18项浏览器回归和48项后端测试通过。

### Main Changes

- 新增轻量全局摘要与真实阶段，工作区和会话上下文保持隔离。
- 修复创建响应与轮询重复入列，以及摘要先于正文时停止按钮错误可用的时序问题。

### Git Commits

| Hash | Message |
|------|---------|
| `f4e2cb5` | (see git log) |

### Testing

- [OK] lint零警告、typecheck、48项单元/集成、18项E2E、build全部通过；桌面1440与窄屏375无溢出。
- [OK] 真实页面只读检查；本次未调用模型，未修改用户工作区数据。

### Status

[OK] **Completed**

### Next Steps

- 用户审阅分组侧栏与全部动态交互；双分屏及其余Harness能力另行设计。


## Session 5: 项目会话入口与模型设置窗口

**Date**: 2026-09-17
**Task**: 项目会话入口与模型设置窗口
**Branch**: `main`

### Summary

参考 DeepSeek Harness 设置窗口，实现全局新建选项目、分组加号新建、未读蓝点、服务端持久模型配置。通过 56 项单元/集成测试、22 项浏览器回归、类型检查、lint、构建及桌面/手机视觉检查；独立审阅后修复跨项目失败提示、异步导航与手机焦点。没有调用真实模型或替换用户密钥。

### Git Commits

| Hash | Message |
|------|---------|
| `7903039` | (see git log) |

### Status

[OK] **Completed**


## Session 6: 完成W01-5通用文件作业与真实服务器验收

**Date**: 2026-09-18
**Task**: 完成W01-5通用文件作业与真实服务器验收
**Branch**: `main`

### Summary

实现任务×席位文件目录、上传与下载、Pi容器工具和网页文件处理；真实Docker、DeepSeek、压缩续作、停止与网页完整流程通过。用户已允许服务器模型配置，仍待Git提交。

### Main Changes

- 复用Pi公开文件工具，使用请求级Linux容器；普通文件与固定下载副本独立保存。
- 新增上传、文件面板、预览和下载卡，保留会话输入与既有交互。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 176项全量测试、40项浏览器回归；新增250字节文件名回归，本地和Linux文件服务8项通过。
- [OK] 真实Docker P0、DeepSeek两组文件探针、网页70到75多轮计算与下载、停止及重启通过。

### Status

[OK] **Completed**

### Next Steps

- 用户查看http://127.0.0.1:4315；后续按中文提交约定审阅提交与归档。


## Session 7: 实现双测试席位任务分派与成果交接

**Date**: 2026-09-19
**Task**: 实现双测试席位任务分派与成果交接
**Branch**: `main`

### Summary

先提交中文回退基线，再完成W01-8实现。355项单元/集成已验证、66项浏览器全量通过，真实DeepSeek/Docker完成分派→脚本生成→提交→退回→再提交→验收及重启读回。正式部署与用户验收待进行，@文件选择器后置。

### Main Changes

- 保留Pi原生循环与会话，新增两席位范围、业务工具及HITL、SQLite回执与固定副本、网页待办及关联办理。
- 同步MVP路线、具体阶段记录、前后端规范和使用说明；本轮实现尚未再次提交或推送。

### Git Commits

| Hash | Message |
|------|---------|
| `fbcdd46` | (see git log) |

### Testing

- [OK] typecheck、lint、build、git diff --check通过；5项新增浏览器用例使用真实本地业务后端，仅模型模拟。
- [OK] SIGKILL覆盖复制中、等待确认、业务提交前后；旧单席位停服备份启用双席位后原JSONL/指令/文件字节不变。

### Status

[OK] **Completed**

### Next Steps

- 用户查看并验收本期；需要更新线上服务时停服备份并仅发布4315。


## Session 8: 实现文件、Skill与子Agent对话选择

**Date**: 2026-09-20
**Task**: 实现文件、Skill与子Agent对话选择
**Branch**: `main`

### Summary

完成W01-9：@文件/只读子Agent、/Skill、独立草稿与原生输入历史；375项单元/集成、77项浏览器范围及真实DeepSeek/Docker组合验证通过。未提交或部署。

### Main Changes

- 复用Pi原生循环和JSONL，受控加载Skill并传入匹配子角色，文件去重后合并计数。
- 修复IME、目录筛选、失败选择恢复以及初始化期间输入归属问题，同步规范和验收证据。

### Git Commits

(No commits - planning session)

### Testing

- [OK] 全套单元/集成375项通过；最终产品代码下浏览器76/77，余项确认测试等待问题，仅修正测试后引用组10/10通过。
- [OK] 真实reviewer/analyst读取文件并按Skill返回；普通续聊、重启历史和越界访问通过；typecheck/lint/build通过。

### Status

[OK] **Completed**

### Next Steps

- 用户查看验收；需要时以中文提交当前Git，并按用户指令更新唯一线上服务。


## Session 9: 提交W01-9并更新唯一线上实例

**Date**: 2026-09-20
**Task**: 提交W01-9并更新唯一线上实例
**Branch**: `main`

### Summary

中文提交当前实现，从已提交代码构建并部署tencent-server唯一4315实例；停服备份、历史副本读回、服务与浏览器验证通过。

### Git Commits

| Hash | Message |
|------|---------|
| `2abb782` | (see git log) |

### Testing

- [OK] 原48个文件哈希保持一致，A/B各2个会话均可读，模型及Docker正常，4316未启动。
- [OK] HTTP构建资产逐字节一致；浏览器刷新原历史和新增菜单、Skill候选正常。

### Status

[OK] **Completed**

### Next Steps

- 用户使用线上页面验收；本轮未推送GitHub。


## Session 10: 实现业务任务与独立席位登录

**Date**: 2026-09-21
**Task**: 实现业务任务与独立席位登录
**Branch**: `main`

### Summary

提交实施前设计基线；实现账号登录、公私任务目录、工作区访问、归档和备份初始化，代码待用户验收，未更新线上服务。

### Main Changes

- 复用 Pi 原生会话；增加固定席位身份和任务范围校验、跨标签退出隔离。

### Git Commits

| Hash | Message |
|------|---------|
| `a4080ea` | (see git log) |

### Testing

- [OK] 402 项 Vitest、87 项浏览器回归；退出竞争修复后相关 6 次复测通过；3 轮真实模型与 Docker 成功。

### Status

[OK] **Completed**

### Next Steps

- 用户验收后再安排实现提交及部署，正式账号由离线维护命令开通。


## Session 11: 发布任务与独立席位登录版本

**Date**: 2026-09-21
**Task**: 发布任务与独立席位登录版本
**Branch**: `main`

### Summary

按用户要求更新 tencent-server 唯一4315服务；51个旧数据文件完整备份核验，新数据根及两个随机密码账号就绪，登录与模型配置冒烟验证通过。

### Git Commits

(No commits - planning session)

### Testing

- [OK] A/B登录、席位绑定、匿名401、空目录、模型就绪；浏览器登录页可见。

### Status

[OK] **Completed**

### Next Steps

- 用户测试，新实现及发布记录尚未提交。
