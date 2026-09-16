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
