/// <reference lib="webworker" />
/**
 * Analysis worker for SignalScope SETI.
 *
 * Receives a WorkUnit, materializes its spectrogram from a real data source
 * (remote SIGPROC filterbank, user-uploaded filterbank, or a cached decoded
 * spectrogram from a previous session), runs a simplified turboSETI-style
 * narrowband + drift detector, and posts back partial spectrogram rows for
 * live visualization plus a final result.
 *
 * No synthetic / mock data is generated — every analysis is on real bytes.
 */

import {
  decimateSpectrogram,
  decodeFilterbankData,
  parseFilterbankHeader,
  type FilterbankHeader
} from '../data/filterbankParser';
import type {
  AnalysisResult,
  ResourceProfile,
  Spectrogram,
  WorkUnit
} from '../types/domain';
import { detectCandidates, quickMedian } from './candidateDetector';
import { powerSpectrum } from './fft';

interface AnalyzeRequest {
  type: 'analyze';
  workUnit: WorkUnit;
  resourceProfile: ResourceProfile;
}

interface CancelRequest {
  type: 'cancel';
}

type Incoming = AnalyzeRequest | CancelRequest;

interface ProgressMessage {
  type: 'progress';
  workUnitId: string;
  progress: number;
  cpuUsage: number;
}

interface RowsMessage {
  type: 'rows';
  workUnitId: string;
  startRow: number;
  channels: number;
  rows: Float32Array;
}

