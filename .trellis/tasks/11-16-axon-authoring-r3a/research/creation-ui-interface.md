# 创建入口反馈共享接口

Backend提供只读SkillInfo[]：GET /api/admin/capabilities/authoring-skills；SkillFile：同路径/:id。固定真实注册id为expert-manager、skill-creator，内容/hash均服务端登记。当前管理员本人个人workspace的原resources.skills和skills/:id也返回它们。

Web统一原Skill picker/chip；主入口预选真实metadata，传普通skill:{id,hash}。创建无需authoring字段；编辑额外保留authoring:{kind,targetId,baseline}，必须与所选管理Skill一致。切换/移除Skill清除编辑意图，不设置“对话模式”。正文查看在无workspace时走admin只读正文路径；有workspace时仍可统一用该只读入口。

创建专家/技能只有一个按钮，原Panel弹窗选择“通过 Skill 创建”或“手动创建”；导入不变。

侧栏新建与Skill创建统一到原chat空草稿页，不提前创建Session；使用当前/最近可用真实workspace，否则未选择。页面内选择实际授权task/personal空间；task虚拟条目只在用户显式选择时调用原workspace准备API。新空间仍使用原TaskPanel（或测试模式workspace表单），确认后只准备草稿，不调用模型。现有Session绑定不可变。

useChat.beginNew将workspace对应selected明确设为空字符串，Activity刷新保留这个显式新草稿状态。首次发送沿用原create及稳定session action。各workspace草稿/附件保持原scope；显式切换workspace不搬运附件。页面保留每空间已有新草稿，未选择空间可见原输入区与管理Skill标签，也可查看/移除/选择管理Skill；先选空间再输入、发送或上传文件。

不加新聊天存储/API，所有保存/确认/原子回执沿原路径。阶段用户验收仍pending，不commit/push/deploy。

空间准备及管理方法metadata读取/预选复用同一临时choosingNewSpace标志。准备期间禁止旧scope输入/发送/上传、引用和选择修改；正文、附件及已有选择原样保留，当前导航离开时旧异步结果不得写回。该标志只属于原页面临时交互，不是新会话状态或持久授权。
