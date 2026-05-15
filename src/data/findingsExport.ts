import type { AnalysisResult, CandidateSignal, WorkUnit } from '../types/domain';

/**
 * Findings-export module for SignalScope SETI.
 *
 * Produces a small package of files in the form a Breakthrough Listen /
 * Berkeley SETI researcher can ingest directly:
 *
 *  1. `<unit>.dat`      — turbo_seti-compatible "hit table" of every detected
 *                         candidate. This is the same shape `turbo_seti` writes
 *                         when scanning a `.fil` file, so a researcher can drop
 *                         our output into the same downstream tooling
 *                         (`find_event_pipeline`, `plot_event`, etc.).
 *  2. `manifest.json`   — full provenance: what file we scanned, what byte
 *                         range, what classifier rules ran, when, with what
 *                         resource budget. Includes every candidate's plain-
 *                         language explanation so a human reviewer can triage
 *                         the bundle quickly.
 *  3. `README.txt`      — instructions for the receiving researcher: what
 *                         this bundle is, what it is NOT, and how to load it.
 *
 * Everything is bundled as a single `.zip` with no compression (STORE-only).
 * No third-party zip library is used — a tiny inline writer is sufficient for
 * three small text files.
 *
 * There is **no public submission endpoint** at Berkeley SETI for citizen-
 * scientist findings: the project shares observations one-way through the
 * Open Data archive, and accepts community contributions through papers and
 * GitHub PRs (e.g. on `turbo_seti`). The honest path is to download this
 * bundle and forward it to a researcher (see `README.txt`).
 */

const CLASSIFIER_VERSION = 'signalscope-classifier-0.2 (median+MAD threshold, ±4ch drift tracker)';
const TOOL_NAME = 'SignalScope SETI';
const TURBO_SETI_HEADER_VERSION = '2.x compatible';

// -- public API --

/** Returns true iff there is enough data on the WorkUnit/AnalysisResult to
 *  build a meaningful export. */
export function canExportFindings(unit: WorkUnit | undefined, result: AnalysisResult | undefined): boolean {
  if (!unit || !result) return false;
  // Require at least one candidate OR enough header metadata to be useful as
  // a "we scanned this and found nothing" report.
  return unit.channels > 0 && unit.frames > 0;
}

/**
 * Build the export bundle as a single `.zip` Blob. Caller is responsible for
 * triggering the download (e.g. via a temporary `<a>` element).
 */
export function buildFindingsBundle(unit: WorkUnit, result: AnalysisResult): Blob {
  const baseName = sanitizeFileName(unit.target.name || unit.id) + '-' + shortId(unit.id);
  const datText = buildTurboSetiDat(unit, result.candidates);
  const manifest = buildManifestJson(unit, result);
  const readme = buildReadmeText(unit, result);

  const files: ZipFile[] = [
    { name: `${baseName}.dat`, content: datText },
    { name: 'manifest.json', content: manifest },
    { name: 'README.txt', content: readme }
  ];
  const bytes = createStoreZip(files);
  // Copy into a fresh ArrayBuffer-backed Uint8Array so strict TS sees a
  // BufferSource whose backing is unambiguously an ArrayBuffer (not the
  // ArrayBuffer | SharedArrayBuffer union TS infers for raw `Uint8Array`).
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return new Blob([ab], { type: 'application/zip' });
}

/** Suggested filename for the downloaded bundle. */
export function suggestedBundleFileName(unit: WorkUnit): string {
  const base = sanitizeFileName(unit.target.name || unit.id);
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  return `signalscope-${base}-${ts}.zip`;
}

// -- turbo_seti-compatible `.dat` writer --

/**
 * Produce a turbo_seti-compatible hit-table string.
 *
 * Format reference: https://github.com/UCBerkeleySETI/turbo_seti
 * Columns: Top_Hit_# Drift_Rate SNR Uncorrected_Frequency Corrected_Frequency
 *          Index freq_start freq_end SEFD SEFD_freq Coarse_Channel_Number Full_number_of_hits
 */
