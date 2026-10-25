# 实施与验证

1. [x] 读取相关前端/标绘规范；当前分支 codex/frontend-plotting，基线 698d9a5。
2. [x] 修改四项交互，按需更新受影响浏览器测试。
3. [x] 执行 typecheck、lint、build，以及 annotations/situation/map-symbols 浏览器回归（独立 E2E 端口，勿复用其他 worktree 服务）。
4. [x] 检查宽/窄桌面属性卡和保存按钮，核对直接落点、未保存保护、保存 camera 稳定、来源独立刷新。
5. [x] 使用 trellis-check 子代理检查并修复范围内问题。
6. 中文提交，更新原 4324 预览服务，保留独立测试数据；归档本任务并记录验收。

回滚：仅回退本次提交，数据协议无变化。
