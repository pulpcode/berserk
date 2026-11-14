# 统一登录与能力中心修正审查

审查范围为最新用户四项要求对应的变更，旧R2草稿/试用/发布/迁移模块沿用此前审查；本轮未增加数据库schema或更改账号密码。

## 已核实的数据流

- 匿名选择目录：loginSeats保持旧席位约定，loginUsers仅返回当前启用、仍有管理员角色的无席位账号ID与显示名。独立账号不进入历史/业务席位目录。
- accountId、seatId、username选择器互斥；accountId在服务端重新解析当前账号资格，再走原密码派生验证、节流、CSRF、Cookie/view轮换。撤权/停用后选择项及登录身份失效。
- 登录只挂载一个带固定API客户端的Axon树；根App先收窄AccountIdentity再挂载业务hook。无席位账号使用共享ApplicationSidebar及同一CapabilityCenter，不挂载useChat/useTasks、不请求业务数据。/admin及业务深链接仅规范为/capabilities。
- 管理员使用现有管理目录/授权，普通用户使用获准发布目录；技能目录仅投影当前受控方法的id/name/description，不含工作区文件内容、工具或业务席位目录。连接器保持真实空状态。
- “创建专家”是显式点击POST、保留动作ID并防同一进行中重复提交，成功后按返回expertId打开原编辑器。管理面板挂载及详情/列表/标签读取均不POST；既有CAS、试用、人工确认、发布门禁仍在服务端。
- 专家/技能详情使用既有原生dialog；专家协作子dialog保留原焦点恢复和既有创建意图，未引入新模型/工具执行循环。
- shared sidebar的品牌、折叠、ref、关闭和Settings footer从原业务树抽取，业务导航内容和异步业务hook保持原路径；无席位设置仅提供账号与退出。

## 修复

`.trellis/spec/frontend/harness-lab.md` 仍只描述loginSeats/seatId，缺少最新统一能力中心表现约定。已补齐loginUsers/accountId、共享应用壳、无业务hook、三类目录和显式创建的契约与验收文件。

未发现需要修改产品代码的安全或功能阻塞项。未执行提交/部署，也未启动额外并行检查，避免重复TypeScript/浏览器进程竞争本机资源。最终类型、lint、构建和回归由主代理现有检查统一收尾，确切结果以acceptance和原始日志为准。

主代理确认本轮集中检查结果：TypeCheck进程13749退出0；lint进程5793退出0，保留2条既有InteractionCard警告；build进程78483退出0。之后的两处CSS修正不涉及身份/接口/类型；主代理正在执行最终顺序浏览器与检查收尾，本审查未另启重复进程。
