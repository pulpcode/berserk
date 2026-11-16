# 技能步骤与目录布局调整验收

## 产品范围

- 主顺序为技能内容 → 使用范围 → 检查与发布；历史与隔离试用保留手动入口。
- 新建确认已原子保存完整内容，成功后直接进入范围；导入、复制与现有技能仍从内容打开。内容无修改时提供下一步，有修改保存成功才前进。
- 范围成功保存后进入检查并运行现有格式校验；校验失败保留“范围已保存”的事实及错误，允许重试。没有自动模型、试用、重新扫描或发布。
- 发布仍需说明、勾选确认和显式按钮，成功后进入历史，完成返回列表。
- 失败/CAS不跳页，不覆盖本地字段；GET/扫描刷新不导航，保持独立CAS基线与会话动作ID。
- 标题与导入/创建同一flex行。只依据真实archived状态折叠归档记录，普通草稿（包括合法空正文草稿）仍显示。归档管理只读。

## 修改文件

- experiments/harness-lab/src/web/SkillLibrary.tsx
- experiments/harness-lab/src/web/CapabilityCenter.tsx
- experiments/harness-lab/src/web/skill-management.css
- experiments/harness-lab/tests/e2e/skills.spec.ts

无服务端/schema/鉴权改动，无部署、提交或push。历史占位资产的线上维护由主会话在备份后单独操作。

## 验证范围和准确计数

- skills.spec.ts共12个独立用例：原8个保留权限/CAS/导入/隐私/Unicode断言并适配自动切页，新增4个覆盖完整链路、草稿409、范围已保存但检查503、标题同排与真实归档分组。
- 全部12/12通过，最终全套日志skill-flow-browser-final.log（54.2秒）。随后只调整了检查页顶部按钮同排wrapper，无行为变化。
- 该wrapper之后流程/标题两条2/2通过（27.9秒），日志skill-flow-browser-visual.log。
- 为得到内部滚动区完整归档卡片证据，仅截图语句再次聚焦1/1通过（21.0秒），日志skill-flow-browser-archive-final.log。
- 为得到成功历史/完成入口截图，仅截图语句再次聚焦既有流程1/1通过（20.3秒），日志skill-flow-browser-completion.log。
- 上述重复运行不增加独立用例数。各相关流程中fake模型调用均为0。
- 定向ESLint覆盖上述两个TSX及skills.spec.ts；全局类型、lint、build及其他9条浏览器回归由主会话/独立checker运行。

## 视觉验收

人工查看1060宽度header、发布和归档展开图：标题/操作同排、顶部返回/检查按钮同排、发布按钮完整可见；合法intentional-empty草稿仍在普通目录，归档new-skill只出现在展开的归档区。自动边界框断言验证1060/1440标题与操作按钮中心y差小于2px，文档无横向溢出。

截图均以skill-flow-为前缀，含header/scope/publish/complete的1060/1440双尺寸以及归档折叠/展开1060图。source hash和日志清单见skill-flow-source.json。CapabilityCenter最终不可达分支修正由独立checker负责，hash文件仅记录生成时的文件状态。

## 后续

主会话完成最终全局门禁、精确历史占位归档维护与4316部署。UI变更无遗留已知阻塞。
