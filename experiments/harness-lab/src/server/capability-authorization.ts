import type { PiLab } from '../pi/lab.js';
import type { ExpertDefaultScope, ManagementActor } from '../contracts/capability-management.js';
import { SystemRoles } from '../access/system-roles.js';
import { isBusinessIdentity } from '../contracts/access.js';
import { RequestError } from '../contracts/errors.js';

export function capabilityIdentity(lab: PiLab, actor: ManagementActor) {
  const identity = lab.access?.accountIdentity(actor.userId);
  if (!identity || identity.seatId !== actor.seatId) throw new RequestError('AUTH_REQUIRED', '账号或席位已变化，请重新登录。', 401);
  return identity;
}
export function requireCapabilityAdministrator(lab: PiLab, actor: ManagementActor): void {
  capabilityIdentity(lab, actor);
  new SystemRoles(lab.access!.db).requireAdministrator(actor.userId);
}
export function authorizeExpertDefault(lab: PiLab, actor: ManagementActor, scope: ExpertDefaultScope, write: boolean): void {
  const identity = capabilityIdentity(lab, actor);
  if (scope.kind === 'personal') {
    if (!isBusinessIdentity(identity)) throw new RequestError('FORBIDDEN', '个人专家偏好需要业务席位。', 403);
    if (scope.id !== identity.userId) throw new RequestError('FORBIDDEN', '不能修改其他账号的个人偏好。', 403);
    lab.access!.assertCanCollaborate(identity.seatId);
  } else if (scope.kind === 'seat') {
    requireCapabilityAdministrator(lab, actor);
    if (!lab.access!.businessSeats().some(seat => seat.id === scope.id)) throw new RequestError('SEAT_NOT_FOUND', '业务席位不存在或已停用。', 404);
  } else {
    if (!isBusinessIdentity(identity)) throw new RequestError('FORBIDDEN', '任务专家配置需要业务席位。', 403);
    lab.access!.assertCanCollaborate(identity.seatId);
    const task = lab.access!.get(scope.id, identity.seatId, write);
    if (write && !(task.visibility === 'public' ? identity.createPublicTask : task.ownerSeatId === identity.seatId)) {
      throw new RequestError('FORBIDDEN', '当前席位无权管理此任务的默认专家。', 403);
    }
  }
}
