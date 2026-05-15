/**
 * SIGPROC `.fil` filterbank parser.
 *
 * The SIGPROC filterbank format is the de-facto interchange format for
 * channelized, time-integrated radio-astronomy data and is the format used
 * by Breakthrough Listen Open Data for its smaller "fine-resolution" files
 * (e.g. the famous `Voyager1.single_coarse.fine_res.fil`).
 *
 * Format reference: http://sigproc.sourceforge.net/sigproc.pdf
 *
 * Header layout (all little-endian):
 *   { uint32 keyword-length, ASCII keyword bytes [, value of keyword-specific type] }*
 * The header starts with the special keyword `HEADER_START` (no value) and
 * ends with `HEADER_END` (no value). Between them, each keyword's value type
 * is fixed by the spec — strings carry their own uint32 length prefix,
 * integers are int32, and floating-point keys are float64.
 *
 * Data layout (after HEADER_END):
 *   For each time sample t in [0, nsamples):
 *     For each IF i in [0, nifs):
 *       For each frequency channel c in [0, nchans):
 *         A `nbits`-bit unsigned sample
 *
 * Most Breakthrough Listen files use nifs=1 and nbits=32 (IEEE 754 float).
 */

export interface FilterbankHeader {
  /** Number of frequency channels per time row. */
  nchans: number;
  /** Bits per sample (8, 16, 32 supported here; 2 and 4 are packed). */
  nbits: number;
  /** Number of IF (polarization) streams; usually 1 for BL. */
  nifs: number;
  /** MHz of the first channel (top of the band if `foff` is negative). */
  fch1: number;
  /** MHz between adjacent channels (often negative — band is flipped). */
  foff: number;
  /** Seconds per integration row. */
  tsamp: number;
  /** Optional: observation start as Modified Julian Date. */
  tstart?: number;
  /** Optional: source name as written in the file. */
  sourceName?: string;
  /** Optional: packed RA `HHMMSS.ss` and Dec `DDMMSS.ss`. */
  srcRaj?: number;
  srcDej?: number;
  /** Numeric IDs from the SIGPROC spec. */
  telescopeId?: number;
  machineId?: number;
  /** 1 = filterbank, 2 = time series, 6 = dedispersed. */
  dataType?: number;
  /** Whether 8-bit samples are signed (0 = unsigned). */
  signed?: number;
  /** Byte offset where the data section begins (== bytes consumed by header). */
  dataOffset: number;
}

/** Decoded sub-image of a filterbank file. */
export interface DecodedFilterbank {
  header: FilterbankHeader;
  frames: number;
  channels: number;
  /** Row-major [frames * channels] of power values. */
  data: Float32Array;
}

const STRING_KEYS = new Set([
  'source_name',
  'rawdatafile'
]);

const DOUBLE_KEYS = new Set([
  'tstart',
  'tsamp',
  'fch1',
  'foff',
  'src_raj',
  'src_dej',
  'az_start',
  'za_start',
  'refdm',
  'period'
]);

const INT_KEYS = new Set([
  'machine_id',
  'telescope_id',
  'data_type',
  'barycentric',
  'pulsarcentric',
  'nbits',
  'nsamples',
  'nchans',
  'nifs',
  'nbeams',
  'ibeam',
  'signed'
]);

/**
 * Parse the SIGPROC header from a buffer. The buffer must contain at least
 * the full header (a few KB is plenty); extra bytes after `HEADER_END` are
 * ignored.
 */
