# 第一批离线检查记录

2026-11-02。只使用构造数据、受控模型和本地服务，没有付费模型请求，没有修改线上数据。

## 实施阶段

在 `experiments/harness-lab` 执行：

```sh
npm run typecheck
npm run lint
npm run build
npm test -- --configLoader runner tests/task-resources.test.ts tests/annotation-from-source.test.ts tests/annotations.test.ts tests/annotation-results.test.ts tests/annotation-edit-changes.test.ts tests/pi/annotation-source-history.test.ts tests/pi/annotations.test.ts
npm test -- --configLoader runner tests/task-resources.test.ts tests/context-http.test.ts tests/annotations-acceptance.test.ts tests/spatial-source.test.ts tests/pi/provider-payload.test.ts
```

实施阶段最后状态：类型、lint、构建通过。去重为 11 个文件、182 项通过，其中新 `task-resources.test.ts` 为 12 项；后续重复跑的项不相加。独立审查新增的检查及最终状态另记，不能把本段数字当作最终测试总数。

| 文件 | 实施阶段通过数 |
| --- | ---: |
| task-resources | 12 |
| annotation-from-source | 42 |
| annotations | 39 |
| annotation-results | 13 |
| annotation-edit-changes | 9 |
| pi/annotation-source-history | 1 |
| pi/annotations | 30 |
| annotations-acceptance | 2 |
| spatial-source | 16 |
| context-http | 14 |
| pi/provider-payload | 4 |

## 桌面回归

使用当前包的 Vite 配置、`configLoader:runner`、`/tmp/berserk-resource-contracts-vite` 缓存和独立端口 5193。这样不会写入 `node_modules` 符号链接指向的其他 worktree 缓存。

```sh
AXON_E2E_PORT=5193 npm run test:e2e -- tests/e2e/annotations.spec.ts --grep 'independent drafts, fixed publication|compact editor retains hidden styles|object edit preserves defaults' --workers=1 --output=/tmp/task-resources-batch1-playwright
```

3/3 通过，36.6 秒：固定发布与原生引用、隐藏字段保留、对象编辑与冲突合并。使用现有 fakeRuntime，不接真实模型。临时 5193 服务已停止；截图等暂存于上述 `/tmp` 目录，不作为永久评测数据。

## 遇到的失败与处理

| 记录 | 原因与处理 | 是否计为模型失败 |
| --- | --- | --- |
| 初次 Vitest/Vite 启动 EPERM | 共享依赖目录不在当前写入范围；采用 runner 加载配置，浏览器缓存放 /tmp | 否，没有模型调用 |
| 本地 HTTP 与 5193 监听 EPERM | 沙箱禁止监听；经工具审批以本地权限运行，HTTP 14 项与桌面 3 项随后通过 | 否 |
| 开发样例对象数断言 | 首稿误写 13 个，实际逐条为 11 个；修正计数检查 | 否，测试实现问题 |
| provider-payload 文案断言 | `git show 2a5fd9f` 证实旧断言与当时产品描述已不一致；局部更新断言，产品工具正文不改 | 否，基线陈旧断言 |
| 实施子代理重复启动的桌面运行 | 发现重复后停止，1 项中断、2 项未跑；不计通过，不与主会话 3 项合并 | 否 |

原始执行失败保留在本次工具执行记录中，没有把失败覆盖为成功或择优计算。上述重跑是离线环境/测试修复后的验证，不是模型任务重跑。

## 样例复核

- S08 原先意外含有实际位置，已改为仅计划位置；S08/S09 各自提供区域几何。
- S12 用户故障声明原先误挂来源系统证据，已改为最小用户声明，并附实际消息原文；不顺带声称用户确认了数量、分配或位置。
- S07 的未知数量船舶记录改为粒度未知、没有已认证单体身份，避免“已明确单体却不知道实体数量”的题意矛盾。
- 原始数据与预期分文件。12 项是后续开发样例，不是已完成的 12 次真实 Agent 任务；集合选择、合并、空间结果由第二批实现后再核对。

独立检查还修复了局部覆盖契约：没有后续游标、但能解释局部覆盖原因的来源，现在可正确标为 `partial`。新增权限检查从没有来源限制的另一份草稿开始，以证明限制确由新字段的证据依赖继承。

## 独立检查与最终状态

独立检查最终新增资源测试为 14 项；9 个文件、151 项通过，TypeScript、lint/boundaries、构建和 diff 空白检查通过。另有不重叠的 5 个文件、75 项已通过；按最终文件计数去重共 14 个文件、226 项。桌面 3 项单列，不计入 Vitest 分母。

独立检查与完整口径见 [review.md](review.md) 和 [results.md](results.md)。没有未修复的本批范围内缺陷。
