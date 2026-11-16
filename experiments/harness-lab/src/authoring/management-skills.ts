import { join } from 'node:path';
import type { SkillFile } from '../contracts/index.js';
import type { AuthoringIntent } from '../contracts/authoring.js';
import { RequestError } from '../contracts/errors.js';
import { hashContent, readControlled } from '../resources/files.js';
import { controlledSkillDescription } from '../pi/skill-metadata.js';
import { fixtureDir } from '../tools/sources.js';

const methods = [
  { id: 'expert-manager', kind: 'expert', version: '1' },
  { id: 'skill-creator', kind: 'skill', version: '1' },
] as const;
export const managementSkillIds: readonly string[] = methods.map(method => method.id);
export function managementSkillKind(id: string): AuthoringIntent['kind'] | undefined { return methods.find(method => method.id === id)?.kind; }
/** These files are deployment-owned methods, never uploaded assets or writable publication records. */
export async function loadManagementSkills(ids: readonly string[] = managementSkillIds): Promise<SkillFile[]> {
  return Promise.all(ids.map(async id => {
    const method = methods.find(method => method.id === id);
    if (!method) throw new RequestError('RESOURCE_NOT_FOUND', '管理 Skill 不存在。', 404);
    const content = (await readControlled(join(fixtureDir, 'skills', id, 'SKILL.md'), 16384))!;
    const description = controlledSkillDescription(content, id);
    return { id, name: id, description, version: method.version, hash: hashContent(content), content };
  }));
}
