# R3 技能包核心实现记录

新增contracts/skills.ts和skills/package、import、service、scanner、migration。SkillService使用既有capabilities.sqlite新增r3_skill_*表和独立meta1，保持旧capability user_version2；现存库需显式停服迁移，新安装由createdNew允许初始化。原R2修订与历史不改写。

核心接口已交接运行与UI代理：create/import/saveDraft/validate/publish/setPolicy/lifecycle/list/detail/catalog/resolve/resolveForManagement/getPublished/assertAvailable/prepareTrial/materialize/materializePackage/registerBuiltins/scans/rescan。完整包hash覆盖清单和要求，发布修订另含版本身份，旧快照固定；发布不要求成功扫描或试用。格式报告显式检查或发布实际检查后持久化，GET不新建报告。管理actor在锁内及blob写入后复查。

导入使用yauzl lazyEntries，有界实际展开、规范路径/链接/重名/目录冲突/包装/CRC32检查。Markdown原字节保存。标准元数据按Unicode小写字母数字/连字符和码点长度检查；空正文是Axon提示，未知扩展保留；调用资格扩展使autoInvocationEligible=false，运行代理须过滤自动目录。确定性包内Markdown引用缺失错误，外部URL不下载。

扫描读取部署manifest与固定规则，默认semgrep或LAB_SKILL_SCANNER_COMMAND。固定快照只复制脚本，不带包内配置；本地规则hash/工具version核对，关闭metrics/versioncheck/nosem/gitignore及ruleID路径重写，stdout+stderr预算、超时与进程组终止。队列64/并发2，同snapshot+versions进行中重扫复用；报告只更新自身scanId，失败不影响发布。重启将pending/running置中断失败，不自动重放。

验证：tests/skills-core.test.ts与tests/skills-import-scanner.test.ts合计7/7通过，最终2.17秒；核心、契约、两测试及CLI scopedESLint通过。首次lint发现控制字符regex，改为字符码检查后通过。没有运行全局tsc/lint、没有宣称真实模型/Docker/扫描器平台总验收。最后close幂等修正是低影响收尾，交父代理集成复核。

待集成：运行代理的当前账号授权及inflight guards、动态候选autoInvocationEligible、只读实际挂载、专家固定包和试用；UI/API；父代理真实Semgrep/Docker证明、全局typecheck/lint/build。父代理真实扫描发现恢复解析的坏Python未必报错，应基于原始Semgrep报告核对覆盖/解析状态，不能将未报告错误假定完整解析。
