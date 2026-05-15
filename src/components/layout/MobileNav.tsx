import { NavLink } from 'react-router-dom';

const LINKS = [
  { to: '/', label: 'Mission' },
  { to: '/live', label: 'Live' },
  { to: '/sky', label: 'Sky' },
  { to: '/findings', label: 'Findings' },
  { to: '/learn', label: 'Learn' }
];

export function MobileNav() {
  return (
    <nav className="md:hidden fixed bottom-3 left-3 right-3 z-50 flex justify-around rounded-2xl border border-white/10 bg-space-950/90 px-2 py-1.5 backdrop-blur-md">
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.to === '/'}
          className={({ isActive }) =>
            `rounded-xl px-3 py-2 text-[11px] font-semibold uppercase tracking-widest transition ${
              isActive ? 'bg-white/10 text-signal-cyan' : 'text-slate-400'
            }`
          }
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
