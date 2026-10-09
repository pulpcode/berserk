import type { FastifyInstance } from 'fastify';
import { taskContextSchema } from '../access/context.js';
import type { BackgroundService } from '../background/service.js';
import type { BackgroundAnalysisInput } from '../contracts/background.js';
import type { TaskLinkUpdateInput, TaskSuggestionCreateInput } from '../contracts/task-information.js';
import { identityOf } from './auth.js';
import { sendFile } from './file-response.js';

const uuid = {type: 'string', format: 'uuid'};
const id = {type: 'string', pattern: '^[a-zA-Z0-9_-]{1,64}$'};
const shape = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({type: 'object', additionalProperties: false, properties, required});
const empty = shape({});
const taskParams = shape({taskId: uuid});
const itemParams = shape({taskId: uuid, eventId: uuid});
const eventParams = shape({eventId: uuid});
const jobQuery = shape({jobId: uuid});
const reason = {type: 'string', minLength: 1, maxLength: 1500};
type ItemParams = {taskId: string; eventId: string};

/** Browser routes share the existing login/CSRF/view hooks and the same scoped relation service as tools. */
export async function taskInformationRoutes(app: FastifyInstance, background?: BackgroundService) {
  if (!background) return;
  const links = background.taskLinks;
  app.get<{Params: {taskId: string}; Querystring: {query?: string; sourceId?: string; offset?: string; limit?: string}}>(
    '/api/tasks/:taskId/information', {schema: {params: taskParams, querystring: shape({query: {type: 'string', maxLength: 200}, sourceId: id, offset: {type: 'string', pattern: '^\\d{1,8}$'}, limit: {type: 'string', pattern: '^\\d{1,3}$'}}, [])}},
    request => links.list(identityOf(request), request.params.taskId, {...request.query, offset: request.query.offset === undefined ? undefined : Number(request.query.offset), limit: request.query.limit === undefined ? undefined : Number(request.query.limit)}));
  app.get<{Params: ItemParams; Querystring: {jobId: string}}>('/api/tasks/:taskId/information/:eventId', {schema: {params: itemParams, querystring: jobQuery}},
    request => links.detail(identityOf(request), request.params.taskId, request.params.eventId, request.query.jobId));
  app.get<{Params: ItemParams & {fileId: string}; Querystring: {jobId: string; preview?: string}}>('/api/tasks/:taskId/information/:eventId/files/:fileId',
    {schema: {params: shape({taskId: uuid, eventId: uuid, fileId: uuid}), querystring: shape({jobId: uuid, preview: {enum: ['true', 'false']}}, ['jobId'])}},
    async (request, reply) => sendFile(reply, await background.openTaskFile(identityOf(request), request.params.taskId, request.params.eventId, request.query.jobId, request.params.fileId), request.query.preview === 'true'));
  app.get<{Params: {eventId: string}; Querystring: {jobId: string}}>('/api/information/events/:eventId/task-links', {schema: {params: eventParams, querystring: jobQuery}},
    request => links.links(identityOf(request), request.params.eventId, request.query.jobId));
  app.put<{Params: ItemParams; Body: TaskLinkUpdateInput}>('/api/information/events/:eventId/task-links/:taskId',
    {schema: {params: itemParams, querystring: empty, body: shape({revision: {type: 'integer', minimum: 0}, mode: {enum: ['include', 'exclude', 'auto']}, jobId: uuid, reason}, ['revision', 'mode', 'jobId'])}},
    request => links.update(identityOf(request), request.params.eventId, request.params.taskId, request.body));
  app.post<{Params: {eventId: string}; Body: TaskSuggestionCreateInput}>('/api/information/events/:eventId/tasks',
    {schema: {params: eventParams, querystring: empty, body: shape({jobId: uuid, clientActionId: uuid, title: {type: 'string', minLength: 1, maxLength: 60}, goal: {type: 'string', minLength: 1, maxLength: 8000}, reason, context: taskContextSchema}, ['jobId', 'clientActionId', 'title', 'goal', 'reason'])}},
    request => links.createFromSuggestion(identityOf(request), request.params.eventId, request.body));
  app.post<{Params: ItemParams; Body: {jobId: string}}>('/api/tasks/:taskId/information/:eventId/analysis-options', {schema: {params: itemParams, querystring: empty, body: jobQuery}},
    request => background.analysisOptionsTask(identityOf(request), request.params.taskId, request.params.eventId, request.body.jobId));
  app.post<{Params: ItemParams; Body: Omit<BackgroundAnalysisInput, 'taskSpaceId'> & {jobId: string}}>('/api/tasks/:taskId/information/:eventId/analyses',
    {schema: {params: itemParams, querystring: empty, body: shape({jobId: uuid, clientActionId: uuid, goal: {type: 'string', minLength: 1, maxLength: 16000}, mode: {enum: ['conversation', 'background']}, includeResult: {type: 'boolean'}, fileIds: {type: 'array', maxItems: background.files.maxAttachments, uniqueItems: true, items: uuid}, skillIds: {type: 'array', maxItems: 1, items: id}, agentIds: {type: 'array', maxItems: 1, items: id}}, ['jobId', 'clientActionId', 'goal', 'mode', 'includeResult', 'fileIds'])}},
    request => { const {jobId, ...input} = request.body; return background.analyseTask(identityOf(request), request.params.taskId, request.params.eventId, jobId, input); });
  app.get<{Params: ItemParams; Querystring: {jobId: string; clientActionId: string}}>('/api/tasks/:taskId/information/:eventId/analyses',
    {schema: {params: itemParams, querystring: shape({jobId: uuid, clientActionId: uuid})}},
    request => background.findTaskAnalysis(identityOf(request), request.params.taskId, request.params.eventId, request.query.jobId, request.query.clientActionId));
}
