import type { RealDataSource, RemoteFilterbankSource, SkyTarget, Telescope } from '../types/domain';

const DATAFILE_PROXY_PATH = import.meta.env.VITE_DATAFILE_PROXY_PATH ?? '/api/datafile';

/**
 * Curated catalog of public Berkeley SETI / Breakthrough Listen filterbank
 * files. These are real telescope observations — not simulations — that the
 * citizen-science engine can stream, decode, and analyze in the browser.
 *
 * Every URL in this file has been live-probed via HEAD request and is range-
 * fetchable. The entries are selected to cover scientifically meaningful
 * diversity:
 *
 *  - Voyager 1                  — the canonical artificial Doppler-drift
 *                                 narrowband detection. Used as a positive
 *                                 control / calibration target: detections
 *                                 here are human technology, NOT ET.
 *  - 'Oumuamua / 'Oumuamua_OFF — the interstellar visitor + an off-source
 *                                 baseline for textbook RFI rejection
 *  - TRAPPIST-1                 — 7-planet exoplanet system
 *  - FRB 121102                 — first known repeating fast radio burst
 *  - PSR J0332+5434             — bright pulsar calibrator (B0329+54)
 *  - HD 109376, GJ 757          — nearby stars from BL Carbon-band ETZ survey
 *  - test_ifs.fil               — tiny (~246 KB) file for fast first-load
 *
 * Each `upstreamUrl` is fetched only through the `/api/datafile` Pages
 * Function, which restricts requests to a host allowlist (see
 * `functions/api/datafile.ts`). The browser never talks to Berkeley directly.
 *
 * To extend the catalog, query the BL Open Data backend at
 *   http://seti.berkeley.edu/opendata/api/query-files?target=...&file-types=filterbank
 * append the returned URL (after verifying the host is allowlisted), and pick
 * `displayChannels` / `displayFrames` / `maxBytes` for how much you want the
 * worker to download. No other code changes are required.
 */
export interface RealCatalogEntry {
  id: string;
  target: SkyTarget;
  telescope: Telescope;
  /** ISO 8601 observation date. */
  observedAt: string;
  /** Approximate L/S/C/X band labels for the UI. */
  band: string;
  /** Approximate file size in bytes (used for the "fetching X MB" hint). */
  approxBytes: number;
  /** Frequency / time hints shown before the worker parses the header. */
  hintFreqStartMHz: number;
  hintFreqEndMHz: number;
  /** Display resolution we decimate to for analysis + waterfall. */
  displayFrames: number;
  displayChannels: number;
  /** Max bytes the worker is allowed to download for this unit. */
  maxBytes: number;
  /** Where to fetch the raw file from (passed through the allowlisted proxy). */
  upstreamUrl: string;
  /** Short note shown in the UI's real-data badge. */
  note: string;
  /** Attribution string shown in the work-unit metadata panel. */
  attribution: string;
}

const ATTRIBUTION_BL =
  'Breakthrough Listen / Berkeley SETI Research Center — Open Data. ' +
  'Used here under the project\u2019s public data policy.';

