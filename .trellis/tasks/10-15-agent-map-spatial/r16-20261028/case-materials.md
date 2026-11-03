# R16 冻结材料入口

题干及评分契约见tasks.md。case-specs.json逐字提取用户原句，Q10沿用Q09明确原句。case-materials.json包含24题草稿数据与独立正确值，schedule.json包含288个唯一槽位；材料留在评测端，不加载到Agent工作区。来源数据由data.ts sourceScene在真实模拟HTTP服务中生成，Q01/Q02/Q14有1个范围内来源点、Q03有2个。Q22轮间编辑通过真实用户API执行。
