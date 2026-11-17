# 管理方法作为真实只读 Skill

## 实现边界

- 新增部署维护的expert-manager/skill-creator两份SKILL.md，registry只登记id/kind/version；description/body/hash来自精确文件正文。原capability_authoring_method和显式Skill加载同源，不安装或执行用户包。
- 新增admin metadata/detail只读API，可在尚未选择空间时显示/查看方法；原workspace resources/detail只有当前管理员本人personal/private范围可获得方法。每次读取前后复核current账号，foreign/业务/非管理员拒绝。读取无资产、模型或schema写入。
- 原skill:{id,hash}选择推导既有AuthoringIntent，普通上传包即使name相同仍为随机asset ID，不授管理权。管理方法不可与package修订/子Agent混用；legacy authoring字段仅兼容，若与选择的kind或普通Skill冲突拒绝。详情edit的target/baseline原守卫保留。
- 只有显式管理Skill请求将该真实SkillFile加入固定request资源snapshot；普通native snapshots不混入管理方法。显式正文经原composer输入加载/展示，host不再重复注入完整方法；原6管理工具+ask_user、原确认/原子保存/回执流程保持。
- 新composer v8和resource schema3明确标记管理Skill，旧v1—v7及资源schema1/2校验保持严格，未改旧模板文本/JSONL。readonly子历史拒绝管理schema。管理Skill不是伪造的可发布asset，不加入原CapabilityService包状态授权；当前管理员/个人请求守卫负责实际工具权限。无新资产表、schema迁移或聊天存储。

## 验证

- 新测试5例首轮4过，1失败为断言误认为provider仍保留Pi custom role；实际原Pi适配已将其转换。修正断言为实际provider消息文本中完整注册method JSON恰好一次，未改产品实现来配合测试。
- 最终management-skills5 + 原authoring6 + composer-input/recovery，共4文件51/51通过，23.49s；保存首轮失败与最终日志。覆盖真实API登录、目录/内容读取、普通/foreign权限，真实Pi确认保存与重新打开v8历史、下一请求不保留管理工具、stale hash零模型、矛盾字段、撤权、同名普通包不扩权、旧版本不放宽。
- 定向ESLint exit0，git diff --check通过。第二次集成typecheck exit0；首轮包含1处本实现account identity类型narrow错误已修复，及web并行编辑的过渡错误，日志保留。最终全局门禁和真实模型由root统一。

源码此时冻结供独立审查；若review后再改，以主会话最终hash/证据为准。本实现未改web、未部署、提交或push，阶段用户验收仍pending。