export function parseFilterbankHeader(buffer: ArrayBuffer): FilterbankHeader {
  const dv = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let pos = 0;

  const first = readKeyword(dv, bytes, pos);
  if (first.keyword !== 'HEADER_START') {
    throw new Error(
      `Not a SIGPROC filterbank file (first keyword was "${first.keyword}", expected HEADER_START)`
    );
  }
  pos = first.next;

  const header: Partial<FilterbankHeader> = {};

  while (pos < bytes.length) {
    const k = readKeyword(dv, bytes, pos);
    if (k.keyword === '<INVALID>' || k.keyword === '<EOF>') {
      throw new Error(`SIGPROC header parse stalled at byte ${pos}`);
    }
    pos = k.next;

    if (k.keyword === 'HEADER_END') {
      header.dataOffset = pos;
      break;
    }

    const lower = k.keyword.toLowerCase();
    if (STRING_KEYS.has(lower)) {
      const s = readString(dv, bytes, pos);
      pos = s.next;
      if (lower === 'source_name') header.sourceName = s.value;
    } else if (DOUBLE_KEYS.has(lower)) {
      if (pos + 8 > bytes.length) throw new Error('Truncated double in header');
      const v = dv.getFloat64(pos, true);
      pos += 8;
      switch (lower) {
        case 'fch1':
          header.fch1 = v;
          break;
        case 'foff':
          header.foff = v;
          break;
        case 'tsamp':
          header.tsamp = v;
          break;
        case 'tstart':
          header.tstart = v;
          break;
        case 'src_raj':
          header.srcRaj = v;
          break;
        case 'src_dej':
          header.srcDej = v;
          break;
      }
    } else if (INT_KEYS.has(lower)) {
      if (pos + 4 > bytes.length) throw new Error('Truncated int in header');
      const v = dv.getInt32(pos, true);
      pos += 4;
      switch (lower) {
        case 'nchans':
          header.nchans = v;
          break;
        case 'nbits':
          header.nbits = v;
          break;
        case 'nifs':
          header.nifs = v;
          break;
        case 'telescope_id':
          header.telescopeId = v;
          break;
        case 'machine_id':
          header.machineId = v;
          break;
        case 'data_type':
          header.dataType = v;
          break;
        case 'signed':
          header.signed = v;
          break;
      }
    } else {
      // Unknown keyword. The SIGPROC spec does not allow guessing the type
      // from context, so refuse rather than risk misaligning the parser.
      throw new Error(
        `Unknown SIGPROC keyword "${k.keyword}" at byte ${pos - k.keyword.length - 4}`
      );
    }
  }

  if (header.dataOffset === undefined) {
    throw new Error('SIGPROC header is missing HEADER_END terminator');
  }
  if (
    header.nchans === undefined ||
    header.nbits === undefined ||
    header.fch1 === undefined ||
    header.foff === undefined ||
    header.tsamp === undefined
  ) {
    throw new Error('SIGPROC header is missing required keys (nchans/nbits/fch1/foff/tsamp)');
  }
  if (header.nifs === undefined) header.nifs = 1;

  return header as FilterbankHeader;
}

function readKeyword(
  dv: DataView,
  bytes: Uint8Array,
  pos: number
): { keyword: string; next: number } {
  if (pos + 4 > bytes.length) return { keyword: '<EOF>', next: bytes.length };
  const len = dv.getUint32(pos, true);
  if (len === 0 || len > 80 || pos + 4 + len > bytes.length) {
    return { keyword: '<INVALID>', next: bytes.length };
  }
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[pos + 4 + i]);
  return { keyword: s, next: pos + 4 + len };
}

function readString(
  dv: DataView,
  bytes: Uint8Array,
  pos: number
): { value: string; next: number } {
  if (pos + 4 > bytes.length) throw new Error('Truncated string in header');
  const len = dv.getUint32(pos, true);
  if (pos + 4 + len > bytes.length) throw new Error('Truncated string body in header');
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[pos + 4 + i]);
  return { value: s, next: pos + 4 + len };
}

/**
 * Decode raw filterbank samples into a Float32 power matrix [frames × nchans].
 *
 * The buffer passed in MUST start exactly at the data section — i.e. caller
 * has already skipped the header bytes (`header.dataOffset`).
 *
 * If the buffer ends mid-row, the trailing partial row is dropped.
 */
