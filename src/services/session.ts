/**
 * SIMULATED sign-in (COM-01, NFR-07, NFR-08). There are no passwords: a demo user is picked,
 * MFA roles confirm a one-time code that is shown on screen, and an idle timeout locks the
 * session. Nothing here is a security control.
 */
import { MFA_ROLES } from '../domain/pack';
import { nowIso, nowMs } from '../lib/clock';
import { uid } from '../lib/ids';
import { actorFor } from './authz';
import { commit, getDb } from './db';
import { appendAudit } from './ledger';
import { getUser } from './registry';
import { ServiceError } from './types';
import { L } from '../constants/labels';

const G = L.common.login;

let pendingOtp: { userId: string; code: string } | null = null;

export const isSignedIn = () => getDb().session.signedIn;
export const needsOtp = (userId: string) => MFA_ROLES.includes(getUser(userId)?.roleId ?? '');

/** Step 1. Returns the code to display when the role needs MFA. */
export function startSignIn(userId: string): { otp?: string } {
  if (!getUser(userId)) throw new ServiceError('not_found', G.unknownUser);
  if (needsOtp(userId)) {
    pendingOtp = { userId, code: String(100000 + Math.floor(Math.random() * 900000)) };
    return { otp: pendingOtp.code };
  }
  completeSignIn(userId);
  return {};
}

/** Step 2 for MFA roles. */
export function verifyOtp(userId: string, code: string) {
  if (!pendingOtp || pendingOtp.userId !== userId) throw new ServiceError('invalid_state', G.startAgain);
  if (code.trim() !== pendingOtp.code) throw new ServiceError('validation', G.wrongCode, { fieldErrors: { otp: G.incorrectCode } });
  pendingOtp = null;
  completeSignIn(userId);
}

function completeSignIn(userId: string) {
  commit((d) => {
    d.session = { userId, workspaceId: 'tc', signedIn: true, lastActiveAt: nowIso() };
    appendAudit(d, actorFor(userId, 'tc'), { action: 'login', summary: G.auditSignedIn(needsOtp(userId)), correlationId: uid('cor') });
  });
}

export function signOut(reason: 'user' | 'idle' = 'user') {
  commit((d) => {
    appendAudit(d, actorFor(d.session.userId, d.session.workspaceId), { action: 'logout', summary: reason === 'idle' ? G.auditIdle : G.auditSignedOut, correlationId: uid('cor') });
    d.session = { ...d.session, signedIn: false };
  });
}

/** Called on user activity (throttled by the caller). Does not emit a store revision. */
export function touchSession() {
  getDb().session.lastActiveAt = nowIso();
}

export function idleExpired(): boolean {
  const { session, demo } = getDb();
  return session.signedIn && nowMs() - new Date(session.lastActiveAt).getTime() > demo.idleTimeoutMin * 60_000;
}
