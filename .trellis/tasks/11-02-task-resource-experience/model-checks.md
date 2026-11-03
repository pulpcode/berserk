# 第三批：模型配置实现与离线检查

本文件只记录 B3-05。未访问真实模型 API、未读取真实密钥、未修改线上配置或部署。下述请求均由本地替身接收；不能据此声称远端已开启内部推理、套餐扣费正确或业务正确率提高。

## 改了什么

- 在现有模型设置增加推理选择：沿用旧请求、明确关闭 `off`、明确开启 `high`。设置页沿用原有保存、配置版本与冲突处理。
- `resolveModelThinking` 按实际模型 ID 与规范化 HTTPS 地址验证能力；provider 是用户可修改的注册名称，不作为能力证据。
- 将原 `lab.ts` 的模型注册抽出为 `pi/model-runtime.ts` 的 `configuredRuntime`。产品已使用此入口，未来测评可直接复用；本批没有改写历史 probe 或历史结果。
- 已核实组合通过 Pi 原生 `reasoning`、`thinkingLevel`、`thinkingFormat:deepseek` 和 `supportsReasoningEffort` 发送参数，没有另建请求插件框架。
- 请求开始时仍捕获 profile；正在准备、执行、委派或后台运行期间沿用原有忙碌保护。新设置只用于后续请求。

## 支持范围与官方依据

本次核实日期：2026-11-02。SDK：`@earendil-works/pi-ai`、`@earendil-works/pi-coding-agent` 均为 **0.85.1**。

| 模型 ID | 地址 | 本批支持 |
| --- | --- | --- |
| `deepseek-flash` | `https://api.deepseek.com` 或 `/v1` | 明确 off/high |
| `deepseek-v4.1-flash` | `https://ark.cn-beijing.volces.com/api/plan/v3` | 明确 off/high；不依赖 provider 别名 |
| 其他模型或地址 | 任意 | 旧请求可继续；开启 high 明确拒绝，不静默降级 |

依据：

