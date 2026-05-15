import { describe, expect, it } from 'vitest';
import { detectCandidates } from './candidateDetector';
import type { WorkUnit } from '../types/domain';

function unit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'test-unit',
    target: { name: 'Test Target', raHours: 1, decDeg: 2 },
    telescope: 'Green Bank Telescope',
    observedAt: '2026-05-15T00:00:00.000Z',
    freqStartMHz: 1420,
    freqEndMHz: 1421,
    channelBandwidthHz: 10,
    channels: 64,
    frames: 32,
    framePeriodSec: 1,
    sourceRef: 'TEST/source',
    license: 'test',
    ...overrides
  };
}

function baseline(workUnit: WorkUnit, value = 1): Float32Array {
  return new Float32Array(workUnit.channels * workUnit.frames).fill(value);
}

describe('detectCandidates', () => {
  it('does not flag a flat spectrogram', () => {
    const workUnit = unit();
    const candidates = detectCandidates(workUnit, baseline(workUnit));

    expect(candidates).toEqual([]);
  });

  it('labels a persistent stationary narrowband tone as likely RFI', () => {
    const workUnit = unit();
    const data = baseline(workUnit);
    for (let frame = 0; frame < workUnit.frames; frame++) {
      data[frame * workUnit.channels + 24] = 18;
    }

    const [candidate] = detectCandidates(workUnit, data);

    expect(candidate).toBeDefined();
    expect(candidate.label).toBe('likely-rfi');
    expect(candidate.frequencyMHz).toBeCloseTo(1420.375, 3);
    expect(candidate.snr).toBeGreaterThan(1_000_000);
  });

  it('labels a wide saturated channel run as broadband RFI', () => {
    const workUnit = unit();
    const data = baseline(workUnit);
    for (let frame = 0; frame < workUnit.frames; frame++) {
      for (let channel = 10; channel < 36; channel++) {
        data[frame * workUnit.channels + channel] = 12;
      }
    }

    const [candidate] = detectCandidates(workUnit, data);

    expect(candidate).toBeDefined();
    expect(candidate.label).toBe('likely-rfi');
    expect(candidate.pixel.width).toBeGreaterThanOrEqual(20);
    expect(candidate.explanation).toContain('Broadband');
  });
});
