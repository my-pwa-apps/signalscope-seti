import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle';
  size?: 'sm' | 'md' | 'lg';
  iconLeft?: ReactNode;
}

export function Button({
  children,
  className,
  variant = 'primary',
  size = 'md',
  iconLeft,
  ...rest
}: Props) {
  const sizes = {
    sm: 'h-8 px-3 text-xs',
    md: 'h-10 px-4 text-sm',
    lg: 'h-12 px-6 text-base'
  } as const;
  const variants = {
    primary:
      'bg-gradient-to-br from-signal-cyan/90 to-signal-violet/80 text-space-950 shadow-glow hover:brightness-110',
    ghost:
      'border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:border-white/20',
    danger:
      'bg-gradient-to-br from-signal-rose to-signal-amber text-space-950 hover:brightness-110',
    subtle: 'bg-transparent text-slate-300 hover:text-white hover:bg-white/5'
  } as const;
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold uppercase tracking-wider transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
        sizes[size],
        variants[variant],
        className
      )}
    >
      {iconLeft}
      {children}
    </button>
  );
}
