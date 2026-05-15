import { useEffect, useMemo, useRef } from 'react';
import { infernoLUT } from '../../utils/color';
import type { CandidateSignal, Spectrogram } from '../../types/domain';

interface Props {
  spectrogram: Spectrogram | null;
  candidates?: CandidateSignal[];
  /** Show animated scanline. */
  scanline?: boolean;
  /** Optional progress 0..1 to drive the scanline position. */
  progress?: number;
  className?: string;
}

/**
 * High-performance waterfall renderer using a pre-computed LUT and
 * `putImageData`. Repaints only when the spectrogram reference changes.
 */
export function Waterfall({
  spectrogram,
  candidates = [],
  scanline = true,
  progress = 0,
  className
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const lut = useMemo(() => infernoLUT(), []);
  const animRef = useRef<number | null>(null);

  // Paint the spectrogram bitmap whenever data changes.
  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv || !spectrogram) return;
    const { channels, frames, data } = spectrogram;
    cnv.width = channels;
    cnv.height = frames;
    const ctx = cnv.getContext('2d');
    if (!ctx) return;

    // Compute a robust scaling per repaint (5th–99th percentile).
    const sample = sampleValues(data, 4096);
    sample.sort((a, b) => a - b);
    const lo = sample[Math.floor(sample.length * 0.05)] ?? 0;
    const hi = sample[Math.floor(sample.length * 0.99)] ?? 1;
    const range = Math.max(1e-6, hi - lo);

    const img = ctx.createImageData(channels, frames);
    const px = img.data;
    for (let i = 0; i < channels * frames; i++) {
      const v = data[i];
      let n = (v - lo) / range;
      if (n < 0) n = 0;
      else if (n > 1) n = 1;
      const idx = (n * 255) | 0;
      const off = idx * 4;
      const o = i * 4;
      px[o] = lut[off];
      px[o + 1] = lut[off + 1];
      px[o + 2] = lut[off + 2];
      px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [spectrogram, lut]);

  // Paint overlays (candidates + scanline) on a separate canvas, animated.
  useEffect(() => {
    const overlay = overlayRef.current;
    const base = canvasRef.current;
    if (!overlay || !base || !spectrogram) return;
    overlay.width = base.width;
    overlay.height = base.height;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;

    let t0 = performance.now();
    const draw = () => {
      ctx.clearRect(0, 0, overlay.width, overlay.height);

      // Candidate boxes.
      for (const c of candidates) {
        const x = c.pixel.channel - c.pixel.width / 2;
        const y = c.pixel.row;
        const w = c.pixel.width;
        const h = c.pixel.height;
        const color = labelColor(c.label);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.25;
        ctx.shadowBlur = 6;
        ctx.shadowColor = color;
        ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
        ctx.shadowBlur = 0;
        if (c.aiAssessment && c.aiAssessment.label !== 'likely_rfi' && c.aiAssessment.label !== 'likely_noise') {
          const markerX = x + w + 2;
          const markerY = Math.max(4, y - 2);
          ctx.fillStyle = 'rgba(251,191,36,0.95)';
          ctx.beginPath();
          ctx.moveTo(markerX, markerY - 3);
          ctx.lineTo(markerX + 3, markerY);
          ctx.lineTo(markerX, markerY + 3);
          ctx.lineTo(markerX - 3, markerY);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Scanline.
      if (scanline) {
        const y = progress > 0 ? progress * overlay.height : ((performance.now() - t0) / 4000) * overlay.height % overlay.height;
        const grad = ctx.createLinearGradient(0, y - 18, 0, y + 18);
        grad.addColorStop(0, 'rgba(94,224,255,0)');
        grad.addColorStop(0.5, 'rgba(94,224,255,0.85)');
        grad.addColorStop(1, 'rgba(94,224,255,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y - 18, overlay.width, 36);
      }

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [spectrogram, candidates, scanline, progress]);

  return (
    <div className={`relative h-full w-full ${className ?? ''}`}>
      <canvas
        ref={canvasRef}
        className="pixelated-canvas absolute inset-0 h-full w-full rounded-lg"
      />
      <canvas
        ref={overlayRef}
        className="pixelated-canvas pointer-events-none absolute inset-0 h-full w-full rounded-lg"
      />
      {!spectrogram && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-500">
          <span className="text-sm">No spectrogram yet — start analysis to see live data.</span>
        </div>
      )}
    </div>
  );
}

function sampleValues(data: Float32Array, n: number): number[] {
  const stride = Math.max(1, Math.floor(data.length / n));
  const out: number[] = [];
  for (let i = 0; i < data.length; i += stride) out.push(data[i]);
  return out;
}

function labelColor(label: CandidateSignal['label']): string {
  switch (label) {
    case 'noise':
      return 'rgba(148,163,184,0.85)';
    case 'likely-rfi':
      return 'rgba(244,114,182,0.95)';
    case 'interesting':
      return 'rgba(94,224,255,0.95)';
    case 'needs-followup':
      return 'rgba(251,191,36,0.95)';
  }
}
