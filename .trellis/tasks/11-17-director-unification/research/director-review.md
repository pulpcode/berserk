# 导演台独立审查（2026-11-17）

范围：导演台 host/source/UI，互斥切换、恢复、结束门禁、历史和权限，旧控制入口。业务接入迁移由另一审查负责。未部署、未提交代码，不代表用户验收。

## 已修复

1. `ScenarioStore.writable` 的 1000 次操作上限同时阻止暂停和结束，使达到上限的调试轮次无法“重新开始”。仅允许未暂停轮次的暂停及结束越过编辑上限；冻结、修订、活动指针和不确定通知检查保持。重复暂停和继续仍不能绕过上限。
2. `debugState` 原先仅返回最后 20 条记录，早先待核对通知会因后续保存而消失，切换仍被它阻挡。现在返回最近 20 条以及所有接收待核对通知，已确认旧记录仍保留于历史而不扩大当前窗口。

## 验证

- `tests/director-debug-store.test.ts`：3/3，通过真实SQLite边界快照验证上限后的结束/重开、陈旧CAS拒绝；内存源验证22次编辑后早期待核对通知仍可达，确认后回归20条窗口。
- 修改文件ESLint、完整 `npm run typecheck` 与 `git diff --check` 通过。
- built静态路由：真实 `createApp(lab,true)` 使用当前 `dist/index.html`，`/director` 返回200 HTML；`/simulation` 与 `/scenario-director` 返回404 JSON；无Location跳转，零模型调用。临时验证脚本 `/tmp/axon-director-static-check.mts`。
- 审阅 `director-routes`、`ScenarioTasks`、`ScenarioScope`、source控制、`DirectorModes`、`FreeDebug`，未发现额外确定的本轮缺陷。待核对切换的原请求保持、启动不自动重放、保存独立于发送和服务端原授权均保留。
- 旧Orchard/map真实模型探针按主代理明确决定停用执行，启动前报错；本轮没有把旧场景事实映射为harbor事实。新的自由调试使用真实HTTP/SQLite与确定性浏览器回归，真实模型和用户验收仍另行进行。