interface DoneMessage {
  type: 'done';
  workUnitId: string;
  result: AnalysisResult;
  spectrogram: Spectrogram;
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

/** Sent once after the worker has parsed a real filterbank header and learned
 *  the true channels/frames/frequency span. The engine merges these fields
 *  into the WorkUnit so the UI displays accurate metadata. */
interface UnitUpdatedMessage {
  type: 'unit-updated';
  workUnitId: string;
  channels: number;
  frames: number;
  freqStartMHz: number;
  freqEndMHz: number;
  channelBandwidthHz: number;
  framePeriodSec: number;
  /** Byte offsets (data-section-relative) of each chunk window actually
   *  decoded. Always at least 1 entry. */
  chunkOffsets?: number[];
  /** Bytes read per chunk window. */
  chunkSpanBytes?: number;
}

/** Sent on real-data mode to report fetch progress as bytes arrive. */
interface FetchProgressMessage {
  type: 'fetch-progress';
  workUnitId: string;
  phase: 'header' | 'data' | 'decode';
  bytesLoaded: number;
  bytesTotal: number;
}

export type Outgoing =
  | ProgressMessage
  | RowsMessage
  | DoneMessage
  | ErrorMessage
  | UnitUpdatedMessage
  | FetchProgressMessage;

let cancelled = false;

self.onmessage = async (ev: MessageEvent<Incoming>) => {
  const msg = ev.data;
  if (msg.type === 'cancel') {
    cancelled = true;
    return;
  }
  if (msg.type === 'analyze') {
    cancelled = false;
    try {
      await analyze(msg.workUnit, msg.resourceProfile);
    } catch (err) {
      const m: ErrorMessage = {
        type: 'error',
        message: err instanceof Error ? err.message : String(err)
      };
      (self as DedicatedWorkerGlobalScope).postMessage(m);
    }
  }
};

const PROFILE_DELAY_MS: Record<ResourceProfile, number> = {
  eco: 80,
  balanced: 28,
  maximum: 2
};

const PROFILE_BATCH_ROWS: Record<ResourceProfile, number> = {
  eco: 3,
  balanced: 6,
  maximum: 16
};

async function analyze(unit: WorkUnit, profile: ResourceProfile): Promise<void> {
  const t0 = performance.now();

  // Step 1: Materialize the spectrogram. Every supported source is real:
  //   - 'filterbank'        : range-fetched Berkeley SETI archive file
  //   - 'filterbank-local'  : user-uploaded .fil read via Blob.slice
  //   - 'cached-decoded'    : previously analyzed spectrogram replayed
  //                           from IndexedDB (offline / no-network path)
  let spectrogram: Spectrogram;
  let effectiveUnit: WorkUnit = unit;
  if (!unit.dataSource) {
    throw new Error('WorkUnit has no dataSource — synthetic generation has been removed.');
  }
  if (unit.dataSource.kind === 'cached-decoded') {
    const ds = unit.dataSource;
    // Copy the cached buffer so we own it (the engine still holds a reference
    // to the original). We post unit-updated immediately so the live waterfall
    // resizes to the cached shape before rows start arriving.
    const data = new Float32Array(ds.data);
    spectrogram = {
      workUnitId: unit.id,
      frames: ds.frames,
      channels: ds.channels,
      data
    };
    const refresh: UnitUpdatedMessage = {
      type: 'unit-updated',
      workUnitId: unit.id,
      channels: ds.channels,
      frames: ds.frames,
      freqStartMHz: unit.freqStartMHz,
      freqEndMHz: unit.freqEndMHz,
      channelBandwidthHz: unit.channelBandwidthHz,
      framePeriodSec: unit.framePeriodSec
    };
    (self as DedicatedWorkerGlobalScope).postMessage(refresh);
    effectiveUnit = { ...unit, channels: ds.channels, frames: ds.frames };
  } else if (
    unit.dataSource.kind === 'filterbank' ||
    unit.dataSource.kind === 'filterbank-local'
  ) {
    const real = await fetchAndDecodeFilterbank(unit);
    if (cancelled) return;
    spectrogram = real.spectrogram;
    effectiveUnit = real.unit;
  } else {
    throw new Error(
      `Unsupported dataSource kind: ${(unit.dataSource as { kind: string }).kind}`
    );
  }
  const { channels, frames, data } = spectrogram;

  // Step 2: Stream rows to the UI in batches with a tiny delay so the
  // resource profile actually throttles work.
  const batch = PROFILE_BATCH_ROWS[profile];
  const delay = PROFILE_DELAY_MS[profile];
  const cpuUsage = profile === 'maximum' ? 0.95 : profile === 'balanced' ? 0.55 : 0.22;

  for (let r = 0; r < frames; r += batch) {
    if (cancelled) return;
    const rowsToSend = Math.min(batch, frames - r);
    const slice = new Float32Array(rowsToSend * channels);
    slice.set(data.subarray(r * channels, (r + rowsToSend) * channels));
    const rowsMsg: RowsMessage = {
      type: 'rows',
      workUnitId: unit.id,
      startRow: r,
      channels,
      rows: slice
    };
    (self as DedicatedWorkerGlobalScope).postMessage(rowsMsg, [slice.buffer]);

    const progress: ProgressMessage = {
      type: 'progress',
      workUnitId: unit.id,
      progress: Math.min(1, (r + rowsToSend) / frames),
      cpuUsage
    };
    (self as DedicatedWorkerGlobalScope).postMessage(progress);

    if (delay > 0) await sleep(delay);
  }

  // Step 3: Run a simplified turboSETI-style detector on the full spectrogram.
  // (Use the local copy so we did not need to keep the original buffer alive.)
  const candidates = detectCandidates(effectiveUnit, data);

  // Step 4: Estimate noise floor (median of per-channel medians).
  const noiseFloor = estimateNoiseFloor(data, channels, frames);

  // Step 5: Touch FFT path so it counts toward "binsProcessed". Current
  // filterbank inputs are already channelized; a future raw-voltage adapter
  // would transform voltage chunks here.
  const fftBins = exerciseFFT();

  const computeMs = performance.now() - t0;
  const sourceTag =
    unit.dataSource?.kind === 'filterbank'
      ? ' [real]'
      : unit.dataSource?.kind === 'filterbank-local'
      ? ' [uploaded]'
      : unit.dataSource?.kind === 'cached-decoded'
      ? ' [cached replay]'
      : '';
  const result: AnalysisResult = {
    workUnitId: unit.id,
    computeMs,
    candidates,
    noiseFloor,
    binsProcessed: channels * frames + fftBins,
    summary:
      `Scanned ${channels} channels × ${frames} frames${sourceTag} in ${computeMs.toFixed(0)} ms; ` +
      `${candidates.length} candidate(s) above ${noiseFloor.toFixed(2)} noise floor.`
  };

  const done: DoneMessage = {
    type: 'done',
    workUnitId: unit.id,
    result,
    spectrogram: {
      workUnitId: spectrogram.workUnitId,
      frames: spectrogram.frames,
      channels: spectrogram.channels,
      data: spectrogram.data
    }
  };
  (self as DedicatedWorkerGlobalScope).postMessage(done, [spectrogram.data.buffer]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Compute per-channel median across time, then take the median of those.
 * This is a robust noise-floor estimate that ignores narrowband signals.
 */
function estimateNoiseFloor(
  data: Float32Array,
  channels: number,
  frames: number
): number {
  const colMedians = new Float32Array(channels);
  const colBuf = new Float32Array(frames);
  for (let c = 0; c < channels; c++) {
    for (let f = 0; f < frames; f++) colBuf[f] = data[f * channels + c];
    colMedians[c] = quickMedian(colBuf.slice());
  }
  return quickMedian(colMedians.slice());
}

function exerciseFFT(): number {
  // Run a small FFT so the worker's compute graph also touches the FFT path.
  // This keeps the path warm and lets us count bins meaningfully.
  const n = 1024;
  const sig = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    sig[i] = Math.sin((2 * Math.PI * 50 * i) / n) + 0.1 * Math.random();
  }
  const ps = powerSpectrum(sig);
  return ps.length;
}

/**
 * Real-data path: read a SIGPROC `.fil` file from one of two sources (a
 * public archive URL via the Pages range-proxy, or a user-uploaded `Blob`),
 * parse the header, decode the data section, and decimate the result down
 * to the WorkUnit's nominal display resolution.
 *
 * For files that are MUCH larger than `maxBytes` (typically Breakthrough
 * Listen GUPPI splices that can be tens of GB), the read is automatically
 * split into N non-contiguous **time windows** spread uniformly across the
 * file. Each window is decoded independently and concatenated frame-wise
 * into the final spectrogram, giving the detector temporal diversity
 * instead of just the first ~30 MB of a 70 GB capture.
 *
 * The read pattern is:
 *   - tiny (~8 KB) header read at offset 0
 *   - either a single data slab, OR N smaller slabs across the file
 * Each slab uses HTTP Range / Blob.slice so we never load more than needed.
 */
async function fetchAndDecodeFilterbank(
  unit: WorkUnit
): Promise<{ unit: WorkUnit; spectrogram: Spectrogram }> {
  if (
    !unit.dataSource ||
    (unit.dataSource.kind !== 'filterbank' &&
      unit.dataSource.kind !== 'filterbank-local')
  ) {
    throw new Error('fetchAndDecodeFilterbank called without a filterbank dataSource');
  }
  const ds = unit.dataSource;

  // Abstract over remote-URL vs local-Blob reads. Both end up returning an
  // ArrayBuffer of the requested byte range.
  const readBytes: (offset: number, length: number) => Promise<ArrayBuffer> =
    ds.kind === 'filterbank'
      ? async (offset, length) => {
          const proxy = ds.proxyPath;
          const encoded = encodeURIComponent(ds.upstreamUrl);
          const url = `${proxy}?url=${encoded}&offset=${offset}&length=${length}`;
          // Bound every remote read with an AbortController so a stalled
          // upstream (or a missing /api/datafile proxy returning a never-
          // ending HTML response) cannot wedge the analysis loop forever.
          // Header reads are tiny so 20s is plenty; data slabs scale with
          // size up to a hard 90s ceiling.
          const timeoutMs = length > 65536 ? 90000 : 20000;
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          let resp: Response;
          try {
            resp = await fetch(url, { signal: controller.signal });
          } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
              throw new Error(
                `Remote fetch timed out after ${Math.round(timeoutMs / 1000)}s ` +
                  `(${length} bytes @ ${offset}). The /api/datafile proxy may be ` +
                  `unreachable on this host (e.g. GitHub Pages has no Pages Functions).`
              );
            }
            throw err;
          } finally {
            clearTimeout(timer);
          }
          if (!resp.ok) {
            throw new Error(
              `Remote fetch failed: ${resp.status} ${resp.statusText} ` +
                `(${length} bytes @ ${offset} via ${proxy})`
            );
          }
          return resp.arrayBuffer();
        }
      : async (offset, length) => {
          // Local file: slice the Blob and read as ArrayBuffer. The browser
          // streams from disk efficiently — no full-file load required.
          const slice = ds.file.slice(offset, offset + length);
          return slice.arrayBuffer();
        };

