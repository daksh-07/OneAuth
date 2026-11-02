'use client';

export function SharedDeviceToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-card border border-line bg-surface p-3.5 has-[:checked]:border-warning/50 has-[:checked]:bg-warning-soft">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
      />
      <span>
        <span className="block text-sm font-medium">This is a shared or public computer</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">
          You’ll be signed out after 8 hours, and this device won’t be able to manage your account.
        </span>
      </span>
    </label>
  );
}
