# 本次创建入口反馈 Web 实现

本轮只处理用户最新三项交互反馈，用户验收仍为 pending。没有提交、push、部署，也没有创建第二聊天页、聊天存储或资产生命周期。

## 实际行为与草稿归属

- 专家和技能各只保留一个创建按钮，用现有 Panel 选择“通过 Skill 创建”或“手动创建”；原导入、完整手动创建、复制和管理详情保持。
- 侧栏新建、分组加号和通过 Skill 创建进入同一原聊天空草稿页。页面使用 NewSession 内联空间选择和原 TaskPanel 新建空间。选方法、进入/离开页面、取消创建都不建 Session/资产、不写模型；首次发送仍使用 useChat.create/send 和原稳定 action ID。
- 原 workspace 草稿正文、附件、model 和 composer selection 是唯一草稿来源。beginNew 将该 workspace 的 selected 显式置空，activity 刷新不再自动选回旧 Session。已有 Session 的 workspace 不改。空间切换有现存输入时显式确认；正文/附件仍属于原空间，目的草稿不会被覆盖。管理方法仅可带到完全空白的目的草稿，不替换已有正文、附件、Skill、Agent、目标或引用的含义。
- 零空间也显示同一原新页，可以查看/移除/选择管理 Skill，并选择或显式新建个人空间；先选空间再输入、上传或发送。管理员空间候选仍只来自其本人个人范围，没有业务任务入口。
- 页面路由使用 /?new&workspace=...。空间切换 replace 当前新页 URL，Back/Forward/刷新只消费该次导航。局部点击已同步消费新路由，避免本来就空的新页在首次 Session POST 返回后才执行 beginNew 并清空新选择。异步 task: 准备使用同步 route revision 和原导航取消守卫。
- 管理方法使用服务端真实 expert-manager / skill-creator metadata/hash/body，通过原 Skill picker、chip、移除、内容面板和历史展示；移除/改选 Skill 清除配套 authoring target/baseline。创建只传 skill，编辑才传与 method 匹配的 target/baseline。恢复旧未发送 mode 草稿时映射为可见真实 Skill，目标基线不丢；无法映射时明确提示重新选择并阻止隐式普通发送。
- 删除原“普通对话/专家创作/技能创作”模式下拉。管理 Skill 只在 Skill 分类出现，不混入文件/Agents 分类。后端当前管理员/个人空间/真实注册身份仍决定管理权限。

## 验证与失败记录

- 首轮 authoring 3 例因同名“新建个人空间”按钮定位过宽失败，限定内联新页作用域后 3/3 通过（25.7s）。保留 first/second 日志，没有改弱业务断言。
- administrator 4 + skills 13，共 17/17 通过（2.0m）：保留原手动创建、导入/复制/范围/冲突/发布等业务断言，只适配方式选择与延后首发。此轮在最后路由/目的草稿收紧之前运行，相关新行为以最终 authoring 和 root 冻结回归为准。
- root 的普通快速 API 首发回归暴露 new-route 初次消费时序问题。临时诊断监听本地 sessionStorage/history，确认 Session 已创建后被旧新页 effect 清空；同步消费修复后原 ordinary case 1/1 通过。临时测试源已移除，诊断日志保留，不作为新增产品能力。
- 冻结前 typecheck 发现独立审查新增测试的 TS2722，审查代理已修复；Web 自有文件定向 ESLint 通过。旧失败日志保留。
- 最终 authoring 初次启动被 sandbox 的本地监听限制 EPERM 拒绝；授权本地127.0.0.1测试重跑。该轮首例登录后懒加载标题5s超时、其余真实确认/保存及旧草稿目标迁移2/2通过；当时并行全局单测负载较高。等待标题的测试明确改为15s，未改产品来掩盖失败。

最终冻结回归、截图检查与源码hash见下方补充及 creation-web-source.json。root 统一负责其余旧 NewSession 场景适配、全局门禁和真实方舟探针；本报告不将技术验证等同于阶段用户验收。

## 准备窗口审查修复

两空间测试新增后曾在 TaskPanel 关闭即填写下一空间，观察到异步 workspace 准备尚未结束，旧输入框仍可编辑。除明确等待真实空间ID外，产品将同一个 choosingNewSpace 标志纳入 composerReady、上传/模型/引用picker/移除，原附件与地图引用回调、文件面板引用和欢迎建议也短路保护；不增加状态库。实际 POST /api/tasks/:id/workspace hold 回归证明旧正文保留且输入/发送/加号/Skill移除禁用、无会话/模型副作用。

审查另确认通过 Skill 入口在 management metadata 未加载时存在 await 读取窗口。复用同一个准备标志包住真实 metadata 读取/预选，保留原导航守卫并防止准备重入。实际 GET authoring-skills hold 回归在已有真实个人空间和正文、原方法的条件下证明读取完成前不能发送普通或旧方法请求；完成后显示正确 expert-manager 且正文保留。

准备窗口修复后 authoring 3/3 通过29.5s；新增 metadata hold 后3/3通过26.7s。最后两个文件引用回调短路补齐后，再以 creation-web-source.json 的精确冻结源码执行最终3例，结果另记。Root在独立低负载复验原新页导航、references/capabilities、access/workbench以及失败单测，并负责最终全局门禁。

## 最终冻结结果

- 精确冻结源码 authoring.spec.ts 3/3 通过26.8s，最终浏览器进程正常exit0；日志 creation-web-final-browser.log。包含两类延迟请求保护、零空间真实picker/正文、两空间既有普通草稿不变、Agents分类不混入管理方法、原确认拒绝/批准/详情、旧创作草稿迁移以及两目标/CAS保持。
- 四张最终截图在 creation-web-screenshots/：composer1060/1440、confirmation1060/1440；已按桌面布局检查，无横向溢出，空间选择与Skill标签在原composer区域，确认操作可达。方式选择有实际浏览器断言，无单独截图。
- 13个自有源码/浏览器文件SHA256在 creation-web-source.json；main冻结hash为41acd82b528354f9c50be34890dc4f959698ab0d8668e92552243eb57b00ee83。
- 类型/定向ESLint已有exit0记录；其后仅准备窗口与引用回调保护、窄测试，root运行最终全局type/lint/build。git diff --check由实现者最终复核。
- 用户验收仍pending；没有commit、push、部署或线上数据变更。
