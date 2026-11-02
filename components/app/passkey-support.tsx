'use client';

import { useSyncExternalStore } from 'react';
import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

const subscribe = () => () => {};

/** null while unknown (server render), then true/false. */
export function useWebAuthnSupport(): boolean | null {
  return useSyncExternalStore(subscribe, () => browserSupportsWebAuthn(), () => null);
}
