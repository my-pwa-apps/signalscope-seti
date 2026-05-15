import { useEffect, useRef } from 'react';
import { Card, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { Stat } from '../components/ui/Stat';
import { MeterBar } from '../components/ui/MeterBar';
import { Waterfall } from '../components/viz/Waterfall';
import { SpectrumPlot } from '../components/viz/SpectrumPlot';
import { useEngine } from '../engine/store';
import {
  formatDec,
  formatDuration,
  formatHz,
  formatMHz,
  formatRA
} from '../utils/format';
import { Button } from '../components/ui/Button';
import {
  buildFindingsBundle,
  canExportFindings,
  suggestedBundleFileName
} from '../data/findingsExport';

export function LiveAnalysis() {
  const status = useEngine((s) => s.status);
  const unit = useEngine((s) => s.currentUnit);
  const live = useEngine((s) => s.liveSpectrogram);
  const lastResult = useEngine((s) => s.lastResult);
  const progress = useEngine((s) => s.progress);
  const cpu = useEngine((s) => s.cpuUsageEstimate);
  const fetchProgress = useEngine((s) => s.fetchProgress);
  const lastError = useEngine((s) => s.lastError);
  const clearError = useEngine((s) => s.clearError);
  const start = useEngine((s) => s.start);
  const pause = useEngine((s) => s.pause);

  const isRunning = status === 'analyzing' || status === 'fetching';
  const isReal = unit?.dataSource?.kind === 'filterbank';
  const isUpload = unit?.dataSource?.kind === 'filterbank-local';
  const isCached = unit?.dataSource?.kind === 'cached-decoded';
  const exportable = unit !== undefined && unit !== null && lastResult !== undefined && canExportFindings(unit, lastResult);

  function handleExport() {
    if (!unit || !lastResult) return;
    const blob = buildFindingsBundle(unit, lastResult);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedBundleFileName(unit);
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke the URL after the browser has had a chance to start the download.
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  return (
    <div className="space-y-5">
      {lastError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-signal-rose/40 bg-signal-rose/[0.08] px-4 py-3 text-sm text-signal-rose">
          <div>
            <div className="font-semibold">Real-data fetch failed</div>
            <div className="text-xs text-signal-rose/80">{lastError}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}
      {isReal && fetchProgress && status === 'analyzing' && progress === 0 && (
        <div className="rounded-xl border border-signal-cyan/30 bg-signal-cyan/[0.05] px-4 py-3 text-xs text-slate-300">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-signal-cyan">
              Streaming real filterbank · {fetchProgress.phase}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {(fetchProgress.bytesLoaded / 1024 / 1024).toFixed(2)} MB /{' '}
              {(fetchProgress.bytesTotal / 1024 / 1024).toFixed(0)} MB budget
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <ProgressFill
              value={
                fetchProgress.bytesTotal > 0
                  ? fetchProgress.bytesLoaded / fetchProgress.bytesTotal
                  : 0
              }
              className="bg-signal-cyan"
            />
          </div>
        </div>
      )}
      {isUpload && fetchProgress && status === 'analyzing' && progress === 0 && (
        <div className="rounded-xl border border-signal-mint/30 bg-signal-mint/[0.05] px-4 py-3 text-xs text-slate-300">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-signal-mint">
              Reading uploaded filterbank · {fetchProgress.phase}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {(fetchProgress.bytesLoaded / 1024 / 1024).toFixed(2)} MB /{' '}
              {(fetchProgress.bytesTotal / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/5">
            <ProgressFill
              value={
                fetchProgress.bytesTotal > 0
                  ? fetchProgress.bytesLoaded / fetchProgress.bytesTotal
                  : 0
              }
              className="bg-signal-mint"
            />
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Waterfall · time × frequency"
            subtitle="Brighter pixels mean more radio energy in that channel and time bin."
            right={
              <div className="flex items-center gap-2">
                {exportable && (
                  <Button size="sm" variant="ghost" onClick={handleExport}>
                    Export findings
                  </Button>
                )}
                {isRunning ? (
                  <Button size="sm" variant="ghost" onClick={pause}>
                    Pause
                  </Button>
                ) : (
                  <Button size="sm" onClick={start}>
                    {status === 'paused' ? 'Resume' : 'Start'}
                  </Button>
                )}
              </div>
            }
          />
          <div className="relative aspect-[2/1] w-full overflow-hidden rounded-xl border border-white/5 bg-space-950">
            <Waterfall
              spectrogram={live}
              candidates={lastResult?.candidates ?? []}
              progress={isRunning ? progress : 0}
              scanline={isRunning}
            />
            <FreqTimeAxes unit={unit ?? undefined} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Pill tone="cyan">Inferno colormap</Pill>
            <Pill tone="violet">Detected candidates outlined</Pill>
            {isReal && (
              <Pill tone="mint" dot>
                Real telescope data
              </Pill>
            )}
            {isUpload && (
              <Pill tone="mint" dot>
                Your upload &middot; local
              </Pill>
            )}
            {isCached && (
              <Pill tone="mint" dot>
                Cached replay
              </Pill>
            )}
            {unit?.chunkCount && unit.chunkCount > 1 && (
              <Pill tone="violet">
                {unit.chunkCount}-window sample
              </Pill>
            )}
            <span className="ml-auto font-mono text-[10px] uppercase tracking-widest text-slate-500">
              {unit
                ? `${unit.channels} ch × ${unit.frames} frames`
                : 'no unit loaded'}
            </span>
          </div>

          <div className="mt-5">
            <CardHeader
              title="Time-integrated spectrum"
              subtitle="Average channel intensity across the whole observation."
            />
            <div className="h-32 w-full overflow-hidden rounded-xl border border-white/5 bg-space-950">
              <SpectrumPlot spectrogram={live} unit={unit ?? undefined} />
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Work unit metadata" />
            {unit ? (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Field label="Target" value={unit.target.name} />
                <Field label="Telescope" value={unit.telescope} />
                <Field label="Right Ascension" value={formatRA(unit.target.raHours)} mono />
                <Field label="Declination" value={formatDec(unit.target.decDeg)} mono />
                <Field label="Distance" value={unit.target.distanceLy ? `${unit.target.distanceLy.toLocaleString()} ly` : '—'} />
                <Field label="Observed" value={new Date(unit.observedAt).toLocaleString()} />
                <Field
                  label="Frequency band"
                  value={`${formatMHz(unit.freqStartMHz)} – ${formatMHz(unit.freqEndMHz)}`}
                  mono
                />
                <Field label="Channel BW" value={formatHz(unit.channelBandwidthHz)} mono />
                <Field label="Frame period" value={`${unit.framePeriodSec.toFixed(3)} s`} mono />
                <Field label="Source" value={unit.sourceRef} mono />
              </dl>
            ) : (
              <p className="text-sm text-slate-500">
                No work unit loaded. Press Start to fetch one.
              </p>
            )}
            {unit && (
              <div className="mt-4 rounded-lg border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400">
                {unit.license}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Live engine" />
            <div className="space-y-3">
              <Stat
                label="Progress"
                value={`${(progress * 100).toFixed(0)}%`}
                accent="cyan"
              />
              <MeterBar value={progress} tone="cyan" />
              <Stat
                label="Estimated CPU"
                value={`${(cpu * 100).toFixed(0)}%`}
                accent="violet"
              />
              <MeterBar value={cpu} tone="violet" />
              {lastResult && (
                <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3 text-xs text-slate-400">
                  <div className="font-semibold text-slate-300">Last unit summary</div>
                  <div className="mt-1 font-mono">
                    {lastResult.candidates.length} candidates · {formatDuration(lastResult.computeMs)} ·{' '}
                    {(lastResult.binsProcessed / 1e6).toFixed(2)} M bins
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title="What you're looking at"
          subtitle="A plain-English guide to this view."
        />
        <div className="grid grid-cols-1 gap-4 text-sm text-slate-300 md:grid-cols-3">
          <ExplainBlock
            title="Why narrowband?"
            body="Natural cosmic sources are broadband and noisy. A narrow tone in a narrow channel is unusual and worth examining."
          />
          <ExplainBlock
            title="Why drift?"
            body="As planets and telescopes move relative to each other, a real distant transmitter's frequency would drift slightly over time — a Doppler signature."
          />
          <ExplainBlock
            title="Why interference?"
            body="Phones, satellites, and electronics on Earth produce strong signals too. We flag them when the energy is wide, vertical, or too steady."
          />
        </div>
      </Card>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className={mono ? 'font-mono text-slate-200' : 'text-slate-200'}>{value}</dd>
    </>
  );
}

function ExplainBlock({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="text-xs font-semibold uppercase tracking-widest text-signal-cyan/90">
        {title}
      </div>
      <p className="mt-2 leading-relaxed text-slate-300">{body}</p>
    </div>
  );
}

function ProgressFill({ value, className }: { value: number; className: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  useEffect(() => {
    if (ref.current) ref.current.style.width = `${pct}%`;
  }, [pct]);
  return <div ref={ref} className={`h-full rounded-full transition-[width] ${className}`} />;
}

function FreqTimeAxes({ unit }: { unit?: import('../types/domain').WorkUnit }) {
  if (!unit) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-3 font-mono text-[10px] uppercase tracking-widest text-slate-400">
      <div className="flex items-center justify-between">
        <span>{formatMHz(unit.freqStartMHz)}</span>
        <span>frequency →</span>
        <span>{formatMHz(unit.freqEndMHz)}</span>
      </div>
      <div className="flex items-center justify-between">
        <span>0.0 s</span>
        <span>↓ time</span>
        <span>{(unit.frames * unit.framePeriodSec).toFixed(1)} s</span>
      </div>
    </div>
  );
}