export function buildTurboSetiDat(unit: WorkUnit, candidates: CandidateSignal[]): string {
  const mjd = isoToMJD(unit.observedAt);
  const obsLength = unit.frames * unit.framePeriodSec;
  const deltaT = unit.framePeriodSec;
  const deltaF = unit.channelBandwidthHz;
  // turbo_seti's default max-drift search window in Hz/s. SignalScope's
  // adaptive ±4-channel tracker spans different ranges depending on
  // resolution; we emit a conservative ceiling for downstream filters.
  const maxDrift = Math.max(
    4.0,
    Math.ceil(Math.max(...candidates.map((c) => Math.abs(c.driftHzPerSec)), 0) / 1.0) || 4.0
  );

  const lines: string[] = [];
  lines.push('# -------------------------- o --------------------------');
  lines.push(`# File ID: ${unit.sourceRef}`);
  lines.push(`# Source:${unit.target.name}`);
  lines.push(
    `# MJD: ${mjd.toFixed(6)} RA: ${unit.target.raHours.toFixed(6)} Dec: ${unit.target.decDeg.toFixed(6)}`
  );
  lines.push(
    `# DELTAT: ${deltaT.toFixed(6)} DELTAF(Hz): ${deltaF.toFixed(6)}  ` +
      `max_drift_rate: ${maxDrift.toFixed(3)} obs_length: ${obsLength.toFixed(6)}`
  );
  lines.push('# --------------------------');
  lines.push(
    '# Top_Hit_#     Drift_Rate     SNR     Uncorrected_Frequency     Corrected_Frequency     Index     freq_start     freq_end     SEFD     SEFD_freq     Coarse_Channel_Number     Full_number_of_hits'
  );
  lines.push('# --------------------------');

  // turbo_seti convention: hits sorted by SNR descending.
  const sorted = [...candidates].sort((a, b) => b.snr - a.snr);
  sorted.forEach((c, i) => {
    const halfBwMHz = ((c.pixel.width / 2) * unit.channelBandwidthHz) / 1e6;
    const freqStart = c.frequencyMHz - halfBwMHz;
    const freqEnd = c.frequencyMHz + halfBwMHz;
    const coarseCh = Math.floor(c.pixel.channel / 1024);
    const index = c.pixel.channel;
    const row = [
      pad(i + 1, 9),
      fixed(c.driftHzPerSec, 6, 13),
      fixed(c.snr, 6, 13),
      fixed(c.frequencyMHz, 6, 22),
      fixed(c.frequencyMHz, 6, 22),
      pad(index, 10),
      fixed(freqStart, 6, 14),
      fixed(freqEnd, 6, 14),
      fixed(0.0, 6, 9), // SEFD unknown
      fixed(0.0, 6, 13), // SEFD_freq unknown
      pad(coarseCh, 8),
      pad(index, 10)
    ].join(' ');
    lines.push(row);
  });

  if (sorted.length === 0) {
    lines.push('# (no hits above threshold)');
  }

  return lines.join('\n') + '\n';
}

// -- JSON manifest --

