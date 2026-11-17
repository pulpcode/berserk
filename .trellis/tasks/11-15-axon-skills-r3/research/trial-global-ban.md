# R3试用的既有全局封禁守卫

交付复核发现：prepareTrial及resolveForManagement仅验证管理员与不可变包，隔离试用requestGuard也只有管理员检查。R3资产已banned时仍能被隔离试用，违反v0.3第8.3节/C10/C16保留既有封禁与取消的要求。

最小修复：SkillService.assertTrialAllowed(skillId)只拒绝当前全局banned，普通disabled/archived及正式seatpolicy不用于阻断管理试用。prepareTrial在入口与不可变快照await返回后复核。resolveForManagement作为管理读取保持可用，管理员仍能查看被封禁内容和历史。CapabilityTrials增加内部可选executionGuard(actor,trial,expert)，仅接入既有执行guard和100ms撤权定时器；get/list/history不调用该执行守卫。SkillTrials与R2专家试用分别从当前SkillService检查实际schema2依赖。后者不取消或更改R2专家发布门禁。没有新增封禁UI、第二模型循环、策略引擎、镜像或schema。

新tests/skills-trial-ban.test.ts通过真实认证/API/Pi、仅模型替身，证明：
1. 已封禁技能的草稿/已发布试用入口均拒绝，零模型调用，管理详情及试用列表仍可读。
2. 普通停用且policy-none仍可由管理员试用；之后封禁不隐藏已完成历史，不能启动新试用。
3. 模型等待期间封禁，通过既有定时器取消真实Pi请求，替身provider收到abort，管理员仍可读失败历史。
4. 包读取await期间到达封禁在返回前被复核，零模型调用；管理读取本身保持可用。
5. R2专家固定引用组织技能的试用同样在运行中封禁后停止，未新增模型调用。

首轮3项9.17秒通过；补入await竞争与R2专家案例后，五个受影响完整文件21/21通过38.62秒：skills-trial-ban、pi/capability-trials、capability-trial-management-sync、skills-api、capability-management-api。全局typecheck、定向ESLint、diffcheck通过。新R2案例最初草拟时使用错误管理方法名saveDraft，在该文件被测试进程加载前已更正为现有save；没有因此产生或改写失败测试结果。

日志均保留于同目录。先前真实方舟/Docker探针不包含此晚期守卫补丁，不能声称与最终源码完全相同；此次为替身模型/API的确定性封禁验证，父代理统一交付声明。scripts/probe-skills-r3.ts仅增加SkillTrials.open必须的当前资产守卫回调，未重新付费执行。
