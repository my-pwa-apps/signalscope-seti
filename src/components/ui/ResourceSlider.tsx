import clsx from 'clsx';
import type { ResourceProfile } from '../../types/domain';

interface Props {
  value: ResourceProfile;
  onChange(v: ResourceProfile): void;
  className?: string;
}

const OPTIONS: { value: ResourceProfile; label: string; hint: string }[] = [
  { value: 'eco', label: 'Eco', hint: 'Quiet — saves battery & CPU' },
  { value: 'balanced', label: 'Balanced', hint: 'Background-friendly default' },
  { value: 'maximum', label: 'Maximum', hint: 'Use all available cores' }
];

export function ResourceSlider({ value, onChange, className }: Props) {
  return (
    <div className={clsx('flex flex-col gap-2', className)}>
      <div className="grid grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/5 p-1">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={clsx(
              'rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-widest transition',
              value === o.value
                ? 'bg-gradient-to-br from-signal-cyan/90 to-signal-violet/80 text-space-950 shadow-glow'
                : 'text-slate-400 hover:text-slate-200'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="px-1 text-xs text-slate-500">
        {OPTIONS.find((o) => o.value === value)?.hint}
      </p>
    </div>
  );
}
