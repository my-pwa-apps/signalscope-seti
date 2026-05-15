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

/** Module-level singleton: one analysis worker is reused across every unit
 *  for the lifetime of the page, so we don't repeatedly pay the worker spin-up
 *  cost or leak orphaned workers holding spectrogram buffers. */
let worker: Worker | null = null;
/** Active in-flight handler so we route postMessage events to the right run
 *  even though the worker is shared. */
let activeHandler: ((msg: Outgoing) => void) | null = null;
let activeError: ((message: string) => void) | null = null;
let cancelInflight: (() => void) | null = null;

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), {
    type: 'module',
    name: 'signalscope-analysis'
  });
  worker.onmessage = (ev: MessageEvent<Outgoing>) => {
    if (activeHandler) activeHandler(ev.data);
  };
  worker.onerror = (event) => {
    const message = event.message || 'Analysis worker crashed.';
    console.error('[analysis worker]', message);
    if (activeError) activeError(message);
  };
  return worker;
}

/** Send a cancel message to the in-flight analysis (if any) and resolve the
 *  pending promise with `null`. Safe to call when nothing is running. */
export function cancelCurrentAnalysis(): void {
  if (worker) worker.postMessage({ type: 'cancel' });
  if (cancelInflight) cancelInflight();
}

/** Tear the analysis worker down completely. Used by the engine reset path so
 *  IndexedDB clears + the next analysis start from a known-good state. */
export function disposeAnalysisWorker(): void {
  if (cancelInflight) cancelInflight();
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    worker = null;
  }
  activeHandler = null;
  activeError = null;
}

export function analyzeWorkUnit(
  initialUnit: WorkUnit,
  resourceProfile: ResourceProfile,
  callbacks: AnalysisCallbacks
): Promise<AnalysisRunResult | null> {
  return new Promise((resolve) => {
    let unit = initialUnit;
    let settled = false;
    const w = ensureWorker();

    activeHandler = handle;
    activeError = handleWorkerError;
    cancelInflight = () => {
      if (settled) return;
      settled = true;
      detach();
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
        detach();
        resolve({ unit, result: msg.result, spectrogram: msg.spectrogram });
      } else if (msg.type === 'error') {
        callbacks.onError(msg.message);
        settled = true;
        detach();
        resolve(null);
      }
    }

    function handleWorkerError(message: string) {
      if (settled) return;
      callbacks.onError(message);
      settled = true;
      detach();
      resolve(null);
    }

    function detach() {
      if (activeHandler === handle) activeHandler = null;
      if (activeError === handleWorkerError) activeError = null;
      cancelInflight = null;
    }

    w.postMessage({ type: 'analyze', workUnit: unit, resourceProfile });
  });
}
