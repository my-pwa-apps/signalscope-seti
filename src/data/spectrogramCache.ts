import type { AnalysisResult, Spectrogram, WorkUnit } from '../types/domain';

/**
 * IndexedDB-backed cache of analyzed work units.
 *
 * Every successful analysis (real-archive *or* user upload) is persisted here
 * along with its decoded spectrogram, so the engine can **replay** prior
 * observations when the network is offline. Replays go through the exact same
 * classifier as live runs, but they read the spectrogram straight from the
 * cache instead of fetching + decoding a filterbank again.
 *
 * Why IndexedDB rather than localStorage? Spectrograms are megabytes of
 * binary data, well above the 5 MB localStorage quota that most browsers
 * enforce, and IndexedDB stores `Float32Array` buffers natively without
 * base64 inflation.
 *
 * The cache keeps the most recent `CACHE_MAX_ENTRIES` analyses. Older entries
 * are pruned automatically after each save.
 */

const DB_NAME = 'signalscope';
const DB_VERSION = 1;
const STORE = 'cachedAnalyses';
const CACHE_MAX_ENTRIES = 5;

export interface CachedAnalysis {
  /** Auto-increment IndexedDB key. */
  id: number;
  /** Wall-clock time the analysis was originally completed. */
  savedAt: string;
  /** Original WorkUnit metadata (target, freq, telescope, etc.). */
  unit: WorkUnit;
  /** Decoded spectrogram, ready to feed to the detector. */
  spectrogram: {
    frames: number;
    channels: number;
    /** Backing buffer of a Float32Array of length frames × channels. */
    data: ArrayBuffer;
  };
  /** Detector output from the original run. */
  result: AnalysisResult;
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
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a completed analysis. Strips any non-cloneable refs (e.g. `Blob`s) on
 *  the WorkUnit before persisting, since uploaded `File` instances cannot be
 *  meaningfully replayed across sessions. */
export async function saveCachedAnalysis(
  unit: WorkUnit,
  spectrogram: Spectrogram,
  result: AnalysisResult
): Promise<void> {
  if (!isAvailable()) return;

  // Drop the file Blob — we cannot resurrect File handles across reloads.
  // Replace with a marker so the UI can still display "from a previous upload".
  const sanitizedUnit: WorkUnit = unit.dataSource
    ? unit.dataSource.kind === 'filterbank-local'
      ? {
          ...unit,
          dataSource: undefined,
          sourceRef: `LOCAL/${unit.dataSource.fileName}`
        }
      : unit
    : unit;

  // IndexedDB structuredClone handles Float32Array natively, but we copy the
  // buffer slice so the live spectrogram's transferred buffer is not held by
  // the cache record.
  const dataCopy = new Float32Array(spectrogram.data).buffer;

  const entry = {
    savedAt: new Date().toISOString(),
    unit: sanitizedUnit,
    spectrogram: {
      frames: spectrogram.frames,
      channels: spectrogram.channels,
      data: dataCopy
    },
    result
  };

  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  await pruneOldEntries(db);
  db.close();
}

async function pruneOldEntries(db: IDBDatabase): Promise<void> {
  const all = await new Promise<CachedAnalysis[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CachedAnalysis[]);
    req.onerror = () => reject(req.error);
  });
  if (all.length <= CACHE_MAX_ENTRIES) return;
  // Sort by savedAt ascending and delete the oldest extras.
  all.sort((a, b) => (a.savedAt < b.savedAt ? -1 : 1));
  const drop = all.slice(0, all.length - CACHE_MAX_ENTRIES);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const e of drop) store.delete(e.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listCachedAnalyses(): Promise<CachedAnalysis[]> {
  if (!isAvailable()) return [];
  const db = await openDB();
  const all = await new Promise<CachedAnalysis[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as CachedAnalysis[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  // Newest first.
  all.sort((a, b) => (a.savedAt > b.savedAt ? -1 : 1));
  return all;
}

export async function countCachedAnalyses(): Promise<number> {
  if (!isAvailable()) return 0;
  const db = await openDB();
  const n = await new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return n;
}

export async function clearCachedAnalyses(): Promise<void> {
  if (!isAvailable()) return;
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
