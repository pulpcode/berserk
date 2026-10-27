# 产品提示修复工程检查

日期：2026-10-27。依据：第5版修复方案，审阅稿提交 `c6b5dc8`。本报告记录产品实施子代理实际执行的检查，不包含测评器检查或新真实模型成绩。

## 改动范围

产品文件：

- `experiments/harness-lab/src/pi/annotation-tools.ts`
- `experiments/harness-lab/src/pi/spatial-tools.ts`
- `experiments/harness-lab/fixtures/skills/map-annotations/SKILL.md`
- `experiments/harness-lab/fixtures/skills/spatial-analysis/SKILL.md`

测试文件：

- `experiments/harness-lab/tests/pi/provider-payload.test.ts`
- `experiments/harness-lab/tests/pi/spatial.test.ts`

工具描述与 Skill 落实目标确认、逐项完成明确要求和证据核对步骤。保留真实工具的数量、分页、字段、版本及空间关系语义，以及权限、CAS、整体字段替换和不确定回执处理。未修改工具参数结构、执行逻辑、服务、数据库或前端。

## 实际命令与结果

以下 npm 命令均在 `experiments/harness-lab` 目录执行。

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 首轮发现新增测试直接读取联合类型 `AnnotationRef.setId`，TS2339；改为使用实际成功工具回执的 `ref` 后，重新执行通过 |
| `npm run lint` | 通过，含 Pi/browser 依赖边界检查 |
| `npm run build` | 通过，2239 modules；有大于500 kB chunk的提示，未作为本轮范围扩大或顺带优化依据 |
| `npm test -- tests/pi/provider-payload.test.ts tests/pi/spatial.test.ts` | 2个文件、16项通过 |
| 下列相关回归命令 | 11个文件、244项通过 |
| `npm test -- tests/pi/spatial.test.ts -t 'saves the fixed geometry'` | 类型错误修正后定向复跑：3项通过、9项因过滤未执行；该3项已包含在上述16项中，不重复计数 |
| `git diff --check -- experiments/harness-lab` | 通过 |

相关回归完整命令：

```sh
npm test -- tests/pi/annotations.test.ts tests/pi/annotation-workflow.test.ts tests/pi/annotation-hook-boundaries.test.ts tests/pi/annotation-source-history.test.ts tests/pi/composer-input.test.ts tests/annotations.test.ts tests/annotation-from-source.test.ts tests/map-symbol-contracts.test.ts tests/annotation-results.test.ts tests/spatial-point-classification.test.ts tests/spatial-contract-boundaries.test.ts
```

合计 **13个测试文件、260个唯一测试通过**。首次类型检查错误和其修复保留在记录中，不将重复定向运行增加为新的通过样本。各测试使用受控 provider，Pi工具循环、回执、版本和对象读写为真实实现。

## 新增验证覆盖

1. 实际 provider 请求包含新版目标选择、完成检查、查询范围与空间关系描述，保存工具仍不接受 `informationRole/style/note` 参数。
2. 两个 Skill 均通过原生 `skill_read` 按需读取；实际交付正文逐字匹配仓库文件，并核对资源记录与原生历史。首次请求未强制携带完整正文。
3. 保存固定范围后，分别验证仅保存、补充信息性质、补充备注。检查精确原几何、同一对象身份、只新增一个对象、原对象不变、未要求字段保持缺省，以及没有发布。
4. 既有属性保留、符号约束、身份定位、冲突、原回执恢复、固定结果与空间分类等回归通过。

## 非描述代码一致性检查

在 `experiments/harness-lab` 使用本地 TypeScript 编译器API执行一次静态对比：通过 `git show c6b5dc8:experiments/harness-lab/<path>` 读取两个工具文件基线，分别解析基线和当前源码的 AST；仅将所有名为 `description` 的属性赋值初始化器替换为相同字符串，再用同一 TypeScript printer 输出并比较。

结果：`src/pi/annotation-tools.ts` 与 `src/pi/spatial-tools.ts` 去除描述文字后的 AST 均与基线完全一致。该检查支持“只修改描述、参数结构及执行逻辑未变”的结论；真实描述送达由 provider payload 测试另行验证。

## 限制与未执行项

- 未调用真实模型，也没有使用旧30槽成绩证明新版有效。上述检查证明说明送达、结构兼容和既有工具组合能力，不证明模型会正确选择、持续执行或准确解释。
- 未重新运行全部浏览器E2E：本轮未修改前端或业务写入流程，按方案执行相关工程回归。
- 未修改4324试用服务、另一worktree、原冻结驱动或历史测评证据；未执行合并、推送或Git提交。