1. [方舟 Agent Plan 的 Pi 接入示例](https://docs.volcengine.com/docs/ark/agent-plan-personal-pi?lang=en)：给出 Agent Plan `/api/plan/v3`、`deepseek-v4.1-flash`，当前示例容量为 1024000、最大输出 393216。无网络 SDK 注册继续使用人工配置的容量，不自动改变既有部署参数。
2. [方舟深度思考说明](https://docs.volcengine.com/docs/ark/deep-thinking?lang=en)、[DeepSeek-V4.1-Flash 模型说明](https://console.volcengine.com/ark/region%3Acn-beijing/docs/deepseek-v4-1-flash)：支持 enabled/disabled，Chat API 使用 `reasoning_effort`，high 是支持的配置。文档中具体版本名与 Agent Plan 公布的模型别名结合使用；不把其他模型、任意自建 endpoint 推断成已支持。
3. [DeepSeek 官方思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：官方 Chat Completions 的 thinking 开关、推理强度和工具续轮规则。
4. 已安装 SDK `pi-ai/dist/api/openai-completions.js`：`thinkingFormat === 'deepseek'` 且声明支持 reasoning 时，原生生成 enabled/disabled；high 映射 `reasoning_effort:'high'`。同文件原生保留 `reasoning_content` 的签名和工具续轮。`api/simple-options.js` 原生按剩余上下文裁剪输出 allowance。

只支持本批核实的文本 Chat Completions 路径。没有扩展 Responses、图片输入或其他推理等级；不对其他模型的 encrypted reasoning 协议作兼容保证。

`.env.ark-plan.example` 是明确开启 high 的示例，更新为上述当前官方容量；不自动加载、不部署、不含密钥。旧 `.env` 没有新增字段时保持原请求。显式保存的本地模型设置仍按原规则覆盖环境值。

## 旧配置和回退

原来 Pi 会话层为 off，但自定义 Ark provider 的旧请求可能根本没有 `thinking` 字段，不能推断远端一定关闭。此次用“字段是否显式存在”保留这个区别：

- 缺少 `thinkingMode`：Pi 会话仍按旧 off；旧 provider 为 `deepseek` 时仍发 disabled；其他 provider 维持原 payload，不凭空添加开关。界面显示“沿用旧请求（未指定开关）”，不声称远端已关闭。
- 只保存容量、密钥等其他字段：仍保留缺省状态，不暗中写入 off。
- 明确选择 off/high 并保存：已核实组合使用新的原生适配；未知组合不能开启 high，界面明示该组合开关尚未核实。
- 旧 schema 1/2 单配置与 schema 3 目录均可读；仅启动或读取不重写文件。显式保存后单配置写 schema 4，目录写 schema 5。版本检查、原子写入与同源密钥保留限制不变。
- 旧二进制不认识 schema 4/5，不能直接用新文件回退运行。回退前须备份新文件并恢复与旧版本匹配的配置备份；本批不自动降级/覆盖配置。没有改动历史会话记录格式或历史测评分数。

公开设置响应包含 `thinkingMode`、`thinkingSupported`、`thinkingExplicit` 及现有配置 version、模型、端点、输出能力，不返回密钥。`thinkingExplicit=false` 时 mode=off 仅表示旧 Pi 会话层选择，不能据此推断远端行为。

## 请求捕获与路径证据

新增 `tests/pi/model-thinking.test.ts` 使用真实 `PiLab` / Pi SDK，仅替换最终 `fetch`。每次校验实际 URL 为 Agent Plan `.../chat/completions`，读取 JSON 请求体；不保存或输出 Authorization。

| 路径 / 主题 | 实际断言与结果 |
| --- | --- |
| T20 配置 | 未知 endpoint/model 的 high 被拒绝；provider 别名不影响已核实组合；非法 mode/null 被拒绝；schema1/2/3保持原文件，4/5可保存重启；CAS版本变动；公开设置无密钥 |
| T21 主回复与工具续轮 | 明确off发 `thinking.type=disabled` 且无effort；high发 enabled+high。一次真实 `source_read` 后续轮保留模拟的 `reasoning_content`，该内容不出现在公开会话响应 |
| T22 子任务 | 主Agent委派 analyst、子Agent返回、父Agent续轮，共3个请求，均enabled+high |
| T22 后台 | `createBackgroundExecutor` 的服务处理请求，enabled+high；角色权限未改 |
| T22 自动压缩 | 实际历史达到阈值后走 Pi 原生自动压缩，再继续主回复，两类请求均enabled+high。原生摘要 allowance 会按剩余上下文裁剪，本例最终wire为2871，处于2048以上、5600以内 |
| T22 共用压缩适配 | 直接进入相同controlledStream的compaction路径，显式测试 allowance=700，wire精确为700，且不插入宿主AGENTS提醒 |
| T22 运行中修改 | 请求被预留后保存模式返回busy；原请求仍off；结束后显式保存high产生新版本，下个请求才high |
| T23 无思考正文 | 正常正文/工具结果没有思考正文仍可成功；只见HTTP心跳时持续保活，最终正文可完成 |
| T23 真正停滞、取消 | 空闲80ms无字节则失败；主动取消得到aborted；单次provider请求均无自动重试 |
| T23 Pi原生重试 | 本地首次503、后续成功，捕获2次HTTP请求、2次modelAttempts，均保持enabled+high；不是SDK transport悄悄重试 |

现有产品没有公开的手动压缩入口，本批没有新增；共用compaction适配单测不冒称已经通过手动压缩UI验收。

**重试口径**：提供方 transport 为 `maxRetries:0`；产品 Pi 原生 `retry.enabled=true, maxRetries=3, baseDelayMs=2000` 保持原状，因此一次可重试错误最多产生原请求加3次原生重试。既有transport回归仍验证持续空闲失败会有4次请求。这里的“0”不能写成“整个产品绝不重试”。本批真实模型调用为0，离线测试也不调用远端，不存在真实测评追加。

## 命令与首次失败

工作目录为 `experiments/harness-lab`，除非另行说明。测试使用 `--configLoader runner --cache=false`；测试数据写系统临时目录，未向共享 node_modules 写构建缓存。

1. 首次 `npm run typecheck`：本模块 resolver 返回值被TS推断为string，已补明确的 `ModelThinkingMode` 返回类型；并行Skill测试union错误交由所有者修复。
2. 首次从仓库根执行 `npm exec --prefix experiments/harness-lab -- vitest ...`：因Vitest root在仓库根而找不到test。调整为包目录执行。
3. 首次新模型测试：9/10通过；自动压缩断言误把Pi上游预算5600当作最终HTTP值，实际SDK原生按剩余上下文裁到2871。查阅 `simple-options.js` 后修正为验证原生裁剪边界，另有700预算精确wire测试；未改产品压缩预算。
4. 旧 `tests/model-config.test.ts`、model-settings/catalog 的新写入schema断言原为2/3，按新4/5升级；旧格式输入fixture仍保留。
5. 两次批量编辑因命令cwd为包目录、相对路径仍包含包前缀，报FileNotFoundError，未写入文件；随后在正确cwd执行。期间旧测试运行记录不混作最终通过数。
6. 一次共享typecheck遇到并行 `tests/e2e/annotations.spec.ts` 类型错误；共享lint遇到main.tsx两处无用import，已通知UI所有者处理。模型模块自身未出现lint错误。
7. 旧兼容wire自查发现新适配可能自动给旧Ark alias补disabled；已在交付前修复为未显式配置时保持原wire，补旧alias/deepseek两条真SDK断言。不是远端发现，也没有进行真实调用。

最终针对模型相关的命令：

```sh
npx vitest run --configLoader runner --cache=false tests/pi/model-thinking.test.ts tests/pi/model-settings.test.ts tests/pi/model-catalog.test.ts tests/model-config.test.ts tests/pi/transport.test.ts tests/pi/compaction.test.ts tests/pi/subagent.test.ts tests/pi/background-runner.test.ts
```

**8文件，117项通过**（最后一次完整执行，18.00秒；不把之前重复运行相加）。其中新增model-thinking为18项。`npm run typecheck` 最新已通过；`npm run lint` 最终结果由下方补记。

浏览器页面由根代理/界面验收统一执行。这里不把单元测试当作设置页面的截图证据。

最终补记：UI所有者清理两处未用import后，再运行 `npm run lint`，**通过**（含 Pi/browser dependency boundaries）。`git diff --check` 通过。上述117项之后仅修正文档注释和删除重复空行，没有修改模型运行逻辑。

## 独立审核追加的跨层修复

设置页真实浏览器保存high首次返回400，发现server/app.ts共用modelBody遗漏thinkingMode，直接lab/store测试未覆盖。已在严格schema添加off/high；新增model-settings测试走单模型PUT、目录POST、目录PUT三条真实HTTP入口，非法mode/null/boolean/额外字段仍400且配置不变，缺字段保存仍不显式化。两文件最终19项通过（新增1项），不与此前117项相加。设置浏览器实际保存与125%原生缩放通过，未发送Agent消息。
