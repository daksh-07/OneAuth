'use client';

import {
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function postJson<T = unknown>(url: string, body: unknown = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('network', 'You appear to be offline. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? 'error', data.message ?? 'Something went wrong. Please try again.', res.status);
  return data as T;
}

/** Converts WebAuthn browser errors into plain-language messages. */
export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof WebAuthnError) {
    if (err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return 'This passkey is already registered to your account.';
    if (err.code === 'ERROR_CEREMONY_ABORTED') return 'Passkey request cancelled.';
  }
  const name = (err as Error)?.name;
  if (name === 'NotAllowedError') return 'The passkey request was cancelled or timed out.';
  if (name === 'InvalidStateError') return 'This passkey is already registered.';
  if (name === 'SecurityError') return 'Passkeys aren’t available on this address.';
  return 'Your passkey couldn’t be used. Please try again.';
}

export function isCancellation(err: unknown): boolean {
  return (err as Error)?.name === 'NotAllowedError' || (err instanceof WebAuthnError && err.code === 'ERROR_CEREMONY_ABORTED');
}

type Options<T> = { challengeId: string; options: T };

export async function registerPasskey(path: string, body: Record<string, unknown>, verifyBody: Record<string, unknown> = {}) {
  const { challengeId, options } = await postJson<Options<PublicKeyCredentialCreationOptionsJSON>>(`${path}/options`, body);
  const response = await startRegistration({ optionsJSON: options });
  return postJson<{ ok: true }>(`${path}/verify`, { challengeId, response, ...verifyBody });
}

export async function authenticatePasskey(path: string, verifyBody: Record<string, unknown> = {}) {
  const { challengeId, options } = await postJson<Options<PublicKeyCredentialRequestOptionsJSON>>(`${path}/options`, {});
  const response = await startAuthentication({ optionsJSON: options });
  return postJson<{ ok: true }>(`${path}/verify`, { challengeId, response, ...verifyBody });
}

/** Re-verifies the user with their passkey (step-up) before a sensitive action. */
export function stepUp() {
  return authenticatePasskey('/api/auth/stepup');
}

/** Runs fn; if the server asks for a fresh passkey check, performs one and retries once. */
export async function withStepUp<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'reauth_required') {
      await stepUp();
      return fn();
    }
    throw err;
  }
}

/** Same as withStepUp, for server actions that report errors as values. */
export async function actionWithStepUp<R extends { ok: boolean; code?: string }>(fn: () => Promise<R>): Promise<R> {
  const first = await fn();
  if (first.ok || first.code !== 'reauth_required') return first;
  await stepUp();
  return fn();
}