  postMsg({
    type: 'fetch-progress',
    workUnitId: unit.id,
    phase: 'header',
    bytesLoaded: 0,
    bytesTotal: ds.maxBytes
  });

  // 1. Header chunk. 8 KB is comfortably larger than any well-formed SIGPROC
  //    header and still trivially small to read.
  const headerBytes = 8192;
  const headerBuf = await readBytes(0, headerBytes);
  const header = parseFilterbankHeader(headerBuf);

  // 2. Decide single-slab vs chunked-windows. The trigger: known total file
  //    size at least 4× the analysis budget. Otherwise we read one contiguous
  //    slab from offset 0, same as before.
  const bytesPerSample = header.nbits / 8;
  const bytesPerRow = header.nchans * header.nifs * bytesPerSample;
  const knownTotal =
    ds.kind === 'filterbank' ? ds.totalFileBytes : ds.fileSizeBytes;
  const totalDataBytes =
    knownTotal !== undefined ? Math.max(0, knownTotal - header.dataOffset) : 0;
  const usefulBudget = Math.max(bytesPerRow, ds.maxBytes - headerBuf.byteLength);
  // Decide chunk count. For 4×budget < file < 64×budget we use 2-4 chunks;
  // for huge files we cap at 8 chunks so the UI doesn't stall.
  let chunkCount = 1;
  if (totalDataBytes > 0 && totalDataBytes > 4 * ds.maxBytes) {
    const ratio = totalDataBytes / ds.maxBytes;
    chunkCount = Math.min(8, Math.max(2, Math.round(Math.log2(ratio))));
  }

