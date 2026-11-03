# 24项真实对照：执行前离线检查

用户已批准12题×A/B共24项；先4项流程关口通过后继续20项，不自动重试或追加。A固定ba3fc69，B固定74986e0；相同原生按需Skill，Flash enabled/high，限300请求、800万输入、50万输出。未核对账户余额，不宣称额度足够；真实429立即保存并停止。

- 首轮3/3：预算/参数合同；24/24真实HTTP夹具准备、两组文档和题干一致；首4受控HTTP/Pi完整链路26次受控响应，0真实请求。
- 回复白名单/冻结依赖扩充后的受影响3/3：首4重新离线通过；P04两组真实CAS冲突、重读和保留人工备注（10受控响应）；S06两组来源港区内1点、草稿港区内4点，来源港区实际可查询。
- 最终两处修正2/2：P04从实际JSON读到target触发（不依赖heading关键词）；多问题共享一条冻结回复在单次交互中原子消费，跨交互不重复。
- 最终TypeScript和根目录ESLint通过。所有模型输出均受控，没有连通性探测或真实模型调用。

最终6个测试定义分批验证，不声称最后重跑了全量6项。24夹具完成约74秒，首4模拟约20秒；P04最终约11秒。不存在测试挂起。

证据路径（临时目录可能由系统清理，真实批次另行永久归档）：

- 24夹具：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-live-2Gp8f5/batch`
- 回复扩充后首4：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-live-PAsQK6/batch`
- 最终P04：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-live-MDjEBu/batch`
- S06：`/var/folders/td/741qp46d52b2b8_2zdzj7ps40000gn/T/integrated-live-S4z0Ix/batch`

首次TypeScript暴露环境对象推断过窄，修正类型后通过。首次冻结命令父目录使用了包内相对目录，未生成冻结文件、未发模型；纠正为仓库`.local`后重新生成。历史错误不计为任务失败。

## 如何执行复核

真实目录拟为 `.local/agent-spatial-plotting-20261029/live`；`pending.json`显示待处理检查点和decision文件路径。普通答复用`advance/reply/hold`；结构化AskUser按真实questionId映射冻结replyId，经原生interaction API提交。未知问题`hold`保持同一进程和服务，等待`.next`文件，不猜答案。每条固定回复跨plain/API只消费一次；原题和澄清分开计数。

首4需`first4-review.json`，绑定行状态哈希、复核人、理由和pass；不因模型答错停止。P05两组服务分别保留到浏览器检查同一对象，browser-review绑定实际会话/地图证据哈希。全部原始回复与决定保留；语义正确另由复核记录。

冻结源包含驱动、评分口径、计划、精确fixtures/replies、实际共享helper与产品脚本，运行时git archive另行完整哈希。一次授权claim阻止换目录重用同一批预算。动态复核材料写`reviews/`，不能写驱动根层json造成冻源变化。
