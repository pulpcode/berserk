# Agent 空间分析与地图协作的开源设计调研

日期：2026-10-14

状态：后续开发阶段的调研材料，待审阅；本文不代表已经确定技术选型或开始实施。

## 1. 调研目的与结论

为当前态势地图、标绘和 Agent 工具补充空间分析能力，梳理值得借鉴的开源设计。重点是对象选择、计算接口、地图反馈、领域知识和效果验证。

建议以“文本模型理解需求、宿主读取获准数据、空间工具执行计算、地图展示结果”为主线。多模态识图可以作为补充，不作为第一阶段的必要条件。

当前已有 MapLibre 地图、Terra Draw 绘制交互、标绘服务和来源查询。Terra Draw 已经接入，并非本次建议新增的依赖。当前尚未提供供 Agent 调用的距离、相交、包含等空间分析工具；内部几何合法性检查也不等于对外提供分析能力。

以下仓库事实来自公开源码及设计文档；迁移建议是针对本项目的分析。未在本项目部署或验收这些 Agent 项目，不把仓库介绍视为生产能力证明。

## 2. 优先阅读顺序

| 参考项目 | 优先学习的设计 | 在本项目中的用途 |
| --- | --- | --- |
| MapOS | 通过结构化接口读取地图视野、活动对象及展示结果 | 让“这里”“当前地图范围”“把结果标出来”有明确含义 |
| qgis-mcp | 按对象引用操作、按需读取几何、查询算法参数、提供可行动的错误提示 | 设计 Agent 空间工具接口 |
| geoskills | 数据检查、坐标系、单位和分析适用条件 | 组织领域知识与前置检查 |
| MapLibre Agent Skills | 无 Skill 与有 Skill 的对照测试及负向用例 | 验证 Skill 是否解决真实能力缺口 |
| SpatialAnalysisAgent | 展示分析步骤、运行信息与结果报告 | 让计算依据可检查、结果可追溯 |

产品设计优先阅读 MapOS；验证方法优先阅读 MapLibre Agent Skills；工具接口设计时进一步阅读 qgis-mcp。

## 3. 各仓库的设计与迁移建议

### 3.1 MapOS：让 Agent 读取应用状态并展示结果

