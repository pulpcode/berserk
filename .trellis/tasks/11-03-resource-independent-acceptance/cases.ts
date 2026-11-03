/** Reviewed user inputs only. Hidden continuation facts remain controller-side. */
import type {ContextRef} from '../../../experiments/harness-lab/src/contracts/context.js';
export type CaseId = 'P01'|'P02'|'P03'|'P04'|'N01'|'N02'|'N03'|'N04'|'N05'|'N06'|'N07'|'N08';
export interface AcceptanceTurn {
  text:string;
  contextRefs?:ContextRef[];
  annotationSelections?:Array<{layerIds?:string[];objectIds?:string[]}>;
  after?:'source-update';
}
export interface HumanFact {
  id:string; topic:'region'; value:string; objectId:string; acceptableForms:string[]; rule:string;
}
export interface AcceptanceCase {
  id:CaseId; phase:'public'|'formal'; title:string; taskTitle:string; taskGoal:string;
  turns:AcceptanceTurn[]; humanFacts:HumanFact[];
}
export const acceptanceCases:AcceptanceCase[]=[
  {
    "id": "P01",
    "phase": "public",
    "title": "真实显式引用、内部与边界",
    "taskTitle": "独立资源核验·P01",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "只看我引用的“绀溪核验图层”和“绀溪矩形”，列出矩形内部及边界上的实际资源，内部和边界分开，给出各自数量。",
        "annotationSelections": [
          {
            "layerIds": [
              "p01-assets"
            ]
          },
          {
            "objectIds": [
              "p01-area"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "P02",
    "phase": "public",
    "title": "两个来源全部任务关系未知",
    "taskTitle": "独立资源核验·P02",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "请查“苇汀调度”和“杉岬协作”这两个来源中，本任务的资源情况。分别说现在看到哪些、与本任务是什么关系，以及各来源查全没有。"
      }
    ],
    "humanFacts": []
  },
  {
    "id": "P03",
    "phase": "public",
    "title": "公开消歧接续",
    "taskTitle": "独立资源核验·P03",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "请查“南坪”里面有哪些实际车辆。两个同名区域请先让我选，再继续查。",
        "annotationSelections": [
          {
            "layerIds": [
              "p03-areas"
            ]
          }
        ]
      }
    ],
    "humanFacts": [
      {
        "id": "p03-region",
        "topic": "region",
        "value": "选西侧南坪，就是经度121.00到121.03、纬度31.00到31.03的那个。",
        "objectId": "p03-southwest",
        "acceptableForms": [
          "西侧南坪",
          "p03-southwest"
        ],
        "rule": "仅在实际询问区域选择时接续；按真实含义匹配选项，不能提前发送或代选。"
      }
    ]
  },
  {
    "id": "P04",
    "phase": "public",
    "title": "两轮续读与旧快照",
    "taskTitle": "独立资源核验·P04",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "查询“雾栈车队”的实际车辆，先给我最前面两条，并保留这一次查询结果，余下的等我下一轮再读。"
      },
      {
        "text": "继续读取第一轮那次查询剩下的两条；再打开当时保留的前两条核对。请分清续读的旧快照与来源现状，不用重新查询现状。",
        "after": "source-update"
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N01",
    "phase": "formal",
    "title": "真零、已知部分、未知关系",
    "taskTitle": "独立资源核验·N01",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "分别说明“青埠台账”和“蓼湾调度”在我引用的“砾岸矩形”里有没有实际资源、查全没有、与本任务关系如何。不要把两个来源混成一个结论。",
        "annotationSelections": [
          {
            "objectIds": [
              "n01-area"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N02",
    "phase": "formal",
    "title": "五成员并集与单体受控副本",
    "taskTitle": "独立资源核验·N02",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "contextRefs":[{"systemId": "n02-luqiao", "objectType": "resource", "objectId": "lq-morning"}, {"systemId": "n02-luqiao", "objectType": "resource", "objectId": "lq-evening"}],
        "text": "把“鹭桥车籍”的“晨组车辆汇总”和“暮组车辆汇总”去重，给我车辆名称名单和数量。图层里引用的“沄桥运输车副本”也要核对，别重复算同一辆。",
        "annotationSelections": [
          {
            "objectIds": [
              "n02-copy-u"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N03",
    "phase": "formal",
    "title": "一组未知重叠，另一组可精确",
    "taskTitle": "独立资源核验·N03",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "contextRefs":[{"systemId": "n03-shitai", "objectType": "resource", "objectId": "st-known"}, {"systemId": "n03-shitai", "objectType": "resource", "objectId": "st-unlisted"}, {"systemId": "n03-tingjing", "objectType": "resource", "objectId": "tj-upper"}, {"systemId": "n03-tingjing", "objectType": "resource", "objectId": "tj-lower"}],
        "text": "这四份汇总合起来多少，哪些还不能确定？请按它们各自的统计范围分别说明：车辆看“石苔车辆范围”，舟艇看“汀镜舟艇范围”，不要把不同范围硬拼成一个数。"
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N04",
    "phase": "formal",
    "title": "已分配与可用的交集、条件和状态冲突",
    "taskTitle": "独立资源核验·N04",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "核对“霁浦调度”和引用图层里的资源：哪些已经分配给本任务，而且现在能确认可用？请另列条件未确认、故障、过期或证据冲突等待核实项，并区分仅相关和潜在支援。平台里的引用本身别当成分配。",
        "annotationSelections": [
          {
            "layerIds": [
              "n04-copies"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N05",
    "phase": "formal",
    "title": "实际位置、边界、无实际位置与各项时间",
    "taskTitle": "独立资源核验·N05",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "按实际位置统计我引用的“鹤砾矩形”内车辆和舟艇，边界及没有可判定实际位置的资源分别列出；同时说明每项的数据时间、读取时间和统计范围。站址、计划位置不能当成员实际位置。",
        "annotationSelections": [
          {
            "objectIds": [
              "n05-area"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N06",
    "phase": "formal",
    "title": "单一区域真歧义，先问再完成",
    "taskTitle": "独立资源核验·N06",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "查北区内本任务可用资源，边界单列。",
        "annotationSelections": [
          {
            "layerIds": [
              "n06-areas"
            ]
          }
        ]
      }
    ],
    "humanFacts": [
      {
        "id": "n06-region",
        "topic": "region",
        "value": "选东侧北区，经度121.06到121.10、纬度31.00到31.04的那个。",
        "objectId": "n06-east",
        "acceptableForms": [
          "东侧北区",
          "n06-east"
        ],
        "rule": "仅在实际询问区域选择时接续；按真实含义匹配选项，不能提前发送或代选。"
      }
    ]
  },
  {
    "id": "N07",
    "phase": "formal",
    "title": "明确比较两个北区，不强迫选择",
    "taskTitle": "独立资源核验·N07",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "两个北区分别有哪些可用资源？请比较，内部和边界分开说明，不需要把两区合成一个总数。",
        "annotationSelections": [
          {
            "objectIds": [
              "n07-w",
              "n07-e"
            ]
          }
        ]
      }
    ],
    "humanFacts": []
  },
  {
    "id": "N08",
    "phase": "formal",
    "title": "固定图层两轮口径，拒绝无关补查",
    "taskTitle": "独立资源核验·N08",
    "taskGoal": "按用户明确范围核对资源事实，提供有据可查的结果。仅查询，不保存或修改业务资料。",
    "turns": [
      {
        "text": "只看我引用的“沚灯现场图层”中的实际资源，告诉我有哪些、分别在哪里。",
        "annotationSelections": [
          {
            "layerIds": [
              "n08-target"
            ]
          }
        ]
      },
      {
        "text": "同一图层全部点分别在哪里？"
      }
    ],
    "humanFacts": []
  }
];
export function acceptanceCase(id:CaseId):AcceptanceCase {
  const result=acceptanceCases.find(c=>c.id===id);
  if(!result)throw new Error(`Unknown case ${id}`);
  return structuredClone(result);
}
