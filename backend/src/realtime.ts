/**
 * Realtime is intentionally HTTP-based in this build.
 *
 * The application refreshes authorized data from the API (dashboard polling
 * and notification badge polling). There is no unauthenticated Socket.IO room
 * and no privileged event payload delivered outside the normal API checks.
 * These hooks remain as cheap in-process signals for future authenticated
 * transports and for instrumentation, and contain no sensitive data.
 */

export interface DataChangeSignal {
  entity: string;
  action: string;
  id?: string;
  at: string;
}

const recentSignals: DataChangeSignal[] = [];

export function emitDataChanged(entity: string, action: string, id?: string) {
  recentSignals.push({ entity, action, id, at: new Date().toISOString() });
  if (recentSignals.length > 100) recentSignals.shift();
}

export function emitNotification(_userIds: string[], _payload: { title: string; message: string; link?: string | null }) {
  emitDataChanged('notifications', 'created');
}

export function recentDataChanges(): readonly DataChangeSignal[] {
  return recentSignals;
}
