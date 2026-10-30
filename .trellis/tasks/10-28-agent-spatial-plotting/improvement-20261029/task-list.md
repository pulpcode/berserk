# 本轮8题逐题清单
2026-10-29。三组各重复2次，共48项。继承题逐字不变；新题明确标记。评分口径另见 review-protocol.md。

## T01（inherited，原P02）

原题逐轮：
1. 在当前草稿deployment层的[114,22.5]添加消防车，名称消防车甲，信息性质为方案，保存草稿；不发布、不采用。

仅真实追问时可用的冻结回复：
- 第1轮／declared-choice／消防车具体类型：水罐消防车
- 第1轮／details／已有坐标、图层、名称或性质，不用于回答车型：当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。

预期：
```json
{
  "clarifyBeforeWrite": true,
  "name": "消防车甲",
  "point": [
    114,
    22.5
  ],
  "symbolId": "xf3013-2020.6.2.1",
  "informationRole": "plan",
  "preserveOld": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "deployment",
    "name": "部署图层",
    "features": [
      {
        "objectId": "old",
        "name": "既有标注",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.02,
            22.52
          ]
        }
      }
    ],
    "order": 0,
    "defaultVisible": true
  }
]
```

## T07（inherited，原P05）

原题逐轮：
1. 以当前草稿reference层对象ID origin为中心生成700米范围，只预览不保存。
2. 将刚才700米固定范围保存到当前草稿derived层，名称临时范围，信息性质设为方案，并加备注“待核实”，不发布、不采用。

仅真实追问时可用的冻结回复：
- 第1轮／preview／中心或半径：当前草稿reference层origin，700米，只预览不保存。
- 第2轮／save／固定结果、图层、名称、性质或备注：刚才700米固定范围；当前草稿derived层；名称临时范围；信息性质为方案；备注待核实；不发布、不采用。

预期：
```json
{
  "radius": 700,
  "name": "临时范围",
  "informationRole": "plan",
  "note": "待核实",
  "browserSameObject": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "reference",
    "name": "参照对象",
    "features": [
      {
        "objectId": "origin",
        "name": "基点",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114,
            22.5
          ]
        }
      }
    ],
    "order": 0,
    "defaultVisible": true
  },
  {
    "layerId": "derived",
    "name": "派生层",
    "features": [
      {
        "objectId": "existing",
        "name": "既有记录",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.04,
            22.54
          ]
        }
      }
    ],
    "order": 1,
    "defaultVisible": true
  }
]
```

## T02（inherited，原P01）

原题逐轮：
1. 在当前草稿deployment层的[114,22.5]添加水罐消防车，名称消防车甲，信息性质为方案，保存草稿；不发布、不采用。

仅真实追问时可用的冻结回复：
- 第1轮／details／题干已有车型、坐标、图层、名称或性质：水罐消防车；当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。

预期：
```json
{
  "name": "消防车甲",
  "point": [
    114,
    22.5
  ],
  "symbolId": "xf3013-2020.6.2.1",
  "informationRole": "plan",
  "preserveOld": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "deployment",
    "name": "部署图层",
    "features": [
      {
        "objectId": "old",
        "name": "既有标注",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.02,
            22.52
          ]
        }
      }
    ],
    "order": 0,
    "defaultVisible": true
  }
]
```

## T03（inherited，原S06）

原题逐轮：
1. 本会话港区内几个资源点，只分析。

仅真实追问时可用的冻结回复：
- 第1轮／declared-choice／草稿还是来源系统：按当前会话草稿的港区和资源层。

