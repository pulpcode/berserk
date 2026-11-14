# WorkBuddy 风格能力中心界面调整

依据用户本轮四项要求及 unified-capability-ui.md（主代理已通过 CUA 查看本机 WorkBuddy 三类页面），能力中心改为顶部专家／技能／连接器标签、右侧搜索与动作、三列卡片网格，在桌面较窄内容区转两列；使用 Axon 现有色彩与 Lucide 矢量图标。

- 普通用户卡片展示获准专家的真实名称、简介与当前可协作状态，点击按需打开详情；继续通过原工作空间选择及幂等创建动作开始空会话。卡片与常用详情不再展示发布号、修订号。
- 独立管理员使用现有管理目录，不读取业务专家目录、任务或工作空间；卡片过滤通用助手和 role-* 技术条目。顶部“创建专家”仅在明确点击时执行一次带原 sessionAction 回执的 POST，打开新专家编辑；配置卡片会选中对应专家。额外保留“专家管理”用于原有席位默认等操作。
- CapabilityManagement 新增 initialExpertId，可直接定位创建或选中的专家，草稿／检查／隔离试用／人工确认／发布／历史／使用范围原流程保持。
- 技能标签从新增只读 library 元数据 API 读取真实名称／简介，支持搜索及详情；连接器展示真实空状态。本轮没有增加安装、创作或连接功能。
- 键盘左右键/Home/End切换标签并移动焦点；搜索有独立可访问名称，空结果／读取失败／重试明确。

修改产品文件：src/web/CapabilityCenter.tsx、capabilities.css、CapabilityManagement.tsx。修改 tests/e2e/capabilities.spec.ts，适配按需详情并新增三标签、真实技能、搜索、键盘、无隐式会话创建和窄桌面网格检查。

验证：初轮 5/5 浏览器通过，原始日志 /private/tmp/axon-workbuddy-capability-browser-final.log；首次因共享 node_modules Vite 缓存权限 EPERM 未启动，记录 /private/tmp/axon-workbuddy-capability-browser.log，授权环境重跑通过。查看1440/1060截图后发现全局 button:hover 覆盖选中标签背景，已增加明确 hover/active 规则并为卡片说明设 font-weight:400；技能网格改用独立 CSS 类防止全局 skill-list 样式干扰。最终新增选中标签悬停文字对比度至少4.5检查，以及专家/技能宽窄桌面截图，由共享壳代理在最终串行浏览器批次运行。产品源码已冻结，最终批次结果由主代理汇总。

本代理未提交、部署或修改管理员账号／密码／席位权限。
