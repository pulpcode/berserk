# 初步依赖核查

> 本文保留当时的初步建议。产品方向以当前 `Axon_导演台整合方案_v0.1.md` 为准：互斥运行、确认后结束旧轮次、本轮删除旧页面地址且不兼容跳转。
- 普通控制：src/web/situation/Simulation.tsx → server/context-routes.ts 的 /simulation、object-updates、report-updates、actions/:id/send → scripts/mock-context/control-api.ts。通过来源管理权和查询可见性校验；当前未直接要求controlScenarios/directorSeatId。
- 场景控制：ScenarioDirector → server/scenario-routes.ts → mock-context/scenarios/control.ts。要求controlScenarios、指定directorSeatId、来源权限；任务准备还要求createPublicTask。
- 两者共用simulation配置/控制服务，但来源、流程和权限不能仅按mock/scenario名字推断。普通控制读取同一simulation.sources；当前线上为scenario来源。probe-context/probe-task-plan/probe-situation-map及示例仍引用mock来源，不能直接停用。
- 数据：mock-context/server.ts维护普通对象/报告/变更；场景引擎有独立按轮次状态和虚拟时钟。query.ts在无明确绑定时可选择active instance，单纯合并页面不能确保自由调试读到隔离数据；必须显式锁定调试数据范围，禁止回退运行中演练。
- 服务启动main.ts将两者放入同一simulation.sqlite位置管理，实际表/轮次由各存储管理。上线迁移此次仅保留原四source及整个background/context配置，不变更任何模式。

建议：统一导演授权，导演台加方式选择；保留原演练面板。自由调试进入独立调试实例/数据域，查询、编辑、通知预览固定该域，显式动作才写入/发送。重置只作用于调试域；演练控制继续按轮次/修订、虚拟时间、历史回执。旧页面先导航到新入口，旧API和source保留兼容直到调用审计和迁移验证通过，再决定停用。

实施前仍需细化通知目标配置、订阅规则的实际活跃依赖及自由调试实例契约；这是方案确认后的工作，不宣称隔离已实现。

## 线上只读核对
notifications.json仅列scenario-intel-source、scenario-situation-source；普通control-api和场景control都按systemId从同一targets选择。此前按名称将mock来源等同普通模拟、scenario等同演练的解释不充分：当前两个UI发送可能走同一scenario来源。后台历史/规则/授权按source统计见online-source-dependencies.json，仍需保留这些依赖，不能直接删除mock来源。

## 审阅补充方向
本阶段同时完成情报/态势业务接入整合：各自包含查询和通知管理，运行来源四转二；旧来源保留历史身份，不长期保留写入口。前文“先保留再决定”是早期研究建议，以审阅稿6.3节为准。迁移必须列明凭证、规则、权限、去重和在途回执的处置，不能简单合并授权。

用户进一步确认：后续仅两个有效来源标识，历史保留实际原始标识，不要求历史也只有两个；列表归类与底层身份分别处理。曾提出“历史也迁入两个标识”的解释已撤回，未实施该迁移。
