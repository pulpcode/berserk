import { loadManagementSkills } from '../authoring/management-skills.js';
import { Type } from 'typebox';
import { Check } from 'typebox/value';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { AuthoringIntent, AuthoringProposeInput } from '../contracts/authoring.js';
import type { AuthoringContext, AuthoringService } from '../authoring/service.js';
import { RequestError } from '../contracts/errors.js';

const strict = { additionalProperties: false };
const kind = Type.Union([Type.Literal('expert'), Type.Literal('skill')]);
const targetId = Type.String({ minLength: 1, maxLength: 160 });
const proposalId = Type.String({ pattern: '^[0-9a-f-]{36}$' });
const digest = Type.String({ pattern: '^[0-9a-f]{64}$' });
const text = Type.String({ maxLength: 262144 });
const ref = Type.Object({ skillId: targetId, revisionId: targetId, packageDigest: digest }, strict);
export const authoringProposeSchema = Type.Object({
  kind, targetId: Type.Optional(targetId), summary: Type.String({minLength:1,maxLength:4000}),
  baseline: Type.Optional(Type.Object({ draftRevision: Type.Integer({ minimum: 1 }), digest }, strict)),
  content: Type.Optional(Type.Object({ name: Type.Optional(text), description: Type.Optional(text), instructions: Type.Optional(text),
    skillIds: Type.Optional(Type.Array(targetId)), skillRefs: Type.Optional(Type.Array(ref)), allowedTools: Type.Optional(Type.Array(targetId)),
  }, strict)),
  methodBody: Type.Optional(text),
  files: Type.Optional(Type.Array(Type.Object({ path: targetId, content: text }, strict), { maxItems: 256 })),
  removePaths: Type.Optional(Type.Array(targetId, { maxItems: 256 })),
}, strict);
export const authoringIntentSchema = Type.Object({kind,targetId:Type.Optional(targetId),baseline:Type.Optional(Type.Object({draftRevision:Type.Integer({minimum:1}),digest},strict))},strict);
export const validAuthoringIntent = (value: unknown): value is AuthoringIntent => Check(authoringIntentSchema,value) && (value.baseline === undefined || value.targetId !== undefined);
export const authoringSaveSchema = Type.Object({ proposalId }, strict);
export const authoringToolNames = ['capability_authoring_catalog', 'capability_authoring_read', 'capability_authoring_propose', 'capability_authoring_save', 'capability_authoring_report', 'capability_authoring_method'] as const;


