# 实施与验证计划

用户已经批准原评审方案，本文件仅拆分执行职责，不改变产品范围。

## 改动边界
当前没有对话多工作只读识别与侧面板。新增契约和受权读/分析接口、Pi独立分析及前端会话内存投影；复用业务查询、详情、模型运行时与现有认证。需要动到 contracts、pi/lab.ts、server/app.ts、web/main.tsx/Settings.tsx/styles.css 和新增局部模块。数据库、主上下文、正式关联与输入建议语义不改。

## 接口约定
统一契约放 src/contracts/work-activity.ts，由后端实现者维护并优先交付。
GET /api/sessions/:id/work-activity-analysis：只读最新来源与工作版本、确定回执和可用性；无模型请求。
POST 同路径：接受 {sourceRequestId, finalMessageId, version}（来自上述 GET 的来源与版本，无客户端正文/工作候选/身份覆盖）；响应包含同一版本和结构化识别结果。
GET DTO：{version:string, source:{sourceRequestId:string,finalMessageId:string}|null, canAnalyze:boolean, reason?:string, linkedWorkItemId?:string, facts:WorkActivityItem[], evidence:WorkActivityEvidence[]}。
POST DTO：{version:string, source:{sourceRequestId:string,finalMessageId:string}, status:'ready'|'unavailable', items:WorkActivityItem[], coverage:'complete'|'partial', reason?:string}。
WorkActivityItem：{id:string, workItemId:string|null, title:string, description:string, relation:'processing'|'reference'|'uncertain', recency:'current'|'earlier', origin:'receipt'|'analysis', state?:WorkState, evidenceIds:string[]}。
WorkActivityEvidence：{id:string,messageId:string,requestId:string,kind:'user'|'assistant'|'receipt',text:string}。
版本不包含选择模型；包括会话来源及可见业务集合/版本，服务端重新授权。没有成功来源时仍可返回确定业务回执。完整字段校验和错误语义由后端契约负责，前端运行时解码。
席位待办使用现有 /api/work-items 与已有项目/席位显示信息；处理中的会话活动与正式状态分开。

## 顺序与职责
1. 提交规划（仅本任务规划和原评审文档），然后 task.py start。
2. 后端实现者：契约、分析上下文/结果校验、PiLab只读快照及独立调用、API、相关单元/API测试；先发布契约，禁止改web。
3. 前端实现者：会话内存/重新验证/忽略与重试、折叠面板、main/Settings/CSS、浏览器测试；禁止改后端及契约，与后端协调字段。
4. 主代理：独立代码审查、集成修正、真实模型隔离样例验证、规格和验收记录；不并行运行多个完整测试runner。
5. 质量检查：npm run typecheck、npm run lint、相关 Vitest、相关 Playwright、npm run build、git diff --check。完整测试仅在出现需扩大验证的影响时运行。
6. 实现完成后报告结果及未验证项，待用户测试；没有部署请求不更新4316。

## 风险与回退
独立分析可能误判、超时或因上下文预算产生不完整覆盖，必须显式表达。关闭面板/识别即可回到既有工作入口；无数据库迁移。真实模型验证只用隔离数据和合成业务，记录成本/延迟与失败，不能用模拟模型宣称语义准确。