export function decodeFilterbankData(
  dataBuffer: ArrayBuffer,
  header: FilterbankHeader,
  maxFrames?: number
): { frames: number; channels: number; data: Float32Array } {
  const { nchans, nifs, nbits } = header;
  if (nbits !== 8 && nbits !== 16 && nbits !== 32) {
    throw new Error(`Unsupported nbits=${nbits} (this parser supports 8, 16, 32)`);
  }
  const bytesPerSample = nbits / 8;
  const samplesPerRow = nchans * nifs;
  const bytesPerRow = samplesPerRow * bytesPerSample;
  const availableFrames = Math.floor(dataBuffer.byteLength / bytesPerRow);
  const frames = maxFrames ? Math.min(maxFrames, availableFrames) : availableFrames;
  if (frames <= 0) {
    throw new Error(
      `decodeFilterbankData: not enough bytes for one row ` +
        `(${dataBuffer.byteLength} < ${bytesPerRow}). Expand maxBytes.`
    );
  }

  const out = new Float32Array(frames * nchans);
  const dv = new DataView(dataBuffer);
  const u8 = new Uint8Array(dataBuffer);
  const signed = header.signed === 1;

  if (nifs === 1) {
    // Fast path: one IF stream, contiguous channels per row.
    for (let f = 0; f < frames; f++) {
      const rowStart = f * bytesPerRow;
      const outRow = f * nchans;
      if (nbits === 32) {
        for (let c = 0; c < nchans; c++) {
          out[outRow + c] = dv.getFloat32(rowStart + c * 4, true);
        }
      } else if (nbits === 16) {
        for (let c = 0; c < nchans; c++) {
          out[outRow + c] = signed
            ? dv.getInt16(rowStart + c * 2, true)
            : dv.getUint16(rowStart + c * 2, true);
        }
      } else {
        // nbits === 8
        for (let c = 0; c < nchans; c++) {
          const v = u8[rowStart + c];
          out[outRow + c] = signed ? (v << 24) >> 24 : v;
        }
      }
    }
  } else {
    // Slower fallback: sum across IF streams.
    for (let f = 0; f < frames; f++) {
      const rowStart = f * bytesPerRow;
      const outRow = f * nchans;
      for (let c = 0; c < nchans; c++) {
        let acc = 0;
        for (let i = 0; i < nifs; i++) {
          const sampOff = rowStart + (i * nchans + c) * bytesPerSample;
          if (nbits === 32) acc += dv.getFloat32(sampOff, true);
          else if (nbits === 16) acc += dv.getUint16(sampOff, true);
          else acc += u8[sampOff];
        }
        out[outRow + c] = acc;
      }
    }
  }

  return { frames, channels: nchans, data: out };
}

/**
 * Average-pool a (frames × channels) matrix down to (targetFrames × targetChannels).
 *
 * If a target dimension is larger than the source, the source dim is returned
 * unchanged for that axis (we never upsample real data — that would just be
 * decoration).
 */
export function decimateSpectrogram(
  data: Float32Array,
  frames: number,
  channels: number,
  targetFrames: number,
  targetChannels: number
): { frames: number; channels: number; data: Float32Array } {
  const outFrames = Math.min(frames, targetFrames);
  const outChannels = Math.min(channels, targetChannels);
  if (outFrames === frames && outChannels === channels) {
    return { frames, channels, data };
  }
  const out = new Float32Array(outFrames * outChannels);
  for (let tf = 0; tf < outFrames; tf++) {
    const f0 = Math.floor((tf * frames) / outFrames);
    const f1 = Math.max(f0 + 1, Math.floor(((tf + 1) * frames) / outFrames));
    for (let tc = 0; tc < outChannels; tc++) {
      const c0 = Math.floor((tc * channels) / outChannels);
      const c1 = Math.max(c0 + 1, Math.floor(((tc + 1) * channels) / outChannels));
      let sum = 0;
      let n = 0;
      for (let f = f0; f < f1; f++) {
        const rowOff = f * channels;
        for (let c = c0; c < c1; c++) {
          sum += data[rowOff + c];
          n++;
        }
      }
      out[tf * outChannels + tc] = n > 0 ? sum / n : 0;
    }
  }
  return { frames: outFrames, channels: outChannels, data: out };
}
