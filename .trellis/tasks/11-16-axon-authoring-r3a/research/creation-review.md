# 创建入口反馈独立审查

本报告仅审查本次三项创建交互反馈，不代替此前 R3A 阶段或用户验收。阶段仍为 `in_progress`，`userAcceptance` 仍为 `pending`；本审查未提交、push 或部署。

## 审查范围

- 创建专家/技能的单一入口、手动/Skill 方式选择；打开和取消选择不创建会话、草稿资产或模型调用。
- 复用原聊天新草稿页，在页内选择实际授权空间或显式创建空间；首次发送沿原 Session action 创建会话，已有会话绑定不变。
- 管理方法通过真实部署文件、原 Skill 选择/标签/移除/正文查看/历史展示链路提供，不再使用独立创作模式下拉。
- 当前管理员本人个人范围、撤权复核、同名上传包、旧历史严格校验和原确认/CAS/保存回执路径。

已按 active task 的 check.jsonl、PRD/design/implement、management-skill-interface.md、creation-ui-interface.md 及对应 frontend/backend specs 逐层核对源码。

## 审查发现并协作修复

以下产品修复由 Web owner 完成；审查没有覆盖或回滚并行编辑。

1. 能力中心进入 Skill 创建时会直接更换目的空间未发送草稿的方法/编辑目标。现在如目的空间已有正文、附件、方法或编辑意图，先确认；取消不导航、不改选择。切换空间仅向真正空的目的草稿预选管理方法，不搬运原空间附件。
2. 浏览器后退/前进或直达 `/?new` 时可能保留已有会话选择。现在 new route 按导航修订和 URL 消费，恢复显式空会话选择；命令式进入新页同步登记已消费 URL，避免快速首次创建返回后又清空新会话。虚拟空间准备使用真实返回 workspace ID，并丢弃过期导航结果。
3. 原本地草稿仅保存旧 authoring 字段时，新版可能没有可见 Skill。现在只对未发送本地草稿，在真实 metadata 读取后迁移为可见管理 Skill，并保留配对 target/baseline；切换或移除 Skill 清除隐藏编辑意图。未改写已有原生历史。
4. 无空间的新页最初无法打开原 Skill picker。现在原加号可选择、查看和移除管理 Skill；文件与 Agents 仍要求空间，输入和发送仍先选择空间。
5. 全局管理 metadata 曾被无条件合入文件/Agents 列表。现在仅 `mode === 'skills'` 时合并管理方法，保留各原列表含义。
6. root 补查发现，新空间 POST 尚在准备时原 composer 仍可编辑，可能将用户输入写回原空间。最终源码复用原准备状态禁用输入、发送、上传、模型和选择修改；审查补查的附件 remove/retry、地图引用删除及 FilesPanel/ComposerReferences 追加引用也有 guard。管理 metadata 读取尚未返回时采用同样保护。实际请求 hold 用例验证准备期间旧正文保留、按钮禁用、零 Session/模型写入；状态提前声明，避免 render TDZ，没有新增持久状态。

审查自修：新增异步撤权测试的 resolver 在 TypeScript 中仍可能为 undefined；在调用前添加显式 guard，修复 TS2722，不改变产品代码。

旧浏览器回归适配：access.spec.ts 的侧栏创建按钮选择器限定到对应 catalog heading/sidebar，以免与新草稿页同名按钮冲突；侧栏折叠、焦点、权限、草稿与零写入断言原样保留。workbench 的已有会话历史用例保留 root 提供的显式 fixture 空会话，仍断言零模型调用。

## 已核实的跨层约束

