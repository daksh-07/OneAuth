import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Panel } from '@/components/ui/panel';

export function NoAccess({ what }: { what: string }) {
  return (
    <Panel>
      <EmptyState icon={<Lock />} title="Not available on this device">
        This device’s access doesn’t include {what}. Open OneAuth on a device you signed in to with your passkey.
      </EmptyState>
    </Panel>
  );
}
