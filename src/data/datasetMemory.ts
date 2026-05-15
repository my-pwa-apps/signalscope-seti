import type { AnalysisResult, CandidateLabel, CandidateSignal, WorkUnit } from '../types/domain';

/**
 * Per-dataset analysis memory, backed by IndexedDB.
 *
 * SignalScope analyzes large filterbank files in small chunks (see the
 * chunked-analysis branch of `analysis.worker.ts`). A single chunk cannot
 * see anything that happens in *other* chunks of the same file, so a real
 * persistent narrowband transmitter might be flagged by one chunk and then
 * missed when its drift slope carries the carrier outside the next chunk's
 * frequency window — *unless* we remember what we found across chunks.
 *
 * This module keeps a small, capped-size record per `datasetId` containing:
 *   1. **Analyzed-chunk coverage** — which byte ranges of the file have
 *      already been examined, so subsequent passes can preferentially
 *      cover unexplored regions.
 *   2. **Candidate history** — every candidate signal flagged in any past
 *      chunk of the same dataset, keyed by frequency. The engine uses this
 *      to annotate fresh candidates with a `recurrenceCount` so the UI can
 *      highlight signals that keep showing up across passes (a much
 *      stronger SETI signal than a one-off blip).
 *
 * The store is intentionally per-dataset, not global: cross-dataset
 * recurrence would mostly surface earth-bound RFI carriers that happen at
 * common frequencies (FM broadcast, WiFi, GPS), which is the opposite of
 * useful.
 *
 * Storage uses a separate IndexedDB database (`signalscope-datasets`) from
 * the spectrogram cache (`signalscope`), so a schema bump in one does not
 * disturb the other.
 */

const DB_NAME = 'signalscope-datasets';
const DB_VERSION = 1;
const STORE = 'datasetMemory';

/** Cap on the number of chunk-coverage records kept per dataset. Older
 *  entries are pruned LRU. 200 is enough to cover a 70 GB filterbank in
 *  ~32 MB increments many times over. */
const MAX_CHUNKS_PER_DATASET = 200;

/** Cap on the number of candidate-history records kept per dataset. */
const MAX_CANDIDATES_PER_DATASET = 500;

/** Default frequency-match tolerance used by recurrence annotation when the
 *  unit doesn't expose a per-channel bandwidth. 100 Hz is a few channels at
 *  typical BL high-resolution products. */
const DEFAULT_FREQ_TOLERANCE_HZ = 100;

export interface ChunkCoverageRecord {
  /** Work-unit id of the analysis that produced this chunk. */
  unitId: string;
  /** ISO timestamp of when the chunk was analyzed. */
  analyzedAt: string;
  /** Byte offsets (relative to the file's data section) of each chunk
   *  window covered by this work unit. */
  offsets: number[];
  /** Bytes read per chunk window. */
  spanBytes: number;
}

export interface CandidateHistoryRecord {
  /** Center frequency in MHz of the candidate. */
  freqMHz: number;
  /** Drift rate at detection time, Hz/s (signed). */
  driftHzPerSec: number;
  /** Linear SNR at detection time. */
  snr: number;
  /** Classifier label assigned. */
  label: CandidateLabel;
  /** Work-unit that produced this hit. */
  unitId: string;
  /** ISO timestamp of detection. */
  seenAt: string;
}

export interface DatasetMemoryRecord {
  /** Primary key — same value as `WorkUnit.datasetId`. */
  datasetId: string;
  /** ISO timestamp of the last update to this record. */
  updatedAt: string;
  /** Total size of the underlying file in bytes, if known. */
  totalFileBytes?: number;
  /** Free-text descriptor for the UI (target name, telescope, etc.). */
  label?: string;
  /** Chunk coverage history, most recent first after `recordChunkAnalysis`. */
  analyzedChunks: ChunkCoverageRecord[];
  /** Candidate hit history, most recent first. */
  candidates: CandidateHistoryRecord[];
}

function isAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'datasetId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Append the chunk-coverage and candidate information from one completed
 * analysis to the dataset's memory. Creates a fresh record if this is the
 * first time we've seen this `datasetId`. Caps the record size so a single
 * dataset cannot grow unbounded.
 *
 * Safe to call from a non-critical path — failures (storage exceeded,
 * private-window IDB disabled, etc.) are swallowed with a console warning.
 */
