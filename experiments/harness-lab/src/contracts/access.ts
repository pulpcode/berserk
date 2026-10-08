export interface Identity {
  userId: string; username: string; displayName: string; seatId: string; seatName: string;
  /** Legacy name: create and manage all public task metadata; never grants workspace access. */
  createPublicTask: boolean;
  manageModelSettings: boolean;
}
export interface AuthSession {
  mode: 'login' | 'test'; csrf?: string; viewId?: string; identity?: Identity;
  seats?: Array<{id: string; name: string}>;
}
export interface TaskBusinessRef {
  systemId: string;
  objectType: string;
  objectId: string;
  label?: string;
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
}
export interface TaskInput { title: string; goal: string; visibility: 'public' | 'private'; clientActionId: string; context?: TaskContext }
export interface TaskUpdateInput { title: string; goal: string; revision: number; context?: TaskContext | null }
