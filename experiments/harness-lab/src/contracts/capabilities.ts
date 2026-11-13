/** Shared capability data. Native conversation records are decoded only by src/pi. */
export type CapabilityMode = 'interactive' | 'delegated' | 'background' | 'trial';
export type CapabilityState = 'enabled' | 'disabled' | 'banned';
export interface ExpertRef { expertId: string; revisionId: string }
export interface SkillRevision {
  id: string; name: string; description: string; version: string; hash: string; content: string;
  revisionId: string; digest: string;
}
export interface ExpertRevision extends ExpertRef {
  schemaVersion: 1; releaseVersion: string; digest: string;
  name: string; description: string; instructions: string;
  modes: CapabilityMode[]; selectable: boolean; system: boolean;
  /** null retains the host's existing permission-filtered set; never grants new tools. */
  allowedTools: string[] | null;
  skills: SkillRevision[];
}
export interface CapabilityAvailability { available: boolean; state: CapabilityState; reason?: string }
export interface ExpertDependency {
  id: string; name: string; revisionId: string; releaseVersion: string; digest: string;
}
export interface ExpertSummary extends ExpertRef {
  name: string; description: string; releaseVersion: string; digest: string;
  modes: CapabilityMode[]; dependencies: ExpertDependency[];
  availability: CapabilityAvailability;
}
export interface ExpertDetail extends ExpertSummary { instructions: string; allowedTools: string[] | null }
export interface ExpertBinding {
  schemaVersion: 1; sessionId: string; workspaceId: string; seatId: string;
  expertRef: ExpertRef; digest: string; boundAt: string; userId?: string; legacy?: true;
}
export interface SessionExpert extends ExpertSummary {
  currentRevisionId: string; updateAvailable: boolean; legacy?: true;
}
export interface ExpertSessionSelection {
  expertRef?: ExpertRef; expectedDigest?: string; clientActionId?: string;
}
export interface ExecutionManifest {
  schemaVersion: 1; requestId: string; sessionId: string; workspaceId: string;
  expertRef: ExpertRef; digest: string; skills: ExpertDependency[];
  identity: { seatId: string; userId?: string }; mode: CapabilityMode;
  tools: string[]; model: { id: string; version: string }; runtime: string;
}
export interface CapabilityAdminSummary {
  experts: Array<ExpertSummary & { selectable: boolean; system: boolean }>;
  revisions: number; skillRevisions: number;
  migration: { state: 'none' | 'prepared' | 'completed'; inputDigest?: string };
}
