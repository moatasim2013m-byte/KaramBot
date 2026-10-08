/**
 * Which state «ربط واتساب» is in, and what its one button says and does. Plain functions with
 * no React, so the backend's tests can hold the screen to the server's Arabic: every button the
 * server's messages name («أعد الربط», «أضف الرقم», «حاول مرة أخرى», «أكمل الربط») is the button
 * this screen shows in that state (backend/tests/connectViewContract.test.js).
 */

// Steps after which the server can carry on with the token it already holds: the button then
// posts /retry instead of opening Meta's window again for nothing.
export const SERVER_RESUMABLE = ['token_exchanged', 'subscribed', 'registered'];

export const BUTTON = {
  connectOwner: 'اربط واتساب',
  connectStaff: 'اربط واتساب لهذا الحساب',
  continue: 'أكمل الربط',
  retry: 'حاول مرة أخرى',
  reconnect: 'أعد الربط',
  addNumber: 'أضف الرقم',
};

/**
 * @param {{status?: string, onb?: object|null, problem?: object|null, isStaff?: boolean}} p
 * @returns {{kind: 'connected'|'revoked'|'needs_number'|'waiting_operator'|'steps',
 *   action: 'launch'|'retry'|null, label: string|null, started: boolean}}
 *   kind 'revoked' and 'needs_number' have their own card and no step list; 'waiting_operator'
 *   has no button (SHIFT finishes it from the token it kept).
 */
export function connectView({ status, onb = null, problem = null, isStaff = false } = {}) {
  const started = status === 'in_progress' || status === 'failed' || Boolean(problem);
  if (status === 'connected') return { kind: 'connected', action: null, label: null, started };
  // Meta took SHIFT off the account. Ahead of everything: the step the row reached says nothing
  // any more, and only a fresh popup brings it back (the server will not resume a revoked row).
  if (onb?.revoked) return { kind: 'revoked', action: 'launch', label: BUTTON.reconnect, started };
  // A WABA with no number: the customer adds one in Meta's window, so the popup opens again.
  if (status === 'needs_number') return { kind: 'needs_number', action: 'launch', label: BUTTON.addNumber, started };
  if (status === 'needs_operator') return { kind: 'waiting_operator', action: null, label: null, started };
  const resumeOnServer = SERVER_RESUMABLE.includes(onb?.step) && (status === 'in_progress' || status === 'failed');
  if (resumeOnServer) return { kind: 'steps', action: 'retry', label: BUTTON.retry, started };
  return {
    kind: 'steps',
    action: 'launch',
    label: started ? BUTTON.continue : (isStaff ? BUTTON.connectStaff : BUTTON.connectOwner),
    started,
  };
}
