# R3A 独立审查

审查依据：用户明确的本轮实施授权、v0.2全文、任务prd/design/implement/interface，原Pi/Interaction/R2/R3与原前端契约。原请求、资产服务及历史为唯一数据源；不把未执行的真实模型、浏览器或用户验收记为通过。

## 发现与修复

1. 方法包白名单遗漏部分安装清单。`method-files.ts`允许JSON/YAML文本却只挡住package/requirements等少数名称；environment.yml、pnpm-workspace.yaml、composer.json等原本可由对话提交。按用户既定范围最小补齐常见依赖清单路径拒绝，保留普通参考文本，不增加内容风险分类或审批。扩展名白名单本已拒绝无扩展名、.npmrc、未知脚本/二进制；带脚本包仍在补丁前整包拒绝，不能先删脚本伪装。
2. 只提交完整SKILL.md文本时，原实现只能保留未列出的其他文件，对正文修改的元数据保真仅有提示。经主会话确认补`methodBody`：只允许已有Skill，服务端在已验证基线上保留frontmatter原始前缀字节，仅替换正文；与同次SKILL.md整文件修改/删除互斥。原完整files修改仍可用，创建须完整SKILL.md。CRLF、注释、license/metadata/未知扩展及未改文件保留，no-op不重序列化、不制造草稿修订。未扩大基础BOM包格式支持；原packageContent不接受BOM。helper的字节切片实现不会自行删除前缀，但不据此声称BOM包集成保存可用。
3. 成功保存回放原本未验证编辑回执的目标与基线同实际批准候选一致。Pi实现者补`targetId`与baseline一致性及保存标题核对；审查者新增异常历史断言，目标或基线被改则严格拒绝，不投影成功。幂等返回原回执的批准来源可为此前同proposal/digest的已批准操作，不能伪造最新call覆盖原持久回执。
4. Skill已有本人试用报告尚未接入只读工具。与Pi实现者协作，service定义精确`readSkillTrial`回调并在仅Skill报告未找到时调用，前后重新检查当前请求/管理员；原skill-routes复用SkillTrials.get的owner守卫，复核trialId+expertId目标，只返回原trial元数据，不另读文件或泄露messages/calls/downloads。

## 已检查的不变边界

- 两类服务在各自原锁和SQLite事务内提交真实草稿、审计与完整回执；新专家完整创建不先造占位。固定proposal ID充当动作ID，异参数冲突，同参数返回原回执。原manual create/save/import/publication API行为保留。
- 候选固定owner/session/request/目标/基线/摘要。request-local Map只保留当前候选，切换对象/新候选使旧建议失效，终止时释放；原回执留在r2_actions/r3_skill_actions，可重开后只读查询，不恢复待确认/不重跑保存。无需新增表或schema迁移。
- Pi在请求开始、每工具、确认后和实际事务前复核当前管理员本人个人空间及active请求；业务/子Agent/后台/试用不注册管理工具。管理工具集替换为6个受控工具+原ask_user，不含Shell、发布、授权、业务或子Agent。普通下一请求不继承管理授权，上传同名包不能授权。
- 真实工具/skill目录及完整SkillRef由原管理解析器校验，旧skillIds保留原义，不允许自动调用包仍拒绝。专家原发布成功试用与独立确认、Skill可选试用和扫描仅报告的语义不变。
- 确认复用原InteractionCard，显示宿主完整实际候选与保存前内容；审批与执行证据分开。保存后留在原聊天，成功回执的普通工具详情提供主动管理入口；新技能打开范围前仍核对摘要。
- 创建主入口调用原新对话/空间流程；次要手动与导入保留，点击/取消不调用模型或写资产。原聊天草稿/附件保留，手动未保存内容须确认放弃或取消。未新增创作页、结果卡片、会话列表或第二聊天存储。

## 定向验证

- 新增安装边界后storage9/9通过，2.63s；异常历史1/1通过，2.35s。
- 加methodBody保真后，storage10 + 异常history1共11/11通过（2.44s），`review-final-targeted.log`。这是本次冻结审查补丁的定向结果，不把重复运行相加。
- 审查拥有的authoring/contracts/tests定向ESLint exit0，`review-eslint.log`；`git diff --check`通过。
- 主会话统一负责最终全局typecheck/lint/build/unit，及真实Ark、桌面浏览器和回退证据。本报告未重复跑全局检查，也不把此前检查当最终结果。

## 未修复与交付限制

当前审读代码未见新增阻塞问题。真实模型服从方法、桌面视觉结果、最终全局门禁和用户验收由主会话分别记录；发布和生产迁移未授权执行。本轮无schema迁移不等于旧二进制可读取R3A新增严格交互字段：回退必须配对升级前的完整备份并保留R3A活动数据，不能用旧程序直接打开新活动历史。未修改旧JSONL或已有不可变修订。
