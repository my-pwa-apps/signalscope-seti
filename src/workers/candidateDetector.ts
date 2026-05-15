import type { CandidateLabel, CandidateSignal, WorkUnit } from '../types/domain';

export function quickMedian(arr: Float32Array): number {
  const a = Array.from(arr);
  a.sort((x, y) => x - y);
  const n = a.length;
  return n % 2 ? a[(n - 1) >> 1] : 0.5 * (a[n / 2 - 1] + a[n / 2]);
}

export function detectCandidates(unit: WorkUnit, data: Float32Array): CandidateSignal[] {
  const { channels, frames, channelBandwidthHz, framePeriodSec, freqStartMHz } = unit;

  const integrated = new Float32Array(channels);
  for (let frame = 0; frame < frames; frame++) {
    const offset = frame * channels;
    for (let channel = 0; channel < channels; channel++) {
      integrated[channel] += data[offset + channel];
    }
  }
  for (let channel = 0; channel < channels; channel++) integrated[channel] /= frames;

  const median = quickMedian(integrated.slice());
  const mad = quickMedian(Float32Array.from(integrated, (value) => Math.abs(value - median)));
  const sigma = Math.max(1e-6, 1.4826 * mad);

  const sampleFrame = Math.floor(frames / 2);
  const frameSlice = data.subarray(sampleFrame * channels, (sampleFrame + 1) * channels);
  const frameMedian = quickMedian(Float32Array.from(frameSlice));
  const frameMad = quickMedian(
    Float32Array.from(frameSlice, (value) => Math.abs(value - frameMedian))
  );
  const frameSigma = Math.max(1e-6, 1.4826 * frameMad);

  const peakChannels: number[] = [];
  for (let channel = 2; channel < channels - 2; channel++) {
    const value = integrated[channel];
    if (value < median + 4 * sigma) continue;
    if (
      value >= integrated[channel - 1] &&
      value >= integrated[channel + 1] &&
      value >= integrated[channel - 2] &&
      value >= integrated[channel + 2]
    ) {
      peakChannels.push(channel);
    }
  }

  const grouped: number[][] = [];
  for (const channel of peakChannels) {
    const last = grouped[grouped.length - 1];
    if (last && channel - last[last.length - 1] <= 3) last.push(channel);
    else grouped.push([channel]);
  }

  const candidates: CandidateSignal[] = [];
  const broadbandRuns = findBroadbandRuns(integrated, median + 3 * sigma);
  const acceptedBroadband = broadbandRuns.filter((run) => run.end - run.start >= 20);
  for (const run of acceptedBroadband) {
    candidates.push(
      buildCandidate(unit, {
        center: (run.start + run.end) / 2,
        peakValue: run.peak,
        sigma: frameSigma,
        median: frameMedian,
        rowSpan: { start: 0, end: frames - 1 },
        width: run.end - run.start,
        forceLabel: 'likely-rfi',
        forceExplanation:
          'Broadband emission across many channels - classic terrestrial transmitter signature.'
      })
    );
  }

  for (const group of grouped) {
    const center = group[Math.floor(group.length / 2)];
    if (acceptedBroadband.some((run) => center >= run.start && center <= run.end)) continue;

    const trackChannels = new Float32Array(frames);
    let peakValue = 0;
    let firstSeenRow = -1;
    let lastSeenRow = -1;
    let framesOn = 0;
    let lastChannel = center;
    for (let frame = 0; frame < frames; frame++) {
      let bestChannel = lastChannel;
      let bestValue = -Infinity;
      const low = Math.max(0, lastChannel - 4);
      const high = Math.min(channels - 1, lastChannel + 4);
      for (let channel = low; channel <= high; channel++) {
        const value = data[frame * channels + channel];
        if (value > bestValue) {
          bestValue = value;
          bestChannel = channel;
        }
      }
      trackChannels[frame] = bestChannel;
      if (bestValue > frameMedian + 4 * frameSigma) {
        if (firstSeenRow === -1) firstSeenRow = frame;
        lastSeenRow = frame;
        lastChannel = bestChannel;
        framesOn++;
      }
      if (bestValue > peakValue) peakValue = bestValue;
    }

    if (firstSeenRow === -1 || lastSeenRow - firstSeenRow < 3) continue;

    candidates.push(
      buildCandidate(unit, {
        center,
        peakValue,
        sigma: frameSigma,
        median: frameMedian,
        rowSpan: { start: firstSeenRow, end: lastSeenRow },
        width: group.length,
        slopeChPerFrame: linearSlope(trackChannels, firstSeenRow, lastSeenRow),
        framesOn
      })
    );
  }

  candidates.sort((a, b) => b.snr - a.snr);
  return candidates.slice(0, 12);

  function buildCandidate(
    workUnit: WorkUnit,
    options: {
      center: number;
      peakValue: number;
      sigma: number;
      median: number;
      rowSpan: { start: number; end: number };
      width: number;
      slopeChPerFrame?: number;
      framesOn?: number;
      forceLabel?: CandidateLabel;
      forceExplanation?: string;
    }
  ): CandidateSignal {
    const snr = (options.peakValue - options.median) / options.sigma;
    const driftHzPerSec = options.slopeChPerFrame
      ? (options.slopeChPerFrame * channelBandwidthHz) / framePeriodSec
      : 0;
    const frequencyMHz =
      freqStartMHz + (options.center / channels) * (workUnit.freqEndMHz - workUnit.freqStartMHz);
    const durationSec = (options.rowSpan.end - options.rowSpan.start + 1) * framePeriodSec;
    const persistence = (options.rowSpan.end - options.rowSpan.start + 1) / frames;
    const dutyCycle = options.framesOn !== undefined ? options.framesOn / frames : persistence;

    let label: CandidateLabel = options.forceLabel ?? 'noise';
    let explanation = options.forceExplanation ?? '';

    if (!options.forceLabel) {
      const looksVertical = Math.abs(driftHzPerSec) < 10 && dutyCycle > 0.85;
      const tooWide = options.width > 12;
      const fits = snr > 5 && options.width <= 6 && dutyCycle > 0.15;
      const driftPlausible = Math.abs(driftHzPerSec) > 10 && Math.abs(driftHzPerSec) < 500;
      const isPulsed = dutyCycle < 0.7 && persistence > 0.5;

      if (tooWide) {
        label = 'likely-rfi';
        explanation = 'Wide footprint across many channels - consistent with terrestrial radio interference.';
      } else if (looksVertical) {
        label = 'likely-rfi';
        explanation = 'No drift over time and a steady narrow tone - most likely a local transmitter (RFI).';
      } else if (fits && driftPlausible && snr > 8) {
        label = 'needs-followup';
        explanation =
          'Narrowband signal with plausible Doppler drift and high SNR. Repeat observation needed before any further interpretation.';
      } else if (fits && driftPlausible) {
        label = 'interesting';
        explanation =
          'Narrowband emitter that drifts in frequency over time - the kind of pattern SETI searches highlight.';
      } else if (fits && isPulsed) {
        label = 'interesting';
        explanation =
          'Intermittent narrowband emission - pulsed or scintillating. Could be a passing satellite or something more exotic. Needs more data.';
      } else {
        label = 'noise';
        explanation = 'Marginal excursion above the noise floor; most likely a statistical fluctuation.';
      }
    }

    const confidence = Math.max(0, Math.min(1, (snr - 4) / 16) * Math.max(0.3, persistence));

    return {
      id: `${workUnit.id}-CAND-${options.center}-${Math.round(options.peakValue * 1000)}`,
      workUnitId: workUnit.id,
      frequencyMHz,
      driftHzPerSec,
      snr,
      durationSec,
      confidence,
      label,
      explanation,
      pixel: {
        channel: options.center,
        row: options.rowSpan.start,
        width: Math.max(2, options.width),
        height: Math.max(2, options.rowSpan.end - options.rowSpan.start + 1)
      }
    };
  }
}

interface BroadbandRun {
  start: number;
  end: number;
  peak: number;
}

function findBroadbandRuns(integrated: Float32Array, threshold: number): BroadbandRun[] {
  const runs: BroadbandRun[] = [];
  let start = -1;
  let peak = 0;
  for (let channel = 0; channel < integrated.length; channel++) {
    const value = integrated[channel];
    if (value >= threshold) {
      if (start === -1) {
        start = channel;
        peak = value;
      } else if (value > peak) peak = value;
    } else if (start !== -1) {
      runs.push({ start, end: channel - 1, peak });
      start = -1;
      peak = 0;
    }
  }
  if (start !== -1) runs.push({ start, end: integrated.length - 1, peak });
  return runs;
}

function linearSlope(y: Float32Array, low: number, high: number): number {
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = high - low + 1;
  for (let i = low; i <= high; i++) {
    const x = i;
    sx += x;
    sy += y[i];
    sxx += x * x;
    sxy += x * y[i];
  }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}
