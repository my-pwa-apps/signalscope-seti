import { Card, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { SpaceMap } from '../components/space/SpaceMap';
import { useEngine } from '../engine/store';
import { TARGET_CATALOG } from '../data/skyTargets';
import { formatDec, formatRA } from '../utils/format';
import type { SkyTarget } from '../types/domain';
import { useState } from 'react';

export function SpaceMapPage() {
  const currentUnit = useEngine((s) => s.currentUnit);
  const [override, setOverride] = useState<SkyTarget | null>(null);
  const target = override ?? currentUnit?.target ?? TARGET_CATALOG[0];
  const telescope = currentUnit?.telescope ?? 'Green Bank Telescope';

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
      <Card className="lg:col-span-3 !p-0 overflow-hidden">
        <div className="relative h-[68vh] min-h-[420px] w-full">
          <SpaceMap target={target} telescope={telescope} />
          <div className="pointer-events-none absolute bottom-4 left-4 max-w-md rounded-xl border border-white/10 bg-space-950/70 p-3 backdrop-blur-md">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-signal-cyan/80">
              Target
            </div>
            <div className="mt-0.5 text-lg font-semibold text-slate-100">{target.name}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[11px] text-slate-400">
              <span>RA</span>
              <span className="text-slate-200">{formatRA(target.raHours)}</span>
              <span>Dec</span>
              <span className="text-slate-200">{formatDec(target.decDeg)}</span>
              {target.distanceLy && (
                <>
                  <span>Distance</span>
                  <span className="text-slate-200">{target.distanceLy.toLocaleString()} ly</span>
                </>
              )}
            </div>
            {target.note && (
              <p className="mt-2 text-xs text-slate-400">{target.note}</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Sky targets" subtitle="Click to fly the camera there." />
        <div className="space-y-2">
          {TARGET_CATALOG.map((t) => {
            const active = t.name === target.name;
            return (
              <button
                key={t.name}
                onClick={() => setOverride(t)}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  active
                    ? 'border-signal-cyan/50 bg-signal-cyan/10 shadow-glow'
                    : 'border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-100">{t.name}</span>
                  {active && <Pill tone="cyan">active</Pill>}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-widest text-slate-500">
                  {formatRA(t.raHours)} · {formatDec(t.decDeg)}
                </div>
                {t.note && <p className="mt-1 text-xs text-slate-400">{t.note}</p>}
              </button>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-[11px] leading-relaxed text-slate-400">
          The 3D scene is for visualization only. Star positions are approximate and the
          camera flight is illustrative — no telescope is actually being pointed.
        </div>
      </Card>
    </div>
  );
}
