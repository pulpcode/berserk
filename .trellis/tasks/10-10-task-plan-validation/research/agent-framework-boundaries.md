# Agent 场景边界与桌面验证记录

日期：2026-10-13。代码基线：`908bf64` 加本轮新增验证文件；Node `v24.14.0`。本记录对应 [端到端方案](../agent-framework-e2e-plan.md) 的 E01～E09 中可确定性验证的框架部分，**不代表真实模型主流程已经通过**。

## 1. 结果与改动范围

- 66 个不同的定向 Vitest 用例通过，其中新增组合场景 1 个，复用已有用例 65 个。
- 当前代码的 12 个既有 Playwright 用例通过，默认桌面视口为 1440 × 960，包含 1280 窗口、三栏缩放、地图展开还原与固定引用交互。
- 包级 TypeScript 检查、新增文件 ESLint 检查通过。
- 未修改产品代码、权限、提示词或生产数据，未调用真实模型，未部署。
- 两类首轮失败分别属于测试材料编写错误和旧前端复用，详情保留在第 4 节，未将首轮记录替换为后续通过结果。

新增 [agent-framework-boundaries.test.ts](../../../../experiments/harness-lab/tests/agent-framework-boundaries.test.ts) 补足跨模块组合断言：单个正式账号，在同一任务和席位创建 A/B 会话，从同一个发布版派生独立草稿；通过真实本机 HTTP 更改合成来源；A 保存、发布和设为任务当前后，B 的草稿、固定选择、原发布版保持不变；B 查看 A 后仍只修改自己的草稿。最后验证 A/B 普通文件目录相同，分别用文件名保存成果，避免误称普通文件会话隔离。

此测试直接调用正式身份服务和本机来源；文件内容由测试驱动写入，用于验证工作区路径边界，不作为 Pi 文件执行或模型自主选取文件名的证据。测试账号被显式授予任务管理权限，以独立执行采用操作；不同权限账号的拒绝行为使用既有正式 HTTP 测试覆盖。

## 2. 专项覆盖矩阵

| 编号 | 本轮实际证据 | 结论与限制 |
| --- | --- | --- |
| E01 同用户双会话 | 新组合场景；`annotations-acceptance` 多会话生命周期；桌面 independent drafts | 同一个正式 userId／seatId／taskId 的两个会话可独立派生并交错修改。采用发布版不改写另一个草稿和固定版本。无多账号共席假设 |
| E02 查看引用不换编辑目标 | 新组合场景；原生 Pi `keeps own-session write target`；桌面 fixed reference／overlap 用例 | 查看其他草稿或发布版不切换本会话写入目标；历史引用精确到固定修订。原生 Pi 测试用确定性提供方，不能证明真实模型每次都会正确选目标 |
| E03 同草稿并发 | 正式 HTTP CAS；原生 Pi stale save；桌面 CAS retains form | 过期写入明确冲突；用户未保存表单在刷新后保留，显式核对后才能重提。桌面用后台服务写入模拟人工／Agent 交错，没有增加两个实体页面的压力测试 |
| E04 指代不明 | 此组未执行真实模型判断 | 不能由工具严格校验或 fake 模型回复推导“模型会澄清”；交由本轮真实模型专项记录 |
| E05 来源失败、过期、缺几何 | `context-http` unavailable/unknown/time/cursor；`situation-source` 兼容缺几何；`situation-map-ui` 不生成无几何的已证据链接；桌面来源离线保留旧数据并展示错误 | 框架能区分来源失败与空结果，历史数据不被替换。真实模型是否诚实说明缺口仍需独立观察；包含“无位置”详情的既有综合浏览器用例本轮未运行 |
| E06 未知保存结果 | 桌面丢弃成功保存响应后查询回执，仅 1 次 apply；HTTP／原生 Pi 幂等；来源通知丢失响应后只查询回执 | 保存响应丢失可恢复，未产生第二次业务写入。发布幂等有服务测试；本轮没有单独在浏览器丢弃发布响应或制造任意进程崩溃 |
| E07 真实权限 | `access` 正式登录／私有任务／跨席位文件会话；`annotations-acceptance` 私有草稿与采用权限；`annotations` 来源撤权后禁止读取、复制派生与回执；原生 Pi 跨任务回执／账号替换 | 已执行的服务、HTTP 和原生 Pi 权限边界通过；不依赖提示词或模型自律。公开任务元数据并不等于跨席位私有内容读取权 |
| E08 来源与版本区分 | 新组合场景真实来源 revision 1 → 2，A 采用新发布版；桌面来源错误与固定引用状态；旧证据原生历史重开 | 来源可变，B 草稿、固定引用和原发布版仍可读取原属性与哈希。组合层验证来源更新与采用，桌面没有另写两动作同时发生的新流程 |
| E09 文件边界 | 新组合场景 A/B 共享 filesDirectory、分名保留；`access` 跨席位私有文件读取拒绝 | 框架边界是任务 × 席位。分名保存保留旧文件属于本轮操作约定；框架没有新增普通文件自动版本化或并发合并 |

另外复用了原生 Pi 的小上下文、按字段读取几何、500 对象自动上下文大小保持不变、自动压缩后重读原固定修订等测试。这些是确定性提供方下的 Pi 机制证据，不是本轮真实业务会话已发生上下文压缩的证明。

## 3. 实际命令与输出

以下命令均在 `experiments/harness-lab` 中执行。监听本机端口的测试经工具授权在沙盒外运行，数据使用独立临时目录；没有访问在线业务服务。

