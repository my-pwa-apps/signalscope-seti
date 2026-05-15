# SignalScope SETI

A modern, scientifically-restrained progressive web app inspired by the original
SETI@home idea: users voluntarily donate idle compute to analyze public radio-astronomy
datasets. The app downloads small **work units** —
[real Breakthrough Listen filterbank files](#real-telescope-data) from the
Berkeley SETI archive — analyzes them locally in a Web Worker, and falls back
to replaying previously cached real analyses from IndexedDB when offline. It
visualizes:

1. **What region of space** is being studied (3D immersive sky map).
2. **What frequency range** is being analyzed (waterfall + integrated spectrum).
3. **What the signal data looks like** (live, color-mapped waterfall).
4. **Whether any candidate signal was detected**, with a plain-English label
   (Noise · Likely terrestrial RFI · Interesting · Needs follow-up).
5. **How likely** it is to be natural, human-made, or worth a second look.

> SignalScope is an educational citizen-science prototype. It does not coordinate
> with any official SETI working group, and any candidate it reports is almost
> certainly instrumental, statistical, or terrestrial radio interference.

---

## Tech stack

- **React 18 + TypeScript + Vite** — fast dev loop, modern bundling.
- **Tailwind CSS** — dark, calm, mission-control aesthetic.
- **React Three Fiber + drei + Three.js** — immersive 3D space map.
- **Web Worker** (ES module worker) — all heavy DSP runs off the main thread.
- **WebGPU-ready** — the engine and worker are structured so a WebGPU FFT can be
  swapped in later (`src/workers/fft.ts`).
- **vite-plugin-pwa (Workbox)** — installable PWA with an offline-ready *application shell* and cached-replay path. Live archive streaming always requires network access, even from the installed PWA — only previously analyzed observations replay offline.
- **IndexedDB** — pre-decoded spectrograms of the last 5 analyses are cached
  natively-as-binary so the engine can keep running offline. Lightweight
  metadata (stats, candidate list, settings) still lives in `localStorage`.
- **Zustand** — small, ergonomic global store.
- **Cloudflare Pages** for hosting, **Cloudflare Pages Functions** as the
  optional `/api` backend (`functions/api/*`) — the `/api/datafile`
  range-proxy for Berkeley SETI archive bytes, plus optional Cloudflare
  Workers AI candidate triage at `/api/triage`.

The app is fully usable without any paid services.

---

## Run locally

```pwsh
# Node 20+ recommended (24 tested)
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173).

Useful scripts:

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check + production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run pages:dev` | Build, then serve `dist/` with Cloudflare Pages Functions and the `AI` binding |
| `npm run pages:deploy` | Build, then deploy `dist/` to the `signalscope-seti` Cloudflare Pages project |
| `npm run typecheck` | Strict TypeScript pass without emitting |

The build output works as a static site or as a Cloudflare Pages deployment.
Routing uses hash URLs so direct links work on GitHub Pages and other static
hosts without server rewrite support. The live archive feed still needs a
range proxy: Cloudflare Pages picks up `functions/api/datafile.ts`
automatically, while GitHub Pages builds should set `VITE_DATAFILE_PROXY_PATH`
to an externally deployed proxy URL.

### GitHub Pages publishing

This repository includes a GitHub Actions workflow at
[.github/workflows/deploy-github-pages.yml](.github/workflows/deploy-github-pages.yml).
Every push to `main` runs tests, builds the static PWA, and publishes `dist/`
to GitHub Pages.

GitHub Pages hosts the browser app only. Cloudflare Pages Functions are still
required for `/api/datafile` and `/api/triage`; on GitHub Pages the upload and
cached-replay paths work without those endpoints, while the live archive feed
and Workers AI triage need `VITE_DATAFILE_PROXY_PATH` and `VITE_AI_TRIAGE_PATH`
pointing at an externally reachable backend.

**Cloudflare Pages is the canonical hardened production host.** The HTTP
security headers in [public/_headers](public/_headers)
(`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`,
`Permissions-Policy`) are honored by Cloudflare but **not** by GitHub Pages.
The app also ships a `<meta http-equiv="Content-Security-Policy">` shim in
[index.html](index.html) so the GitHub Pages mirror still gets a CSP and a
meta-referrer policy applied at the document level. Treat the GitHub Pages
build as a mirror; advertise the Cloudflare URL as production.

---

## How the analysis works

`src/workers/analysis.worker.ts` is a Web Worker that takes a `WorkUnit`,
materializes a spectrogram, and runs a deliberately simple
**turboSETI-style** narrowband detector:

1. **Acquire the spectrogram.** Three real-data paths are wired in — there
   is no synthetic / mock path anymore:
   - **Live archive feed** (default, requires deployment to Cloudflare Pages
     or `wrangler pages dev`): stream a public Breakthrough Listen SIGPROC
     `.fil` filterbank file through the `/api/datafile` proxy (see
     [Real telescope data](#real-telescope-data)), parse the header in the
     worker, decode the requested time window(s), and average-pool down to
     the UI's display resolution.
   - **User upload**: a SIGPROC `.fil` picked from disk by the user. The
     file is read in-place via `Blob.slice(...).arrayBuffer()` — nothing is
     uploaded to any server.
   - **Cached replay** (offline fallback): an earlier analysis read straight
     out of IndexedDB. Used when the network is unavailable so the engine
     still has *real* data to work with instead of fabricated noise. See
     [Offline cached replay](#offline-cached-replay).
2. **Stream rows back** to the UI in batches via `postMessage` so the live
   waterfall fills in progressively. The resource profile
   (Eco / Balanced / Maximum) controls batch size and inserted micro-sleeps,
   so the slider really does change CPU load.
3. **Integrate over time** to produce a per-channel mean spectrum.
4. **Robust noise floor** = median of per-channel medians.
   Threshold = `median + 4·σ(MAD)`.
5. **Local maxima** above threshold become candidate channels.
   Adjacent channels are grouped.
6. **Drift estimation**: for each candidate, the per-frame peak position is
   tracked across ±5 channels and a linear regression gives the drift slope.
7. **Classification** (no AI, all explicit rules):
   - Stationary + wide → `likely-rfi`
   - Wide horizontal sweep → `likely-rfi`
   - Narrow, high-SNR, with drift → `interesting` or `needs-followup`
   - Marginal excursions → `noise`
8. **Result** is posted back to the main thread along with the final
   spectrogram (transferred via `ArrayBuffer` ownership, zero copy).

AI is intentionally **not** in the deterministic detector loop. On the Findings
page, users can optionally run Cloudflare Workers AI triage after candidates
exist. That request sends compact candidate metadata only — frequency, drift,
SNR, duration, recurrence, provenance, and the rule-based label — and stores the
returned advisory assessment beside the candidate. Raw `.fil` bytes and full
spectrogram tensors are never sent to the AI endpoint.

`src/workers/fft.ts` ships a small Cooley–Tukey radix-2 FFT. It is exercised on
every run so the code path stays warm and so a future adapter that ingests raw
GUPPI voltage chunks can drop in without any UI changes.

---

## Real telescope data

The app can analyze **actual Breakthrough Listen / Berkeley SETI observations**
end-to-end in the browser. The Dashboard → Data source card surfaces two
real-data inputs:

| Mode | Source | Use case |
| --- | --- | --- |
| **Live archive feed** | Streams `.fil` filterbank files from Berkeley's public archive | Genuine science — Voyager 1, Oumuamua, TRAPPIST-1, FRB 121102, pulsars |
| **Upload your own .fil** | A SIGPROC filterbank you already have on disk | Amateur radio-astronomy second-opinion runs, archive re-analysis |

There is **no demo / synthetic mode** — every analysis is on real bytes. If
the network is unavailable, the app falls back to replaying a previously
cached real analysis from IndexedDB rather than fabricating data; see
[Offline cached replay](#offline-cached-replay).

### Curated catalog (`src/data/realCatalog.ts`)

Every URL has been live-probed against the Berkeley SETI archive (HEAD with
`Accept-Ranges: bytes`) before being committed. The catalog covers
scientifically meaningful targets across the four flagship categories of
modern radio SETI / fast-transient astronomy: an artificial calibrator
(Voyager 1), interstellar interlopers (Oumuamua + OFF), exoplanet hosts
(TRAPPIST-1, HD 109376, GJ 757), a repeating fast radio burst (FRB 121102),
a textbook pulsar (PSR J0332+5434), and a tiny test file.

| Entry | Telescope | Band | Size | Why it's interesting |
| --- | --- | --- | --- | --- |
| `voyager1-2020` | GBT | X-band (~8.4 GHz) | ~65 MB | The canonical *real* narrowband detection — Voyager 1's downlink carrier near 8420 MHz, the textbook artificial Doppler-drift signature. |
| `oumuamua-on` | GBT | S-band (~2.4 GHz) | ~558 MB (range) | 2017 Breakthrough Listen observation of 1I/'Oumuamua, the first known interstellar object. ON-source. |
| `oumuamua-off` | GBT | S-band (~2.4 GHz) | ~558 MB (range) | Matched OFF-source baseline ~2° away — pair this with `oumuamua-on` to do a real ON/OFF differential. |
| `trappist1-2017` | GBT | S-band (~2.16 GHz) | ~334 MB | TRAPPIST-1 — the seven Earth-sized planets, three in the habitable zone. A top SETI target. |
| `frb121102-2017` | GBT | C-band (~6.6 GHz) | range-fetched | The first known repeating fast radio burst. Underlying file is huge (72 GB) but we only fetch a slab via HTTP Range. |
| `psr-j0332-2017` | GBT | C-band (~6.6 GHz) | ~14 MB | PSR B0329+54 / J0332+5434 — bright pulsar used as a calibration sanity check; pulses should show up as periodic broadband stripes. |
| `hd109376-etz` | GBT | X-band (~9.2 GHz) | ~67 MB | Breakthrough Listen ETZ (Earth Transit Zone) survey — these are stars from whose vantage point Earth would transit the Sun. |
| `gj757-etz` | GBT | X-band (~9.2 GHz) | ~67 MB | Another ETZ candidate. Same survey strategy, different host star. |
| `gbt-test-ifs` | GBT | Broadband test | ~246 KB | Tiny SIGPROC filterbank that loads in well under a second, ideal for first-impression demos. |

Adding more entries is a one-file change: append to `REAL_CATALOG` in
[src/data/realCatalog.ts](src/data/realCatalog.ts). The easiest way to find
new URLs is the
[**Berkeley SETI Open Data query API**](http://seti.berkeley.edu/opendata):

```pwsh
# Returns JSON listing every filterbank for a target, with verified URLs
Invoke-RestMethod 'http://seti.berkeley.edu/opendata/api/query-files?target=TRAPPIST-1&file-types=filterbank&limit=5'
```

No other code edits are required when adding an entry.

### How the real-data path works

```
┌────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│  Browser   │──→──│ /api/datafile (proxy) │──→──│ blpd0.ssl.berkeley… │
│  (worker)  │      │  host allowlist +     │      │  Voyager_data/.fil  │
│            │←──── │  HTTP Range bytes     │←──── │  (raw filterbank)   │
└────────────┘      └──────────────────────┘      └─────────────────────┘
       │
       ├─ parse SIGPROC header (8 KB Range fetch)
       ├─ small file (≤ 4× budget):
       │    └─ fetch one contiguous data slab sized to `maxBytes`
       ├─ huge file (> 4× budget, e.g. FRB121102 @ 72 GB):
       │    └─ fetch N (2-8) smaller slabs spread *uniformly* across the
       │       file → see “Chunked analysis of very large files” below
       ├─ decode nbits=8/16/32 to Float32Array
       ├─ average-pool to displayChannels × displayFrames
       └─ run the same detector as the upload + cached-replay paths
```

### Chunked analysis of very large files

The Berkeley SETI archive contains files at every scale — from a 246 KB
calibration filterbank to the 72 GB FRB 121102 capture. A naive “fetch
`maxBytes` from offset 0” strategy would mean the FRB 121102 entry only ever
analyzes the *first ~30 MB* of a multi-hour observation, missing everything
that happened after the first few seconds.

When the worker sees a file whose total size is more than **4×** its
per-unit byte budget, it switches to a multi-window read:

```
file:   [────────────────────── 72 GB ──────────────────────]
            ↑       ↑       ↑       ↑       ↑       ↑
            slab 0  slab 1  slab 2  slab 3  slab 4  slab 5
            ↑ each slab is ≤ maxBytes/N, snapped to a row boundary
            ↑ slabs are decoded independently and concatenated frame-wise
```

- **N is auto-chosen** between 2 and 8 based on `log2(fileSize / maxBytes)`.
- Each slab is range-fetched (`HTTP Range`) so the network only pays for the
  bytes we actually decode, even for tens-of-GB files.
- Each slab is decoded → decimated to `displayFrames / N` rows, then
  concatenated frame-wise into the live waterfall.
- The number of windows is shown in the live page as a “*N*-window sample”
  badge, and recorded in the manifest of any exported findings bundle.
- Because the time gaps *between* slabs are dropped from the row count, the
  drift estimator within a single slab is still meaningful, but **drifts
  that span slab boundaries are not reconstructed**. This is documented in
  the findings-bundle manifest.

The same logic applies to large uploaded `.fil` files: when a user’s upload
exceeds 4× the upload budget the file is sliced into multiple windows via
`Blob.slice(...).arrayBuffer()` — still no network traffic.

### Cross-chunk dataset memory

A real persistent SETI transmitter would show up across **multiple** chunk
analyses of the same observation, not just the one window that happened to
contain it on the first pass. Chunked analysis on its own can't see that,
because each chunk is decoded and classified in isolation. SignalScope
addresses this with a small per-dataset memory layer.

- **Stable `datasetId`.** Every `WorkUnit` carries an id that uniquely
  identifies the underlying file across runs:
  - Remote archive: `BL-OPENDATA/<catalog-id>` (e.g. `BL-OPENDATA/voyager1-2020`)
  - Upload: `LOCAL/<file-name>@<file-size>` (size disambiguates same-name
    files with different contents)
  - Cached replay: carries the original id forward
- **Coverage tracking.** After every analysis the worker reports which
  data-section byte offsets it actually decoded (`chunkOffsets`,
  `chunkSpanBytes`). The engine writes these into a separate IndexedDB
  database (`signalscope-datasets`) keyed by `datasetId`, capped at 200
  chunks and 500 candidate hits per dataset, oldest first when pruning.
- **Unexplored-region biasing.** Before dispatching a new unit, the engine
  reads the prior offsets and passes them to the worker as
  `previousChunkOffsets`. The worker then picks its N chunk offsets with a
  greedy max-min-distance pick over a 64-point uniform candidate grid, so
  repeated runs of the same dataset cover **new** regions of huge files
  rather than always re-reading the same windows.
- **Recurrence annotation.** When a fresh analysis completes, every
  candidate's frequency is checked against the dataset's candidate
  history within a tolerance of `max(2 × channel-bandwidth, 100 Hz)`.
  Each candidate gets a `recurrenceCount` reflecting how many prior chunks
  flagged the same frequency. The Findings page renders an amber
  *"Seen N× in this dataset"* pill next to any candidate with
  `recurrenceCount > 0`, and a Dataset-coverage card on top of the page
  shows total bytes covered + prior-candidate count for the current unit's
  dataset.
- **Best-effort, not exact.** Drift across chunk boundaries is *not*
  reconstructed; the recurrence detector only looks at frequency, not at
  drift continuity. A genuinely drifting source whose carrier sweeps out
  of one chunk and back into another at a different bin will still light
  up two recurrence counts, but the drift-rate values themselves are only
  meaningful within a single chunk. This is documented in the export
  bundle's `README.txt`.
- **Cached replays don't inflate recurrence.** `recordChunkAnalysis` skips
  units with `dataSource.kind === 'cached-decoded'` so re-running a cached
  analysis doesn't double-count its own candidates.
- **Per-dataset, not global.** Cross-dataset recurrence would mostly
  surface earth-bound RFI carriers at common frequencies (FM broadcast,
  WiFi, GPS), which is the opposite of useful. Memory is scoped to one
  `datasetId` at a time.

### Offline cached replay

Every completed analysis is persisted to **IndexedDB** so the app has real
data to keep working on when the network drops:

- The cache is keyed by work-unit id, stores the decoded `Float32Array`
  spectrogram + classifier result + work-unit metadata, and is pruned to
  the **5 most recent** entries.
- IndexedDB is used (not `localStorage`) because spectrograms are several
  megabytes — well above the ~5 MB `localStorage` quota — and IndexedDB
  stores binary data natively without base64 inflation.
- Uploaded-file blobs are stripped from the cached entry. The decoded
  spectrogram is preserved, but the original `File` cannot be re-read
  after a page reload anyway, so we replace the source with
  `LOCAL/<filename>` and skip re-decoding.

The Dashboard surfaces a “Replay cached observation” button whenever cached
analyses exist, and the button auto-highlights when `navigator.onLine` goes
false. Cached replay never touches the network — the `cached-decoded` branch
of the worker bypasses `fetchAndDecodeFilterbank` entirely and feeds the
classifier directly from the cached buffer.

### Sharing findings with researchers

The Live Analysis page and the Findings page both expose an **Export
findings** button that produces a self-contained `.zip` bundle:

| File | Contents |
| --- | --- |
| `<target>.dat` | A turbo_seti-compatible candidate table (the same column layout produced by `turbo_seti.find_doppler.findopp`). Researchers can ingest it with any pipeline that already understands turbo_seti `.dat` files. |
| `manifest.json` | Full provenance: source URL or `LOCAL/<filename>`, telescope, observation MJD, dataset id, chunk offsets / spans, classifier version, and the raw candidate list with labels, scores, and recurrence counts. |
| `README.txt` | Plain-English description of what the bundle is, what the limitations are, and where to send it. |

If Cloudflare AI triage was run, each triaged candidate in `manifest.json` also
includes `ai_assessment` with the provider, model, prompt version, advisory
label, confidence, rationale, and recommended action. This is exported as
context only; it is not scientific confirmation.

```
signalscope-trappist1-2017-20251114T093047.zip
├── TRAPPIST-1.dat       # turbo_seti format
├── manifest.json        # provenance + raw candidates
└── README.txt
```

**There is currently no public Berkeley SETI endpoint for accepting
third-party hits.** The README inside the bundle is honest about that and
points researchers at:

- the [turbo_seti GitHub repo](https://github.com/UCBerkeleySETI/turbo_seti)
  for ingesting the `.dat` into a standard pipeline,
- the [Berkeley SETI contact form](https://seti.berkeley.edu/listen/contact)
  for direct correspondence,
- and the user’s own group / observatory.

The bundle’s on-disk format is exactly what a radio astronomer would
expect from a turbo_seti run, so there’s no friction for them to load it
into their existing tooling.

The Cloudflare Pages Function [functions/api/datafile.ts](functions/api/datafile.ts)
is a deliberately small **range-proxy with a host allowlist**. It only forwards
GET requests to a fixed list of Berkeley / Breakthrough Listen hosts and never
echoes arbitrary URLs, so the proxy cannot be used as an open relay. CORS
headers + `Range` / `Content-Range` are added so the browser can request just
the byte ranges it needs.

The optional Cloudflare Workers AI endpoint lives in
[functions/api/triage.ts](functions/api/triage.ts). It requires a Cloudflare AI
binding named `AI`. The repository includes this Wrangler configuration:

```toml
name = "signalscope-seti"
compatibility_date = "2024-09-01"
pages_build_output_dir = "dist"

[ai]
binding = "AI"
remote = true

[vars]
CLOUDFLARE_AI_MODEL = "@cf/meta/llama-3.1-8b-instruct"
```

You can override the default model with the Pages/Worker env var
`CLOUDFLARE_AI_MODEL`. On static-only hosts, deploy that endpoint as a separate
Worker and build the app with `VITE_AI_TRIAGE_PATH` pointing at it.

The SIGPROC filterbank parser lives in
[src/data/filterbankParser.ts](src/data/filterbankParser.ts). It is a strict
parser of the standard SIGPROC keyword stream (HEADER_START … HEADER_END) and
throws on unknown keywords rather than guessing, so it will never silently
misinterpret a future archive's data format.

### Running the real-data path locally

`vite dev` does **not** serve the `/api/datafile` Pages Function, so the
real-data path only works when:

```pwsh
# build first, then serve dist/ + the Pages Functions
npm run build
npm run pages:dev -- --port 8788
# open http://127.0.0.1:8788
```

Or, of course, when deployed to Cloudflare Pages — the function is picked up
automatically by the Pages build pipeline.

For GitHub Pages or another static-only host, deploy the range proxy separately
and build with:

```pwsh
$env:VITE_DATAFILE_PROXY_PATH = 'https://your-proxy.example.com/api/datafile'
$env:VITE_AI_TRIAGE_PATH = 'https://your-worker.example.com/api/triage'
npm run build
```

If that variable is omitted, the app assumes the proxy is available at
`/api/datafile`, which is correct for Cloudflare Pages but not for GitHub
Pages. The AI triage path similarly defaults to `/api/triage`.

### Production deployment

This repository is configured for the Cloudflare Pages project
`signalscope-seti`.

- Production URL: `https://signalscope-seti.pages.dev`
- Deploy command: `npm run pages:deploy`
- Local Cloudflare Pages smoke test: `npm run pages:dev -- --port 8788`
- Deployment list: `npx wrangler pages deployment list --project-name signalscope-seti`

The deploy script always runs a fresh production build before uploading `dist/`,
so stale local build artifacts are not deployed by accident. The Pages Function
environment is configured through [wrangler.toml](wrangler.toml), including the
Workers AI binding named `AI`.

#### Custom domain (recommended)

Some corporate / older networks cannot complete a TLS handshake to
`*.pages.dev` (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`) because Cloudflare's
edge cipher suite for `*.pages.dev` is more aggressive than legacy TLS
libraries support. If you hit this from your workstation, attach a custom
domain to the Cloudflare Pages project: the custom-domain edge uses the
standard Cloudflare TLS profile and works on all modern browsers and most
legacy ones. Steps:

1. Cloudflare dashboard → *Pages → signalscope-seti → Custom domains → Set up a custom domain.*
2. Add a CNAME in your DNS provider pointing to `signalscope-seti.pages.dev`.
3. Wait for the SSL certificate to provision (typically <5 minutes), then update
   `VITE_DATAFILE_PROXY_PATH` and `VITE_AI_TRIAGE_PATH` in the GitHub Pages
   workflow to point at the new domain.

### Attribution

Real data is hosted by the
[**Berkeley SETI Research Center** under the **Breakthrough Listen Open Data
program**](https://seti.berkeley.edu/opendata) — the same lab that ran
SETI@home from 1999 until its hibernation in 2020. We fetch and analyze, we
don't redistribute. The on-screen waterfall + candidate table always shows the
upstream attribution alongside the analysis.

SETI@home itself is in long-term hibernation as of March 2020 and the BOINC
project no longer dispatches work units; this app is *inspired by* that
project's spirit of distributed volunteer compute rather than a continuation
of it.

---

## Bring your own data — amateur radio astronomy & second-opinion runs

The third option on the Data Source card is **"Upload your own .fil"**. It is
aimed at:

- **Amateur radio astronomers** with their own dish + software-defined radio
  who already produce SIGPROC filterbank captures (e.g. via GNU Radio,
  `digital_rf`, `gr-pulsar`, `dspsr`) and want a quick visual + classifier
  pass on a recording before doing a deeper analysis.
- **Researchers and students** who want a **second opinion** on an archived
  capture — does the same simple narrowband + drift detector flag the same
  candidate channels? Does the waterfall look the way they expect?
- **Educators** demonstrating what a real `.fil` file actually contains, on
  a recording they trust.

### What happens to the file

**Nothing leaves your device.** The file is read with
`Blob.slice(offset, length).arrayBuffer()` directly inside the Web Worker.
The same SIGPROC header parser, the same decoder, and the same detector are
used for uploaded files as for Breakthrough Listen data — the *only*
difference is where the bytes come from:

```
┌─────────────────┐
│  Your .fil file │  (picked by <input type="file">, never uploaded)
└────────┬────────┘
         │  Blob.slice(...).arrayBuffer()
         ▼
┌─────────────────┐    same path as real-data mode from here on
│ Worker: parse → │
│ decode → pool → │
│ detector       │
└─────────────────┘
```

No server is contacted. The Cloudflare Pages Function is not used. The file
is not retained between sessions — refresh the page and you'd need to pick it
again. There is a 32 MiB analysis budget per upload (we slice a representative
window if the file is larger), which keeps memory and decode time bounded.

### What format is expected

The standard **SIGPROC filterbank** (`.fil`) format: an ASCII keyword stream
(`HEADER_START` … `HEADER_END`) followed by raw `nbits = 8`, `16`, or `32`
samples in time-major order. This is what `dspsr`, `digifil`, the GBT/Parkes
backends, and most amateur pulsar-search tools produce. If your tool emits
PSRFITS / HDF5 you can convert with `digifil -f sigproc input.psrfits`.

If a header field is unrecognized the parser will throw rather than guess —
that's deliberate so we don't silently misinterpret your data.

---

## Adding more real datasets

The plumbing for real data is already in place — the detector treats one work
unit at a time, the worker is wired for SIGPROC filterbank fetches, and the
Cloudflare Pages Function proxies through a host allowlist. To extend the
catalog or add new shapes of data:

1. **Add a catalog entry.** Append to `REAL_CATALOG` in
   [src/data/realCatalog.ts](src/data/realCatalog.ts). Set `upstreamUrl` to a
   public Berkeley SETI / Breakthrough Listen `.fil` file and pick
   `displayChannels` / `displayFrames` / `maxBytes` for how much you want the
   browser to download per unit. No other code changes are required.
2. **Allowlist a new host.** Edit `ALLOWED_HOSTS` in
   [functions/api/datafile.ts](functions/api/datafile.ts) if you want to fetch
   from a host that isn't already listed (`blpd*.ssl.berkeley.edu`,
   `bldata.berkeley.edu`, `seti.berkeley.edu`,
   `breakthroughinitiatives.org`, `storage.googleapis.com`).
3. **Stand up a coordinator** (optional). For multi-user coordination, deploy
  a separate Worker/service that hands out `WorkUnit` descriptors, accepts
  `AnalysisResult` payloads for cross-validation, and aggregates dashboard
  counters. The current app is intentionally local-first and does not ship
  coordinator stubs.
4. **Add a new decoder.** For HDF5 (`.h5`) BL files or GUPPI raw voltage
   captures, add a new `RealDataSource.kind` to
   [src/types/domain.ts](src/types/domain.ts) and branch in
   [src/workers/analysis.worker.ts](src/workers/analysis.worker.ts). The
   detector stays unchanged — it always operates on `frames × channels`
   Float32Array.
5. **Optional: WebGPU FFT.** Replace the in-worker FFT call with a WebGPU
   compute shader for raw voltage paths. The dispatcher is already on a
   worker, so this is a contained swap.

---

## Privacy and ethics

- All analysis runs **locally** in your browser, on your CPU.
- Nothing is uploaded automatically. Exporting a findings bundle is a manual
  browser download; sharing it with a researcher is up to the user.
- The app collects **no personal data**, no tracking, no third-party analytics.
- It is **not** an alien-detection app. Every UI surface that mentions
  candidate signals also explains why a candidate is not a discovery.

---

## Limitations and scientific disclaimers

- The bundled detector is intentionally simplified for clarity and education.
  Production SETI pipelines (turboSETI, the `seti-net` family) use more
  sophisticated cadence-based filtering, frequency-resolution stacking, and
  cross-antenna coincidence tests that this app does **not** implement.
- "Compute" numbers, "volunteers online" numbers, and the work-unit queue are
  illustrative until a real coordinator is connected.
- The 3D space map uses approximate star positions and is for visualization
  only. No real telescope is being pointed by this app.
- Berkeley SETI does not currently accept automated uploads of third-party
  hits. The findings-bundle export produces a turbo_seti-compatible `.dat`
  + JSON manifest researchers can ingest manually.

---

## Project layout

```
├── functions/api/        # Cloudflare Pages Functions
│   ├── datafile.ts       #   range-proxy for Berkeley SETI public archive
│   └── triage.ts         #   optional Cloudflare Workers AI advisory triage
├── public/               # Static assets, PWA icons, favicon
├── src/
│   ├── components/       # UI primitives, layout, visualizations
│   │   ├── layout/       # Sidebar, top bar, mobile nav
│   │   ├── space/        # SpaceMap (R3F)
│   │   ├── ui/           # Cards, buttons, pills, meters, sliders
│   │   └── viz/          # Waterfall + integrated-spectrum canvases
│   ├── data/             # Catalogs + decoders
│   │   ├── realCatalog.ts        # Curated public BL filterbank files
│   │   ├── filterbankParser.ts   # SIGPROC .fil header + data decoder
│   │   ├── spectrogramCache.ts   # IndexedDB cache for offline replay
│   │   ├── findingsExport.ts     # turbo_seti .dat + zip bundle writer
│   │   └── skyTargets.ts         # 3D space-map visualization catalog
│   ├── engine/           # Work client, zustand store, engine loop
│   ├── pages/            # Dashboard, LiveAnalysis, SpaceMapPage, Findings, Learn
│   ├── types/            # Core domain types
│   ├── utils/            # Formatting, coords, color LUT
│   └── workers/          # Analysis worker, FFT
├── index.html
├── tailwind.config.ts
├── vite.config.ts
└── package.json
```

---

## License

Code: MIT.
Real radio data inherits its upstream license — propagate
the `license` field on every `WorkUnit`.
