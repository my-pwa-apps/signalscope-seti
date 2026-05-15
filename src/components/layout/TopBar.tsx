import { useEngine } from '../../engine/store';
import { Button } from '../ui/Button';
import { Pill } from '../ui/Pill';
import { formatDuration, formatNumber } from '../../utils/format';

export function TopBar() {
  const status = useEngine((s) => s.status);
  const stats = useEngine((s) => s.stats);
  const start = useEngine((s) => s.start);
  const pause = useEngine((s) => s.pause);
  const isRunning = status === 'analyzing' || status === 'fetching';

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/5 bg-space-950/80 px-5 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <Pill tone={status === 'analyzing' ? 'mint' : status === 'paused' ? 'amber' : 'cyan'} dot>
          {status === 'analyzing'
            ? 'Analyzing'
            : status === 'paused'
            ? 'Paused'
            : status === 'fetching'
            ? 'Fetching unit'
            : 'Idle'}
        </Pill>
        <span className="hidden font-mono text-xs text-slate-500 lg:inline">
          {formatNumber(stats.unitsAnalyzed)} units · {formatDuration(stats.totalComputeMs)} · {stats.candidatesFound} candidates
        </span>
      </div>

      <div className="flex items-center gap-2">
        {isRunning ? (
          <Button variant="ghost" size="sm" onClick={() => pause()}>
            Pause
          </Button>
        ) : (
          <Button size="sm" onClick={() => start()}>
            {status === 'paused' ? 'Resume' : 'Start analyzing'}
          </Button>
        )}
      </div>
    </header>
  );
}
