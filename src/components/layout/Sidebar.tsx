import clsx from 'clsx';
import { NavLink } from 'react-router-dom';
import { useEngine } from '../../engine/store';
import { ScreensaverToggle } from '../screensaver/IdleScreensaver';

const LINKS = [
  { to: '/', label: 'Dashboard', icon: 'mission' },
  { to: '/live', label: 'Live Analysis', icon: 'live' },
  { to: '/sky', label: 'Space Map', icon: 'sky' },
  { to: '/findings', label: 'Findings', icon: 'find' },
  { to: '/learn', label: 'Learn', icon: 'learn' }
] as const;

export function Sidebar() {
  const status = useEngine((s) => s.status);
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-white/5 bg-space-950/80 p-5 md:flex">
      <div className="mb-8 flex items-center gap-3">
        <Logo />
        <div>
          <div className="font-semibold tracking-wide text-slate-100">SignalScope</div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-signal-cyan">SETI Edition</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              clsx(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive
                  ? 'bg-white/8 text-white shadow-[inset_0_0_0_1px_rgba(94,224,255,0.18)]'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-100'
              )
            }
          >
            <NavIcon name={l.icon} />
            <span>{l.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-6">
        <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400">
          <div className="mb-1 font-semibold uppercase tracking-widest text-slate-300">
            Privacy
          </div>
          Analysis runs locally in your browser. Exported findings are downloaded manually.
        </div>
        <ScreensaverToggle />
        <div className="flex items-center justify-between text-[10px] uppercase tracking-widest text-slate-500">
          <span>Engine</span>
          <StatusPill status={status} />
        </div>
      </div>
    </aside>
  );
}

function Logo() {
  return (
    <div className="relative h-10 w-10 overflow-hidden rounded-xl bg-gradient-to-br from-signal-cyan to-signal-violet shadow-glow">
      <div className="absolute inset-1 rounded-lg bg-space-950" />
      <div className="absolute inset-0 flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-signal-cyan">
          <path
            d="M2 14c2-3 4-3 6 0s4 3 6 0 4-3 6 0"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
          />
          <circle cx="18" cy="7" r="1.4" fill="#fbbf24" />
        </svg>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'analyzing'
      ? 'bg-signal-mint/20 text-signal-mint'
      : status === 'paused'
      ? 'bg-signal-amber/20 text-signal-amber'
      : status === 'fetching'
      ? 'bg-signal-cyan/20 text-signal-cyan'
      : 'bg-white/5 text-slate-400';
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[10px] tracking-widest',
        tone
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulseGlow" />
      {status}
    </span>
  );
}

function NavIcon({ name }: { name: string }) {
  const cls = 'h-4 w-4 text-current';
  switch (name) {
    case 'mission':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <rect x="3" y="4" width="18" height="6" rx="2" />
          <rect x="3" y="14" width="11" height="6" rx="2" />
          <rect x="16" y="14" width="5" height="6" rx="2" />
        </svg>
      );
    case 'live':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0" strokeLinecap="round" />
          <circle cx="12" cy="20" r="1" fill="currentColor" />
        </svg>
      );
    case 'sky':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      );
    case 'find':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M4 5h16M4 12h10M4 19h16" strokeLinecap="round" />
          <circle cx="19" cy="12" r="2" />
        </svg>
      );
    case 'learn':
      return (
        <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path d="M4 6l8-3 8 3-8 3-8-3z" />
          <path d="M4 12l8 3 8-3M4 18l8 3 8-3" />
        </svg>
      );
  }
  return null;
}
