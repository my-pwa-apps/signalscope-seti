import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// fake-indexeddb/auto installs an in-memory IndexedDB onto globalThis on import.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import {
  annotateRecurrence,
  clearDatasetMemory,
  getDatasetMemory,
  recordChunkAnalysis
} from './datasetMemory';
import type { AnalysisResult, CandidateSignal, WorkUnit } from '../types/domain';

function unit(overrides: Partial<WorkUnit> = {}): WorkUnit {
  return {
    id: 'u1',
    target: { name: 'TRAPPIST-1', raHours: 23.1, decDeg: -5 },
    telescope: 'Green Bank Telescope',
    observedAt: '2026-05-15T00:00:00.000Z',
    freqStartMHz: 1420,
    freqEndMHz: 1421,
    channelBandwidthHz: 10,
    channels: 1024,
    frames: 32,
    framePeriodSec: 1,
    sourceRef: 'BL/test',
    license: 'BSD',
    datasetId: 'BL-OPENDATA/test',
    chunkOffsets: [0],
    chunkSpanBytes: 1024,
    dataSource: {
      kind: 'filterbank',
      upstreamUrl: 'https://example.invalid/test.fil',
      proxyPath: '/api/datafile',
      maxBytes: 1024,
      totalFileBytes: 8192,
      displayChannels: 256,
      displayFrames: 32,
      attribution: 'test'
    },
    ...overrides
  };
}

function candidate(id: string, overrides: Partial<CandidateSignal> = {}): CandidateSignal {
  return {
    id,
    workUnitId: 'u1',
    frequencyMHz: 1420.405,
    driftHzPerSec: 0.1,
    snr: 12.4,
    durationSec: 32,
    confidence: 0.7,
    label: 'interesting',
    explanation: 'narrow peak',
    pixel: { channel: 100, row: 0, width: 1, height: 32 },
    ...overrides
  };
}

function result(candidates: CandidateSignal[]): AnalysisResult {
  return {
    workUnitId: 'u1',
    computeMs: 100,
    candidates,
    noiseFloor: 0.5,
    binsProcessed: 32_000
  };
}

describe('datasetMemory', () => {
  beforeEach(() => {
    // Replace IDB with a fresh in-memory instance for every test so test
    // ordering cannot leak state between cases.
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });
  afterEach(async () => {
    await clearDatasetMemory();
  });

  it('returns null for unknown datasetId', async () => {
    const m = await getDatasetMemory('does-not-exist');
    expect(m).toBeNull();
  });

  it('records coverage and candidate history on first analysis', async () => {
    const u = unit();
    await recordChunkAnalysis(u, result([candidate('c1')]));
    const m = await getDatasetMemory(u.datasetId!);
    expect(m).not.toBeNull();
    expect(m!.analyzedChunks).toHaveLength(1);
    expect(m!.analyzedChunks[0].offsets).toEqual([0]);
    expect(m!.candidates).toHaveLength(1);
    expect(m!.candidates[0].freqMHz).toBeCloseTo(1420.405);
    expect(m!.totalFileBytes).toBe(8192);
  });

  it('does not write memory for cached-decoded sources', async () => {
    const u = unit({
      dataSource: {
        kind: 'cached-decoded',
        data: new Float32Array(1),
        frames: 1,
        channels: 1,
        cachedAt: '2026-05-15T00:00:00.000Z',
        attribution: 'cached'
      }
    });
    await recordChunkAnalysis(u, result([candidate('c1')]));
    const m = await getDatasetMemory(u.datasetId!);
    expect(m).toBeNull();
  });

  it('annotateRecurrence returns 0 for first-time dataset', async () => {
    const u = unit();
    const out = await annotateRecurrence(u.datasetId, [candidate('c1')]);
    expect(out[0].recurrenceCount).toBe(0);
    expect(out[0].datasetId).toBe(u.datasetId);
  });

  it('annotateRecurrence counts prior hits within frequency tolerance', async () => {
    const u = unit();
    await recordChunkAnalysis(
      u,
      result([
        candidate('a', { frequencyMHz: 1420.405 }),
        candidate('b', { frequencyMHz: 1420.405 + 0.000_05 }) // ~50 Hz away (< 100 Hz default tol)
      ])
    );
    const out = await annotateRecurrence(u.datasetId, [
      candidate('new', { frequencyMHz: 1420.405 + 0.000_03 })
    ]);
    expect(out[0].recurrenceCount).toBe(2);
  });

  it('annotateRecurrence ignores prior hits outside frequency tolerance', async () => {
    const u = unit();
    await recordChunkAnalysis(
      u,
      result([candidate('a', { frequencyMHz: 1420.0 })])
    );
    const out = await annotateRecurrence(u.datasetId, [
      // 1 MHz away from the prior hit — well outside tolerance.
      candidate('new', { frequencyMHz: 1421.0 })
    ]);
    expect(out[0].recurrenceCount).toBe(0);
  });

  it('annotateRecurrence is a no-op when datasetId is missing', async () => {
    const c = candidate('c1');
    const out = await annotateRecurrence(undefined, [c]);
    expect(out).toEqual([c]);
    // Ensures the candidate object is passed through unchanged.
    expect(out[0].recurrenceCount).toBeUndefined();
  });
});
