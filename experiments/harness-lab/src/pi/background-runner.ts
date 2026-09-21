import { join } from 'node:path';
import type { BackgroundExecutor } from '../background/executor.js';
import type { BackgroundProfileSnapshot } from '../contracts/background.js';
import type { SessionSnapshot } from '../contracts/index.js';
import { RequestError } from '../contracts/errors.js';
import { hashContent } from '../resources/files.js';
import { loadControlledSkills, type ResourceSnapshot } from '../resources/service.js';
import { loadAgentRoles } from './roles.js';
import { PiLab } from './lab.js';

/** Freeze only controlled deployment resources; never read a seat's instructions or history. */
export async function snapshotBackgroundProfile(lab: PiLab, profile: BackgroundProfileSnapshot): Promise<BackgroundProfileSnapshot> {
  if (Buffer.byteLength(profile.instructions, 'utf8') > 16384) throw new RequestError('BACKGROUND_SNAPSHOT_INVALID', '服务指令不能超过 16 KiB。', 413);
  const roles = profile.agentIds.length ? await loadAgentRoles(lab.config.agentRolesDir) : [];
  const agents = profile.agentIds.map(id => {
    const role = roles.find(item => item.name === id);
    if (!role) throw new RequestError('ROLE_CONFIG_INVALID', '处理方案指定的 Agent 不存在。', 503);
    return structuredClone(role);
  });
  const skills = await loadControlledSkills(profile.skillIds);
  return { ...structuredClone(profile), skills, agents };
}

function resources(profile: BackgroundProfileSnapshot, jobId: string): ResourceSnapshot {
  if (profile.skills?.length !== profile.skillIds.length || profile.agents?.length !== profile.agentIds.length
    || profile.skills.some(skill => !profile.skillIds.includes(skill.id) || hashContent(skill.content) !== skill.hash)
    || profile.agents.some(agent => !profile.agentIds.includes(agent.name))) throw new RequestError('BACKGROUND_SNAPSHOT_INVALID', '处理方案资源快照缺失或损坏，未启动模型。', 409);
  return { workspaceId: jobId, instructions: [
    { fileId: 'common', name: '服务指令（AGENTS.md）', content: '', hash: null, editable: false },
    { fileId: 'workspace', name: '预处理指令（AGENTS.md）', content: profile.instructions, hash: hashContent(profile.instructions), editable: false },
  ], sources: profile.resources.map(item => ({ ...item, description: item.title, hash: hashContent(item.content) })), skills: structuredClone(profile.skills) };
}

function verifiedResult(snapshot: SessionSnapshot): { snapshot: SessionSnapshot } {
  if (snapshot.recoveryWarning) throw new RequestError('BACKGROUND_RESULT_UNVERIFIED', '原生执行证据不完整，请核对历史及已有文件；不会自动重跑。', 409);
  return { snapshot };
}

/** The queue owns durable job state; this adapter only runs and reads the same native Pi machinery. */
export function createBackgroundExecutor(lab: PiLab): BackgroundExecutor {
  const running = new Map<string, () => void>();
  return {
    async execute(job, input) {
      if (!job.sessionId) throw new RequestError('BACKGROUND_SESSION_MISSING', '后台会话尚未登记。', 409);
      if (running.has(job.id)) throw new RequestError('SESSION_BUSY', '该作业正在执行。', 409);
      let cancelled = false;
      // Cancellation during asynchronous native preparation must not be lost.
      running.set(job.id, () => { cancelled = true; });
      try {
        if (job.kind === 'seat_analysis') {
          if (!job.seatId) throw new RequestError('BACKGROUND_ACTOR_MISSING', '后台分析缺少发起席位。', 409);
          const request = lab.start(job.sessionId, input.text, { ...input.selection, fileRefs: input.files.map(({ path }) => ({ path })) }, job.seatId,
            { background: true, jobId: job.id, requestId: job.requestId });
          running.set(job.id, () => {
            try { lab.cancel(job.sessionId!, job.requestId, job.seatId); }
            catch (error) { if (!(error instanceof RequestError) || error.code !== 'STALE_REQUEST') throw error; }
          });
          await request.run(input.onEvent);
          const current = lab.get(job.sessionId, job.seatId);
          return current.lastResult?.status === 'succeeded' ? verifiedResult(await lab.readSavedSession(job.sessionId, job.seatId)) : { snapshot: current };
        }
        if (!input.profile) throw new RequestError('BACKGROUND_PROFILE_MISSING', '后台处理方案快照缺失。', 409);
        const prepared = await lab.startPreprocess({ jobId: job.id, sessionId: job.sessionId, requestId: job.requestId, directory: input.directory,
          text: input.text, files: input.files, resources: resources(input.profile, job.id), roles: input.profile.agents!, tools: input.profile.tools,
          publish: input.publish });
        running.set(job.id, prepared.cancel);
        if (cancelled) prepared.cancel();
        await prepared.run(input.onEvent);
        const current = prepared.snapshot();
        return current.lastResult?.status === 'succeeded' ? verifiedResult(await lab.readPreprocess({ jobId: job.id, sessionId: job.sessionId, directory: input.directory })) : { snapshot: current };
      }
      finally { running.delete(job.id); }
    },
    async read(job) {
      if (!job.sessionId) return null;
      try {
        return job.kind === 'seat_analysis' ? lab.get(job.sessionId, job.seatId)
          : await lab.readPreprocess({ jobId: job.id, sessionId: job.sessionId, directory: join(lab.config.dataDir, 'background', 'jobs', job.id) });
      } catch (error) {
        if (error instanceof RequestError && error.code === 'SESSION_NOT_FOUND') return null;
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
    async cancel(job) { running.get(job.id)?.(); },
  };
}
