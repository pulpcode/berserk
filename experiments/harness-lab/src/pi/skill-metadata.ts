import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { RequestError } from '../contracts/errors.js';

/** Keep SDK parsing inside the Pi adapter; the deployment whitelist still owns identity. */
export function controlledSkillDescription(content: string, id: string): string {
  try {
    const { frontmatter, body } = parseFrontmatter(content);
    if (frontmatter.name !== id || typeof frontmatter.description !== 'string'
      || !frontmatter.description.trim() || !body.trim()) throw new Error('Invalid controlled method');
    return frontmatter.description.trim();
  } catch {
    throw new RequestError('RESOURCE_STATE_INVALID', 'Skill 配置损坏。', 409);
  }
}