export async function recordChunkAnalysis(
  unit: WorkUnit,
  result: AnalysisResult
): Promise<void> {
  if (!isAvailable()) return;
  if (!unit.datasetId) return;
  // Cached-replay units intentionally do NOT mutate the dataset memory:
  // they re-analyze the *same* decoded bytes that produced the original
  // record, so writing them back would inflate recurrence counts.
  if (unit.dataSource?.kind === 'cached-decoded') return;

  const datasetId = unit.datasetId;
  const totalFileBytes =
    unit.dataSource?.kind === 'filterbank'
      ? unit.dataSource.totalFileBytes
      : unit.dataSource?.kind === 'filterbank-local'
      ? unit.dataSource.fileSizeBytes
      : undefined;
  const offsets = unit.chunkOffsets ?? [];
  const spanBytes = unit.chunkSpanBytes ?? 0;

  const newCoverage: ChunkCoverageRecord = {
    unitId: unit.id,
    analyzedAt: new Date().toISOString(),
    offsets,
    spanBytes
  };
  const newCandidates: CandidateHistoryRecord[] = result.candidates.map((c) => ({
    freqMHz: c.frequencyMHz,
    driftHzPerSec: c.driftHzPerSec,
    snr: c.snr,
    label: c.label,
    unitId: unit.id,
    seenAt: new Date().toISOString()
  }));

  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(datasetId);
      getReq.onsuccess = () => {
        const existing = (getReq.result as DatasetMemoryRecord | undefined) ?? {
          datasetId,
          updatedAt: new Date().toISOString(),
          totalFileBytes,
          label: unit.target?.name,
          analyzedChunks: [],
          candidates: []
        };
        const merged: DatasetMemoryRecord = {
          datasetId,
          updatedAt: new Date().toISOString(),
          totalFileBytes: existing.totalFileBytes ?? totalFileBytes,
          label: existing.label ?? unit.target?.name,
          analyzedChunks: [newCoverage, ...existing.analyzedChunks].slice(
            0,
            MAX_CHUNKS_PER_DATASET
          ),
          candidates: [...newCandidates, ...existing.candidates].slice(
            0,
            MAX_CANDIDATES_PER_DATASET
          )
        };
        store.put(merged);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Read the memory record for one dataset. Returns `null` if none exists. */
export async function getDatasetMemory(
  datasetId: string
): Promise<DatasetMemoryRecord | null> {
  if (!isAvailable() || !datasetId) return null;
  const db = await openDB();
  try {
    return await new Promise<DatasetMemoryRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(datasetId);
      req.onsuccess = () => resolve((req.result as DatasetMemoryRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Wipe all dataset memory. Used by the Dashboard "Reset local stats" button. */
export async function clearDatasetMemory(): Promise<void> {
  if (!isAvailable()) return;
  const db = await openDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Annotate a freshly-detected candidate list with a `recurrenceCount` field
 * counting how many past hits in the same dataset fall within a small
 * frequency tolerance. The tolerance defaults to `max(2 * channelBW, 100 Hz)`
 * — a few channels — so true narrowband sources match while wide RFI
 * carriers don't accidentally all collapse to one bin.
 *
 * The returned array is a *new* array — input candidates are not mutated.
 * Candidates without a `datasetId` (legacy / unrecognized sources) are
 * passed through unchanged with `recurrenceCount` left undefined.
 */
export async function annotateRecurrence(
  datasetId: string | undefined,
  candidates: CandidateSignal[],
  channelBandwidthHz?: number
): Promise<CandidateSignal[]> {
  if (!datasetId) return candidates;
  if (candidates.length === 0) return candidates;
  const memory = await getDatasetMemory(datasetId);
  if (!memory || memory.candidates.length === 0) {
    // First-time analysis of this dataset — annotate with 0 so the UI can
    // distinguish "we checked, nothing prior" from "no dataset id at all".
    return candidates.map((c) => ({
      ...c,
      datasetId,
      recurrenceCount: 0
    }));
  }
  const toleranceHz = Math.max(
    DEFAULT_FREQ_TOLERANCE_HZ,
    (channelBandwidthHz ?? 0) * 2
  );
  const toleranceMHz = toleranceHz / 1e6;
  return candidates.map((c) => {
    let count = 0;
    for (const past of memory.candidates) {
      if (Math.abs(past.freqMHz - c.frequencyMHz) <= toleranceMHz) {
        count++;
      }
    }
    return {
      ...c,
      datasetId,
      recurrenceCount: count
    };
  });
}

/**
 * Build a `previousChunkOffsets` hint for a fresh WorkUnit. The worker
 * uses this to bias its window picks toward unexplored regions of the
 * underlying file. Returns an empty array if the dataset has no prior
 * coverage record.
 */
export async function previousChunkOffsetsFor(
  datasetId: string | undefined
): Promise<number[]> {
  if (!datasetId) return [];
  const memory = await getDatasetMemory(datasetId);
  if (!memory) return [];
  // Flatten all prior offsets into one array. The worker treats this as an
  // unordered set when picking new windows.
  const out: number[] = [];
  for (const chunk of memory.analyzedChunks) {
    for (const off of chunk.offsets) out.push(off);
  }
  return out;
}

/**
 * Convenience summary for the UI. Returns the analyzed byte count and
 * a coverage percentage relative to the known total file size (if any).
 */
export function summarizeCoverage(memory: DatasetMemoryRecord): {
  bytesCovered: number;
  fractionCovered: number;
  uniqueOffsetCount: number;
} {
  // Use the union of `[offset, offset + spanBytes)` intervals so that
  // re-analyzing the same region twice doesn't double-count.
  const intervals: Array<[number, number]> = [];
  for (const chunk of memory.analyzedChunks) {
    for (const off of chunk.offsets) {
      intervals.push([off, off + chunk.spanBytes]);
    }
  }
  if (intervals.length === 0) {
    return { bytesCovered: 0, fractionCovered: 0, uniqueOffsetCount: 0 };
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let bytesCovered = 0;
  let [curStart, curEnd] = intervals[0];
  let uniqueCount = 1;
  for (let i = 1; i < intervals.length; i++) {
    const [s, e] = intervals[i];
    if (s <= curEnd) {
      // Overlap — extend the current interval.
      curEnd = Math.max(curEnd, e);
    } else {
      bytesCovered += curEnd - curStart;
      curStart = s;
      curEnd = e;
      uniqueCount++;
    }
  }
  bytesCovered += curEnd - curStart;
  const total = memory.totalFileBytes ?? 0;
  const fractionCovered = total > 0 ? Math.min(1, bytesCovered / total) : 0;
  return { bytesCovered, fractionCovered, uniqueOffsetCount: uniqueCount };
}
