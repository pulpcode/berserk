export interface Identity {
  role?: never;
  userId: string; username: string; displayName: string; seatId: string; seatName: string;
  /** Legacy name: create and manage all public task metadata; never grants workspace access. */
  createPublicTask: boolean;
  manageModelSettings: boolean;
  /** Explicit read-only public work summaries; no file or mutation authority. */
  viewWorkOverview?: boolean;
  /** Independent, explicitly provisioned scenario control capability; absence is denied. */
  controlScenarios?: boolean;
  /** Explicit server integration grant; never inferred from a seat name. */
  canIssueCommands?: boolean;
  /** Server-computed current business participation; absent only in legacy fixtures. */
  canCollaborate?: boolean;
}
/** A system account has no business seat and acquires no business permissions. */
export interface AdministratorIdentity {
  userId: string; username: string; displayName: string; role: 'administrator';
  /** Account-owned private workspace partition; never a business seat. */
  personalScopeId: string;
  seatId?: never; seatName?: never;
  canCollaborate: false; createPublicTask: false; manageModelSettings: false;
  viewWorkOverview?: false; controlScenarios?: false; canIssueCommands?: false;
}
export type AccountIdentity = Identity | AdministratorIdentity;
export function isBusinessIdentity(identity: AccountIdentity): identity is Identity { return typeof identity.seatId === 'string'; }
export interface AuthSession {
  mode: 'login' | 'test'; csrf?: string; viewId?: string; identity?: AccountIdentity;
  seats?: Array<{id: string; name: string}>;
  /** Public login choices contain no account details, responsibilities or permissions. */
  loginSeats?: Array<{id: string; name: string}>;
  /** Independent account choices expose only an opaque ID and public display name. */
  loginUsers?: Array<{id: string; name: string}>;
}
export type TaskBusinessRole = 'route' | 'resource' | 'location' | 'work_area' | 'reference';
export interface TaskBusinessRef {
  systemId: string;
  objectType: string;
  objectId: string;
  label?: string;
  role?: TaskBusinessRole;
}
export interface TaskContext {
  businessRefs?: TaskBusinessRef[];
  focus?: {
    areaIds?: string[];
    time?: { from?: string; to?: string };
    topics?: string[];
  };
}
export interface TaskSpace {
  id: string; title: string; goal: string; visibility: 'public' | 'private'; ownerSeatId: string;
  state: 'active' | 'archived'; revision: number; createdByUserId: string; updatedByUserId: string; createdAt: string; updatedAt: string;
  context?: TaskContext;
  /** Present only for account-owned personal spaces. ownerSeatId retains the storage partition key. */
  ownerUserId?: string;
  /** Host-owned provenance; never accepted from the business task form. */
  scenarioInstanceId?: string;
  /** Business projection only; the original work/task state is retained. */
  readOnly?: boolean;
}
export interface TaskInput { title: string; goal: string; visibility: 'public' | 'private'; clientActionId: string; context?: TaskContext }
export interface TaskUpdateInput { title: string; goal: string; revision: number; context?: TaskContext | null }