- `expert-manager`/`skill-creator` 的 metadata、正文与 hash 均来自实际 SKILL.md；显式选择与按需读取方法同源。普通请求的 native snapshot 不混入这两份方法。
- 选择使用普通 `skill:{id,hash}`；编辑才额外发送配对 target/baseline。mismatch、包修订混用、子 Agent 混用和 stale hash 在模型调用前失败。
- 当前管理员/本人 private personal workspace 的权限在异步读取前后重新核对。历史或用户包名称不恢复管理权限。
- 新 composer v8/resource schema3 明确隔离管理方法；旧 v1—v7 文本模板未变，旧资源 schema1/2 reader 未放宽。readonly 子历史拒绝管理方法 schema；后台、试用、子 Agent 不获得该管理请求路径。
- 管理方法没有伪装成可发布资产，没有新增资产表、数据库迁移、聊天存储、管理专页或新的保存协议。六个原管理工具与 ask_user、操作确认、CAS 和原子保存回执仍沿原路径。

## 独立新增回归

`tests/pi/management-skill-review.test.ts` 两例：

1. 暂停真实管理文件读取，在 await 期间撤销管理员，再恢复读取；最终返回 FORBIDDEN，模型调用为零。
2. v8/schema3 读取正确方法；v1—v7 降级、正文篡改、伪造 package revision、跨 catalog readSkills、readonly 管理历史全部拒绝。

最终定向运行 2/2 通过（31.44s）；新增测试与 access/workbench 的定向 ESLint 通过。首轮 typecheck 的 TS2722 已修复，集成 typecheck 重跑 exit 0。全局 unit、真实 Ark 与最终构建门禁由 root 统一记录，本报告不重复运行全套 unit。

## 验证记录

- 本地定向 unit：2/2 通过。
- 产品相关 TS/TSX 与独立测试共 18 文件定向 ESLint：通过；本审查测试文件定向 ESLint：通过。
- 集成 TypeCheck：独立运行通过；最终准备期 guard 同源码的 TypeCheck 由 root 确认通过。
- 最终准备期 delta 的 main/ComposerReferences 两文件独立 ESLint：通过。
- access/workbench 浏览器：首轮 19 通过、3 个累计 30s 超时（7.3min）；工作台 12/12 已通过。全局 unit 结束后，同配置、单 worker、原 30s timeout 和全部原断言串行复验 3/3 通过（38.4s），因此 22 项均有通过证据。失败时分别停留在重新连接页、登录处理中、长目录管理流程；未删权限/草稿/归档恢复/导航断言。
- `git diff --check`：通过。
- 最终 source hash 已记录于 `creation-review-source.json`：26 个审查源码/测试文件摘要为 `66b474aa500caf1eddaaadaf2bc3021e408960063b548fc3c126f0013b50d3d4`；main 为 `41acd82b528354f9c50be34890dc4f959698ab0d8668e92552243eb57b00ee83`，ComposerReferences 为 `01a8403940f9312f7aa960c7db3c0ba93946fb12d1ecb1fbdc28693093a31c38`。
- 最终准备期追加引用 guard 后的相同源码，Web owner 串行 authoring 三例 3/3 通过（26.8s），含真实 workspace POST 和 metadata GET hold 断言；main hash 与本报告一致。该结果属于 owner 的浏览器证据，详见 `creation-web-implementation.md`/`creation-web-source.json`。root 统一最终全局 type/lint/build、unit 和真实 Ark 证据。

本审查的七份日志均保存在同一 research 目录的 `creation-review-*.log`。独立新增测试当前 SHA256 为 `41cab0e718d03684aaadeb7852337337fa9336611c8de1bc447277c112774d8b`。

## 未修复项

当前源码审查没有已证实且未修复的产品缺陷。root 的全局 lint/build 收尾和用户验收属于独立门禁，不能据此报告本阶段已验收。新原生历史版本的成对备份回退说明已在后端 spec 保留；不可将旧二进制直接指向含 v8/schema3 的新数据并声称兼容。Spec 中对 v8 记录内容的措辞已由 root 改为实际 Skill body/hash；target/baseline 继续由原请求守卫及候选/确认记录约束，没有引入新的意图记录。
