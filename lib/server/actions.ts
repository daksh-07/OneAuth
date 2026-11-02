'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { requireSession } from './auth';
import { UserFacingError } from './errors';
import { RateLimitError } from './ratelimit';
import { recordEvent } from './events';
import { clearCookie, COOKIE, requestContext } from './request';
import { renameDevice, revokeDevice } from './devices';
import { revokeSession } from './sessions';
import { removePasskey } from './webauthn';
import { deleteAccount, renamePasskey, setPrimaryUse, updateDisplayName } from './account';
import { lookupPairingForApprover } from './pairing';

export type ActionResult = { ok: true } | { ok: false; message: string; code?: string };

async function run(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn();
    return { ok: true };
  } catch (err) {
    if (err instanceof UserFacingError) return { ok: false, message: err.message, code: err.code };
    if (err instanceof RateLimitError) return { ok: false, message: 'Too many attempts. Please wait a moment.', code: 'rate_limited' };
    console.error(JSON.stringify({ level: 'error', msg: 'action failed', name: (err as Error)?.name }));
    return { ok: false, message: 'Something went wrong. Please try again.' };
  }
}

export async function revokeDeviceAction(deviceId: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('devices:manage');
    const ok = await revokeDevice(session.user_id, String(deviceId), session.id, await requestContext());
    if (!ok) throw new UserFacingError('not_found', 'That device was not found or is already disconnected.', 404);
    revalidatePath('/', 'layout');
  });
}

export async function renameDeviceAction(deviceId: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('devices:manage');
    const trimmed = String(name).trim();
    if (trimmed.length < 1 || trimmed.length > 64) throw new UserFacingError('invalid_name', 'Enter a name between 1 and 64 characters.');
    const ok = await renameDevice(session.user_id, String(deviceId), trimmed, await requestContext());
    if (!ok) throw new UserFacingError('not_found', 'That device was not found.', 404);
    revalidatePath('/', 'layout');
  });
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('security:manage');
    const ok = await revokeSession(session.user_id, String(sessionId), 'user_revoked');
    if (!ok) throw new UserFacingError('not_found', 'That session was not found or has already ended.', 404);
    await recordEvent({ type: 'session.revoked', userId: session.user_id, deviceId: session.device_id, sessionId: session.id }, await requestContext());
    revalidatePath('/', 'layout');
  });
}

export async function updateNameAction(name: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('security:manage');
    await updateDisplayName(session.user_id, String(name));
    revalidatePath('/', 'layout');
  });
}

export async function setPrimaryUseAction(use: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('security:manage');
    await setPrimaryUse(session.user_id, String(use));
  });
}

export async function renamePasskeyAction(id: string, nickname: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('security:manage');
    const ok = await renamePasskey(session.user_id, String(id), String(nickname), await requestContext());
    if (!ok) throw new UserFacingError('not_found', 'Passkey not found.', 404);
    revalidatePath('/account');
  });
}

export async function removePasskeyAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const session = await requireSession('security:manage');
    await removePasskey(session, String(id), await requestContext());
    revalidatePath('/account');
  });
}

export async function deleteAccountAction(confirmation: string): Promise<ActionResult> {
  const result = await run(async () => {
    const session = await requireSession('security:manage');
    await deleteAccount(session, String(confirmation));
    await clearCookie(COOKIE.session);
    await clearCookie(COOKIE.device);
  });
  if (result.ok) redirect('/?deleted=1');
  return result;
}

export async function setThemeAction(theme: string): Promise<void> {
  const value = theme === 'light' || theme === 'dark' ? theme : 'system';
  (await cookies()).set(COOKIE.theme, value, { path: '/', sameSite: 'lax', maxAge: 400 * 24 * 60 * 60 });
  revalidatePath('/', 'layout');
}

/** Manual code entry on the approving device. */
export async function findPairingByCodeAction(code: string): Promise<ActionResult & { id?: string }> {
  let id: string | undefined;
  const result = await run(async () => {
    const session = await requireSession('devices:manage');
    const found = await lookupPairingForApprover(session, { code: String(code) }, await requestContext());
    if (!found || found.status !== 'pending') {
      throw new UserFacingError('not_found', 'No active request matches that code. Check the code on the other screen, or start again there.', 404);
    }
    id = found.id;
  });
  return { ...result, id };
}
