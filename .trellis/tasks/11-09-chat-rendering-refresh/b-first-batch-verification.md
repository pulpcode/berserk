# B 轮首批实施与验证

日期：2026-11-13。方案提交：`4f8f83f`。实施分支：`feat/chat-rendering-c`。本记录仅对应首批，不代表 B 轮全部完成。

## 实现范围

- 原生思考内容块与正文保留顺序；只展示模型返回的可见文本，过滤签名和 redacted 数据；流、快照与重启历史同源。
- 文件路径/命令参数白名单；bash 累积输出按快照更新；edit 使用原生 diff/patch，write 和其他工具保留真实结果与回退。
- 完成后整轮耗时与折叠，保持普通回复、文件、交互和异常独立可见；保留用户补充、手动展开、焦点和阅读保护。
- 未增加文件预览、业务快捷入口、模型实接或执行状态库；未部署线上。

## 验证命令与结果

均在 `experiments/harness-lab` 执行。

| 验证 | 结果 |
| --- | --- |
| `npm run typecheck` | 最终通过（包含新增测试） |
| `npm run lint` | 通过；保留 InteractionCard.tsx 两条既有 ref 清理告警，无新增错误 |
| `npm run build` | 产品冻结后最终构建通过；仅既有大 chunk 提示 |
| 后端 6 文件回归 | 64 项通过 |
| 独立投影/终态/分组验证 | 3 文件 33 项通过；补充 patch 内容以 ++/-- 开头的计数测试 1 项通过 |
| 浏览器核心回归 | 132 个用例分批验证通过：首轮 125/132；修正旧交互/DOM 选择器和测试按钮名后，在冻结代码上顺序复验 10/10（包含 7 个失败项和 3 个相关新增场景） |
| `git diff --check` | 通过 |

后端命令：

```sh
npm test -- tests/pi/chat-projection.test.ts tests/pi/conversation-turns.test.ts tests/pi/lab.test.ts tests/pi/recovery.test.ts tests/pi/file-tools.test.ts tests/pi/file-integration-review.test.ts
```

独立审阅命令：

```sh
npm test -- tests/pi/chat-projection.test.ts tests/pi/conversation-turns.test.ts tests/web/process-groups.test.ts
npm test -- tests/web/chat-tool-presentation.test.ts
```

浏览器命令：

```sh
npm run test:e2e -- tests/e2e/chat.spec.ts tests/e2e/hitl.spec.ts tests/e2e/recovery.spec.ts tests/e2e/references.spec.ts tests/e2e/message-queue.spec.ts tests/e2e/files.spec.ts --workers=3
```

首轮失败记录保留：一项阅读位置失败发生于修改 main.tsx 触发 HMR 期间，冻结产品代码后未修改该阅读逻辑即复验通过；一项旧整组收起操作与新的运行中展示行为不再一致；一项新增测试按钮名定位不正确；其余四项依赖旧消息直接子节点结构。已修正测试操作/定位，保持原阅读位置、交互卡对齐宽度和文件归属顺序断言，最后以单 worker 顺序复验 10/10 通过。最终定向前端与测试 ESLint、冻结代码后的 typecheck 也通过。

## 独立审阅与修正

已修正：内层手动展开未保护过程组、多正文块重复结果链接、纯思考增长不跟随、自动折叠后首次点击闭包过期、空起始块加载反馈、空完成工具状态、patch 代码内容被误当文件头。独立审阅无剩余阻断问题。

## 截图

已审阅测试生成的运行中思考与命令、完成收起、完成展开 diff 三张桌面截图。最终复验截图位于 `/private/tmp/berserk-b1-recheck/` 下两个 B首批 场景目录，文件名为 `b-live-thinking-command.png`、`b-completed-collapsed.png`、`b-completed-diff-expanded.png`；已再次审阅最终 diff 截图。

## 尚待用户测试及后续

本批产品验收对应 B1-01–B1-06；无真实 Kimi/Qwen 接入验收，也未将假供应商测试等同于真实模型测试。B 轮后续候选仍开放，不归档整个任务。线上发布需用户另行指令。
