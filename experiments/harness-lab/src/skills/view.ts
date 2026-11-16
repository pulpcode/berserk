import type { SkillPackageRevision, SkillTrialSummary, SkillUseDetail } from '../contracts/skills.js';

/** Shared safe projection for formal accounts and test-seat API trees. */
export function skillUseDetail(value:SkillPackageRevision,trial:SkillTrialSummary={status:'not_tried'}):SkillUseDetail {
  return {skillId:value.skillId,revisionId:value.revisionId,packageDigest:value.packageDigest,
    name:value.name,description:value.description,releaseVersion:value.releaseVersion,requirements:value.requirements,
    content:Buffer.from(value.files.find(item=>item.path==='SKILL.md')!.contentBase64,'base64').toString('utf8'),
    files:value.files.map(({path,size,mediaType})=>({path,size,mediaType})),trialSummary:{status:trial.status}};
}
