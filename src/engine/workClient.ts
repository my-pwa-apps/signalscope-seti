import { REAL_CATALOG, realDataSourceFor, type RealCatalogEntry } from '../data/realCatalog';
import { listCachedAnalyses, type CachedAnalysis } from '../data/spectrogramCache';
import type {
  CachedDecodedSource,
  LocalFilterbankSource,
  WorkUnit
} from '../types/domain';

/**
 * WorkClient — where work units come from.
 *
 * SignalScope has **one** dispatch mode: real data. The default behavior is
 * to cycle through `REAL_CATALOG` — verified Berkeley SETI / Breakthrough
 * Listen filterbank files streamed via the `/api/datafile` Pages Function.
 *
 * Callers can also push one-shot units via `enqueueUnit()`:
 *
 *  - Local uploads:  built by `buildLocalFileWorkUnit(file)`. The byte
 *                    source is a user `File`/`Blob`, never transmitted.
 *  - Cached replays: built by `buildCachedReplayWorkUnit(cached)`. Used when
 *                    the network is offline so the app still has real,
 *                    previously-analyzed data to work with.
 *
 * The one-shot queue always takes priority over the catalog cycler, so an
 * upload or a cached replay dispatches on the very next iteration.
 */

export interface WorkClient {
  fetchWorkUnit(): Promise<WorkUnit>;
  fetchGlobalStats(): Promise<{ usersOnline: number; unitsToday: number }>;
  /** Push a one-shot work unit (upload or cached replay). Returns the unit
   *  that was queued so callers can show its id / metadata in the UI. */
  enqueueUnit(unit: WorkUnit): WorkUnit;
  /** Number of one-shot units waiting to be dispatched. */
  pendingCount(): number;
}

/** Default analysis budget for user-uploaded filterbank files. */
const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;
const UPLOAD_DISPLAY_FRAMES = 128;
const UPLOAD_DISPLAY_CHANNELS = 512;

class LocalWorkClient implements WorkClient {
  private realCursor = 0;
  private pending: WorkUnit[] = [];

  enqueueUnit(unit: WorkUnit): WorkUnit {
    this.pending.push(unit);
    return unit;
  }

  pendingCount(): number {
    return this.pending.length;
  }

  async fetchWorkUnit(): Promise<WorkUnit> {
    // One-shot uploads / cached replays always win over the catalog cycler.
    const pending = this.pending.shift();
    if (pending) return pending;

    const entry = REAL_CATALOG[this.realCursor++ % REAL_CATALOG.length];
    return buildRealWorkUnit(entry);
  }

  async fetchGlobalStats(): Promise<{ usersOnline: number; unitsToday: number }> {
    // Stable values that drift slightly so the dashboard feels alive without
    // pretending there is a real backend.
    const day = Math.floor(Date.now() / 86400000);
    const hour = Math.floor(Date.now() / 3600000);
    return {
      usersOnline: 1240 + ((hour * 7) % 220),
      unitsToday: 86421 + ((day * 1031) % 4096) + ((hour * 13) % 256)
    };
  }
}

export const workClient: WorkClient = new LocalWorkClient();

/**
 * Build a placeholder WorkUnit for a real-catalog entry. The frequency and
 * channel fields are only hints — the worker overwrites them with the true
 * values parsed from the SIGPROC header (via the `unit-updated` message).
 *
 * `datasetId` is stamped from the catalog entry's stable id (not the unit id,
 * which is unique per dispatch). This is what lets the engine recognize that
 * the next "Voyager 1" unit comes from the *same* underlying file as the
 * previous one, even though the WorkUnit instances are distinct.
 */
function buildRealWorkUnit(e: RealCatalogEntry): WorkUnit {
  const bandwidthMHz = e.hintFreqEndMHz - e.hintFreqStartMHz;
  return {
    id: `REAL-${e.id}-${Date.now().toString(36).toUpperCase()}`,
    datasetId: `BL-OPENDATA/${e.id}`,
    target: e.target,
    telescope: e.telescope,
    observedAt: e.observedAt,
    freqStartMHz: e.hintFreqStartMHz,
    freqEndMHz: e.hintFreqEndMHz,
    channelBandwidthHz: (bandwidthMHz * 1e6) / e.displayChannels,
    channels: e.displayChannels,
    frames: e.displayFrames,
    framePeriodSec: 1.0, // overwritten after header parse
    sourceRef: `BL-OPENDATA/${e.id}`,
    license: e.attribution,
    dataSource: realDataSourceFor(e)
  };
}