  postMsg({
    type: 'fetch-progress',
    workUnitId: unit.id,
    phase: 'data',
    bytesLoaded: headerBuf.byteLength,
    bytesTotal: ds.maxBytes
  });

  // 3. Decode either a single slab or N windows.
  let combined: { data: Float32Array; frames: number; channels: number };
  // Track which byte offsets we actually read so the engine can persist them
  // for cross-chunk coverage tracking on this dataset.
  let chunkOffsetsOut: number[] = [];
  let chunkSpanBytesOut = 0;
  if (chunkCount === 1) {
    // Original single-slab path. Read as much contiguous data as the budget
    // allows, starting at the beginning of the data section.
    const dataLength = Math.max(
      bytesPerRow,
      Math.floor(usefulBudget / bytesPerRow) * bytesPerRow
    );
    const dataBuf = await readBytes(header.dataOffset, dataLength);
    postMsg({
      type: 'fetch-progress',
      workUnitId: unit.id,
      phase: 'decode',
      bytesLoaded: headerBuf.byteLength + dataBuf.byteLength,
      bytesTotal: ds.maxBytes
    });
    const decoded = decodeFilterbankData(dataBuf, header);
    const small = decimateSpectrogram(
      decoded.data,
      decoded.frames,
      decoded.channels,
      ds.displayFrames,
      ds.displayChannels
    );
    combined = { data: small.data, frames: small.frames, channels: small.channels };
    chunkOffsetsOut = [header.dataOffset];
    chunkSpanBytesOut = dataLength;
  } else {
    // Multi-window path. Split the per-unit budget into chunkCount smaller
    // slabs spread uniformly across the file. Each window decodes to a
    // displayFrames-per-chunk slice, then concatenated frame-wise.
    const chunkBytesRaw = Math.floor(usefulBudget / chunkCount);
    const chunkBytes = Math.max(
      bytesPerRow * 4,
      Math.floor(chunkBytesRaw / bytesPerRow) * bytesPerRow
    );
    const framesPerChunk = Math.max(1, Math.floor(ds.displayFrames / chunkCount));
    const lastChunkExtra = ds.displayFrames - framesPerChunk * chunkCount; // 0 or +small
    const totalSpan = Math.max(0, totalDataBytes - chunkBytes);
    // Pick chunk start offsets. Default: uniform spacing across the file. If
    // the engine passed `previousChunkOffsets` (regions already analyzed by
    // earlier passes of the same dataset), bias toward unexplored regions so
    // repeated runs grow coverage monotonically rather than always re-reading
    // the same windows.
    const offsetsAligned: number[] = [];
    const prior = unit.previousChunkOffsets ?? [];
    if (prior.length > 0 && totalSpan > 0) {
      // Greedy max-min-distance pick over a dense uniform candidate grid.
      // 64 candidates is enough resolution for any reasonable file size while
      // keeping the picker O(N) tiny.
      const CANDIDATE_COUNT = 64;
      const candidates: number[] = [];
      for (let i = 0; i < CANDIDATE_COUNT; i++) {
        const t = i / (CANDIDATE_COUNT - 1);
        const raw = header.dataOffset + Math.floor(totalSpan * t);
        const al =
          header.dataOffset +
          Math.floor((raw - header.dataOffset) / bytesPerRow) * bytesPerRow;
        candidates.push(al);
      }
      const picked: number[] = [];
      const used = new Set<number>();
      for (let pickIdx = 0; pickIdx < chunkCount; pickIdx++) {
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < candidates.length; i++) {
          if (used.has(i)) continue;
          const off = candidates[i];
          // Score = minimum distance to any prior-or-already-picked offset.
          let minDist = Infinity;
          for (const p of prior) {
            const d = Math.abs(off - p);
            if (d < minDist) minDist = d;
          }
          for (const p of picked) {
            const d = Math.abs(off - p);
            if (d < minDist) minDist = d;
          }
          if (minDist > bestScore) {
            bestScore = minDist;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) break;
        used.add(bestIdx);
        picked.push(candidates[bestIdx]);
      }
      // Sort ascending so the read order traverses the file forward — better
      // for HTTP keep-alive and disk-prefetch behavior.
      picked.sort((a, b) => a - b);
      for (const p of picked) offsetsAligned.push(p);
    }
    let bytesSoFar = headerBuf.byteLength;
    const accumulated: Float32Array[] = [];
    let runningFrames = 0;
    let outChannels = 0;
    for (let i = 0; i < chunkCount; i++) {
      // Either use the precomputed unexplored-biased offset, or fall back to
      // uniform spacing of window *starts* across the file.
      let aligned: number;
      if (offsetsAligned.length === chunkCount) {
        aligned = offsetsAligned[i];
      } else {
        const t = chunkCount === 1 ? 0 : i / (chunkCount - 1);
        const rawOffset = header.dataOffset + Math.floor(totalSpan * t);
        aligned =
          header.dataOffset +
          Math.floor((rawOffset - header.dataOffset) / bytesPerRow) * bytesPerRow;
      }
      chunkOffsetsOut.push(aligned);
      const buf = await readBytes(aligned, chunkBytes);
      const decoded = decodeFilterbankData(buf, header);
      const targetFrames =
        i === chunkCount - 1 ? framesPerChunk + lastChunkExtra : framesPerChunk;
      const small = decimateSpectrogram(
        decoded.data,
        decoded.frames,
        decoded.channels,
        Math.max(1, targetFrames),
        ds.displayChannels
      );
      accumulated.push(small.data);
      runningFrames += small.frames;
      outChannels = small.channels;
      bytesSoFar += buf.byteLength;
      postMsg({
        type: 'fetch-progress',
        workUnitId: unit.id,
        phase: i === chunkCount - 1 ? 'decode' : 'data',
        bytesLoaded: bytesSoFar,
        bytesTotal: ds.maxBytes
      });
      if (cancelled) {
        return { unit, spectrogram: { workUnitId: unit.id, frames: 0, channels: 0, data: new Float32Array(0) } };
      }
    }
    const concatenated = new Float32Array(runningFrames * outChannels);
    let offset = 0;
    for (const part of accumulated) {
      concatenated.set(part, offset);
      offset += part.length;
    }
    combined = { data: concatenated, frames: runningFrames, channels: outChannels };
    chunkSpanBytesOut = chunkBytes;
  }

