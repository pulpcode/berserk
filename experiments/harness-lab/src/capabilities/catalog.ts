import type { CapabilityToolOption } from '../contracts/capability-management.js';

/** Only host-implemented foreground tools. Business grants are still enforced at runtime. */
export const capabilityTools: CapabilityToolOption[] = [
  ...[['source_list','列出资料'],['source_read','读取资料'],['instructions_read','读取工作区指令'],['skill_read','读取技能'],['read','读取文件'],['ls','列出目录'],['find','查找文件'],['grep','搜索文件'],['ask_user','询问用户'],['subagent','只读专家委派']].map(([id,name]) => ({id,name,group:'read' as const})),
  ...[['write','写入文件'],['edit','编辑文件'],['bash','运行脚本或命令'],['file_output','交付文件']].map(([id,name]) => ({id,name,group:'files' as const,requiresFileEnvironment:true})),
  {id:'instructions_update',name:'更新工作区指令',group:'files'},
  ...[['information_search','查询信息'],['information_read','读取信息'],['situation_query','查询态势'],['task_search','查找任务'],['task_read','读取任务'],['task_information_list','任务信息列表'],['task_information_read','读取任务信息'],['work_item_list','工作列表'],['work_item_read','读取工作'],['simulation_command_read','读取指令'],['annotation_list','标注列表'],['annotation_read','读取标注'],['spatial_analyze','空间分析']].map(([id,name])=>({id,name,group:'read' as const})),
  ...[['work_item_action','业务办理'],['handoff_import_file','导入交接文件'],['simulation_command_send','下达业务指令'],['annotation_from_source','从资料创建标注'],['annotation_action','标注操作'],['annotation_from_analysis','从分析创建标注']].map(([id,name])=>({id,name,group:'business' as const})),
];
