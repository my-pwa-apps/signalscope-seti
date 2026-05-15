export function formatMHz(mhz: number, digits = 4): string {
  if (mhz >= 1000) return `${(mhz / 1000).toFixed(digits)} GHz`;
  return `${mhz.toFixed(digits)} MHz`;
}

export function formatHz(hz: number): string {
  if (Math.abs(hz) >= 1e6) return `${(hz / 1e6).toFixed(2)} MHz`;
  if (Math.abs(hz) >= 1e3) return `${(hz / 1e3).toFixed(2)} kHz`;
  return `${hz.toFixed(2)} Hz`;
}

export function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  if (m < 60) return `${m.toFixed(1)} min`;
  const h = m / 60;
  if (h < 24) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

export function formatRA(hours: number): string {
  const h = Math.floor(hours);
  const mm = (hours - h) * 60;
  const m = Math.floor(mm);
  const s = (mm - m) * 60;
  return `${h.toString().padStart(2, '0')}h ${m.toString().padStart(2, '0')}m ${s.toFixed(1)}s`;
}

export function formatDec(deg: number): string {
  const sign = deg >= 0 ? '+' : '-';
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const mm = (a - d) * 60;
  const m = Math.floor(mm);
  const s = (mm - m) * 60;
  return `${sign}${d.toString().padStart(2, '0')}\u00B0 ${m
    .toString()
    .padStart(2, '0')}\u2032 ${s.toFixed(1)}\u2033`;
}

export function formatNumber(n: number, digits = 0): string {
  return n.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

export function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return `${mo}mo ago`;
}
