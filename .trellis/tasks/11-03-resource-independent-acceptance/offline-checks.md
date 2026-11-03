# 离线运行器检查

本页仅报告离线机制，不代表20槽在线成绩或工具验收通过。

- runtime初始完整组6/6通过（82.6秒）：20槽顺序、全部12题真实HTTP分页/coverage/时间及受控导入、P02空统计集合/原生query-read与未改high请求、P04旧固定结果、普通文本和交互API两种v2接续。工具stdout摘要单独标明在checks/runner-initial-summary.json。
- 后增检查按影响范围执行：P04精确offset2/limit2续读，再offset0/limit2重开；N08同固定图层两轮原生工具。两项通过见checks/runner-targeted.log。该文件同时保留首次symlink测试的macOS路径拼写预期错误与N03传输失败。
- 符号链接目标规范化预期修正后，单项通过见checks/dependency-freeze.log。完整node_modules含嵌套传递依赖、链接目标与文件bytes；Chromium bundle与Node身份也冻结。
- N02原生查询包含实际受控导入副本，quantity=5成功；其原始成功snapshot仍位于首次失败保留目录的quantities-N02。
- N03首次原生工具仅得到第二来源，第一来源本地HTTP连接ECONNRESET，未构成统计算法失败。checks/runner-quantities.log与runner-quantity-cause.log保留host/ledger/原始local fetch cause；完整失败目录为`/private/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/independent-acceptance-offline-9qYXfl`（后一次定位目录亦在cause日志）。简单两次fetch复现未触发故障，见transport-reproduction.log，不将其称为通过完整链路。
- 同步全依赖扫描约11秒，干扰主事件循环。改为异步子进程计算相同完整hash后，N03实际HTTP/Pi再次读取两来源并返回车辆unknown、舟艇5，通过见checks/runner-quantity-async-verify.log（85.3秒）。没有增加来源超时、绕过冻结或添加重试。
- P01/N02/N03真实桌面证据见browser-offline-notes.md；显式冻结Chromium复查P01通过。
- 任务TypeScript与所改runner文件ESLint已通过；最终独立checker记录另见review.md/checks/checker*。fixture与评分组由对应作者/审阅者记录，本运行器未重复无关测试。

首次沙箱禁止localhost监听的EPERM属于执行环境限制；随后的本地HTTP/Pi与桌面检查在批准的提权环境执行，所有provider调用仍被确定性本地响应拦截。在线执行前必须完成独立审阅并重新prepare冻结最终材料。
