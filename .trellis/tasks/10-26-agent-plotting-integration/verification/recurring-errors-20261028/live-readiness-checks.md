# 真实加载诊断入口：离线就绪检查

2026-10-28。新增 `loading-diagnostic-live/`，原 `evaluation/`、v2、v3 和离线 `loading-diagnostic/` 未修改。本记录证明可授权入口及保护可运行，**没有调用真实模型，没有消耗真实批次claim，也没有批准真实额度**。

## 完成内容

- 固定复用6题×2轮×A/B的24槽，不允许传入其他排期；真实调用校验精确scope、freezeHash、120请求/4M输入/200k输出及独立授权/额度核实字段。
- 用原生Skill选择实现B，在澄清续轮也继续显式选择；A保留按需加载。实际wire/body/tool审计、12对业务初态核对、原始payload/native session都保留。
- T1真实产生澄清问题，v3答复后再读取/保存；T2直接保存；S1创建3对象；R1实际空间预览不保存；R2/S2只读。所有对象保存经过真实工具与服务，不是生成伪造成功回执。
- lower Ledger复用原持久化与Provider，检查请求前预留及实际超额；独立一次性claim，未知用量/错误/漂移停止；关键效果错误停止后续槽。评分24分母不变，协议状态和语义分开；没有实际执行outcome不得填写review。

## 验证命令与结果

命令从 `experiments/harness-lab` 执行，需本机5285监听权限：

```sh
node --import tsx --test --test-concurrency=1 ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/*.test.ts
node --import tsx --test --test-name-pattern='denominator' ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/run.test.ts
node_modules/.bin/tsc --noEmit -p ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/tsconfig.json
node_modules/.bin/eslint --config eslint.config.js ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/*.ts
```

1. 首轮 **4/4通过**，完整24槽、68次受控provider响应，0真实模型请求。
2. 补充120请求边界、同freeze claim拒绝复用、只读/来源guard负例和HTTP越界写入停批后，完整套件 **6/6通过**；其中24槽全跑完，另有1槽故意越界并保留其余23槽未执行。
3. 最后仅补评分守卫：无对应outcome及`not_executed/prepared/started`不得review；`needs_review`仍可以依据真实证据独立判语义通过。该纯函数测试 **1/1通过**；没有因此重复全量HTTP测试。
4. 最终 TypeScript、ESLint通过。

中间失败如实保留：最初typecheck发现测试故意改变literal预算时强转不兼容，改为显式unknown边界；最后补评分守卫首次漏了循环大括号，纯测和typecheck均报`r is not defined`，修正后重跑通过。一次编辑命令工作目录错误而未写入，纠正后才执行修改。这些均未发起真实请求。

## 原始证据目录

根路径 `/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/`：

| 目录 | 结果 |
| --- | --- |
| `plotting-loading-live-FzYmLO/batch` | 首轮24槽，68 synthetic / 0 real |
| `plotting-loading-live-c1WTeF/batch` | 最终完整24槽，68 synthetic / 0 real；全部recorded但semanticReview仍pending |
| `plotting-loading-live-TdCGs8/batch` | 故意新增两个对象，3 synthetic / 0 real；首槽failed，23槽not_executed；stop=`unexpected_or_duplicate_object` |

完整批次逐槽核对：工具schema一致；A首请求无完整标绘Skill、B完整正文送达；12组初态一致；T1发送2轮但原始用户轮次1；B第二轮仍携带合法Skill选择；T1/T2正确创建水罐消防车且为plan；S1三对象；R1产生真实buffer结果但地图状态不变。所有后端/模型成功仍保留语义待复核，不用受控答案作为模型成绩。

临时目录可能被系统清理，不能当作永久归档。固定源码、协议和上述结果记录在仓库，真实测评证据会另用不覆盖的任务本地目录。

## 接下来如何启动真实批次

源码、审阅文档和最终commit稳定后，执行以下命令生成新的冻结文件：

```sh
node --import tsx ../../.trellis/tasks/10-26-agent-plotting-integration/loading-diagnostic-live/run.ts freeze /tmp/plotting-loading-live-freeze.json
```

冻结含当前Git版本、全部实际依赖及判定协议hash；本记录不是授权文件。独立核对实际提供商额度和模型后，用户批准精确24槽范围和硬额度，才可填写真实授权并执行README的live入口。配对保守预留为36请求/1M输入/65536输出，可能提前停止而未跑完24槽；不能扩大额度、删除未执行槽或自动重试。
