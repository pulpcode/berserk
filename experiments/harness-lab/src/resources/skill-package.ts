import type { SkillFile } from '../contracts/index.js';
import type { SkillPackageRevision, SkillRef as SkillPackageRef } from '../contracts/skills.js';
import { hashContent, stateError } from './files.js';

export function packageRef(skill: Pick<SkillFile, 'id' | 'revisionId' | 'packageDigest'>): SkillPackageRef {
  if (!skill.revisionId || !skill.packageDigest) throw stateError();
  return {skillId: skill.id, revisionId: skill.revisionId, packageDigest: skill.packageDigest};
}
/** Method body remains exact source bytes; the package digest addresses all resources. */
export function packageMethod(pkg: SkillPackageRevision): SkillFile {
  const method = pkg.files.find(file => file.path === 'SKILL.md');
  if (!method) throw stateError();
  const content = new TextDecoder('utf-8', {fatal: true}).decode(Buffer.from(method.contentBase64, 'base64'));
  return {id:pkg.skillId,name:pkg.name,description:pkg.description,version:pkg.releaseVersion,
    hash:hashContent(content),content,schemaVersion:2,revisionId:pkg.revisionId,packageDigest:pkg.packageDigest,
    ...(pkg.autoInvocationEligible === false ? {autoInvocationEligible:false} : {}),
    resourceRoot:`/skills/${pkg.skillId}/${pkg.revisionId}/${pkg.name}`};
}