/** A narrow direct-request convenience only; quoted documents, attachments and history never activate authority. */
export function requestedAuthoring(text: string): AuthoringIntent | undefined {
  if (text.includes('```') || /^[\s>"“]/.test(text)) return undefined;
  const match = /^(?:请帮我|帮我|我想|我要|我需要|请|麻烦)?(?:创建|新建|修改|编辑|调整)(?:一个|一位|这个|这份)?(专家|技能|skill)(?:\s|[，。,:：]|$)/i.exec(text);
  return match ? { kind: match[1].toLowerCase() === '专家' ? 'expert' : 'skill' } : undefined;
}
export function authoringPrompt(intent: AuthoringIntent, methodLoaded = false): string {
  return `\n当前是管理员本人发起的${intent.kind === 'expert' ? '专家' : '方法型技能'}草稿管理请求${intent.targetId ? `，明确目标ID=${intent.targetId}` : ''}${intent.baseline ? `，进入对话时的草稿基线=${JSON.stringify(intent.baseline)}` : ''}。使用受控 capability_authoring_* 工具；${methodLoaded ? '所选管理Skill正文已加载，不要重复读取方法；' : '先按需读取 capability_authoring_method；'}再查询真实目录/草稿。名称不明先问，不凭名称猜ID。一次候选只对应一个明确目标；同会话可以顺序处理不同目标。propose不会写草稿，save会等待网页操作确认，不能把普通文字或问答当批准。发布、授权、默认、Shell、业务操作和子Agent在本请求不提供；普通聊天下一请求仍沿用原权限。保存后留在对话，用真实回执说明效果，不自动跳转。`;
}

export function authoringTools(service: AuthoringService, context: AuthoringContext, intent: AuthoringIntent, options: {
  check: () => void;
  takeApproval: (toolCallId: string) => { proposalId: string; interactionId: string; toolCallId: string } | undefined;
}) {
  const checkTarget = (input: { kind: 'expert' | 'skill'; targetId?: string }) => {
    options.check();
    if (input.kind !== intent.kind || intent.targetId && input.targetId !== intent.targetId) throw new RequestError('FORBIDDEN', '本次请求的管理对象不匹配，请明确切换管理对象后重新发送。', 403);
  };
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && typeof item.path === 'string' && typeof item.contentBase64 === 'string') {
      try { const content = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(item.contentBase64, 'base64')); const { contentBase64: _bytes, ...metadata } = item; void _bytes; return { ...metadata, content }; } catch { return item; }
    }
    return item;
  }) }], details: value });
  return [
    defineTool({ name: 'capability_authoring_method', label: '读取管理方法', description: '按需读取宿主维护的专家或方法型技能管理方法，不安装或执行上传包。', parameters: Type.Object({}, strict), executionMode: 'sequential', execute: async () => { options.check(); const skill = (await loadManagementSkills([intent.kind === 'expert' ? 'expert-manager' : 'skill-creator']))[0]; options.check(); return result({ method: skill.id, content: skill.content, hash: skill.hash }); } }),
    defineTool({ name: 'capability_authoring_catalog', label: '查询能力管理目录', description: '读取可管理对象与真实工具和技能引用目录，不读取他人对话或私有试用资料。', parameters: Type.Object({}, strict), executionMode: 'sequential', execute: async () => { options.check(); return result(await service.catalog(context)); } }),
    defineTool({ name: 'capability_authoring_read', label: '读取管理草稿与回执', description: '编辑前读取明确对象当前草稿和基线；提供proposalId只查询原保存回执，不重放保存。', parameters: Type.Object({ kind, targetId: Type.Optional(targetId), proposalId: Type.Optional(proposalId) }, strict), executionMode: 'sequential', execute: async (_id, params) => {
      checkTarget({ ...params, targetId: params.targetId ?? (params.proposalId ? intent.targetId : undefined) });
      if (params.proposalId) { const receipt = service.receipt(context, { kind: params.kind, proposalId: params.proposalId }); if (receipt && (params.targetId && receipt.targetId !== params.targetId || intent.targetId && receipt.targetId !== intent.targetId)) throw new RequestError('FORBIDDEN','保存回执与选定管理对象不匹配。',403); return { ...result(receipt ?? { status: 'not_saved' }), ...(receipt ? { details: { authoringReceipt: receipt } } : {}) }; }
      if (!params.targetId) throw new RequestError('INVALID_INPUT', '读取草稿需要明确目标ID。');
      return result(await service.read(context, { kind: params.kind, targetId: params.targetId }));
    } }),
    defineTool({ name: 'capability_authoring_propose', label: '提出草稿候选', description: '仅生成并校验候选，不保存。创建专家给完整content；修改先read取得baseline，只传变更字段。Skill files为UTF-8文本补丁；只修改已有SKILL.md正文用methodBody以原字节保留frontmatter，不与files中的SKILL.md混用。未列文件保留；明确删除才给removePaths。', parameters: authoringProposeSchema, executionMode: 'sequential', execute: async (_id, params) => {
      checkTarget(params);
      const { files, ...rest } = params;
      if (intent.baseline && (!params.baseline || intent.baseline.digest !== params.baseline.digest || intent.baseline.draftRevision !== params.baseline.draftRevision)) throw new RequestError('AUTHORING_CONFLICT', '进入对话时的草稿基线已变化，请核对当前内容并重新选择。', 409);
      const input: AuthoringProposeInput = { ...rest, ...(files ? { files: files.map(file => ({ path: file.path, contentBase64: Buffer.from(file.content, 'utf8').toString('base64') })) } : {}) };
      return result(await service.propose(context, input));
    } }),
    defineTool({ name: 'capability_authoring_save', label: '确认保存能力草稿', description: '请求当前管理员在原网页操作确认中批准实际候选；批准后保存草稿并返回持久回执，不发布、不配置使用范围。', parameters: authoringSaveSchema, executionMode: 'sequential', execute: async (toolCallId, params) => {
      options.check(); const approval = options.takeApproval(toolCallId);
      if (!approval || approval.proposalId !== params.proposalId) throw new RequestError('CONFIRMATION_REQUIRED', '本次候选尚未获得真实操作确认。', 409);
      const receipt = await service.commit(context, params.proposalId, { interactionId: approval.interactionId, toolCallId });
      return { ...result(receipt), details: { authoringReceipt: receipt } };
    } }),
    defineTool({ name: 'capability_authoring_report', label: '读取既有检查报告', description: '只读已有验证、扫描或本人试用报告；不运行检查或试用，不把旧内容报告当新内容证明。', parameters: Type.Object({ kind, targetId, reportId: targetId }, strict), executionMode: 'sequential', execute: async (_id, params) => { checkTarget(params); return result(await service.report(context, params)); } }),
  ];
}
