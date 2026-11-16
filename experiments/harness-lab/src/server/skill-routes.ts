import { skillUseDetail } from '../skills/view.js';
import { SkillTrials } from '../pi/skill-trials.js';
import type { CapabilityTrialsOptions } from '../pi/capability-trials.js';
import type { ExpertTrialFile } from '../contracts/capability-trials.js';
import { sendFile } from './file-response.js';
import { RequestError } from '../contracts/errors.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PiLab } from '../pi/lab.js';
import type { SkillActor, SkillDraft, SkillImportPreview, SkillPublishInput, SkillPrincipal } from '../contracts/skills.js';
import { previewSkillImport } from '../skills/import.js';
import { accountIdentityOf } from './auth.js';
import { requireCapabilityAdministrator } from './capability-authorization.js';

const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const empty = object({});
const uuid = { type: 'string', format: 'uuid' };
const id = { type: 'string', minLength: 1, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' };
const revisionId = { type: 'string', minLength: 1, maxLength: 160, pattern: '^[a-zA-Z0-9_-]+$' };
const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
const revision = { type: 'integer', minimum: 1 };
const params = object({ skillId: id });
const file = object({ path: { type: 'string', minLength: 1, maxLength: 1024 }, contentBase64: { type: 'string', maxLength: 28 * 1024 * 1024 } });
const files = { type: 'array', minItems: 1, maxItems: 256, items: file };

/** Management and publication authority is rechecked by the service at commit time. */
export async function skillRoutes(app: FastifyInstance, lab: PiLab, options: Pick<CapabilityTrialsOptions, 'runtimeFactory' | 'executionFactory'> = {}) {
  const skills = lab.skills;
  if (!skills || !lab.access) return;
  const actor = (request: FastifyRequest): SkillActor => {
    const identity = accountIdentityOf(request);
    const value = { userId: identity.userId, assertAdministrator: () => requireCapabilityAdministrator(lab, { userId: identity.userId, seatId: identity.seatId }) };
    value.assertAdministrator(); return value;
  };
  const principal = (request: FastifyRequest): SkillPrincipal => {
    const identity = accountIdentityOf(request);
    return { userId: identity.userId, seatId: identity.seatId, canCollaborate: identity.canCollaborate };
  };
  const trials = await SkillTrials.open({ ...options, assertTrialAllowed:skillId=>skills.assertTrialAllowed(skillId), dataDir: lab.config.dataDir, modelConfig: () => ({ ...lab.config }), authorize: userId => requireCapabilityAdministrator(lab, { userId }) });
  app.addHook('onClose', async () => trials.close());
  const root = '/api/admin/capabilities/skills';
  app.get('/api/capabilities/skills', { schema: { querystring: empty } }, request => skills.catalog(principal(request)));
  app.get<{ Params: { skillId: string }; Querystring: { revisionId: string; packageDigest: string } }>('/api/capabilities/skills/:skillId', { schema: { params, querystring: object({ revisionId, packageDigest: digest }) } }, async request => {
    const value = await skills.resolve({ skillId: request.params.skillId, ...request.query }, principal(request));
    return skillUseDetail(value, trials.publicSummary(value.skillId, value.packageDigest));
  });
  app.get(root, { schema: { querystring: empty } }, request => { actor(request); return skills.list(); });
  app.get<{ Params: { skillId: string } }>(`${root}/:skillId`, { schema: { params, querystring: empty } }, request => { actor(request); return skills.detail(request.params.skillId); });
  app.get<{ Params: { skillId: string; revisionId: string } }>(`${root}/:skillId/revisions/:revisionId`, { schema: { params: object({ skillId: id, revisionId }), querystring: empty } }, request => skills.readRevision(actor(request), request.params.skillId, request.params.revisionId));
  app.post<{ Body: { clientActionId: string; sourceSkillId?: string; files?: SkillDraft['files'] } }>(root, { bodyLimit: 145 * 1024 * 1024, schema: { body: { ...object({ clientActionId: uuid, sourceSkillId: id, files }, ['clientActionId']), not: { required: ['sourceSkillId', 'files'] } } } }, request => skills.create(actor(request), request.body));
  app.put<{ Params: { skillId: string }; Body: Pick<SkillDraft, 'files' | 'requirements'> & { expectedDraftRevision: number } }>(`${root}/:skillId/draft`, { bodyLimit: 145 * 1024 * 1024, schema: { params, body: object({ expectedDraftRevision: revision, files, requirements: { type: 'object', maxProperties: 100, additionalProperties: { type: 'string', maxLength: 4000 } } }, ['expectedDraftRevision', 'files']) } }, request => skills.saveDraft(actor(request), request.params.skillId, request.body));
  app.post<{ Params: { skillId: string }; Body: { expectedDraftRevision: number } }>(`${root}/:skillId/validate`, { schema: { params, body: object({ expectedDraftRevision: revision }) } }, request => skills.validate(actor(request), request.params.skillId, request.body));
  app.post<{ Params: { skillId: string }; Body: SkillPublishInput }>(`${root}/:skillId/publish`, { schema: { params, body: object({ expectedDraftRevision: revision, expectedCurrentRevisionId: { anyOf: [revisionId, { type: 'null' }] }, releaseNotes: { type: 'string', minLength: 1, maxLength: 4000 }, clientActionId: uuid }) } }, request => skills.publish(actor(request), request.params.skillId, request.body));
  app.put<{ Params: { skillId: string }; Body: { expectedRevision: number; mode: 'none' | 'all' | 'seats'; seatIds: string[]; clientActionId: string } }>(`${root}/:skillId/policy`, { schema: { params, body: object({ expectedRevision: { type: 'integer', minimum: 0 }, mode: { enum: ['none', 'all', 'seats'] }, seatIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: id }, clientActionId: uuid }) } }, request => skills.setPolicy(actor(request), request.params.skillId, request.body));
  app.post<{ Params: { skillId: string }; Body: { action: 'disable' | 'restore' | 'archive'; expectedStateRevision: number; clientActionId: string } }>(`${root}/:skillId/lifecycle`, { schema: { params, body: object({ action: { enum: ['disable', 'restore', 'archive'] }, expectedStateRevision: { type: 'integer', minimum: 0 }, clientActionId: uuid }) } }, request => skills.lifecycle(actor(request), request.params.skillId, request.body));
  app.get<{ Params: { skillId: string } }>(`${root}/:skillId/scans`, { schema: { params, querystring: empty } }, request => skills.scans(actor(request), request.params.skillId));
  app.post<{ Params: { skillId: string }; Body: { expectedDraftRevision: number; clientActionId: string } }>(`${root}/:skillId/scans`, { schema: { params, body: object({ expectedDraftRevision: revision, clientActionId: uuid }) } }, request => skills.rescan(actor(request), request.params.skillId, request.body));
  const trialParams = object({ skillId: id, trialId: uuid });
  const matchingTrial = async (who: SkillActor, skillId: string, trialId: string) => { const value = await trials.get(who, trialId); if (value.trial.expertId !== `skill-trial-${skillId}`) throw new RequestError('SKILL_TRIAL_NOT_FOUND', '试用不存在或无权访问。', 404); return value; };
  app.get<{ Params: { skillId: string } }>(`${root}/:skillId/trials`, { schema: { params, querystring: empty } }, request => trials.list(actor(request), request.params.skillId));
  app.post<{ Params: { skillId: string }; Body: { expectedDraftRevision?: number; revisionId?: string; clientActionId: string; input: string; files?: ExpertTrialFile[] } }>(`${root}/:skillId/trials`, { bodyLimit: 1024 * 1024, schema: { params, body: { ...object({ expectedDraftRevision: revision, revisionId, clientActionId: uuid, input: { type: 'string', minLength: 1, maxLength: 16000 }, files: { type: 'array', maxItems: 8, items: object({ name: { type: 'string', minLength: 1, maxLength: 255 }, content: { type: 'string', maxLength: 65536 } }) } }, ['clientActionId', 'input']), oneOf: [{ required: ['expectedDraftRevision'], not: { required: ['revisionId'] } }, { required: ['revisionId'], not: { required: ['expectedDraftRevision'] } }] } } }, async request => { const who = actor(request); const prepared = await skills.prepareTrialAction(who, request.params.skillId, request.body, trials.actionId(who,request.body.clientActionId)); if(prepared.replayed)return trials.replay(who,prepared.trialId); return trials.start(who, { clientActionId: request.body.clientActionId, package: prepared.package, input: request.body.input }, request.body.files); });
  app.get<{ Params: { skillId: string; trialId: string } }>(`${root}/:skillId/trials/:trialId`, { schema: { params: trialParams, querystring: empty } }, request => matchingTrial(actor(request), request.params.skillId, request.params.trialId));
  app.post<{ Params: { skillId: string; trialId: string } }>(`${root}/:skillId/trials/:trialId/cancel`, { schema: { params: trialParams, body: empty }, preValidation: async request => { request.body ??= {}; } }, async request => { const who = actor(request); await matchingTrial(who, request.params.skillId, request.params.trialId); return trials.cancel(who, request.params.trialId); });
  app.post<{ Params: { skillId: string; trialId: string; interactionId: string }; Body: unknown }>(`${root}/:skillId/trials/:trialId/interactions/:interactionId`, { schema: { params: object({ skillId: id, trialId: uuid, interactionId: uuid }) } }, async request => { const who = actor(request); await matchingTrial(who, request.params.skillId, request.params.trialId); return trials.respond(who, request.params.trialId, request.params.interactionId, request.body); });
  app.get<{ Params: { skillId: string; trialId: string; downloadId: string } }>(`${root}/:skillId/trials/:trialId/downloads/:downloadId`, { schema: { params: object({ skillId: id, trialId: uuid, downloadId: uuid }), querystring: empty } }, async (request, reply) => { const who = actor(request); await matchingTrial(who, request.params.skillId, request.params.trialId); return sendFile(reply, await trials.download(who, request.params.trialId, request.params.downloadId)); });
  // Binary parsing is restricted to this plugin and never changes ordinary file uploads.
  await app.register(async scoped => {
    scoped.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (_request, body, done) => done(null, body));
    scoped.post<{ Querystring: { name: string }; Body: Buffer }>(`${root}/import-preview`, { bodyLimit: 20 * 1024 * 1024, schema: { querystring: object({ name: { type: 'string', minLength: 1, maxLength: 240 } }) } }, request => { actor(request); return previewSkillImport(request.query.name, request.body); });
  });
  app.post<{ Body: { clientActionId: string; preview: SkillImportPreview } }>(`${root}/import`, { bodyLimit: 145 * 1024 * 1024, schema: { body: object({ clientActionId: uuid, preview: object({ files, packageDigest: digest, name: { type: 'string', maxLength: 128 }, description: { type: 'string', maxLength: 1024 }, validation: { type: 'object' }, wrapper: { type: 'string', maxLength: 1024 }, warnings: { type: 'array', maxItems: 100, items: { type: 'string', maxLength: 4000 } } }, ['files', 'packageDigest', 'name', 'description', 'validation', 'warnings']) }) } }, request => skills.import(actor(request), request.body));
}
