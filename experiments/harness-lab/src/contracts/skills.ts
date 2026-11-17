/** R3 package contracts; legacy SkillRevision and native records retain schema1. */
export interface SkillRef { skillId:string; revisionId:string; packageDigest:string }
export interface SkillPrincipal { userId:string; seatId?:string; canCollaborate?:boolean }
export interface SkillActor { userId:string; assertAdministrator:()=>void }
export interface SkillFileInput { path:string; contentBase64:string }
export interface SkillPackageFile extends SkillFileInput { size:number; mediaType:string; hash:string }
export interface SkillPackageContent { schemaVersion:2; name:string; description:string; files:SkillPackageFile[]; requirements:Record<string,string>; autoInvocationEligible?:boolean }
export interface SkillPackageRevision extends SkillPackageContent,SkillRef { releaseVersion:string; createdAt:string; methodHash?:string }
export interface SkillIssue { code:string; message:string; path?:string; severity:'error'|'warning'|'info' }
export interface SkillValidation { valid:boolean; packageDigest:string; issues:SkillIssue[]; extensions:string[]; specificationVersion:string; checkedAt:string }
export interface SkillDraft { skillId:string; draftRevision:number; packageDigest:string; files:SkillFileInput[]; requirements:Record<string,string>; updatedAt:string }
export interface SkillSummary extends SkillRef { name:string; description:string; releaseVersion:string; system:boolean; state:'enabled'|'disabled'|'banned'; stateRevision:number; archived:boolean; available:boolean; autoInvocationEligible?:boolean }
export interface SkillPolicy { revision:number; mode:'none'|'all'|'seats'; seatIds:string[] }
export interface SkillScanFinding { path:string; line:number; endLine?:number; ruleId:string; message:string; severity:string }
export interface SkillScanReport { scanId:string; skillId:string; packageDigest:string; scanner:string; scannerVersion:string; rulesDigest:string; state:'pending'|'running'|'completed'|'partial'|'failed'|'not_applicable'; findings:SkillScanFinding[]; targets:string[]; scanned:string[]; skipped:Array<{path:string;reason:string}>; errors:string[]; createdAt:string; completedAt?:string; elapsedMs?:number }
export interface SkillPublication extends SkillRef { publicationId:string; releaseVersion:string; releaseNotes:string; publishedAt:string; publishedBy:string; scanId?:string; scanState?:SkillScanReport['state'] }
export interface SkillAudit { id:string; action:string; userId:string; createdAt:string; detail:Record<string,unknown> }
export interface ManagedSkillDetail { skill:SkillSummary; draft?:SkillDraft; validation?:SkillValidation; policy:SkillPolicy; publications:SkillPublication[]; scans:SkillScanReport[]; audit:SkillAudit[] }
export interface SkillImportPreview { files:SkillFileInput[]; packageDigest:string; name:string; description:string; validation:SkillValidation; wrapper?:string; warnings:string[] }
export interface SkillPublishInput { expectedDraftRevision:number; expectedCurrentRevisionId:string|null; releaseNotes:string; clientActionId:string }
/** Public per-package status only; trial owners, inputs, files and logs stay private. */
export interface SkillTrialSummary { status:'not_tried'|'prepared'|'running'|'succeeded'|'failed'|'cancelled'|'interrupted' }
export interface SkillUseDetail extends SkillRef {
  name:string; description:string; releaseVersion:string; requirements:Record<string,string>; content:string;
  files:Array<{path:string;size:number;mediaType:string}>; trialSummary:SkillTrialSummary;
}
