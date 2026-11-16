# R3基线核查

2026-11-15：HEAD与fetch后的origin/codex/axon-r2均5969069f565d28c753962daca1fe8bf3de17885c，规划前工作树干净。R2技术/线上记录见既有任务acceptance.md，用户总验收pending不等于安全回归失败。

ResourceService的controlledSkillIds/effectiveSkillIds/loadControlledSkills保持固定四项；SkillRevision仅方法正文；skill-metadata用Pi公开frontmatter解析但要求固定ID及非空正文，不能直接作为全部开放规范校验。Docker仅/workspace可写和/logs只读，需新增请求包挂载。

已浏览官方Agent Skills规范及Semgrep本地规则/忽略文档：
- https://agentskills.io/specification
- https://docs.semgrep.dev/running-rules
- https://docs.semgrep.dev/ignoring-files-folders-code
正式规范及可执行依赖/规则快照在R3-0锁定，当前尚未安装扫描器、执行产品测试或改变运行环境。
