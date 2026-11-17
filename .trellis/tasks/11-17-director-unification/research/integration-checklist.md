# 集成检查清单

## 唯一权威和迟到操作
- 唯一source active pointer；无浏览器mode、另一个db active指针或新页面默认值替代。
- 两个客户端同时切换：仅一个CAS成功，另一个409，不重复创建/发送。
- 创建调试、结束到演练选择、调试重置均有稳定operationId、明确参数绑定、读回执与显式重试。
- 已提交编辑/发送落在旧轮次：保存并归属旧轮或拒绝，不能落入新轮。
- 未确定通知阻挡切换；已接收回执可读，不因切换撤回、重送。
- 重启恢复关闭中的admission，不能让旧模型/后台任务发布至新轮。

## 权限与历史
- directorSeatId与controlScenarios双条件；system admin、普通source manage均不等同。
- 旧普通写API绕开UI直接调用不得改活动演练或无轮次调试。
- 原历史sourceId/payloadHash/messageId/nativeJSONL/receipt原样；只读映射不扩大旧ACL。
- retired source禁新POST/upload/规则操作；GET旧回执/信息历史按旧授权读取。
- 合并来源不能将旧mock权限union进scenario；模式profile/recipient配置需要可信轮次校验。

## 界面与部署
- /director唯一入口；/simulation与/scenario-director浏览器地址无redirect/fallback；API路径不机械替换。
- 调试form无JSON要求；保存不发通知，通知独立明确。
- 真实4来源fixture可dry/apply/reopen并保留原历史，碰撞/冲突零写拒绝，backup配对可回退。
- 不部署、不调用真实外部写服务；测试数据全部隔离。
