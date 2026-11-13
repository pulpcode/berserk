# DSH 侧栏状态交互验证

日期：2026-11-13。分支：`feat/chat-rendering-c`。用户已批准审阅稿并明确要求开始实施。

## 实现

- 分组标题展开、折叠均不显示处理中/需关注数字。
- 会话左侧固定16px状态位，静态状态为6px实心点，运行状态使用中性转圈；空闲保留空位对齐标题。
- 会话右侧普通状态显示更新时间，待交互优先显示待回答/待确认。
- 列表共用一个悬停卡，首次800ms延迟，行间立即接续；键盘聚焦也可打开，Escape关闭。卡片在document.body中定位，不被侧栏滚动区域裁切，支持指针进入阅读。
- 隐藏行、失焦、外部滚动及导航关闭浮层；键盘聚焦导致的自动滚动不会取消尚未打开的详情。恢复异常保留实际原因。
- 沿用现有请求状态、未读判定和数据归属；没有增加API、POST或持久状态。

## 复核与修正

- 实施复核修复隐藏锚点残留卡片、待显示键盘详情被自动滚动取消的问题。
- 960×600检查发现整数offsetHeight导致亚像素底部越界，已改用实际浮点边界。
- 最终检查补齐工作区名称/未读变化对卡片尺寸重定位的依赖，删除被新布局替代的孤立CSS选择器。
- 窄窗口测试的程序滚动准备时序已修正；未修改产品行为绕过断言。

## 验证结果

- `npm test -- tests/web`：5文件、34项通过。
- 三项侧栏定向浏览器回归通过，覆盖未读保留、无额外写请求、状态优先级、对齐、800ms延迟、键盘与Escape、960×600底部定位、外部滚动、失焦和程序化隐藏行。
- 桌面1440×960及960×600截图均已审阅，标题、状态和浮层完整可见。
- 完整相关浏览器回归首轮126项通过、2项失败：一项为并行运行清理跟踪文件目录导致的ENOENT；另一项为原交互用例仍要求会话整行只有标题，与新增“待回答”标签不符。已按新契约分别断言标题与待回答标签。引用用例在高并发复验时还曾达到30s测试预算；待其他检查结束后，两项用例使用独立端口/结果目录、单工作进程顺序复验，2项全部通过。保留早期失败，不调整超时或产品逻辑绕过断言。

本轮未部署或推送。4316仍为此前的流式引用修复版本。

## 最终检查

- `npm run typecheck`、完整`npm run lint`通过；仅保留未修改的InteractionCard两条既有ref警告，依赖边界通过。
- 最终冻结源码`npm run build`通过，保留既有chunk体积提示；`git diff --check`通过。
- `npm run test:e2e -- tests/e2e/chat.spec.ts tests/e2e/references.spec.ts tests/e2e/files.spec.ts tests/e2e/recovery.spec.ts tests/e2e/hitl.spec.ts tests/e2e/message-queue.spec.ts --workers=3`：126通过，另2项顺序复验通过，覆盖128个唯一用例。
- 顺序复验命令：`AXON_E2E_PORT=5192 npm run test:e2e -- tests/e2e/chat.spec.ts tests/e2e/hitl.spec.ts -g "resolved references stay visible|SSE question receives attention" --workers=1 --output=/private/tmp/axon-sidebar-final-recheck`。
- `npx eslint tests/e2e/hitl.spec.ts`通过；实施复核与最终全范围检查无遗留问题。