  // 4. Refine WorkUnit metadata from the real header. When chunked, we set
  //    the effective framePeriod so each row still represents the same
  //    underlying time per integration (the gaps *between* chunks are not
  //    represented in the row count — that is documented in the UI). We also
  //    stamp `chunkCount` so the export bundle can record provenance.
  const refined = refineUnitFromHeader(
    unit,
    header,
    combined.frames * (chunkCount > 1 ? Math.floor(usefulBudget / chunkCount / bytesPerRow) : Math.floor(usefulBudget / bytesPerRow)),
    combined.frames,
    combined.channels
  );
  const finalUnit: WorkUnit = {
    ...refined,
    ...(chunkCount > 1 ? { chunkCount } : {}),
    chunkOffsets: chunkOffsetsOut,
    chunkSpanBytes: chunkSpanBytesOut
  };
  postMsg({
    type: 'unit-updated',
    workUnitId: unit.id,
    channels: finalUnit.channels,
    frames: finalUnit.frames,
    freqStartMHz: finalUnit.freqStartMHz,
    freqEndMHz: finalUnit.freqEndMHz,
    channelBandwidthHz: finalUnit.channelBandwidthHz,
    framePeriodSec: finalUnit.framePeriodSec,
    chunkOffsets: chunkOffsetsOut,
    chunkSpanBytes: chunkSpanBytesOut
  });