预期：
```json
{
  "draftCount": 4,
  "draftNames": [
    "岸边甲",
    "栈桥乙",
    "码头丙",
    "港池丁"
  ],
  "sourceCount": 1,
  "sourceNames": [
    "来源港车甲"
  ],
  "accepted": "clarify_then_draft_or_complete_labeled_conditionals",
  "noWrite": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "reference",
    "name": "参照对象",
    "order": 0,
    "defaultVisible": true,
    "features": [
      {
        "objectId": "harbor",
        "name": "港区",
        "kind": "polygon",
        "geometry": {
          "type": "Polygon",
          "coordinates": [
            [
              [
                114,
                22.5
              ],
              [
                114.02,
                22.5
              ],
              [
                114.02,
                22.52
              ],
              [
                114,
                22.52
              ],
              [
                114,
                22.5
              ]
            ]
          ]
        }
      }
    ]
  },
  {
    "layerId": "resources",
    "name": "资源图层",
    "order": 1,
    "defaultVisible": true,
    "features": [
      {
        "objectId": "harbor-a",
        "name": "岸边甲",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.003,
            22.503
          ]
        }
      },
      {
        "objectId": "harbor-b",
        "name": "栈桥乙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.007,
            22.507
          ]
        }
      },
      {
        "objectId": "harbor-c",
        "name": "码头丙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.011,
            22.511
          ]
        }
      },
      {
        "objectId": "harbor-d",
        "name": "港池丁",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.015,
            22.515
          ]
        }
      },
      {
        "objectId": "harbor-out",
        "name": "外港戊",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.03,
            22.51
          ]
        }
      }
    ]
  }
]
```

## T04（new_constructed，数据复用S06）

原题逐轮：
1. 只使用当前会话草稿reference层的港区和resources资源层，统计该港区内的点，列出名单和总数；不要查询来源系统，不修改地图。

仅真实追问时可用的冻结回复：
- 第1轮／scope／仅重述已明确的来源、图层、输出或操作要求，不用于引入新选择：只用当前会话草稿reference层的港区和resources资源层，列出港区内点的名单总数；不查来源、不修改。

预期：
```json
{
  "names": [
    "岸边甲",
    "栈桥乙",
    "码头丙",
    "港池丁"
  ],
  "count": 4,
  "sourceQueriesAllowed": false,
  "noWrite": true,
  "noUnnecessaryClarification": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "reference",
    "name": "参照对象",
    "order": 0,
    "defaultVisible": true,
    "features": [
      {
        "objectId": "harbor",
        "name": "港区",
        "kind": "polygon",
        "geometry": {
          "type": "Polygon",
          "coordinates": [
            [
              [
                114,
                22.5
              ],
              [
                114.02,
                22.5
              ],
              [
                114.02,
                22.52
              ],
              [
                114,
                22.52
              ],
              [
                114,
                22.5
              ]
            ]
          ]
        }
      }
    ]
  },
  {
    "layerId": "resources",
    "name": "资源图层",
    "order": 1,
    "defaultVisible": true,
    "features": [
      {
        "objectId": "harbor-a",
        "name": "岸边甲",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.003,
            22.503
          ]
        }
      },
      {
        "objectId": "harbor-b",
        "name": "栈桥乙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.007,
            22.507
          ]
        }
      },
      {
        "objectId": "harbor-c",
        "name": "码头丙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.011,
            22.511
          ]
        }
      },
      {
        "objectId": "harbor-d",
        "name": "港池丁",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.015,
            22.515
          ]
        }
      },
      {
        "objectId": "harbor-out",
        "name": "外港戊",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.03,
            22.51
          ]
        }
      }
    ]
  }
]
```

## T05（new_constructed，数据复用P01）

原题逐轮：
1. 在当前草稿deployment层的[114,22.5]，只用普通圆点标记消防车甲的位置，不用专业符号；名称消防车甲，信息性质为方案，保存草稿，不发布、不采用。

仅真实追问时可用的冻结回复：
- 第1轮／details／仅重述题干明确的普通点、坐标、图层、名称或性质，不选择任何专业车型：普通圆点，不用专业符号；当前草稿deployment层；[114,22.5]；名称消防车甲；信息性质为方案，保存草稿，不发布、不采用。

