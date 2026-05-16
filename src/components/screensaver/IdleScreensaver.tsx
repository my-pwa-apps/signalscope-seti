import { useCallback, useEffect, useState } from 'react';
import { useEngine } from '../../engine/store';
import { Waterfall } from '../viz/Waterfall';

/**
 * Idle-time waterfall screensaver.
 *
 * After `idleMs` of no user activity, a full-viewport overlay renders the
 * current `liveSpectrogram` (or last cached one) at full size. Any pointer,
 * touch, keyboard, wheel or scroll event dismisses it.
 *
 * Settings are stored in `localStorage` under `signalscope.screensaver.idleMs`:
 *   0 (or missing) = disabled
 *   any positive integer = idle timeout in milliseconds
 *
 * Default ships disabled (opt-in) so we never surprise a first-time visitor
 * with a black overlay.
 */

const STORAGE_KEY = 'signalscope.screensaver.idleMs';
const SETTING_EVENT = 'signalscope:screensaver-change';

/** Sidebar UI options. Off + a few sensible idle thresholds. */
export const SCREENSAVER_OPTIONS: ReadonlyArray<{ label: string; ms: number }> = [
  { label: 'Off', ms: 0 },
  { label: '1 min', ms: 60_000 },
  { label: '3 min', ms: 180_000 },
  { label: '10 min', ms: 600_000 }
];

function readSetting(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Persist the setting and notify any in-tab listeners (the `storage`
 *  event only fires cross-tab, so we also dispatch a custom event). */
export function setScreensaverIdleMs(ms: number): void {
  try {
    if (ms <= 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(ms | 0));
    window.dispatchEvent(new Event(SETTING_EVENT));
  } catch {
    // No-op: storage may be unavailable (private mode); the in-memory state
    // in the toggle component will still update via its own onChange handler.
  }
}

/** Read the current setting and stay subscribed to changes from this tab
 *  (custom event) or other tabs (the native `storage` event). */
export function useScreensaverIdleMs(): number {
  const [ms, setMs] = useState<number>(readSetting);
  useEffect(() => {
    function refresh() {
      setMs(readSetting());
    }
    window.addEventListener('storage', refresh);
    window.addEventListener(SETTING_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(SETTING_EVENT, refresh);
    };
  }, []);
  return ms;
}

export function IdleScreensaver() {
  const idleMs = useScreensaverIdleMs();
  const [active, setActive] = useState(false);

  const live = useEngine((s) => s.liveSpectrogram);
  const last = useEngine((s) => s.lastSpectrogram);
  const status = useEngine((s) => s.status);
  const progress = useEngine((s) => s.progress);
  const isRunning = status === 'analyzing' || status === 'fetching';

  // Activity tracking. Effect re-arms whenever the timeout changes (or the
  // setting is turned off). Intentionally does NOT depend on `active` — the
  // listeners stay mounted and the wake path just toggles state.
  useEffect(() => {
    if (idleMs <= 0) {
      setActive(false);
      return;
    }

    let timer: number | null = null;

    function scheduleIdle() {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        // Don't fire while the tab is hidden — the user obviously isn't
        // looking, and waking on visibility flip is handled below.
        if (document.visibilityState === 'visible') setActive(true);
      }, idleMs);
    }

    function onActivity() {
      // React bails out when state is unchanged, so this is cheap even on
      // hi-rate `mousemove`.
      setActive(false);
      scheduleIdle();
    }

    const events = [
      'mousemove',
      'mousedown',
      'keydown',
      'touchstart',
      'wheel',
      'scroll'
    ] as const;
    for (const e of events) {
      window.addEventListener(e, onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', onActivity);
    scheduleIdle();

    return () => {
      for (const e of events) window.removeEventListener(e, onActivity);
      document.removeEventListener('visibilitychange', onActivity);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [idleMs]);

  // Esc explicitly dismisses (already covered by keydown above, but kept
  // for clarity / muscle memory).
  const dismiss = useCallback(() => setActive(false), []);
  useEffect(() => {
    if (!active) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') dismiss();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, dismiss]);

  if (!active) return null;

  const spec = live ?? last ?? null;

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-space-950"
      role="presentation"
      onClick={dismiss}
      onPointerDown={dismiss}
    >
      <div className="flex-1 overflow-hidden">
        <Waterfall
          spectrogram={spec}
          scanline={isRunning}
          progress={isRunning ? progress : 0}
          className="!rounded-none"
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-6 py-4 text-[10px] uppercase tracking-[0.3em] text-slate-500">
        <span>SignalScope · idle</span>
        <span>{spec ? 'Live waterfall' : 'No data yet · move to wake'}</span>
        <span>Press any key to wake</span>
      </div>
    </div>
  );
}

interface ToggleProps {
  className?: string;
}

/** Compact dropdown to choose the idle timeout. Reads/writes the same key
 *  used by `IdleScreensaver`, so the change takes effect immediately. */
export function ScreensaverToggle({ className }: ToggleProps) {
  const current = useScreensaverIdleMs();
  return (
    <div className={`flex items-center justify-between gap-2 ${className ?? ''}`}>
      <label
        htmlFor="screensaver-select"
        className="text-[10px] uppercase tracking-widest text-slate-500"
      >
        Screensaver
      </label>
      <select
        id="screensaver-select"
        aria-label="Idle waterfall screensaver"
        value={current}
        onChange={(e) => setScreensaverIdleMs(parseInt(e.target.value, 10) || 0)}
        className="rounded-md border border-white/10 bg-space-950/80 px-2 py-1 text-[11px] text-slate-200 focus:border-signal-cyan/60 focus:outline-none"
      >
        {SCREENSAVER_OPTIONS.map((opt) => (
          <option key={opt.ms} value={opt.ms}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
