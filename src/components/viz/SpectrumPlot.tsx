import { useEffect, useRef } from 'react';
import type { Spectrogram, WorkUnit } from '../../types/domain';

interface Props {
  spectrogram: Spectrogram | null;
  unit?: WorkUnit;
  className?: string;
}

/**
 * Time-integrated band view: average intensity per channel.
 * Useful as a calmer companion to the waterfall.
 */
export function SpectrumPlot({ spectrogram, unit, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cnv = canvasRef.current;
    if (!cnv) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cnv.getBoundingClientRect();
    cnv.width = Math.floor(rect.width * dpr);
    cnv.height = Math.floor(rect.height * dpr);
    const ctx = cnv.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, rect.width, rect.height);

    // Background grid.
    ctx.strokeStyle = 'rgba(94,224,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = (i / 5) * rect.height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(rect.width, y);
      ctx.stroke();
    }
    for (let i = 0; i < 9; i++) {
      const x = (i / 8) * rect.width;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, rect.height);
      ctx.stroke();
    }

    if (!spectrogram) return;
    const { channels, frames, data } = spectrogram;
    const integ = new Float32Array(channels);
    for (let f = 0; f < frames; f++) {
      const off = f * channels;
      for (let c = 0; c < channels; c++) integ[c] += data[off + c];
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = 0; c < channels; c++) {
      integ[c] /= frames;
      if (integ[c] < lo) lo = integ[c];
      if (integ[c] > hi) hi = integ[c];
    }
    const range = Math.max(1e-6, hi - lo);

    // Filled area.
    ctx.beginPath();
    ctx.moveTo(0, rect.height);
    for (let c = 0; c < channels; c++) {
      const x = (c / (channels - 1)) * rect.width;
      const y = rect.height - ((integ[c] - lo) / range) * (rect.height - 6) - 3;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(rect.width, rect.height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, rect.height);
    grad.addColorStop(0, 'rgba(94,224,255,0.35)');
    grad.addColorStop(1, 'rgba(94,224,255,0.02)');
    ctx.fillStyle = grad;
    ctx.fill();

    // Stroke line.
    ctx.beginPath();
    for (let c = 0; c < channels; c++) {
      const x = (c / (channels - 1)) * rect.width;
      const y = rect.height - ((integ[c] - lo) / range) * (rect.height - 6) - 3;
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#5ee0ff';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Frequency labels.
    if (unit) {
      ctx.fillStyle = 'rgba(148,163,184,0.7)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.fillText(`${unit.freqStartMHz.toFixed(3)} MHz`, 4, rect.height - 4);
      ctx.textAlign = 'right';
      ctx.fillText(`${unit.freqEndMHz.toFixed(3)} MHz`, rect.width - 4, rect.height - 4);
    }
  }, [spectrogram, unit]);

  return <canvas ref={canvasRef} className={`block h-full w-full ${className ?? ''}`} />;
}