export function buildManifestJson(unit: WorkUnit, result: AnalysisResult): string {
  const source =
    unit.dataSource?.kind === 'filterbank'
      ? {
          kind: 'remote-archive',
          upstream_url: unit.dataSource.upstreamUrl,
          proxy_path: unit.dataSource.proxyPath,
          max_bytes_fetched: unit.dataSource.maxBytes,
          total_file_bytes: unit.dataSource.totalFileBytes ?? null,
          chunk_count: unit.chunkCount ?? 1,
          chunk_offsets: unit.chunkOffsets ?? null,
          chunk_span_bytes: unit.chunkSpanBytes ?? null
        }
      : unit.dataSource?.kind === 'filterbank-local'
      ? {
          kind: 'user-upload',
          file_name: unit.dataSource.fileName,
          file_size_bytes: unit.dataSource.fileSizeBytes,
          max_bytes_analyzed: unit.dataSource.maxBytes,
          chunk_count: unit.chunkCount ?? 1,
          chunk_offsets: unit.chunkOffsets ?? null,
          chunk_span_bytes: unit.chunkSpanBytes ?? null
        }
      : unit.dataSource?.kind === 'cached-decoded'
      ? {
          kind: 'cached-replay',
          cached_at: unit.dataSource.cachedAt,
          note:
            'This analysis was re-run on a previously cached decoded spectrogram. ' +
            'Underlying byte-source provenance is whatever produced the original cache entry.'
        }
      : { kind: 'unknown' };

  const manifest = {
    tool: TOOL_NAME,
    tool_classifier_version: CLASSIFIER_VERSION,
    turbo_seti_dat_compatibility: TURBO_SETI_HEADER_VERSION,
    exported_at: new Date().toISOString(),
    work_unit: {
      id: unit.id,
      target: unit.target,
      telescope: unit.telescope,
      observed_at: unit.observedAt,
      mjd: isoToMJD(unit.observedAt),
      freq_start_mhz: unit.freqStartMHz,
      freq_end_mhz: unit.freqEndMHz,
      channel_bandwidth_hz: unit.channelBandwidthHz,
      channels: unit.channels,
      frames: unit.frames,
      frame_period_sec: unit.framePeriodSec,
      observation_seconds: unit.frames * unit.framePeriodSec,
      dataset_id: unit.datasetId ?? null,
      chunk_count: unit.chunkCount ?? 1,
      chunk_offsets: unit.chunkOffsets ?? null,
      chunk_span_bytes: unit.chunkSpanBytes ?? null,
      source_ref: unit.sourceRef,
      license: unit.license
    },
    source,
    analysis: {
      compute_ms: result.computeMs,
      bins_processed: result.binsProcessed,
      noise_floor_linear: result.noiseFloor,
      summary: result.summary ?? null
    },
    candidates: result.candidates.map((c) => ({
      id: c.id,
      frequency_mhz: c.frequencyMHz,
      drift_hz_per_sec: c.driftHzPerSec,
      snr: c.snr,
      duration_sec: c.durationSec,
      confidence: c.confidence,
      label: c.label,
      dataset_id: c.datasetId ?? unit.datasetId ?? null,
      recurrence_count: c.recurrenceCount ?? 0,
      ai_assessment: c.aiAssessment
        ? {
            provider: c.aiAssessment.provider,
            model: c.aiAssessment.model,
            prompt_version: c.aiAssessment.promptVersion,
            label: c.aiAssessment.label,
            confidence: c.aiAssessment.confidence,
            rationale: c.aiAssessment.rationale,
            recommended_action: c.aiAssessment.recommendedAction ?? null,
            created_at: c.aiAssessment.createdAt
          }
        : null,
      explanation: c.explanation,
      pixel: c.pixel
    })),
    notes: [
      'SignalScope is a citizen-science / educational PWA. The bundled detector is a',
      'simplified narrowband + drift classifier — it is not a substitute for the full',
      'turbo_seti / find_event / SETI@home pipelines.',
      'Frequencies are taken straight from the SIGPROC fch1/foff header. No barycentric',
      'correction is applied, so Uncorrected_Frequency == Corrected_Frequency in the .dat.',
      'Drift estimates are based on a ±4-channel adaptive tracker after time and channel',
      'decimation; researchers should treat the .dat hits as candidates for follow-up,',
      'not final detections.',
      'For chunked analyses, chunk_offsets are byte offsets relative to the SIGPROC',
      'data section. Recurrence counts are frequency-only matches within this dataset; no',
      'cross-chunk drift-continuity reconstruction is performed.',
      'Optional Cloudflare Workers AI triage is advisory only. It is generated from',
      'compact candidate metadata, never raw filterbank bytes, and must not be treated',
      'as scientific confirmation.'
    ]
  };

  return JSON.stringify(manifest, null, 2);
}

