# 激活中断与跨定义升级的操作恢复流程

本流程使用M1已有的操作回执、固定请求和任务映射，不新增终止激活、自动回滚或跨系统事务。恢复的目标是**完成原激活**，再进行升级和新轮创建；它不把已经归档的旧任务自动恢复为活动状态。

## 适用状态与所需资料

Axon的`LAB_DATA_DIR/scenario-runs/.activation.json`为`pending`时，服务器会阻止其他场景写操作。已经进入pending的原激活失败返回`409 SCENARIO_ACTIVATION_PENDING`，页面应保留原请求供核对/继续；未产生pending的前置拒绝与401/403仍保持原错误。旧轮三个任务可能已经部分归档，而来源活动指针仍指向已暂停的旧轮。来源端若已经提交激活、只是响应丢失，也可能出现相同的Axon回执状态；先核对，不能只凭报错判断。

保留以下资料，限定运维访问，不把凭证或完整数据副本放入Issue/聊天：

- Axon完整数据目录，包括认证/任务数据库、会话/文件、`scenario-runs`映射和`.activation.json`。
- 来源完整`MOCK_CONTEXT_DATA_DIR`，包括`simulation.sqlite`与停服前尚未合并的SQLite附属文件；不只导出某一条场景记录。
- 两侧所运行版本、配置及原来源版本的可恢复构建；记录目标实例的`definitionId`、`definitionVersion`、`definitionHash`。
- 原激活的`clientActionId`、实例ID、`expectedRevision`、`expectedActiveRevision`和`terminateUnsent`，以及原操作者`userId`。

原操作者必须仍是同一个账号，具有当前配置指定导演席、独立场景控制权、两个来源的读取权，以及继续归档所需的公共任务管理权。新建同名账号不等于保留原`userId`。登录会话失效可以重新登录原账号；不要复用过期Cookie/CSRF，也不要伪造`actor`。

## 升级前的检查

1. 停止新的导演操作及并发写入，核对浏览器的待核对请求和服务器`.activation.json`。有`pending`就先处理下面的恢复流程，不能带着未完成激活升级定义。仅看实例列表不足以证明激活已核清。
2. 用原导演身份查询`GET /api/simulation/operations/{原clientActionId}`。若返回已提交的激活，核对操作ID、`kind=activate`和目标实例ID；该查询会把匹配的Axon pending回执写为`complete`。再核对任务和活动指针。
3. 若没有pending且没有进行中的请求，停止两侧进程及会写入其数据的作业，按既有停服备份流程保存完整数据与版本。SQLite文件应停写后成组备份，不能在运行中只复制主文件。
4. 完成原激活核对后才升级。定义变更后，旧实例可以保留只读；后续演示创建新实例，不把旧实例的hash或修订号改成新定义。

## 已升级且卡在pending时

1. **保留现状。** 停止新的操作和并发写入，按上述要求保全两侧完整数据、原请求和版本。不要删除/改写`.activation.json`，不要手工改实例hash、修订号、任务映射或来源活动指针，也不要重建三个任务。
2. **先查询原操作。** 仍使用`GET /api/simulation/operations/{原clientActionId}`：
   - `200`且确为原激活：来源已经提交，查询即可核清Axon回执；转到完成检查，无需重发。当前定义不同不会阻止读取已提交操作的固定回执。
   - 明确`404 CONTEXT_NOT_FOUND`：来源没有该操作记录，可以继续下面的版本核对；404本身不会清除pending，也不证明旧任务没有归档。
   - `401/403`、网络/来源错误或无效回执：先恢复原账号授权、连接或正确数据源；不要把它们当作“未提交”而换一个操作ID。
3. **恢复匹配定义的来源版本。** 在停服与备份后，恢复发布目标实例原`definitionHash`的来源代码/构建，保留当前来源数据库及Axon数据。启动后以导演接口核对`GET /api/simulation/scenarios`中定义hash与`GET /api/simulation/instances/{目标实例ID}`一致。恢复代码版本不等于回滚业务数据。
   - 只使用能够读取当前数据格式的已验证版本。若旧构建与当前数据库格式不兼容、原构建缺失或两侧资料不完整，停止本流程，按完整备份恢复方案处置；不能把旧严格读取器直接指向不兼容的新数据。
   - 核对目标仍为prepared、修订仍等于原`expectedRevision`；来源活动指针/活动修订仍对应原请求，旧轮仍暂停，通知与后台作业限制满足。若有其他写入导致不一致，保留证据并停止；不要“刷新”原请求中的修订号绕过冲突。
