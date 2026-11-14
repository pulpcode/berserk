import { UUID } from '../workspaces/store.js';
import { stateError } from '../resources/files.js';

/** Reserved storage-owner namespace, never persisted in the business seats table. */
export function personalScopeUserId(scope: string): string | undefined {
  if (!scope.startsWith('account-')) return undefined;
  const userId = scope.slice('account-'.length);
  return UUID.test(userId) ? userId : undefined;
}

export function personalScopeId(userId: string): string {
  if (!UUID.test(userId)) throw stateError();
  return `account-${userId}`;
}