// -- README --

function buildReadmeText(unit: WorkUnit, result: AnalysisResult): string {
  const totalCands = result.candidates.length;
  const interesting = result.candidates.filter(
    (c) => c.label === 'interesting' || c.label === 'needs-followup'
  ).length;
  const upstreamHint =
    unit.dataSource?.kind === 'filterbank'
      ? `Source file: ${unit.dataSource.upstreamUrl}`
      : unit.dataSource?.kind === 'filterbank-local'
      ? `Source file: <user upload> ${unit.dataSource.fileName} (${unit.dataSource.fileSizeBytes} bytes)`
      : unit.dataSource?.kind === 'cached-decoded'
      ? `Source: <cached replay> originally cached ${unit.dataSource.cachedAt}`
      : `Source ref: ${unit.sourceRef}`;

  return [
    `${TOOL_NAME} — findings export bundle`,
    '='.repeat(60),
    '',
    `Target:       ${unit.target.name}`,
    `Telescope:    ${unit.telescope}`,
    `Observed at:  ${unit.observedAt} (MJD ${isoToMJD(unit.observedAt).toFixed(6)})`,
    `Band:         ${unit.freqStartMHz.toFixed(3)} \u2013 ${unit.freqEndMHz.toFixed(3)} MHz`,
    `Observation:  ${unit.frames} frames \u00D7 ${unit.framePeriodSec.toFixed(3)} s = ` +
      `${(unit.frames * unit.framePeriodSec).toFixed(1)} s total`,
    upstreamHint,
    '',
    `Candidates detected: ${totalCands} total, ${interesting} interesting / needs-followup`,
    `Classifier:          ${CLASSIFIER_VERSION}`,
    `AI triage:           ${result.candidates.some((c) => c.aiAssessment) ? 'included for some candidates' : 'not included'}`,
    '',
    'CONTENTS',
    '--------',
    `  *.dat          turbo_seti-compatible hit table (drop into find_event_pipeline)`,
    '  manifest.json  full provenance + per-candidate explanations',
    '  README.txt     this file',
    '',
    'WHAT THIS IS',
    '------------',
    'A citizen-scientist re-analysis of a public Breakthrough Listen filterbank',
    'file (or, if the source was a user upload, a local SIGPROC capture). The hit',
    "table follows turbo_seti's text format so it can be ingested by Berkeley",
    'SETI tooling without any conversion.',
    '',
    'WHAT THIS IS NOT',
    '----------------',
    '  - Not a detection of extraterrestrial intelligence. Most hits in this',
    '    bundle are statistical noise, terrestrial RFI, or instrumental.',
    '  - Not a substitute for the full turbo_seti / find_event pipeline.',
    "    SignalScope's detector is intentionally simplified for an in-browser run.",
    '  - Not barycentrically corrected. Uncorrected_Frequency == Corrected_Frequency.',
    '  - Not scientifically confirmed by AI. Optional Cloudflare AI triage is an',
    '    advisory summary generated from compact candidate metadata only.',
    '',
    'HOW TO INGEST',
    '-------------',
    '  # In a turbo_seti environment:',
    '  from turbo_seti.find_event.find_event_pipeline import find_event_pipeline',
    '  find_event_pipeline("./this.dat.list", filter_threshold=3, on_off_first="ON")',
    '',
    '  # Or simply inspect:',
    '  cat *.dat | column -t',
    '',
    'WHERE TO SEND IT',
    '----------------',
    'There is no public submission endpoint at Berkeley SETI for citizen-science',
    'findings. The Breakthrough Listen team accepts contributions through:',
    '  - GitHub PRs on turbo_seti:  https://github.com/UCBerkeleySETI/turbo_seti',
    '  - The general project contact form: https://seti.berkeley.edu/listen/contact',
    '  - Academic collaboration / papers',
    'If you have a candidate you genuinely believe is interesting, please use the',
    'contact form above rather than directly emailing individual researchers.',
    '',
    'LICENSE / ATTRIBUTION OF UPSTREAM DATA',
    '--------------------------------------',
    unit.license,
    ''
  ].join('\n');
}