export const REAL_CATALOG: RealCatalogEntry[] = [
  {
    id: 'voyager1-2020',
    target: {
      name: 'Voyager 1 (calibration)',
      raHours: 17.165,
      decDeg: 12.106,
      distanceLy: 0.00248,
      note: 'Human-made probe transmitting from interstellar space — used as a positive-control target, NOT an ET candidate'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2020-04-09T00:00:00Z',
    band: 'X-band (~8.4 GHz)',
    approxBytes: 65 * 1024 * 1024,
    hintFreqStartMHz: 8419.296875,
    hintFreqEndMHz: 8421.484375,
    displayFrames: 16,
    displayChannels: 512,
    maxBytes: 64 * 1024 * 1024,
    upstreamUrl:
      'http://blpd0.ssl.berkeley.edu/Voyager_data/Voyager1.single_coarse.fine_res.fil',
    note: 'Calibration target. Voyager 1 transmits its X-band downlink carrier from ~24 billion km away; detecting it proves the pipeline works. Any signal we find here is human technology, not extraterrestrial.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'oumuamua-on',
    target: {
      name: '\u2018Oumuamua (on-source)',
      raHours: 23.622,
      decDeg: 24.566,
      distanceLy: 0.0,
      note: 'First confirmed interstellar object — observed by BL Dec 2017'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-12-13T21:53:22Z',
    band: 'S-band (~2.4 GHz)',
    approxBytes: 558 * 1024 * 1024,
    hintFreqStartMHz: 2300,
    hintFreqEndMHz: 2500,
    displayFrames: 64,
    displayChannels: 512,
    maxBytes: 32 * 1024 * 1024,
    upstreamUrl:
      'http://blpd0.ssl.berkeley.edu/oumuamua/spliced_blc0001020304050607_guppi_58100_78802_OUMUAMUA_0011.gpuspec.0002.fil',
    note: 'On-source scan of \u2018Oumuamua, the first known interstellar object. Pair with the OFF-source unit to perform classic RFI rejection.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'oumuamua-off',
    target: {
      name: '\u2018Oumuamua (OFF-source)',
      raHours: 23.622,
      decDeg: 22.566,
      distanceLy: 0.0,
      note: 'Off-source baseline 2\u00B0 from \u2018Oumuamua\u2014classic RFI control'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-12-13T21:58:39Z',
    band: 'S-band (~2.4 GHz)',
    approxBytes: 558 * 1024 * 1024,
    hintFreqStartMHz: 2300,
    hintFreqEndMHz: 2500,
    displayFrames: 64,
    displayChannels: 512,
    maxBytes: 32 * 1024 * 1024,
    upstreamUrl:
      'http://blpd0.ssl.berkeley.edu/oumuamua/spliced_blc0001020304050607_guppi_58100_79116_OUMUAMUA_OFF_0012.gpuspec.0002.fil',
    note: 'OFF-source companion to the \u2018Oumuamua pointing. Any candidate appearing in BOTH is terrestrial RFI; candidates only in ON are worth attention.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'trappist1-2017',
    target: {
      name: 'TRAPPIST-1',
      raHours: 23.106,
      decDeg: -5.041,
      distanceLy: 40.7,
      note: '7-planet ultracool dwarf system'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-02-12T17:39:00Z',
    band: 'S-band (~2.16 GHz)',
    approxBytes: 334 * 1024 * 1024,
    hintFreqStartMHz: 2050,
    hintFreqEndMHz: 2250,
    displayFrames: 128,
    displayChannels: 512,
    maxBytes: 32 * 1024 * 1024,
    upstreamUrl:
      'http://blpd0.ssl.berkeley.edu/trappist/blc00_guppi_57807_75725_DIAG_TRAPPIST1_0015.gpuspec.0001.fil',
    note: 'Diagnostic GBT scan of TRAPPIST-1, the most-studied nearby exoplanet system. S-band, dense terrestrial RFI environment.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'frb121102-2017',
    target: {
      name: 'FRB 121102',
      raHours: 5.532,
      decDeg: 33.148,
      distanceLy: 3_000_000_000,
      note: 'First known repeating fast radio burst — host galaxy ~3 Gly away'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-08-26T13:51:45Z',
    band: 'C-band (~6.6 GHz)',
    approxBytes: 72_921 * 1024 * 1024,
    hintFreqStartMHz: 6500,
    hintFreqEndMHz: 6700,
    displayFrames: 256,
    displayChannels: 512,
    maxBytes: 64 * 1024 * 1024,
    upstreamUrl:
      'http://blpd0.ssl.berkeley.edu/frb-machine/spliced_guppi_57991_49905_DIAG_FRB121102_0011.gpuspec.0001.8.fil',
    note: 'A scan from the 2017 BL/GBT campaign that detected 21 new bursts. The repeater is the first FRB ever localized to a host galaxy.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'psr-j0332-2017',
    target: {
      name: 'PSR J0332+5434',
      raHours: 3.539,
      decDeg: 54.578,
      distanceLy: 3_290,
      note: 'Bright canonical pulsar (B0329+54), ~0.7 s period'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-08-26T13:42:00Z',
    band: 'C-band (~6.6 GHz)',
    approxBytes: 14 * 1024 * 1024,
    hintFreqStartMHz: 6500,
    hintFreqEndMHz: 6700,
    displayFrames: 192,
    displayChannels: 512,
    maxBytes: 14 * 1024 * 1024,
    upstreamUrl:
      'http://blpd5.ssl.berkeley.edu/FRB121102_2/BLP20/blc20_guppi_57991_49318_DIAG_PSR_J0332+5434_0008.gpuspec.0002.fil',
    note: 'Calibrator pulsar from the FRB 121102 follow-up campaign. Useful sanity check: a well-known natural transient in real data.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'hd109376-etz',
    target: {
      name: 'HD 109376',
      raHours: 12.578,
      decDeg: -1.475,
      distanceLy: 365,
      note: 'F-type giant — BL ETZ Carbon-band nearby-star survey'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-07-18T21:42:11Z',
    band: 'X-band (~9.2 GHz)',
    approxBytes: 67 * 1024 * 1024,
    hintFreqStartMHz: 9100,
    hintFreqEndMHz: 9300,
    displayFrames: 128,
    displayChannels: 512,
    maxBytes: 32 * 1024 * 1024,
    upstreamUrl:
      'http://blpd13.ssl.berkeley.edu/ETZ/AGBT17A_999_89/GUPPI/BLP00/blc00_guppi_57934_78131_HD_109376_0054.gpuspec.0002.fil',
    note: 'A nearby star scan from the BL "Earth Transit Zone" survey — targeting stars from which Earth would appear to transit the Sun.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'gj757-etz',
    target: {
      name: 'Gliese 757 (GJ 757)',
      raHours: 19.380,
      decDeg: 64.058,
      distanceLy: 81,
      note: 'Nearby K-dwarf, BL ETZ Carbon-band survey'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2017-07-25T03:09:15Z',
    band: 'X-band (~9.2 GHz)',
    approxBytes: 67 * 1024 * 1024,
    hintFreqStartMHz: 9100,
    hintFreqEndMHz: 9300,
    displayFrames: 128,
    displayChannels: 512,
    maxBytes: 32 * 1024 * 1024,
    upstreamUrl:
      'http://blpd13.ssl.berkeley.edu/ETZ/AGBT17A_999_92/GUPPI/BLP00/blc00_guppi_57941_13196_GJ_757_0063.gpuspec.0002.fil',
    note: 'Another BL ETZ survey pointing — see how the same classifier responds to a different nearby star observation.',
    attribution: ATTRIBUTION_BL
  },
  {
    id: 'gbt-test-ifs',
    target: {
      name: 'GBT test scan',
      raHours: 0,
      decDeg: 0,
      distanceLy: 0,
      note: 'Multi-IF SIGPROC test filterbank from the BL archive'
    },
    telescope: 'Green Bank Telescope',
    observedAt: '2016-01-01T00:00:00Z',
    band: 'Broadband test',
    approxBytes: 246 * 1024,
    hintFreqStartMHz: 1400.0,
    hintFreqEndMHz: 1500.0,
    displayFrames: 64,
    displayChannels: 256,
    maxBytes: 1 * 1024 * 1024,
    upstreamUrl: 'http://blpd0.ssl.berkeley.edu/Voyager_data/test_ifs.fil',
    note: 'Small (~246 KB) real SIGPROC filterbank — loads in well under a second, ideal for quick demos on slow connections.',
    attribution: ATTRIBUTION_BL
  }
];

/**
 * Build a `RealDataSource` descriptor from a catalog entry. Cloudflare Pages
 * can serve `/api/datafile` directly; static hosts such as GitHub Pages should
 * set `VITE_DATAFILE_PROXY_PATH` to an externally deployed range proxy.
 */
export function realDataSourceFor(entry: RealCatalogEntry): RealDataSource {
  const source: RemoteFilterbankSource = {
    kind: 'filterbank',
    upstreamUrl: entry.upstreamUrl,
    proxyPath: DATAFILE_PROXY_PATH,
    maxBytes: entry.maxBytes,
    totalFileBytes: entry.approxBytes,
    displayChannels: entry.displayChannels,
    displayFrames: entry.displayFrames,
    attribution: entry.attribution,
    note: entry.note
  };
  return source;
}
