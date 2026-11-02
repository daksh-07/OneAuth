import { Laptop, Monitor, Smartphone, Tablet } from 'lucide-react';

export function DeviceIcon({ platform, className }: { platform: string; className?: string }) {
  const Icon = platform === 'ios' || platform === 'android' ? Smartphone : platform === 'ipad' ? Tablet : platform === 'macos' || platform === 'windows' || platform === 'chromeos' ? Laptop : Monitor;
  return <Icon className={className} aria-hidden="true" />;
}
