# 产品修改离线检查

2026-11-03。本页只记录产品检查，不代表真实模型正确率。未调用真实模型，未自动提交或推送。

## 已实现

| 项目 | 修改与边界 | 验证依据 |
| --- | --- | --- |
| R1 规则一致 | 单一范围仍不明确时先澄清；用户明确要求比较时分别处理。更新工具说明与两个地图 Skill，不强制读取 Skill。 | 提供方实际请求中的工具 description、注册 schema 和 Skill 测试 |
| R2 完整引用读取 | annotation_read 新增 mode:reference，从当前会话分支既有 composer 记录恢复固定版本及所选图层/对象；通过现有读取服务继续校验权限。未新增引用存储，不影响普通读取入口，也不建立可写依据。 | 完整图层分页、同版本多份对象选择、错误序号与跨会话拒绝、跨轮/原生压缩/重启后读取 |
| R3 必要解释 | Skill 增加短例子：区分来源与标绘对象、不重复扣除计划记录、分别保留各区域分类、答全用户要求的时间；规则效果等待后续真实对照。 | Skill 加载及实际请求检查；离线检查只能证明已送达 |
| R4 卡片范围 | 无 position 时标为“按所选空间结果集合统计”；明确 interior/boundary/exterior 时保留对应标签。没有修改统计算法。 | React 渲染断言及真实 Pi/服务链路的桌面浏览器检查 |

新显式引用使用 composer v6；v1—v5 原文模板保持不变。v6 在 v5 正文后增加定位说明。原生工具调用仍保存实际 mode:reference 参数，结果投影回显解析后的固定版本与选择；历史读取不依赖伪造的调用参数。

## 检查结果

- 相关 7 个 Vitest 文件首轮 114 项通过：annotations、composer-input、provider-payload、resource-explanations、map-skill、annotation-hook-boundaries、annotation-results。
- 补充边界后，annotations 定向 33 项通过；composer-input 与 provider-payload 合计 31 项通过。这些与上面的 114 项有重叠，不能相加计分。
- `npm run typecheck --prefix experiments/harness-lab`：通过。
- `npm run lint --prefix experiments/harness-lab`：通过，Pi/浏览器依赖边界检查通过。
- `npm run build --prefix experiments/harness-lab`：通过，2906 modules；保留既有大包警告。
- `git diff --check`：通过。
- 桌面 Playwright：以下命令最终 2/2 通过，25.6 秒。首次 2/2 也通过；复核截图后补了地图完成加载的等待，重新生成截图，无产品修改或真实模型重试。

```sh
npm run test:e2e --prefix experiments/harness-lab -- tests/e2e/annotations.spec.ts --grep 'resource statistic card shows real spatial filter' --workers=1
```

## 浏览器实际验证

题目数据通过 AnnotationService 保存为真实固定草稿。确定性提供方只决定调用参数，实际执行 task_resource_query → spatial_analyze classify_points → task_resource_query summarize，浏览器通过本地真实 API/Pi 历史读取结果。

- 三个已分配、可用且具有实际位置依据的资源分别处于内部、边界、外部；另一个候选缺少实际位置与任务关系依据。
- 真实空间分类断言为 total=3、interior=1、boundary=1、exterior=1，位置缺口另列 1 项。
- 未传 position：统计记录/条目 3 项，名单实际包含内部、边界和外部资源；卡片显示“按所选空间结果集合统计”，不误标为内部。
- 传 position:interior：统计记录/条目 1 项，名单只有内部资源；卡片显示“范围内部”。
- 1440×960 宽屏与 1280×960 三栏最窄聊天面板均无页面或卡片横向溢出，标签可换行阅读。地图面板等待草稿 r1 和 canvas 就绪后截图。
- 展开卡片、调整面板和截图没有额外提供方调用；无浏览器 pageerror。

截图（最终版本由主代理保存在本任务）：

- [集合统计，宽屏](browser/resource-statistic-collection-1440.png)
- [集合统计，三栏窄面板](browser/resource-statistic-collection-1280-split.png)
- [内部统计，宽屏](browser/resource-statistic-interior-1440.png)
- [内部统计，三栏窄面板](browser/resource-statistic-interior-1280-split.png)

## 仍需后续验证

以上证明工具边界、历史兼容和卡片表现符合设计，不证明模型一定主动选对引用、读 Skill 或正确解释结果；这些必须由计划内独立模型对照检验。浏览器使用本地测试瓦片和确定性提供方，不构成线上地图数据源或真实模型效果验收。
