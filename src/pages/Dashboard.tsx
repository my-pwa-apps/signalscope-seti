import { useEffect, useRef, useState } from 'react';
import { Card, CardHeader } from '../components/ui/Card';
import { Stat } from '../components/ui/Stat';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { ResourceSlider } from '../components/ui/ResourceSlider';
import { MeterBar } from '../components/ui/MeterBar';
import { useEngine } from '../engine/store';
import { workClient } from '../engine/workClient';
import { formatDuration, formatNumber, relativeTime } from '../utils/format';
import { Link } from 'react-router-dom';

export function Dashboard() {
  const status = useEngine((s) => s.status);
  const stats = useEngine((s) => s.stats);
  const profile = useEngine((s) => s.resourceProfile);
  const cpu = useEngine((s) => s.cpuUsageEstimate);
  const setProfile = useEngine((s) => s.setProfile);
  const analyzeLocalFile = useEngine((s) => s.analyzeLocalFile);
  const analyzeCachedReplay = useEngine((s) => s.analyzeCachedReplay);
  const refreshCachedCount = useEngine((s) => s.refreshCachedCount);
  const cachedCount = useEngine((s) => s.cachedCount);
  const start = useEngine((s) => s.start);
  const pause = useEngine((s) => s.pause);
  const reset = useEngine((s) => s.resetStats);
  const history = useEngine((s) => s.history);
  const currentUnit = useEngine((s) => s.currentUnit);
  const progress = useEngine((s) => s.progress);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadInfo, setUploadInfo] = useState<{ name: string; sizeMB: number } | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  async function handleFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so the same file can be picked again
    e.target.value = '';
    if (!file) return;
    setUploadInfo({ name: file.name, sizeMB: file.size / (1024 * 1024) });
    await analyzeLocalFile(file);
  }

  const [global, setGlobal] = useState<{ usersOnline: number; unitsToday: number } | null>(null);
  useEffect(() => {
    let alive = true;
    workClient.fetchGlobalStats().then((g) => alive && setGlobal(g));
    const id = setInterval(() => {
      workClient.fetchGlobalStats().then((g) => alive && setGlobal(g));
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Refresh the cached-analyses count on mount and listen for online/offline
  // so the "Replay cached" affordance can light up when the network drops.
  useEffect(() => {
    refreshCachedCount();
    function onlineHandler() {
      setIsOnline(true);
    }
    function offlineHandler() {
      setIsOnline(false);
    }
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  }, [refreshCachedCount]);

  const isRunning = status === 'analyzing' || status === 'fetching';
  const lastError = useEngine((s) => s.lastError);
  const clearError = useEngine((s) => s.clearError);

  return (
    <div className="space-y-5">
      <Hero
        isRunning={isRunning}
        onStart={() => start()}
        onPause={() => pause()}
        progress={progress}
        currentTarget={currentUnit?.target.name}
      />

      {lastError && (
        <div className="flex items-start gap-3 rounded-lg border border-signal-rose/30 bg-signal-rose/[0.08] p-3 text-xs leading-relaxed text-signal-rose">
          <div className="flex-1">
            <div className="mb-1 font-semibold text-signal-rose">Engine paused after a fetch error</div>
            <div className="text-signal-rose/80">{lastError}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={clearError}>
            Dismiss
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
        <Card>
          <Stat
            label="Units analyzed"
            value={formatNumber(stats.unitsAnalyzed)}
            hint="On this device"
            accent="cyan"
          />
        </Card>
        <Card>
          <Stat
            label="Compute time"
            value={formatDuration(stats.totalComputeMs)}
            hint="Lifetime CPU spent"
            accent="violet"
          />
        </Card>
        <Card>
          <Stat
            label="Candidates"
            value={formatNumber(stats.candidatesFound)}
            hint="See Findings page"
            accent="mint"
          />
        </Card>
        <Card>
          <Stat
            label="Throughput"
            value={`${stats.throughputMbinsPerSec.toFixed(1)} Mb/s`}
            hint="Million FFT bins / sec"
            accent="amber"
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Data source"
            subtitle="Real Breakthrough Listen captures or your own .fil file — no synthetic data."
            right={
              cachedCount > 0 ? (
                <Pill tone="mint">
                  {cachedCount} cached observation{cachedCount === 1 ? '' : 's'}
                </Pill>
              ) : undefined
            }
          />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <LiveArchiveCard isOnline={isOnline} />
            <UploadModeCard
              active={!!uploadInfo}
              onPick={() => fileInputRef.current?.click()}
              info={uploadInfo}
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".fil,application/octet-stream"
            aria-label="Upload SIGPROC filterbank file"
            title="Upload SIGPROC filterbank file"
            className="hidden"
            onChange={handleFilePicked}
          />
          <div className="mt-4 rounded-lg border border-signal-cyan/30 bg-signal-cyan/[0.05] p-3 text-[11px] leading-relaxed text-slate-300">
            <span className="font-semibold text-signal-cyan">Heads-up:</span>{' '}
            Live archive streaming requires the Cloudflare Pages Function at{' '}
            <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">/api/datafile</code>{' '}
            to be reachable, which means deploying to Cloudflare Pages or running{' '}
            <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">wrangler pages dev</code>.
            Vite&rsquo;s plain dev server won&rsquo;t serve the proxy.
          </div>
          {(!isOnline || cachedCount > 0) && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-signal-mint/30 bg-signal-mint/[0.06] p-3 text-[11px] leading-relaxed text-slate-300">
              <div className="flex-1 min-w-[14rem]">
                <span className="font-semibold text-signal-mint">
                  {isOnline ? 'Offline-ready replay' : 'You are offline.'}
                </span>{' '}
                {cachedCount > 0
                  ? `${cachedCount} previously analyzed observation${cachedCount === 1 ? '' : 's'} stored locally. Replay one to keep the engine working without network access.`
                  : 'Connect to the network to analyze the live archive, or upload your own .fil file. After your first analysis we will cache it locally for offline replay.'}
                <span className="mt-1 block text-[10px] text-slate-400">
                  Note: only previously analyzed observations are available offline. The live
                  archive feed always requires network access, even from the installed PWA.
                </span>
              </div>
              {cachedCount > 0 && (
                <Button
                  size="sm"
                  variant={isOnline ? 'ghost' : 'primary'}
                  onClick={() => {
                    void analyzeCachedReplay();
                  }}
                >
                  Replay cached observation
                </Button>
              )}
            </div>
          )}
          {uploadInfo && (
            <div className="mt-3 rounded-lg border border-signal-mint/30 bg-signal-mint/[0.05] p-3 text-[11px] leading-relaxed text-slate-300">
              <span className="font-semibold text-signal-mint">Queued:</span>{' '}
              <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">{uploadInfo.name}</code>{' '}
              ({uploadInfo.sizeMB.toFixed(1)} MB). The file is parsed and analyzed
              entirely on this device &mdash; nothing is uploaded. The classifier
              treats your capture exactly like a Breakthrough Listen unit, so this
              is useful as a second-opinion pass on amateur or archived recordings.
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Attribution" subtitle="Where the data comes from." />
          <div className="space-y-3 text-xs leading-relaxed text-slate-400">
            <p>
              Real data is fetched from{' '}
              <a
                href="https://seti.berkeley.edu/opendata"
                target="_blank"
                rel="noopener noreferrer"
                className="text-signal-cyan hover:underline"
              >
                Breakthrough Listen Open Data
              </a>{' '}
              hosted by Berkeley SETI Research Center &mdash; the same lab that ran SETI@home.
            </p>
            <p className="text-slate-500">
              SETI@home itself has been in hibernation since 31 March 2020 and its work-unit
              servers no longer hand out new tasks. Breakthrough Listen is its scientific
              continuation.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Compute settings"
            subtitle="Choose how much of your machine SignalScope may use."
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <ResourceSlider value={profile} onChange={setProfile} />
              <div className="mt-4">
                <MeterBar value={cpu} label="Estimated CPU usage" tone="cyan" />
                <p className="mt-2 text-xs text-slate-500">
                  Heavy work runs in a background Web Worker so the UI stays smooth.
                  Pause anytime — your contribution stats are saved locally.
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-widest text-slate-300">
                  Results stay local
                </span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">
                SignalScope does not submit findings to a coordinator backend. Export a
                findings bundle when you want to share a candidate with a researcher.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill tone="cyan">Local-first</Pill>
                <Pill tone="violet">Manual export</Pill>
                <Pill tone="slate">No tracking</Pill>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Global activity" subtitle="Approximate values; no real coordinator yet." />
          <div className="space-y-4">
            <Stat
              label="Volunteers online"
              value={global ? formatNumber(global.usersOnline) : '—'}
              accent="mint"
            />
            <Stat
              label="Units processed today"
              value={global ? formatNumber(global.unitsToday) : '—'}
              accent="cyan"
            />
            <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3 text-xs text-slate-400">
              Inspired by the original SETI@home distributed-computing model. These
              numbers are placeholders — the analyses themselves run on real Berkeley
              SETI data, but there&rsquo;s no shared coordinator yet to aggregate
              results across volunteers.
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent work units"
            subtitle="The last few units analyzed by this device."
            right={
              <Link to="/findings" className="text-xs font-semibold text-signal-cyan hover:underline">
                View findings →
              </Link>
            }
          />
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Target</th>
                  <th className="px-4 py-2.5">Unit</th>
                  <th className="px-4 py-2.5">Candidates</th>
                  <th className="px-4 py-2.5">Compute</th>
                  <th className="px-4 py-2.5">Finished</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-500">
                      No completed units yet — press Start to begin.
                    </td>
                  </tr>
                )}
                {history.map((h) => (
                  <tr key={h.unitId + h.finishedAt} className="hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-slate-200">{h.targetName}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{h.unitId}</td>
                    <td className="px-4 py-2.5 text-signal-cyan">{h.candidates}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-300">
                      {formatDuration(h.computeMs)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">
                      {relativeTime(h.finishedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="House-keeping" subtitle="Local data stays on this device." />
          <div className="space-y-3 text-sm text-slate-300">
            <p className="text-xs leading-relaxed text-slate-400">
              Your contribution stats, candidates, recent history, cached analyses, and
              dataset memory are stored locally in your browser. Use the button below to
              start fresh.
            </p>
            <Button variant="ghost" size="sm" onClick={() => void reset()}>
              Reset local data
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Hero({
  isRunning,
  onStart,
  onPause,
  progress,
  currentTarget
}: {
  isRunning: boolean;
  onStart(): void;
  onPause(): void;
  progress: number;
  currentTarget?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/5 bg-gradient-to-br from-space-900 via-space-850 to-space-800 p-7 shadow-glow">
      <div className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full bg-signal-cyan/30 blur-3xl" />
      <div className="pointer-events-none absolute -left-20 bottom-0 h-72 w-72 rounded-full bg-signal-violet/30 blur-3xl" />
      <div className="relative grid grid-cols-1 items-center gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Pill tone="cyan" dot>
            Citizen Science · SETI Edition
          </Pill>
          <h1 className="mt-3 text-3xl font-semibold leading-tight text-slate-50 md:text-4xl">
            Donate your idle compute to listen for{' '}
            <span className="bg-gradient-to-r from-signal-cyan via-signal-violet to-signal-rose bg-clip-text text-transparent">
              narrowband signals
            </span>{' '}
            from the sky.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-400">
            SignalScope analyzes small chunks of public radio-astronomy data right here in
            your browser. Inspired by SETI@home and Breakthrough Listen Open Data. Your
            machine, your rules — nothing is uploaded by default.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {isRunning ? (
              <Button size="lg" variant="ghost" onClick={onPause}>
                Pause analysis
              </Button>
            ) : (
              <Button size="lg" onClick={onStart}>
                Start analyzing
              </Button>
            )}
            <Link
              to="/learn"
              className="text-sm font-medium text-slate-300 underline-offset-4 hover:text-white hover:underline"
            >
              How does it work?
            </Link>
          </div>
        </div>
        <div className="relative rounded-2xl border border-white/10 bg-space-950/40 p-5">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
            Current target
          </div>
          <div className="mt-1 text-xl font-semibold text-slate-100">
            {currentTarget ?? 'Idle — no unit loaded'}
          </div>
          <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <ProgressFill value={isRunning ? progress : 0} />
          </div>
          <div className="mt-2 font-mono text-[11px] text-slate-500">
            Work-unit progress · {(progress * 100).toFixed(0)}%
          </div>
        </div>
      </div>
    </div>
  );
}

function LiveArchiveCard({ isOnline }: { isOnline: boolean }) {
  return (
    <div
      className={`rounded-xl border bg-white/[0.02] p-4 text-left transition ${
        isOnline
          ? 'border-transparent ring-2 ring-signal-cyan/60 shadow-[0_0_22px_-8px_rgba(56,189,248,0.6)]'
          : 'border-white/5 opacity-70'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-signal-cyan' : 'bg-white/15'}`} />
        <span className="text-sm font-semibold text-slate-100">Live archive feed</span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        Streams real <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">.fil</code>{' '}
        filterbank captures from Berkeley SETI&rsquo;s public archive &mdash; Voyager 1
        (positive-control calibration, not an ET candidate), Oumuamua, TRAPPIST-1,
        FRB 121102, and more &mdash; through our Cloudflare range-proxy. Very large
        files (tens of GB) are sampled in multiple non-contiguous time windows.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill tone="cyan">Breakthrough Listen</Pill>
        <Pill tone="cyan">GBT &middot; Parkes</Pill>
        <Pill tone="cyan">9 verified targets</Pill>
      </div>
    </div>
  );
}

function UploadModeCard({
  active,
  onPick,
  info
}: {
  active: boolean;
  onPick(): void;
  info: { name: string; sizeMB: number } | null;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-label={active ? 'Pick another SIGPROC filterbank file' : 'Upload SIGPROC filterbank file'}
      className={`group rounded-xl border bg-white/[0.02] p-4 text-left transition ${
        active
          ? 'border-transparent ring-2 ring-signal-mint/60 shadow-[0_0_22px_-8px_rgba(110,231,183,0.6)]'
          : 'border-dashed border-white/15 hover:border-signal-mint/40 hover:bg-white/[0.04]'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-signal-mint' : 'bg-white/15'}`} />
        <span className="text-sm font-semibold text-slate-100">Upload your own .fil</span>
      </div>
      <p className="text-[11px] leading-relaxed text-slate-400">
        {info
          ? `Loaded ${info.name} (${info.sizeMB.toFixed(1)} MB). Click to pick another.`
          : 'Drop in a SIGPROC filterbank file from your own dish, software-defined radio capture, or an archive you already trust. Processed entirely in-browser \u2014 nothing is uploaded.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Pill tone="mint">Second opinion</Pill>
        <Pill tone="mint">100% local</Pill>
        <Pill tone="mint">.fil / SIGPROC</Pill>
      </div>
    </button>
  );
}

function ProgressFill({ value }: { value: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  useEffect(() => {
    if (ref.current) ref.current.style.width = `${pct}%`;
  }, [pct]);
  return (
    <div
      ref={ref}
      className="h-full rounded-full bg-gradient-to-r from-signal-cyan via-signal-violet to-signal-rose transition-[width]"
    />
  );
}