/**
 * Build a one-shot WorkUnit that points at a locally-uploaded SIGPROC `.fil`
 * file. The file never leaves the browser — the worker reads it via
 * `Blob.slice(...).arrayBuffer()` and decodes it on the same thread that
 * runs the classifier.
 */
export function buildLocalFileWorkUnit(file: File): WorkUnit {
  const source: LocalFilterbankSource = {
    kind: 'filterbank-local',
    file,
    fileName: file.name,
    fileSizeBytes: file.size,
    maxBytes: UPLOAD_MAX_BYTES,
    displayChannels: UPLOAD_DISPLAY_CHANNELS,
    displayFrames: UPLOAD_DISPLAY_FRAMES,
    attribution:
      'User-uploaded SIGPROC filterbank — processed entirely in your browser; ' +
      'nothing is uploaded to any server.',
    note: 'Local file — second-opinion analysis only, no data leaves your device.'
  };
  return {
    id: `UPLOAD-${shortId()}-${Date.now().toString(36).toUpperCase()}`,
    // `datasetId` includes the file *size* so that two uploads with the same
    // name but different contents (or different versions of the same name)
    // get separate dataset memories. Two uploads of *the exact same file*
    // (same name + size) intentionally share memory so re-uploading triggers
    // cross-chunk correlation against previous passes.
    datasetId: `LOCAL/${file.name}@${file.size}`,
    target: {
      name: file.name.replace(/\.[fF][iI][lL]$/, '') || 'User upload',
      raHours: 0,
      decDeg: 0,
      note: 'User-supplied filterbank file'
    },
    telescope: 'Green Bank Telescope', // unknown until SIGPROC header is parsed
    observedAt: new Date(file.lastModified || Date.now()).toISOString(),
    freqStartMHz: 0,
    freqEndMHz: 0,
    channelBandwidthHz: 0,
    channels: UPLOAD_DISPLAY_CHANNELS,
    frames: UPLOAD_DISPLAY_FRAMES,
    framePeriodSec: 1.0,
    sourceRef: `LOCAL/${file.name}`,
    license: source.attribution,
    dataSource: source
  };
}

/**
 * Build a one-shot WorkUnit that replays a previously cached, fully-decoded
 * spectrogram from IndexedDB. Used when the network is offline so the engine
 * has something real to keep analyzing instead of falling back to fake data.
 */
export function buildCachedReplayWorkUnit(cached: CachedAnalysis): WorkUnit {
  // Copy the cached buffer — IndexedDB may reuse it on subsequent reads, and
  // the worker transfers ownership of any buffer it ends up using.
  const data = new Float32Array(new Float32Array(cached.spectrogram.data));
  const source: CachedDecodedSource = {
    kind: 'cached-decoded',
    data,
    frames: cached.spectrogram.frames,
    channels: cached.spectrogram.channels,
    cachedAt: cached.savedAt,
    attribution:
      'Replayed from a previous online session — cached locally because the network is unavailable.',
    note: `Cached ${new Date(cached.savedAt).toLocaleString()}`
  };
  return {
    ...cached.unit,
    id: `REPLAY-${shortId()}-${Date.now().toString(36).toUpperCase()}`,
    license: source.attribution,
    dataSource: source
  };
}

/** Convenience: count cached analyses available for offline replay. */
export async function cachedReplayCount(): Promise<number> {
  const all = await listCachedAnalyses();
  return all.length;
}

/** Build the next available cached-replay work unit, cycling through cached
 *  entries deterministically. Returns null if the cache is empty. */
export async function nextCachedReplayUnit(): Promise<WorkUnit | null> {
  const all = await listCachedAnalyses();
  if (all.length === 0) return null;
  const idx = cachedReplayCursor++ % all.length;
  return buildCachedReplayWorkUnit(all[idx]);
}

let cachedReplayCursor = 0;

function shortId(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}