// -- utils --

function isoToMJD(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return t / 86400000 + 40587;
}

function sanitizeFileName(s: string): string {
  return s
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function shortId(s: string): string {
  // Stable short suffix derived from a longer id, lowercase hex.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8);
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, ' ');
}

function fixed(n: number, frac: number, w: number): string {
  return n.toFixed(frac).padStart(w, ' ');
}

// -- minimal STORE-only ZIP writer --
//
// Implements just enough of APPNOTE.TXT v6.3.4 to bundle a small number of
// text files. Compression method = 0 (STORE), no extra fields, no UTF-8 path
// flag (file names below are pure ASCII), CRC32 over raw data.

interface ZipFile {
  name: string;
  content: string;
}

interface ZipEntryMeta {
  name: string;
  data: Uint8Array;
  crc32: number;
  localOffset: number;
}

function createStoreZip(files: ZipFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const entries: ZipEntryMeta[] = [];
  const parts: Uint8Array[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const data = encoder.encode(f.content);
    const crc = crc32(data);

    // Local file header (30 bytes + name)
    const lfh = new Uint8Array(30 + nameBytes.length);
    const lfhView = new DataView(lfh.buffer);
    lfhView.setUint32(0, 0x04034b50, true); // local file header signature
    lfhView.setUint16(4, 20, true); // version needed = 2.0
    lfhView.setUint16(6, 0, true); // flags
    lfhView.setUint16(8, 0, true); // method = STORE
    lfhView.setUint16(10, 0, true); // mod time
    lfhView.setUint16(12, 0, true); // mod date
    lfhView.setUint32(14, crc, true);
    lfhView.setUint32(18, data.length, true); // compressed size = uncompressed
    lfhView.setUint32(22, data.length, true);
    lfhView.setUint16(26, nameBytes.length, true);
    lfhView.setUint16(28, 0, true); // extra field length
    lfh.set(nameBytes, 30);

    parts.push(lfh, data);
    entries.push({ name: f.name, data, crc32: crc, localOffset: offset });
    offset += lfh.length + data.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    const nameBytes = encoder.encode(e.name);
    const cdh = new Uint8Array(46 + nameBytes.length);
    const v = new DataView(cdh.buffer);
    v.setUint32(0, 0x02014b50, true); // central dir header signature
    v.setUint16(4, 20, true); // version made by
    v.setUint16(6, 20, true); // version needed
    v.setUint16(8, 0, true); // flags
    v.setUint16(10, 0, true); // method = STORE
    v.setUint16(12, 0, true);
    v.setUint16(14, 0, true);
    v.setUint32(16, e.crc32, true);
    v.setUint32(20, e.data.length, true);
    v.setUint32(24, e.data.length, true);
    v.setUint16(28, nameBytes.length, true);
    v.setUint16(30, 0, true); // extra
    v.setUint16(32, 0, true); // comment
    v.setUint16(34, 0, true); // disk start
    v.setUint16(36, 0, true); // internal attrs
    v.setUint32(38, 0, true); // external attrs
    v.setUint32(42, e.localOffset, true);
    cdh.set(nameBytes, 46);
    parts.push(cdh);
    offset += cdh.length;
  }

  const centralEnd = offset;
  const centralSize = centralEnd - centralStart;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk where central dir starts
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true); // comment length
  parts.push(eocd);

  // Concatenate.
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const p of parts) {
    out.set(p, cursor);
    cursor += p.length;
  }
  return out;
}

// Standard reflected CRC-32 (IEEE 802.3). Lazy-init the table.
let CRC32_TABLE: Uint32Array | null = null;
function ensureCrcTable(): Uint32Array {
  if (CRC32_TABLE) return CRC32_TABLE;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  CRC32_TABLE = t;
  return t;
}

function crc32(data: Uint8Array): number {
  const t = ensureCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
