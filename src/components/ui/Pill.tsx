import clsx from 'clsx';
import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  tone?: 'cyan' | 'violet' | 'rose' | 'amber' | 'mint' | 'slate';
  className?: string;
  dot?: boolean;
}

const TONES: Record<NonNullable<Props['tone']>, string> = {
  cyan: 'border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan',
  violet: 'border-signal-violet/30 bg-signal-violet/10 text-signal-violet',
  rose: 'border-signal-rose/30 bg-signal-rose/10 text-signal-rose',
  amber: 'border-signal-amber/30 bg-signal-amber/10 text-signal-amber',
  mint: 'border-signal-mint/30 bg-signal-mint/10 text-signal-mint',
  slate: 'border-white/10 bg-white/5 text-slate-300'
};

export function Pill({ children, tone = 'slate', className, dot }: Props) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-widest',
        TONES[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current shadow-glow animate-pulseGlow" />}
      {children}
    </span>
  );
}