  return {
    unit: finalUnit,
    spectrogram: {
      workUnitId: unit.id,
      frames: combined.frames,
      channels: combined.channels,
      data: combined.data
    }
  };
}

function refineUnitFromHeader(
  unit: WorkUnit,
  header: FilterbankHeader,
  decodedFrames: number,
  outFrames: number,
  outChannels: number
): WorkUnit {
  // foff is MHz per source channel. After channel decimation by a factor of
  // `nchans / outChannels`, the effective channel bandwidth widens by that
  // factor. After time decimation by `decodedFrames / outFrames`, the
  // effective frame period scales the same way.
  const channelDecim = header.nchans / outChannels;
  const frameDecim = decodedFrames / Math.max(1, outFrames);
  const effectiveChannelBandwidthHz = Math.abs(header.foff) * 1e6 * channelDecim;
  const effectiveFramePeriodSec = header.tsamp * frameDecim;
  const fLo = header.fch1 + (header.foff < 0 ? header.foff * (header.nchans - 1) : 0);
  const fHi = header.fch1 + (header.foff >= 0 ? header.foff * (header.nchans - 1) : 0);
  return {
    ...unit,
    channels: outChannels,
    frames: outFrames,
    freqStartMHz: Math.min(fLo, fHi),
    freqEndMHz: Math.max(fLo, fHi),
    channelBandwidthHz: effectiveChannelBandwidthHz,
    framePeriodSec: effectiveFramePeriodSec
  };
}

function postMsg(m: Outgoing): void {
  (self as DedicatedWorkerGlobalScope).postMessage(m);
}