4. **再核对，然后原样继续。** 再次查询原操作；仍为明确404时，才以同一原导演账号向`POST /api/simulation/instances/{原目标实例ID}/activate`提交原请求。`clientActionId`和全部业务字段保持原值，不新增`actor`。页面仍保留待核对请求时，使用“核对操作结果”→“重试原请求”；不会自动重放。
5. **处理原限制。** 若仍有忙碌任务、未完成工作或授权问题，先通过既有业务流程解决，再重复原操作核对/重试。已归档的旧任务会被归档循环跳过，剩余任务才继续处理；没有自动回滚，也不会因为重试重新创建演示任务。
6. **完成后才再次升级。** 按下面的完成检查确认原激活成功，停服备份后再升级来源定义，并创建新轮。

## 页面原请求丢失时的只读核对

服务器回执仍是依据。`inputHash`当前是JSON编码的固定元组，不是可以重新计算覆盖的状态：

```text
[目标instanceId, 原userId, expectedRevision, expectedActiveRevision, terminateUnsent]
```

由运维在Axon主机上只读恢复请求摘要；先设置为实际部署的数据目录，不使用示例目录覆盖现有数据。下面脚本只输出操作参数，不读取或输出凭证，不写任何文件：

```sh
node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dataDir = process.env.LAB_DATA_DIR;
if (!dataDir) throw new Error('请先设置实际 LAB_DATA_DIR');
const receipt = JSON.parse(readFileSync(join(dataDir, 'scenario-runs', '.activation.json'), 'utf8'));
const args = JSON.parse(receipt.inputHash);
if (!Array.isArray(args) || args.length !== 5) throw new Error('请核对原回执格式');
const [instanceId, userId, expectedRevision, expectedActiveRevision, terminateUnsent] = args;
if (receipt.state !== 'pending' || instanceId !== receipt.instanceId || userId !== receipt.userId
    || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
    || !Number.isSafeInteger(expectedActiveRevision) || expectedActiveRevision < 0
    || typeof terminateUnsent !== 'boolean') throw new Error('回执不一致，停止操作');
console.log(JSON.stringify({ userId, path: `/api/simulation/instances/${instanceId}/activate`, body: {
  clientActionId: receipt.operationId, expectedRevision, expectedActiveRevision, terminateUnsent,
}}, null, 2));
JS
```

使用现有认证API客户端按该摘要提交；当前登录`userId`必须匹配，保留当前有效CSRF与身份视图校验。摘要没有授予权限，不绕过登录；不能用另一个操作ID替换它。若原回执损坏，停止并核对备份，不猜测参数。

## 完成检查与证据边界

- 原操作查询返回`200`，ID/实例/`kind=activate`一致，服务器`.activation.json`为`complete`。
- 实例列表的活动指针为目标新轮；旧轮为frozen，新轮为active。
- 两轮`GET /api/simulation/instances/{id}/initialize`所列仍是原任务ID；通过`GET /api/tasks/{taskId}`核对旧轮三个任务为archived、新轮三个任务为active，其他任务未受影响。
- 旧会话、文件、固定来源引用与原生工具结果继续保留；激活或归档不等于业务支援任务完成。

验证命令（harness-lab目录）：

```sh
npx vitest run tests/scenario-director-api.test.ts -t 'resumes the original pending activation' --maxWorkers=1
```

该测试用既有任务忙碌限制制造“首任务已归档、第二任务归档返回`409 SCENARIO_ACTIVATION_PENDING`、来源尚无操作”的真实HTTP/SQLite状态，再用测试内存中的发布hash变更模拟定义不匹配，确认pending保留、新操作被阻止，撤销导演权限后仍返回403且不泄露操作ID。恢复原发布hash后，同一原操作ID及参数能够完成，首任务修订不再增加，任务ID/数量保持不变，模型调用为零。

这证明现有协议在上述前提下支持受控继续，不证明任意版本/数据库格式可逆、真实进程崩溃全过程、全自动跨版本恢复、自动撤销或业务状态回滚。M1-A11保留这些限制，不记为全面自动恢复通过。
