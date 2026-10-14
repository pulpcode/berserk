# 地图 Agent 工作流独立审阅

日期：2026-10-14。审阅范围为本阶段 prd/design/implement 与实际共享工作区代码。上一阶段未提交内容以 `.local/agent-map-workflow/baseline.json` 为分界；`ac50ba1` 不包含上一阶段来源工具实现。未提交、未部署。

## 已修复发现

1. `src/pi/lab.ts`：原后置工具钩子可以把成功读取标为 `isError:true`，而原实现只因写入错误清理请求状态。这样错误读取仍可能在下一次推理前成为可写依据。审阅指出后由 Pi 实现者修正为所有 annotation 工具与 situation_query 的错误/替换内容均使依据失效；钩子异常停止执行。`tests/pi/annotation-hook-boundaries.test.ts` 使用真实 SDK 会话与公开钩子注入验证读取错误、来源错误、内容替换及已提交后钩子异常。
2. `src/pi/annotation-tools.ts`：适配器完成内部工作后仍可能被最终取消/权限检查拒绝。Pi 实现者把前后检查纳入统一 try/catch，并在任何失败时清理请求依据；新增提交后、最终检查前取消的回归，确认已提交数据保留但状态不再可用。
3. `.trellis/spec/backend/map-annotations.md`、`backend/conversation-references.md`、`frontend/harness-lab.md`：原规范仍描述模型填写机械修订、单对象来源工具、两项 Skill 与旧引用展示。审阅者同步已实现的宿主状态、批量与幂等契约、受控 Skill 兼容及结构化入口，保留 HTTP 显式 CAS 和旧历史语义。

## 路径核查结论

- `AnnotationRequestState` 在每个受认证前台请求内创建；普通推理才提升新读取。顺序写入通过真实 beforeRef/afterRef 推进，旧回执无推进。固定历史读取、自动元信息不会建立草稿编辑依据；取消、实际消费的 steer/follow-up、压缩完成使依据失效。
- `actionFromHost`、`fromSourcesFromHost` 在已读版本上检查草稿身份/CAS；创建检查空状态及 bindingRevision/baseRef。原 HTTP 入口保留显式条件。失败不会取最新 head 重试。
- 批量来源在网络查询前验证所有目标，逐项核对真实来源修订，最终通过既有单事务保存；第二项失败、容量、撤权、取消和外部保存不会留下半批结果。刷新沿用同一 ID，保留名称、业务字段、样式及其他引用。
- 宿主幂等摘要使用规范化原始意图和捕获的任务/会话；机械版本变化不改变同调用意图。回执重放重新检查当前权限，不能借其他任务/会话绕开摘要与归属检查。
- Skill 通过统一 effectiveSkillIds 暴露，磁盘工作区两项基础 Skill 不变。正文仅显式选择或按需读取进入模型；受控三项白名单、hash、请求及父子历史校验未放宽为任意资源。后台 Profile 与子工具白名单不随新增方法扩大。
- UI 根据实际成功工具结果生成固定引用，同一 requestId 的最终答复只取该请求证据。旧回执明确标为原动作，固定引用不切换编辑目标；后台权限检查仍决定真实读取。来源按钮读取当前授权态势，与历史证据修订分开。

## 验证

审阅者最终执行：

- `npm run typecheck`：通过。
- `npm run lint`：通过，包含 Pi/浏览器依赖边界。
- `npm run build`：通过；现有大包体积提示仍在，不是构建失败。
- `git diff --check`：通过。
- 新范围：`annotation-from-source`、`annotation-map-evidence`、`pi/annotation-workflow`、`pi/map-skill`、`pi/annotations`、`pi/annotation-source-history` 六文件 **76/76**；`pi/annotation-hook-boundaries` **5/5**。
- 既有回归：`annotations`、`annotations-acceptance`、`context-http`、`pi/composer-input`、`resources`、`task-information-api`、`server` 七文件，共 **68 个不同用例最终通过**。首次 17 个 HTTP 用例因沙箱拒绝监听 `127.0.0.1` 而失败；允许隔离本机端口后重跑涉及的两文件，18/18 通过（其中 1 个此前已通过）。没有把这些环境失败记为产品缺陷。
- 第一次审阅运行还遇到实现中的 compaction 假模型用例未产生目标写调用，以及该文件 prefer-const。Pi 实现者修正原生压缩夹具与局部声明后，上述最终检查通过；不是删除断言或放宽产品保护。
- 主会话另外报告桌面地图测试 **14/14** 与构建通过；浏览器命令及更广回归的完整记录由主会话验证报告汇总，未在此重复运行。

上述审阅者范围合计 **149 个不同确定性用例**，不叠加重复运行或主会话的重叠用例。

## 未修复发现与限制

当前已检查代码未发现仍需修复的具体正确性问题。没有据推测增设对象级合并、跨轮状态恢复或新权限机制。

真实模型固定 11 案由主会话随后执行，本审阅尚不评价 Skill 触发率、业务图层选择或真实模型完成率。整份草稿 CAS 会拒绝与目标对象无关的并发保存，这是本阶段明确采用的保守粒度。来源查询只保证已读修订匹配，不构成跨系统同时快照。结构化地图入口不是正文论断的逐句证明。旧二进制不保证读取新增 Skill 历史，未来部署须使用兼容回退包或恢复停机前的独立备份。

## 固定真实模型批次报告复核

批次完成后再次核对 `validation.md`、本地 `2026-10-14T03-50-33.671Z/analysis.json` 和 `semantic-review.json`。逐案重算结果为 70 次模型请求、17 条用户请求，input 182,250 / output 14,109 / cacheRead 901,504 / total 1,097,863，与报告一致。主流程模型请求/工具调用分别 10/11、10/10、28/31，第三轮拒绝确为 ANNOTATION_READ_REQUIRED 4 次与 SOURCE_READ_REQUIRED 4 次。

3/3 的范围是保存几何、来源修订、身份及固定版本结果；未指定图层两案已写入后解释，应判失败，不能把自动正则的“确认/调整”当成事前澄清。Skill 可用 7 案仅 2 案实际加载，图层对照四对全部未加载，不能用其结果证明 Skill 正文有效。正文尺度错误、私有性误述及来源事实与保存属性混淆均有保留；报告未夸大为全面业务通过。

仅补两项表述：累计 token 不是单次上下文大小；两个同名歧义案通过的是先澄清/不写入，不是几何生成成功。未改产品代码、原始模型记录或重跑模型。
