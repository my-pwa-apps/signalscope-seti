import type { AnalysisResult, ResourceProfile, Spectrogram, WorkUnit } from '../types/domain';
import type { Outgoing } from '../workers/analysis.worker';

interface AnalysisCallbacks {
  onProgress(msg: Extract<Outgoing, { type: 'progress' }>): void;
  onRows(msg: Extract<Outgoing, { type: 'rows' }>): void;
  onFetchProgress(msg: Extract<Outgoing, { type: 'fetch-progress' }>): void;
  onUnitUpdated(unit: WorkUnit): void;
  onError(message: string): void;
}

export interface AnalysisRunResult {
  unit: WorkUnit;
  result: AnalysisResult;
  spectrogram: Spectrogram;
}

let worker: Worker | null = null;
let cancelInflight: (() => void) | null = null;

function ensureWorker(handle: (msg: Outgoing) => void): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
    type: 'module',
    name: 'signalscope-analysis'
  });
  worker.onmessage = (ev: MessageEvent<Outgoing>) => handle(ev.data);
  worker.onerror = (event) => {
    console.error('[analysis worker]', event.message);
  };
  return worker;
}

export function cancelCurrentAnalysis(): void {
  if (worker) worker.postMessage({ type: 'cancel' });
  if (cancelInflight) cancelInflight();
}

export function analyzeWorkUnit(
  initialUnit: WorkUnit,
  resourceProfile: ResourceProfile,
  callbacks: AnalysisCallbacks
): Promise<AnalysisRunResult | null> {
  return new Promise((resolve) => {
    let unit = initialUnit;
    let settled = false;
    const w = ensureWorker(handle);

    cancelInflight = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(null);
    };

    function handle(msg: Outgoing) {
      if (settled) return;
      if (msg.type === 'progress' && msg.workUnitId === unit.id) {
        callbacks.onProgress(msg);
      } else if (msg.type === 'rows' && msg.workUnitId === unit.id) {
        callbacks.onRows(msg);
      } else if (msg.type === 'fetch-progress' && msg.workUnitId === unit.id) {
        callbacks.onFetchProgress(msg);
      } else if (msg.type === 'unit-updated' && msg.workUnitId === unit.id) {
        unit = {
          ...unit,
          channels: msg.channels,
          frames: msg.frames,
          freqStartMHz: msg.freqStartMHz,
          freqEndMHz: msg.freqEndMHz,
          channelBandwidthHz: msg.channelBandwidthHz,
          framePeriodSec: msg.framePeriodSec,
          ...(msg.chunkOffsets ? { chunkOffsets: msg.chunkOffsets } : {}),
          ...(msg.chunkSpanBytes !== undefined ? { chunkSpanBytes: msg.chunkSpanBytes } : {})
        };
        callbacks.onUnitUpdated(unit);
      } else if (msg.type === 'done' && msg.workUnitId === unit.id) {
        settled = true;
        cleanup();
        resolve({ unit, result: msg.result, spectrogram: msg.spectrogram });
      } else if (msg.type === 'error') {
        callbacks.onError(msg.message);
        settled = true;
        cleanup();
        resolve(null);
      }
    }

    function cleanup() {
      if (worker) worker.onmessage = null;
      worker = null;
      cancelInflight = null;
    }

    w.postMessage({ type: 'analyze', workUnit: unit, resourceProfile });
  });
}
