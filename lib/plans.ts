/**
 * Plan catalogue. Prices are unvalidated hypotheses and are NOT connected to a
 * payment provider; nothing here can charge anyone. Identity, storage and
 * enterprise entitlements stay separate so each can change independently.
 */
export interface Plan {
  id: string;
  name: string;
  status: 'available' | 'planned';
  identity: { maxTrustedDevices: number | null; temporarySessions: boolean };
  storageBytes: number;
  /** Proposed monthly price in minor units; null = free or custom. */
  proposedPrice: { amount: number; currency: string } | null;
}

const GB = 1024 ** 3;

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    status: 'available',
    identity: { maxTrustedDevices: null, temporarySessions: true },
    storageBytes: 0, // OneAuth Cloud is not launched; no storage is allocated yet.
    proposedPrice: null,
  },
  {
    id: 'personal_pro',
    name: 'Personal Pro',
    status: 'planned',
    identity: { maxTrustedDevices: null, temporarySessions: true },
    storageBytes: 100 * GB,
    proposedPrice: { amount: 899, currency: 'AUD' },
  },
  {
    id: 'family',
    name: 'Family',
    status: 'planned',
    identity: { maxTrustedDevices: null, temporarySessions: true },
    storageBytes: 0,
    proposedPrice: null,
  },
];

export const STORAGE_ADDON = { id: 'storage_100gb', bytes: 100 * GB, proposedPrice: { amount: 399, currency: 'AUD' }, status: 'planned' as const };

export function planById(id: string): Plan {
  return PLANS.find((p) => p.id === id) ?? PLANS[0];
}
