# R3核心独立审查与修复

范围：完整读取任务PRD/设计/执行计划、原稿v0.3 C01—C18及R1/R2相关规范；审核src/skills、共享契约、迁移以及运行/API接缝。用户总验收不由这些技术检查替代。

## 已修复

1. 不可变blob落盘后授权撤销导致发布事务未提交，重试重新生成createdAt却复用旧blob，造成metadata/blob永久不一致。blob现在验证完整身份并返回原始持久元数据；发布/内置注册复用该值。新增撤权窗口→同动作重试→实际resolve及幂等回执回归。
2. resolve原先仅在异步load前检查授权，范围/账号变动后仍可返回正文。现load后再检查；运行代理另接当前账号authorizeUse，覆盖账号停用与席位匹配。
3. 存储policy未知mode会落入all使用语义、asset.system非布尔也可扩大资格。私有asset/policy解码检查类型/枚举/修订/作用域，损坏失败关闭，新增数据库损坏回归。
4. Semgrep真实错误type有元组格式，原先转成PartialParsing,[object Object]且内部span无法安全投影。现在保留类型首项、实际整数错误码及属于当前包的路径，不输出内部对象或宿主路径。
5. 扫描结束回调在close且数据根已删除后写DB，产生Unhandled Rejection。关闭后禁止迟到写入，残留运行记录由启动转中断失败；新增close→删除→回调测试。首轮12断言虽然通过但有1unhandled错误，不记为通过，已修复后重跑。
6. 发布methodHash保存在修订元数据，提供metadata-only methodHash(ref)；运行catalog不需要解析整个不可变包。公开catalog只查询已发布资产，summary有发布修订时不读取/解析可变草稿；新增损坏无关草稿不影响正式目录、缺blob仍可读metadata但实际加载失败的回归。
7. 引入窄onPolicyChange通知，提交范围/普通生命周期变更后回调；幂等重试不重复通知。运行代理复用已有活动记录和stop来收敛撤权，不新建执行/策略状态机。
8. 按v0.3§6.4增加有界配置：LAB_SKILL_MAX_ARCHIVE_BYTES/EXPANDED_BYTES/FILES/RESOURCE_BYTES/METHOD_BYTES/TEXT_BYTES。仅允许正整数且不超过默认平台上限，启动时验证，纯loader测试不修改进程环境。
9. 默认扫描入口切换至父代理负责的受控Docker sandbox wrapper，开发可显式LAB_SKILL_SCANNER_COMMAND；物理网络/资源边界由父代理独立验证，不将本机直接二进制扫描冒称容器隔离证明。

## 证据与边界

最终冻结核心3文件测试共14/14通过（3.67秒）：skills-review7、skills-core4、skills-import-scanner3。实际日志review-core-14-pass.log；定向ESLint通过（review-core-eslint.log）。新回归包括孤立blob重试、异步撤权、损坏策略/资产、扫描tuple错误脱敏、关闭迟到写入、可配置限额、元数据目录/提交后通知。全局typecheck/lint/test、浏览器、真实扫描、模型/Docker由父代理统一顺序执行，审查代理未并发运行这些重检查，尚不声明全局通过。

新增规范backend/capabilities-r3.md并更新backend/frontend索引和R2交叉链接。公开trial摘要DTO/页面由独立跨层审查代理负责，未覆盖其变更。迁移回退、真实扫描容器、当前运行撤权/惰性装载等集成仍由父代理和运行代理完成证据闭环。
