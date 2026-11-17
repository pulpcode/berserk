# 统一 Axon 界面落点

- `ApplicationSidebar.tsx`：从原业务页面抽取原样的品牌、折叠/展开、侧栏和设置页脚，业务页面与无业务席位账号复用同一组件。
- `main.tsx`：应用入口按 AccountIdentity 只做一次身份分流；普通业务页面逻辑迁入 BusinessApp，保留其 hook 与现有 JSX；无业务席位管理员进入 CapabilityApplication，不挂载任何业务 hook。
- `CapabilityApplication.tsx`：使用同一 app-shell/sidebar/workspace 样式，默认能力中心；任务和旧 /admin 深链接归一到 /capabilities。只提供能力中心和设置，设置只展示账户及退出。
- `Settings.tsx`：接受 AccountIdentity；业务身份原权限保持，管理员显示身份而非虚构席位，不挂载模型配置和个人偏好。
- 删除前一版专用 Administrator.tsx/administrator.css，不再显示“管理后台”或单独管理站。
- `styles.css` 仅为没有工作空间列表的侧栏增加填充弹性区域；不改现有业务样式。
- `tests/e2e/administrator.spec.ts`：统一下拉登录、共同品牌/侧栏、显式创建一次、保存/检查、旧链接/业务深链接、无业务 API 请求、桌面1060、折叠/设置/退出、撤权及总体席不获管理权限。

验证输出由父代理汇总。当前源码定向 ESLint 已通过；重复类型检查按父代理要求取消，等待统一检查；浏览器定向套件执行中。


## 最终验证

- 定向 ESLint 通过；初次品牌组件抽取遗留未使用 X 导入已移除。重复类型检查按父代理要求取消，由父代理统一类型/构建检查。
- 首轮多套并行浏览器时发生整体30秒超时，停止保留记录；串行安静复测时10项既有登录全部通过。
- 四文件20项套件19通过，1项管理员用例仍加载启动后才修正的旧测试定位器（dialog.filter(has专家名称)在检查标签下失配，trace已核实）；产品无相应错误。新进程加载稳定dialog标题定位器后，管理员2/2通过（13.4秒、7.9秒）。
- 新增特定专家卡片用例：准备两个专家，点击目标卡片，核对对应名称/指令，不产生创建POST或模型调用；单项通过。
- 父代理最终工具栏CSS调整后，再跑管理员卡片+能力中心5项，共6/6通过，包含所选标签hover对比度>=4.5、宽/窄卡片截图、管理员1060/1440截图和特定专家配置。
- 统一最终覆盖：10项既有登录、5项能力中心、3项R2管理、3项无席位管理员；通过分轮原始日志记录，未将中间失败写成全套单次通过。
- 管理员1060与1440界面由父代理最终视觉复核：同一Axon侧栏/品牌、无任务空间、三标签和创建入口，工具栏换行完整且无溢出。截图位于 /private/tmp/axon-unified-capabilities-final-results/administrator-an-administr-a5d99-hout-creating-another-draft/。

无账号/密码/数据库schema改动；未提交、未部署。后续部署和用户验收由父代理汇总。
