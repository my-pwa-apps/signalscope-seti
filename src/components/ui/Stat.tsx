import clsx from 'clsx';
import type { ReactNode } from 'react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: 'cyan' | 'violet' | 'rose' | 'amber' | 'mint';
  className?: string;
}

const ACCENTS: Record<NonNullable<Props['accent']>, string> = {
  cyan: 'text-signal-cyan',
  violet: 'text-signal-violet',
  rose: 'text-signal-rose',
  amber: 'text-signal-amber',
  mint: 'text-signal-mint'
};

export function Stat({ label, value, hint, accent = 'cyan', className }: Props) {
  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </span>
      <span className={clsx('font-mono text-2xl font-semibold', ACCENTS[accent])}>{value}</span>
      {hint && <span className="text-xs text-slate-500">{hint}</span>}
    </div>
  );
}