预期：
```json
{
  "name": "消防车甲",
  "point": [
    114,
    22.5
  ],
  "symbol": "circle",
  "noSymbolId": true,
  "informationRole": "plan",
  "preserveOld": true,
  "noUnnecessaryClarification": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "deployment",
    "name": "部署图层",
    "features": [
      {
        "objectId": "old",
        "name": "既有标注",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.02,
            22.52
          ]
        }
      }
    ],
    "order": 0,
    "defaultVisible": true
  }
]
```

## T06（inherited，原S02）

原题逐轮：
1. 先列当前草稿reference层全部点名和总数，再以该层对象ID origin生成500米预览，不保存。

仅真实追问时可用的冻结回复：
- 第1轮／scope／统计范围、中心或半径：统计当前草稿reference全层；500米预览以同层origin为中心，不保存。

预期：
```json
{
  "names": [
    "基点",
    "参照甲",
    "参照乙",
    "参照丙"
  ],
  "total": 4,
  "inputCount": 1,
  "noWrite": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "reference",
    "name": "参照对象",
    "order": 0,
    "defaultVisible": true,
    "features": [
      {
        "objectId": "origin",
        "name": "基点",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114,
            22.5
          ]
        }
      },
      {
        "objectId": "reference-a",
        "name": "参照甲",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.01,
            22.5
          ]
        }
      },
      {
        "objectId": "reference-b",
        "name": "参照乙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.02,
            22.51
          ]
        }
      },
      {
        "objectId": "reference-c",
        "name": "参照丙",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.03,
            22.52
          ]
        }
      }
    ]
  }
]
```

## T08（inherited，原P06）

原题逐轮：
1. 系统当前目录中的水罐消防车、消防直升机、冲锋舟分别属于标准符号还是应用扩展？只查目录，不改地图。

仅真实追问时可用的冻结回复：
- 第1轮／scope／目录范围或查询对象：只问系统当前目录中的水罐消防车、消防直升机、冲锋舟，属于标准符号还是应用扩展；不改地图。

预期：
```json
{
  "水罐消防车": "standard",
  "消防直升机": "standard",
  "冲锋舟": "extension",
  "noWrite": true,
  "noExternalStandardInference": true
}
```

完整初始草稿：
```json
[
  {
    "layerId": "deployment",
    "name": "部署图层",
    "features": [
      {
        "objectId": "old",
        "name": "既有标注",
        "kind": "point",
        "geometry": {
          "type": "Point",
          "coordinates": [
            114.02,
            22.52
          ]
        }
      }
    ],
    "order": 0,
    "defaultVisible": true
  }
]
```

## 冻结顺序
首6为T01/T07首重复，流程复核后继续42，不重跑首6。
1. T01-R1-G0
2. T01-R1-G1
3. T01-R1-G2
4. T07-R1-G1
5. T07-R1-G2
6. T07-R1-G0
7. T02-R1-G2
8. T02-R1-G0
9. T02-R1-G1
10. T03-R1-G0
11. T03-R1-G1
12. T03-R1-G2
13. T04-R1-G1
14. T04-R1-G2
15. T04-R1-G0
16. T05-R1-G2
17. T05-R1-G0
18. T05-R1-G1
19. T06-R1-G0
20. T06-R1-G1
21. T06-R1-G2
22. T08-R1-G1
23. T08-R1-G2
24. T08-R1-G0
25. T01-R2-G1
26. T01-R2-G2
27. T01-R2-G0
28. T07-R2-G2
29. T07-R2-G0
30. T07-R2-G1
31. T02-R2-G0
32. T02-R2-G1
33. T02-R2-G2
34. T03-R2-G1
35. T03-R2-G2
36. T03-R2-G0
37. T04-R2-G2
38. T04-R2-G0
39. T04-R2-G1
40. T05-R2-G0
41. T05-R2-G1
42. T05-R2-G2
43. T06-R2-G1
44. T06-R2-G2
45. T06-R2-G0
46. T08-R2-G2
47. T08-R2-G0
48. T08-R2-G1