第一组（新增测试修正前）：

```sh
npm test -- tests/agent-framework-boundaries.test.ts tests/annotations-acceptance.test.ts tests/annotations.test.ts tests/access.test.ts tests/context-http.test.ts --maxWorkers=2
```

输出：5 文件，**41 passed / 1 failed**，32.92 秒。失败仅新增测试漏填必填发布名称；第 4 节记录修正。4 个既有文件的 41 个用例通过，没有无理由重复整组。

修正后仅重跑新增测试：

```sh
npm test -- tests/agent-framework-boundaries.test.ts --maxWorkers=1
```

输出：**1 passed**，1.39 秒。

第二组（补齐原生 Pi、来源历史、缺几何与上下文观察）：

```sh
npm test -- tests/pi/annotations.test.ts tests/situation-source.test.ts tests/situation-map-ui.test.ts tests/context-composer-map.test.ts --maxWorkers=2
```

输出：4 文件，**24 passed**，9.37 秒。最终不同用例合计 `41 + 1 + 24 = 66`。

桌面浏览器在修正测试环境后执行：

```sh
CI=1 AXON_E2E_PORT=5198 npm run test:e2e -- tests/e2e/annotations.spec.ts tests/e2e/situation-map.spec.ts --grep-invert 'unified source tree' --workers=1 --output=/tmp/axon-agent-framework-boundaries-browser-current
```

输出：**12 passed (1.5m)**。`CI=1` 禁止复用已有端口服务，5198 为本轮独立 Vite 端口。测试使用本地瓦片夹具并拦截公共 OSM 请求，不证明在线底图连通性或真实地理对齐。

排除了综合 `unified source tree` 用例以避免额外执行其窄视口专项；其无位置详情部分也相应未计为本轮浏览器覆盖。复用的 `three columns`、`layer tree` 用例内部既有 350px 窗口断言仍被原样执行；本轮未修改这些既有用例、未新增手机设计或手机验收，不能把这些截图解释为手机产品支持。

质量检查：

```sh
npm run typecheck
npx eslint tests/agent-framework-boundaries.test.ts
```

修正后均退出码 0。只增加验证代码，因此本子任务未运行全量构建／全量测试或部署；根任务可据最终整体变更执行统一检查。

## 4. 首轮失败与纠正

1. **沙盒未允许监听端口**：首个 Playwright 命令在 Vite 启动处报 `listen EPERM: operation not permitted 127.0.0.1:5187`，测试没有开始。经授权重跑，不记为产品失败或通过。
2. **复用了旧前端**：默认 `reuseExistingServer` 使下一轮使用 5187 上的旧页面。失败页面显示“账号”，而当前 `Seats.tsx` 提供“席位”选择；前两个用例等待 `getByLabel('席位')` 超时，第三个被主动中止，剩余 9 个未运行。没有修改产品或放松定位器；改为 `CI=1 AXON_E2E_PORT=5198` 启动当前代码，再运行 12 个用例全部通过。
3. **新测试材料漏填发布名称**：第一次 Vitest 在新增文件的 publish 动作报 `INVALID_INPUT / 标注输入无效`。同轮 TypeScript 检查发现两处 publish 缺必填 title 和来源 properties 联合类型不适用于标注的标量属性。为两个发布动作补业务名称，并在来源查询结果中明确验证 availableCount，再选择标量车辆属性，未改产品校验。仅重跑受影响新增测试和类型检查后通过。

上述原始失败保留，既有产品的合法必填和属性边界未为通过测试而放宽。本组没有发现需要修改产品代码的已验证缺陷。

## 5. 原始日志与截图位置

原始材料已由主执行者复制到仓库忽略目录 `.local/agent-framework-e2e/boundaries/`，未加入 Git；以下保留初始临时路径以便追溯。总报告见 [本轮验证结果](agent-framework-validation.md)。

| 内容 | 本机路径 |
| --- | --- |
| 首次沙盒启动失败 | `/tmp/axon-agent-framework-boundaries-browser.log` |
| 旧前端 2 失败 / 1 中止 / 9 未运行 | `/tmp/axon-agent-framework-boundaries-browser-escalated.log` |
| 旧前端错误页面与 trace.zip | `/tmp/axon-agent-framework-boundaries-browser/` |
| 当前代码 12 通过日志 | `/tmp/axon-agent-framework-boundaries-browser-current.log` |
| 当前代码截图 | `/tmp/axon-agent-framework-boundaries-browser-current/` |
| 第一组 41 通过 / 新增 1 失败 | `/tmp/axon-agent-framework-boundaries-unit.log` |
| 新增用例修正后通过 | `/tmp/axon-agent-framework-boundaries-unit-fixed.log` |
| 原生 Pi 等 24 通过 | `/tmp/axon-agent-framework-boundaries-native.log` |
| 类型检查修正前 / 后 | `/tmp/axon-agent-framework-boundaries-typecheck.log`、`/tmp/axon-agent-framework-boundaries-typecheck-fixed.log` |

已目视检查当前代码的 `annotation-reference-1440.png` 和 `three-column-resize-1440.png`：只读参考、固定 r1 状态、当前绘制图层与三栏地图区域可区分；地图背景为测试瓦片，不能据此评价实际底图。

E04/E05 真实模型表现、S01～S07 三轮业务过程、实际文件与交接成果、上下文用量及耗时已合并入总报告，均不以本记录的确定性通过数替代。
