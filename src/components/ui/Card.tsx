import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Extra glassy panel feel. */
  glass?: boolean;
}

export function Card({ children, className, glass = true, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={clsx(
        'rounded-2xl border border-white/5 bg-space-900/70 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
        glass && 'backdrop-blur-md',
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  right
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-300">
          {title}
        </h3>
        {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
