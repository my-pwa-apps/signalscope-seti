/**
 * Core domain types for SignalScope SETI.
 *
 * These types intentionally mirror, in a simplified way, the kind of metadata
 * present in real Breakthrough Listen Open Data work units (.fil / .h5 / GUPPI
 * RAW headers). Real adapters can convert telescope file headers into these
 * shapes without changing the rest of the app.
 */

export type Telescope =
  | 'Green Bank Telescope'
  | 'Parkes Murriyang'
  | 'MeerKAT'
  | 'Allen Telescope Array';

export interface SkyTarget {
  /** Common target name, e.g. "HIP 13402" or "TRAPPIST-1". */
  name: string;
  /** Right Ascension, hours (0..24). */
  raHours: number;
  /** Declination, degrees (-90..90). */
  decDeg: number;
  /** Approximate distance in light years, if known. */
  distanceLy?: number;
  /** Optional short description ("nearby M dwarf", "galactic plane sweep"). */
  note?: string;
}

export interface WorkUnit {
  id: string;
  /** Sky target for this work unit. */
  target: SkyTarget;
  telescope: Telescope;
  /** ISO timestamp of the observation. */
  observedAt: string;
  /** Lower edge of the analyzed band, MHz. */
  freqStartMHz: number;
  /** Upper edge of the analyzed band, MHz. */
  freqEndMHz: number;
  /** Sample / channel rate after channelization, Hz per channel. */
  channelBandwidthHz: number;
  /** Number of frequency channels in each spectrogram frame. */
  channels: number;
  /** Number of time integrations (rows in the waterfall). */
  frames: number;
  /** Seconds per integration row. */
  framePeriodSec: number;
  /** Source dataset reference, e.g. "BL-OPENDATA/GBT/blc00". */
  sourceRef: string;
  /** Data license / attribution. */
  license: string;
  /** Pointer to where the spectrogram bytes for this unit live. Required for
   *  every analysis — SignalScope no longer generates synthetic data. */
  dataSource?: RealDataSource;
  /** When the worker had to split a very large file into multiple non-
   *  contiguous time windows to fit within the analysis budget, this is the
   *  number of windows that were sampled. `undefined` or `1` means the
   *  analyzed slab was a single contiguous block. */
  chunkCount?: number;
  /** Stable identifier for the underlying dataset / file. Every WorkUnit
   *  generated from the same source file shares this id, so the engine can
   *  correlate findings across multiple non-contiguous chunk analyses of
   *  the same observation (cross-chunk recurrence detection, coverage
   *  tracking). Format conventions:
   *    - Remote archive : `BL-OPENDATA/<catalog-id>`     (e.g. `BL-OPENDATA/voyager1-2020`)
   *    - User upload    : `LOCAL/<file-name>@<size>`     (size disambiguates name collisions)
   *    - Cached replay  : same id as the original unit
   *  Older WorkUnits without this field are treated as one-off analyses
   *  with no cross-chunk memory. */
  datasetId?: string;
  /** Byte offsets (relative to the start of the SIGPROC data section) that
   *  this WorkUnit actually decoded. For single-slab mode this is a 1-element
   *  array of just the starting offset; for chunked mode there is one entry
   *  per window. Used by the dataset-memory layer to know which parts of a
   *  huge file have already been covered across multiple sessions. */
  chunkOffsets?: number[];
  /** Bytes read per chunk window (constant across all chunks of one unit).
   *  Combined with `chunkOffsets` this fully describes the file regions
   *  covered by this analysis. */
  chunkSpanBytes?: number;
  /** Hint from the engine listing data-section byte offsets that have been
   *  covered by *previous* analyses of the same dataset. The worker uses
   *  this to bias its window picks toward unexplored regions of the file
   *  so multi-pass coverage of huge captures grows monotonically. */
  previousChunkOffsets?: number[];
}

/**
 * Reference to a spectrogram-bearing data source the worker can analyze.
 * Three flavors are supported:
 *
 *  - `'filterbank'`        : a remote SIGPROC `.fil` URL fetched through the
 *                            Cloudflare Pages range-proxy. Host must be on
 *                            the proxy allowlist.
 *  - `'filterbank-local'`  : a user-uploaded `.fil` file (`File` / `Blob`).
 *                            Read in-place via `file.slice(...)` — the bytes
 *                            never leave the browser.
 *  - `'cached-decoded'`    : a previously-analyzed spectrogram replayed from
 *                            IndexedDB. Used for the offline / no-network
 *                            path so the app still has something real to
 *                            show. Skips header parsing entirely.
 *
 * All three go through the same classifier — only the byte-acquisition step
 * differs. HDF5 (`.h5`) remains intentionally out of scope.
 */
export type RealDataSource =
  | RemoteFilterbankSource
  | LocalFilterbankSource
  | CachedDecodedSource;

export interface RemoteFilterbankSource {
  kind: 'filterbank';
  /** Absolute upstream URL (passed through the proxy after host-allowlist check). */
  upstreamUrl: string;
  /** Path of the proxy endpoint, e.g. '/api/datafile'. */
  proxyPath: string;
  /** Max bytes the worker may fetch for this unit (caps download size per chunk
   *  in chunked mode, or total in single-slab mode). */
  maxBytes: number;
  /** Total file size in bytes if known. When this is much larger than
   *  `maxBytes`, the worker splits the read into several non-contiguous
   *  windows spread uniformly across the file to give temporal diversity. */
  totalFileBytes?: number;
  /** Decimate the decoded matrix down to this size for analysis + display. */
  displayChannels: number;
  displayFrames: number;
  /** Human-readable attribution shown in the UI. */
  attribution: string;
  /** Optional short note for the badge (e.g. "X-band carrier ~8420 MHz"). */
  note?: string;
}