- 仓库：[NicHaley/mapos](https://github.com/NicHaley/mapos)
- 重点阅读：[开发与架构文档](https://github.com/NicHaley/mapos/blob/main/CLAUDE.md)

其设计文档描述了读取当前视野、活动文件等状态，以及添加覆盖物、平移地图、打开文件的接口。地图服务采用统一契约与适配器；本地文件是持久数据来源，空间索引可以重建。

本项目可以借鉴：

1. 用户点选对象后，向 Agent 提供对象引用；用户说“当前地图范围”时，提供本次操作对应的视野边界。
2. 明确区分界面状态、对象数据与计算结果。图层是否显示、地图缩放范围，不等于对象是否存在或是否有权限读取。
3. 返回的分析对象可以定位、高亮；生成的分析几何先展示，需要保存时再进入现有草稿写入流程。
4. 空间计算接口与具体计算库之间保持清晰边界，但不为尚未存在的多个后端预先建设复杂插件系统。

适用边界：MapOS 是个人本地地图应用。其文件库作用域不能替代本项目的用户、席位、任务、会话隔离。读取“当前视野”也应绑定本次请求，不应在分析过程中悄悄随用户拖动而改变输入范围。

### 3.2 qgis-mcp：先确认数据与能力，再执行计算

- 仓库：[nkarasiak/qgis-mcp](https://github.com/nkarasiak/qgis-mcp)
- 重点阅读：[工具源码](https://github.com/nkarasiak/qgis-mcp/blob/main/src/qgis_mcp/server.py)、[Agent 接入说明](https://github.com/nkarasiak/qgis-mcp/blob/main/docs/agent-integration.md)

工具源码中值得关注的设计：

- `get_layer_features` 使用图层 ID、筛选条件和分页，默认不返回几何。
- `list_processing_algorithms` 与 `get_algorithm_help` 用于发现算法及参数，再由 `execute_processing` 执行。
- 常见错误附带下一步提示，例如图层不存在时建议重新查询可用图层。

对本项目的建议是“定位对象 → 确认适用操作 → 后端读取几何 → 执行计算 → 返回依据”。模型选择对象和业务参数，宿主负责作用域、权限和输入版本。

初期只有少量操作时，用清晰的固定工具说明即可，不必复制完整算法目录，也不必开放任意 Python 或 SQL 执行。MCP 是接入方式之一，现有 Pi 原生工具同样可以承接这些设计。

源码中还有一个需要辨析的细节：部分大结果虽然生成缓存资源引用，原始 `features` 仍保留在返回值中。因此，返回引用本身不保证减少上下文；本项目需要实际约束默认结果大小，并将详细几何留在后端或按需读取。

### 3.3 geoskills：先判断数据是否支持所问问题

- 仓库：[phuismann/geoskills](https://github.com/phuismann/geoskills)
- 重点阅读：[数据接收检查](https://github.com/phuismann/geoskills/blob/master/skills/geodata-intake/SKILL.md)、[坐标系与重投影](https://github.com/phuismann/geoskills/blob/master/skills/crs-and-reprojection/SKILL.md)

这些 Skill 分别组织数据类型、几何、覆盖范围、坐标系和单位检查。信息缺失时先说明问题，不通过猜测补齐分析前提。

对本项目应分成两层：

- 程序负责已经确定的规则：坐标规范、单位转换、几何合法性、对象权限、数据范围及容量限制。
- Skill 负责方法选择与业务解释：何时需要空间工具，何时缺少道路或通行资料，哪些结论不能由几何关系推出。

例如：模型不需要重新猜测系统已经确定的 WGS84 坐标规范；但应理解“经纬度差不能直接作为米数”“平面相交不等于道路连通”“查询无命中不等于现实中不存在”。

这些 Skill 可作为知识组织方式参考，具体规则仍要与本项目支持的计算方法一致。程序已能保证的约束，不应只写入 Skill 后交给模型遵守。

### 3.4 MapLibre Agent Skills：用对照验证 Skill 的价值

- 仓库：[maplibre/maplibre-agent-skills](https://github.com/maplibre/maplibre-agent-skills)
- 重点阅读：[贡献规范](https://github.com/maplibre/maplibre-agent-skills/blob/main/CONTRIBUTING.md)、[评估设计](https://github.com/maplibre/maplibre-agent-skills/blob/main/evals/README.md)

该仓库强调先定义错误与评价标准，再比较不加载 Skill 和加载 Skill 的表现；用例包括直接需求、隐含需求、错误方法和不该套用该 Skill 的相邻问题。其内容主要服务地图开发，评估方法值得迁移到产品内 Agent。

本项目可以设计以下对照：

| 用户问题 | 预期行为 |
| --- | --- |
| 这条线与区域相交吗 | 查询正确对象并调用几何关系工具 |
| 这条线能作为车辆通行路线吗 | 认识到还需要道路连接与通行依据，不能仅凭相交作答 |
| 把这条线改名 | 使用编辑工具，不额外执行空间分析 |
| 对象没有几何时计算距离 | 明确指出缺少输入，不生成估计值冒充计算结果 |

建议固定模型、工具和数据条件，比较 Skill 的增益，并使用不同对象名称、空间形状及问法验证泛化。无 Skill 时已能通过的用例仍可保留为系统回归测试，只是不应据此宣称 Skill 带来了提升。

该仓库的回答评估不能直接替代本项目的操作验收。我们还需检查实际对象选择、工具调用、数值结果及保存行为；几何结果应由已知答案和程序断言验证，不能只交给另一个模型打分。强制注入 Skill 的效果，也要与运行时是否正确发现并加载 Skill 分开验证。

### 3.5 SpatialAnalysisAgent：分析过程和结果可检查

- 原列举仓库：[GIS-Copilot/SpatialAnalysisAgent](https://github.com/GIS-Copilot/SpatialAnalysisAgent)
- 该仓库链接的文档：[用户手册](https://github.com/Teakinboyewa/SpatialAnalysisAgent/blob/master/User_Manual.md)、[场景案例](https://github.com/Teakinboyewa/SpatialAnalysisAgent/blob/master/Case_Studies.md)
- 相关论文：[GIS Copilot: Towards an Autonomous GIS Agent for Spatial Analysis](https://arxiv.org/abs/2411.03205)

用户手册展示了运行信息、报告和 Solution Graph，用户可以查看分析步骤和成果。文档链接指向另一个 GitHub 仓库，后续选型时需要确认实际采用的代码来源与版本。

本项目可以先提供简洁的分析记录：参与对象与版本、操作类型、参数与单位、结果及数据限制。例如“发现三条道路与区域相交”，应能逐一定位这些道路，并查看计算所用区域。

不必因此新增复杂工作流引擎。初期复用现有工具结果展示与地图引用，满足核查需求后再决定是否需要流程图。

## 4. 空间计算库与 Agent 项目的不同用途

Agent 项目主要帮助设计交互和工具组织。空间算法优先复用成熟实现，再针对支持范围验收。

| 实现 | 参考链接 | 适用方向与代价 |
| --- | --- | --- |
| Turf.js | [仓库](https://github.com/Turfjs/turf)、[相交](https://turfjs.org/docs/api/booleanIntersects)、[点到线距离](https://turfjs.org/docs/api/pointToLineDistance)、[缓冲区](https://turfjs.org/docs/api/buffer) | 与当前 Node.js、TypeScript、GeoJSON 接近，适合先验证有限范围内的常见操作 |
| Shapely / GEOS | [Shapely 手册](https://shapely.readthedocs.io/en/stable/manual.html) | 适合几何处理；增加 Python 环境，并需处理适当的投影与坐标转换 |
| PostGIS | [数据管理与空间索引](https://postgis.net/docs/manual-3.5/using_postgis_dbmanagement.html)、[距离范围查询](https://postgis.net/docs/ST_DWithin.html) | 适合持续查询大量空间数据，需要数据库部署和数据接入 |
| Valhalla | [仓库](https://github.com/valhalla/valhalla) | 路线规划方向，需要可用路网及相应通行数据，不能从底图图片直接获得 |

Turf.js 是当前优先验证的候选，不是已经批准的生产选型。以上能力可以本地部署，不要求将业务数据发送给外部在线服务。

当前标绘契约仅支持点、线及不带洞的单环面。缓冲区、裁剪等操作可能生成多面或带洞的面，计算结果能否展示、能否保存为可编辑标注，需要分别设计。不能通过丢弃洞或分离部分来静默适配。

## 5. 后续开发阶段建议

建议将后续阶段聚焦为“Agent 基础空间分析与地图结果核查”，初步验证三个场景：

1. 一条标线是否与一个区域相交。
2. 一个集合点是否位于指定区域内。
3. 一个集合点距离指定道路多远。

建议流程：用户引用对象 → 宿主读取获准的几何及版本 → 空间工具计算 → 返回结构化依据 → 地图定位或高亮。新增几何需要保存时，再通过既有草稿写入服务处理。

正式设计前需要明确：

- 几何关系的业务含义：接触边界是否计入，相交与穿越如何区分。
- 度量方法、单位、精度容差及适用地理范围。
- 来源数据是否完整、是否缺几何，以及计算基于哪个来源修订和标注版本。
- 分析结果的展示、引用和保存方式；只读分析与修改草稿应有清晰边界。
- 多面、带洞面及过大结果的处理范围。
- 正确结果、无结果、数据不足、参数不适用和来源失败的不同反馈。

验收应同时覆盖确定性计算、权限与版本边界、真实模型工具选择、Skill 对照，以及桌面地图中的结果核查。基础算法成立与 Agent 能可靠使用，应分别验证。

当前仅保存调研结论。后续再根据场景与数据条件形成该阶段的需求、技术设计和实施计划。
