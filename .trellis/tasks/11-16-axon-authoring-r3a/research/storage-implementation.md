# R3A storage implementation

无需schema/数据迁移：复用既有r2_actions及r3_skill_actions；候选在当前请求固定Map并通过原Pi工具/确认历史存证，重启不恢复待确认。只读receipt查询在数据库重开后可核对已提交结果，不重放写入。

原专家/技能服务saveAuthoring在各自原锁内校验、同一SQLite事务写完整草稿/必要资产、审计、实际receipt（owner/session/request/proposalId/digest/target/baseline/confirmation及实际新revision/digest）。proposalId为稳定动作ID，同ID异参数冲突；原子失败不会遗留占位。没有跨连接外层事务。

AuthoringService拥有真实目录、原目标读取、expert字段patch、skill文件patch、固定候选和一次采纳；输入深拷贝，摘要验证，基线必须吻合。新候选或切换目标使旧候选失效。既有文件/字段保留，明确removePaths才删除；脚本/二进制/安装要求包仅手动维护，不允许先删脚本伪装方法包。保存不碰范围或发布，沿原enqueue调度扫描。现有手动create/save接口无行为变更。

Pi在原确认获得批准后调用commit；commit给原服务注入当前assertActive/管理员检查，在锁内、异步包引用校验后及事务前复核，阻断停止/撤权窗口。授权撤销发生在已提交之后不假称回滚。目录不泄漏私人试用；expert报告仅本人trial。

验证：首轮5测试因夹具只注册review而缺synthesis内置失败，修复夹具后5/5。追加专家精确patch、脚本不可擦除、数据库重开后查询，storage8+原专家/技能3文件19项=4文件27/27（11.01s）通过。最后在补同ID异参数断言、使用显式假scanner避免测试触发真实扫描后，storage8/8（3.16s）通过。定向ESLint退出0，git diff --check通过；早期typecheck通过但共享Pi/web继续变化，最终全局门禁由root负责。

场景覆盖：完整创建；同参数回执；异参数冲突；创建/receipt故障事务回滚；两类CAS及保真patch；未知工具、额外approved字段、脚本拒绝；跨目标候选失效；停止撤权；跨owner/session回执隔离；数据库重开只读查询且无待确认恢复。测试不证明真实模型/扫描器/用户验收。未部署、未提交或push。
