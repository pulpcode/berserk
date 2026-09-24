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
export interface TaskSpace {
  id: string; title: string; goal: string; visibility: 'public' | 'private'; ownerSeatId: string;
  state: 'active' | 'archived'; revision: number; createdByUserId: string; updatedByUserId: string; createdAt: string; updatedAt: string;
}
export interface TaskInput { title: string; goal: string; visibility: 'public' | 'private'; clientActionId: string }
