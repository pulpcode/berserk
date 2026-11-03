# 单地图专业标绘实施验收

日期：2026-10-25。分支：`codex/frontend-plotting`。方案提交：`0468d98`；实现提交：`b5cdf15`。独立 worktree 实施，无主线合并或推送。

## 交付

- 22 个受控专业点标号：20 个 XF/T 3013—2020 条目，冲锋舟和救援舰船为应用扩展；来源/转写方式逐项记录。
- 单地图、默认收起、按需展开工具。开合不写入，同一地图保留相机；未完成绘制暂停和显式恢复，合法未保存预览独立显隐，属性缓冲保留。
- 方向、20–64 px 尺寸、信息性质、路线末端箭头及搜救/警戒区域模板；旧点样式继续可读。
- 网页、校验、服务和 Pi schema 共用目录；复制、发布、派生、采用、幂等和来源刷新保留新增字段。无 SQL 迁移。
- 保存/预览共用纯几何校验；固定参考与来源只读。来源仍按现有机制刷新，未接真实个体 GPS/AIS。

## 自动验证

在 `experiments/harness-lab`、Node 24.14.0、锁定依赖下执行：

| 检查 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm run lint`（含导入边界） | 通过 |
| `npm run build` | 通过；保留既有大 chunk 提示 |
| `git diff --check` | 通过 |
| 11 文件单元/服务回归 | 174 项通过 |
| `tests/spatial-map-ui.test.ts` | 另行通过（与地图回归合跑） |
| `tests/e2e/annotations.spec.ts` + `situation-map.spec.ts` | 23 个唯一用例全通过；最终局部修正后受影响 5 个用例复验通过 |
| `tests/e2e/map-symbols.spec.ts` | 2 个用例通过（容量/重叠/方位、故障素材回退） |
| `task.py validate` | implement/check 各 8 项真实路径通过，无截断警告 |

174 项命令范围：

```sh
npm test -- tests/annotation-geometry.test.ts tests/map-symbol-contracts.test.ts tests/map-symbol-assets.test.ts tests/annotations.test.ts tests/annotations-acceptance.test.ts tests/annotation-from-source.test.ts tests/annotation-results.test.ts tests/pi/annotations.test.ts tests/pi/annotation-source-history.test.ts tests/situation-map-ui.test.ts tests/map-basemaps.test.ts
```

浏览器使用本地瓦片/来源夹具，独立端口 5191/5192；没有公网瓦片抓取或真实业务写入。来源刷新测试明确观察来源坐标变化，同时相机、草稿输入、标绘数据和修订不变。容量用例真实渲染 500 个对象并点击重叠位置，验证两对象均可选择；相机旋转保持真实方位。缺图用例令一个受控 SVG 加载失败，验证中性图像注册与失败 ID 报告。

## 验收标准映射

| 标准 | 证据 |
| --- | --- |
| A1 | 目录/provenance/assets 测试；22 项显示和类别检索；三类船艇不同 glyph |
| A2–A3 | 同一 MapLibre 身份/相机；开合不写；未完成线顶点恢复；底图切换回归 |
| A4 | 水罐车、救护车、消防艇、冲锋舟、救援舰船网页新增、方向/尺寸保存后服务读取 |
| A5 | 点线面文字 TerraDraw 回归；箭头为派生 Marker；区域应用模板和属性编辑 |
| A6–A7 | role 严格校验、旧缺省保留、sourceRefs 完整身份及来源复制刷新回归；发布/采用仍为 plan |
| A8 | 既有 15 秒刷新在输入中继续，来源变化可见；表单、相机、标绘和修订不变；态势失败/撤权原回归 |
| A9–A10 | 旧形状/固定引用/CAS/回执与 Pi schema/service 测试；非法值原子拒绝 |
| A11 | 图标深浅底图尺寸样张；专业 symbol 图层、白衬、真实重叠点击；宽与窄桌面截图 |
| A12–A13 | 消防/水域五种专业符号保存→发布→采用 UI 闭环；发布前后 current sequence 保持 0，显式采用才变 1；固定发布内容 role=plan |
| A14 | 工具默认关闭且开合无写；不可写上下文说明与表单禁用；权限仍由原服务强制 |

## 人工像素检查

实际打开并检查下列截图；浅色空白底图是本地测试瓦片，不能表述为生产定位或真实现场影像。

- [展开工具](single-map-open.png)：工具右侧停靠，五种标号和拟定标签清晰，无对象裁切。
- [收起工具](single-map-closed.png)：地图释放空间，专业标号仍显示。
- [窄桌面](single-map-narrow.png)：工具置于地图下方，地图控件和输入可用。
- [22 项尺寸检查](symbols-sizes.png)：20/32/48/64 px、深浅底色。20 px 下精细子类依赖名称辅助识别，32 px 为默认，可放大到64。

## 审查修复与边界

审查已修复合法预览与表单不同步、无效 role 清空操作、暂停绘制被其他操作覆盖、内部跳转未保护脏输入、多个保留工作区的 DOM id 冲突、普通几何性质标签、旧点添加标签后锚点偏移和只读属性表单状态。最终完整检查在产品代码冻结后通过，无未解决 findings。

8 个原文位图符号已按批准样张转写为 SVG 几何，12 个保留原矢量路径。战斗员中的 1 是标准编号示例，非真实人员绑定；详见素材 README。无新来源协议、移动端、大屏页面或 Pi 内核改造；未运行真实模型或生产 GPS 联调，不能以夹具回归代替这些能力。
