import clsx from 'clsx';
import { useEffect, useRef } from 'react';

interface Props {
  /** 0..1 */
  value: number;
  className?: string;
  label?: string;
  tone?: 'cyan' | 'violet' | 'mint' | 'amber';
}

const TONES = {
  cyan: 'from-signal-cyan to-signal-violet',
  violet: 'from-signal-violet to-signal-rose',
  mint: 'from-signal-mint to-signal-cyan',
  amber: 'from-signal-amber to-signal-rose'
} as const;

export function MeterBar({ value, className, label, tone = 'cyan' }: Props) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const fillRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (fillRef.current) fillRef.current.style.width = `${pct}%`;
  }, [pct]);
  return (
    <div className={clsx('w-full', className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          <span>{label}</span>
          <span className="font-mono text-slate-400">{pct.toFixed(0)}%</span>
        </div>
      )}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
        <div
          ref={fillRef}
          className={clsx('h-full rounded-full bg-gradient-to-r transition-[width]', TONES[tone])}
        />
      </div>
    </div>
  );
}