export interface LocalFilterbankSource {
  kind: 'filterbank-local';
  /** The user's filterbank file. Read via `file.slice(...).arrayBuffer()`. */
  file: Blob;
  /** Original filename used for display + history. */
  fileName: string;
  /** Total file size in bytes (informational + used to decide chunked mode). */
  fileSizeBytes: number;
  /** Max bytes the worker may decode for this unit (caps memory use). */
  maxBytes: number;
  /** Decimate the decoded matrix down to this size for analysis + display. */
  displayChannels: number;
  displayFrames: number;
  /** Attribution / source-of-truth note (e.g. "User upload — local processing only"). */
  attribution: string;
  /** Optional short note for the badge. */
  note?: string;
}

export interface CachedDecodedSource {
  kind: 'cached-decoded';
  /** Pre-decoded spectrogram replayed from IndexedDB. */
  data: Float32Array;
  frames: number;
  channels: number;
  /** Original ISO timestamp the analysis was first run. */
  cachedAt: string;
  /** Attribution string (typically: "Cached from previous online session"). */
  attribution: string;
  /** Optional short note for the badge. */
  note?: string;
}

/**
 * A single time slice of the waterfall — one row of channel intensities.
 * Stored as Float32 so it can be transferred to/from workers cheaply.
 */
export interface SpectrogramFrame {
  /** Index of the row in the work unit (0..frames-1). */
  row: number;
  /** Length must equal `WorkUnit.channels`. */
  intensities: Float32Array;
}

/**
 * Full spectrogram tensor for a work unit, frames × channels (row major).
 * Backed by a single Float32Array for compact transfer.
 */
export interface Spectrogram {
  workUnitId: string;
  frames: number;
  channels: number;
  data: Float32Array;
}

export type CandidateLabel =
  | 'noise'
  | 'likely-rfi'
  | 'interesting'
  | 'needs-followup';

export interface AiAssessment {
  provider: 'cloudflare-workers-ai' | 'signalscope-rule-fallback';
  model: string;
  promptVersion: string;
  label: 'likely_rfi' | 'likely_noise' | 'interesting' | 'needs_follow_up';
  /** 0..1 confidence in the advisory AI triage label. */
  confidence: number;
  /** Short, conservative rationale suitable for display and export. */
  rationale: string;
  /** Optional suggested next step, e.g. analyze another chunk or treat as RFI. */
  recommendedAction?: string;
  createdAt: string;
}

export interface CandidateSignal {
  id: string;
  workUnitId: string;
  /** Center frequency in MHz. */
  frequencyMHz: number;
  /** Drift rate in Hz/s; can be negative. */
  driftHzPerSec: number;
  /** Linear signal-to-noise ratio (peak / local-noise-sigma). */
  snr: number;
  /** Duration in seconds the candidate persists. */
  durationSec: number;
  /** 0..1 confidence the candidate is real (not local noise). */
  confidence: number;
  /** Coarse classification label. */
  label: CandidateLabel;
  /** Plain English explanation shown in the UI. */
  explanation: string;
  /** Sub-pixel position used for waterfall overlays (channel, row). */
  pixel: { channel: number; row: number; width: number; height: number };
  /** Dataset (file) this candidate was detected in. Used to correlate
   *  recurring detections across chunk-by-chunk analyses of the same
   *  underlying observation. Same convention as `WorkUnit.datasetId`. */
  datasetId?: string;
  /** How many *prior* analyses of the same dataset flagged a candidate at
   *  approximately this frequency. A high recurrence count on a narrowband
   *  detection is one of the strongest "this might be a real persistent
   *  source rather than a one-off RFI burst" signals SignalScope can give
   *  in its current form. `0` or `undefined` means this is the first time
   *  this frequency has been flagged in this dataset. */
  recurrenceCount?: number;
  /** Optional advisory classification generated by Cloudflare Workers AI.
   *  This never replaces the deterministic detector label and must not be
   *  treated as scientific confirmation. */
  aiAssessment?: AiAssessment;
}

export interface AnalysisResult {
  workUnitId: string;
  /** Wall-clock seconds spent analyzing on the user's machine. */
  computeMs: number;
  /** Detected candidate signals. */
  candidates: CandidateSignal[];
  /** Coarse noise floor estimate (linear). */
  noiseFloor: number;
  /** Number of FFT bins / channels processed. */
  binsProcessed: number;
  /** Optional debug summary string. */
  summary?: string;
}

export type ResourceProfile = 'eco' | 'balanced' | 'maximum';

export interface ContributionStats {
  unitsAnalyzed: number;
  candidatesFound: number;
  totalComputeMs: number;
  /** Last measured throughput in millions of FFT bins per second. */
  throughputMbinsPerSec: number;
}

export interface EngineSnapshot {
  status: 'idle' | 'fetching' | 'analyzing' | 'paused';
  currentUnit?: WorkUnit;
  /** 0..1 progress through the current unit. */
  progress: number;
  cpuUsageEstimate: number; // 0..1
  resourceProfile: ResourceProfile;
  lastResult?: AnalysisResult;
  lastSpectrogram?: Spectrogram;
}
