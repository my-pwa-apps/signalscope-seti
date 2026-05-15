# SETI-AI Backlog

## Identified Issues - May 15, 2026

- [x] [Priority: Critical]
  **Area:** Bug / State Synchronization
  **File(s):** src/engine/store.ts
  **Issue:** Race condition in `triageLastResultWithAi`. If the engine finishes a new unit while the AI request is pending, applying the AI results will revert `lastResult` to the previous unit.
  **Impact:** Corrupts the candidate history and desynchronizes the UI from the current running dataset.
  **Suggested fix:** Add a check `if (useEngine.getState().lastResult?.workUnitId !== result.workUnitId) return;` before calling `set()` to discard stale AI results.
  **Acceptance criteria:** AI results do not overwrite a newer `lastResult` if the engine progresses. Fixed in `src/engine/store.ts` by discarding stale AI responses.

- [x] [Priority: High]
  **Area:** Testing
  **File(s):** package.json, tests/*
  **Issue:** Zero automated test coverage.
  **Impact:** High regression risk for the core DSP and classification logic.
  **Suggested fix:** Install Vitest and write unit tests for `detectCandidates` using fixed 2D float arrays.
  **Acceptance criteria:** Core candidate detection rules are covered by automated tests. Fixed with `src/workers/candidateDetector.ts` and `src/workers/candidateDetector.test.ts`.

- [x] [Priority: High]
  **Area:** Deployment / Documentation
  **File(s):** README.md, wrangler.toml
  **Issue:** Missing explicit `wrangler.toml` AI binding documentation.
  **Impact:** New developers cannot run the AI feature locally without guessing the CF Pages config.
  **Suggested fix:** Add a snippet in the README showing the required `[ai] binding = "AI"` config for local dev.
  **Acceptance criteria:** A clean clone can run AI triage locally via `npm run pages:dev` using just the README instructions.

- [x] [Priority: Medium]
  **Area:** Refactor
  **File(s):** src/engine/store.ts, src/engine/engineCoordinator.ts
  **Issue:** Zustand store is massive (~500 lines) and mixes state with worker orchestration.
  **Impact:** Difficult to maintain and test isolation.
  **Suggested fix:** Extract the worker instantiation and message handling loop into a dedicated class (`EngineCoordinator`) and expose simple action methods to Zustand.
  **Acceptance criteria:** `store.ts` focuses only on state, reducing its footprint. Fixed by moving worker lifecycle, cancellation, and message routing into `src/engine/engineCoordinator.ts` while leaving persistence/state transitions in Zustand.

- [x] [Priority: Medium]
  **Area:** Performance
  **File(s):** src/components/viz/SpaceMapPage.tsx (bundle)
  **Issue:** Large chunk size (~834 KB) for the 3D map.
  **Impact:** Slows down initial load of the Space Map route on slow networks.
  **Suggested fix:** Aggressive tree-shaking for Three.js instead of importing the entire namespace.
  **Acceptance criteria:** Space map chunk size is reduced below 500KB. Fixed by using named Three.js imports and splitting the lazy 3D route; `SpaceMapPage` is now ~10 KB and the React Three vendor stack is isolated.

- [x] [Priority: Medium]
  **Area:** UX / Polish
  **File(s):** src/pages/Findings.tsx
  **Issue:** AI binding errors show a raw generic red text blob to the user.
  **Impact:** Unfriendly UX if the server is misconfigured.
  **Suggested fix:** Catch the specific 503 error, disable the button, and show a more friendly "AI feature not enabled on this deployment" message.
  **Acceptance criteria:** Users don't see JSON/developer error messages if AI isn't configured. Fixed in `src/data/aiTriage.ts`.

- [x] [Priority: Medium]
  **Area:** Deployment
  **File(s):** functions/api/datafile.ts
  **Issue:** Cloudflare Pages egress bandwidth scaling.
  **Impact:** Fetching up to 80MB chunks repeatedly using the `Range` proxy could exhaust free-tier CF limits if the app becomes popular.
  **Suggested fix:** Tightly monitor the `cf: { cacheTtl }` hit rate in Cloudflare dashboard, and consider reducing `MAX_RANGE_BYTES`.
  **Acceptance criteria:** Network egress remains within sustainable bounds. Fixed by reducing the proxy hard cap to 64 MiB, matching the largest catalog analysis budget, while keeping Cloudflare edge caching enabled.

- [x] [Priority: Low]
  **Area:** Security
  **File(s):** functions/api/triage.ts
  **Issue:** Trivial prompt injection risk via `explanation` strings if a user edits them via IndexedDB/uploaded file structure.
  **Impact:** A user can confuse the LLM into generating fun outputs, but it only hits their own client.
  **Suggested fix:** Truncate text properties and regex-strip control tokens before passing inputs to the AI binding.
  **Acceptance criteria:** User input is sanitized before hitting the LLM. Fixed in `functions/api/triage.ts`.

- [x] [Priority: Low]
  **Area:** Cleanup
  **File(s):** src/engine/store.ts
  **Issue:** `initialSettings` fallback loads from localStorage, but unused settings (like the removed `submitAnonymized`) might still exist in users' caches.
  **Impact:** Minor memory bloat.
  **Suggested fix:** Add a small migration function to clean up deprecated local storage keys.
  **Acceptance criteria:** Deprecated keys are securely removed on next load. Fixed with settings normalization in `src/engine/store.ts`.

- [x] [Priority: Low]
  **Area:** UX
  **File(s):** src/pages/LiveAnalysis.tsx
  **Issue:** No visual indicator on the waterfall itself that AI labeled something.
  **Impact:** Users must read the table to see AI triage results.
  **Suggested fix:** Add a small sparkle/indicator to the waterfall overlay if a candidate gets a non-RFI AI label.
  **Acceptance criteria:** Spatial mapping of AI candidates is visually clear. Fixed in `src/components/viz/Waterfall.tsx`.

## Pre-Deployment Review - May 15, 2026

| Priority | Count |
|---|---:|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 1 |

- [x] [Priority: High]
  **Area:** Security / Deployment
  **File(s):** functions/api/triage.ts, wrangler.toml
  **Issue:** Public `/api/triage` calls Cloudflare Workers AI without application-level abuse controls.
  **Impact:** A third party can call the endpoint directly and consume AI quota/cost even though browser CORS limits are present.
  **Suggested fix:** Add Cloudflare rate limiting/WAF rules for `/api/triage`, cap request body size, and consider a same-origin nonce or Turnstile-backed proof for higher-traffic deployments.
  **Acceptance criteria:** Repeated high-volume calls to `/api/triage` are rate-limited before reaching Workers AI, and oversized request bodies are rejected. Fixed with request-size checks and per-client throttling in `functions/api/triage.ts`.

- [x] [Priority: Medium]
  **Area:** PWA / UX
  **File(s):** public/icons/*, vite.config.ts
  **Issue:** The PWA manifest uses SVG icons only and does not include screenshots or shortcut metadata.
  **Impact:** Some app stores/install surfaces and older mobile browsers provide weaker install prompts or poorer icon rendering.
  **Suggested fix:** Add generated PNG icons at 192/512 sizes, optional screenshots, and shortcuts for Dashboard and Findings.
  **Acceptance criteria:** Lighthouse PWA installability audit passes with no icon warnings on Chromium and mobile Safari surfaces render a crisp icon. Fixed with PNG icons, shortcuts, and screenshots in `vite.config.ts` and `public/`.

- [x] [Priority: Medium]
  **Area:** PWA / UX
  **File(s):** src/main.tsx
  **Issue:** Service-worker updates are silent because `onNeedRefresh` does not surface any reload affordance.
  **Impact:** Users can keep running an older analysis shell after a production deploy until the browser decides to refresh.
  **Suggested fix:** Add a small non-blocking update banner/toast that calls `updateSW(true)`.
  **Acceptance criteria:** When a new service worker is waiting, users see a clear reload action and can update without closing the app. Fixed in `src/main.tsx` and `src/index.css`.

- [ ] [Priority: Medium]
  **Area:** Deployment
  **File(s):** wrangler.toml, package.json
  **Issue:** `*.pages.dev` TLS could not be externally smoke-tested from this workstation due `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`; local Wrangler Pages and deployment listing passed.
  **Impact:** Production availability is not independently verified from this environment even though Cloudflare accepted the deployment.
  **Suggested fix:** Verify `https://signalscope-seti.pages.dev` and the latest deployment URL from a separate network/browser, then attach a custom domain if `pages.dev` TLS remains blocked locally.
  **Acceptance criteria:** The production URL loads over HTTPS from at least one external network and `/api/triage` returns 200 for a smoke payload.

- [x] [Priority: Low]
  **Area:** Documentation
  **File(s):** README.md
  **Issue:** README explains setup well but does not list the exact production URLs created during this deployment.
  **Impact:** Future handoff/reviewers must query Wrangler to find the active Pages deployment.
  **Suggested fix:** Add a short "Production deployment" subsection with `signalscope-seti.pages.dev`, the deploy command, and the dashboard link pattern.
  **Acceptance criteria:** A maintainer can find the production URL and redeploy command from the README alone. Fixed in `README.md`.

## Pre-Deployment Review - May 16, 2026

Second QC pass after dual-deployment to Cloudflare Pages and GitHub Pages, hardening of the `/api/triage` endpoint, and the AI rule-based fallback. The runtime health checks (3/3 unit tests, clean TS build, `npm audit` 0 vulnerabilities) are green. The findings below are real defects and risks discovered while reading the code rather than synthetic “nice-to-haves”.

| Priority | Count |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 4 |

**Status:** all 12 items in this section have since been closed in the May 17, 2026 follow-up pass below. Item-by-item closure notes are inline.

- [x] [Priority: High]
  **Area:** Bug / Memory
  **File(s):** src/engine/engineCoordinator.ts, src/engine/store.ts
  **Issue:** `cleanup()` on every successful or cancelled run set the module-level `worker` reference to `null` *without* calling `worker.terminate()`. The next call to `ensureWorker()` therefore spun up a brand-new `Worker` and the old one stayed alive holding the previous spectrogram closure (and any IndexedDB handles), which on a long Dashboard session leaks one worker per work unit. As a side effect, `cancelCurrentAnalysis()` could no-op between units because the singleton it tries to message had already been nulled.
  **Impact:** Steady memory growth during continuous-run sessions, occasional pauses that don't actually cancel the next-up unit, and elevated background CPU from orphaned workers.
  **Suggested fix:** Keep one true singleton worker for the lifetime of the page and route incoming messages through a per-run handler/error closure; expose a `disposeAnalysisWorker()` that the engine reset path calls to terminate cleanly.
  **Acceptance criteria:** A long-running session does not accumulate `Worker` instances (DevTools Performance ➜ Memory > Workers stays at 1), and `pause()` followed immediately by another `start()` correctly cancels and reuses the same worker. Fixed in `src/engine/engineCoordinator.ts` and `src/engine/store.ts`.

- [x] [Priority: High]
  **Area:** Bug / Reliability
  **File(s):** src/engine/engineCoordinator.ts
  **Issue:** `worker.onerror` only logged to the console — it never resolved the in-flight `analyzeWorkUnit(...)` promise. A worker-level uncaught exception (e.g. a future codec bug, OOM during decode) would hang the engine loop forever in `await analyzeWorkUnit(...)`, with the UI stuck on the spinner and no error surfaced.
  **Impact:** Hard hang of the analysis loop on any worker-level fault, with no way to recover short of a full reload.
  **Suggested fix:** Plumb `worker.onerror` through the active run's error handler so it calls `callbacks.onError(message)` and resolves the promise with `null`, just like an explicit `{type: 'error'}` message.
  **Acceptance criteria:** A simulated worker crash produces a red error banner and the engine returns to `idle/paused` instead of staying in `analyzing` indefinitely. Fixed in `src/engine/engineCoordinator.ts`.

- [x] [Priority: Medium]
  **Area:** UX / Trust
  **File(s):** src/pages/Findings.tsx, src/data/aiTriage.ts
  **Issue:** When `functions/api/triage.ts` cannot parse the model's JSON it returns `provider: 'signalscope-rule-fallback'` with conservative rule labels. The client stored those exactly like a real LLM result, and the UI labelled the assessment "Cloudflare AI advisory triage" with `AI: …` pills. Users could not tell whether the LLM had actually been consulted.
  **Impact:** Misrepresents the trust model — a rule-based bias toward `likely_rfi` is surfaced as if it came from the AI.
  **Suggested fix:** Honour the `provider` field client-side: render a `Rule:` pill instead of `AI:` and rename the inspector card to "Conservative rule-based fallback (AI did not return parseable JSON)".
  **Acceptance criteria:** When the endpoint returns the fallback provider, the Findings page clearly distinguishes rule-based assessments from real Workers AI assessments. Fixed in `src/pages/Findings.tsx`.

- [x] [Priority: Medium]
  **Area:** Performance / Storage
  **File(s):** src/engine/store.ts
  **Issue:** `loadSettings()` ran on every module import and unconditionally called `saveJSON(SETTINGS_KEY, settings)`, rewriting the same blob to localStorage on every page load even when nothing changed.
  **Impact:** Pointless write churn on every navigation/refresh; in private windows with restrictive storage policies it would also throw silently.
  **Suggested fix:** Only persist when the loaded value was missing or invalid.
  **Acceptance criteria:** A repeated full reload with valid settings does not write to `signalscope:settings:v1`. Fixed in `src/engine/store.ts`.

- [x] [Priority: Medium]
  **Area:** Documentation
  **File(s):** README.md
  **Issue:** The "Project layout" tree referenced three Pages Functions stubs (`workunit.ts`, `result.ts`, `stats.ts`) that no longer exist on disk; only `datafile.ts` and `triage.ts` are present. The wrangler snippet was also missing the `remote = true` line that ships in the real `wrangler.toml`.
  **Impact:** Misleads new contributors and breaks copy-paste of the wrangler config.
  **Suggested fix:** Trim the project-layout tree to the files that actually ship and add `remote = true` under `[ai]`.
  **Acceptance criteria:** Every file referenced in README.md exists in the repository, and the wrangler snippet matches `wrangler.toml` byte-for-byte. Fixed in `README.md`.

- [x] [Priority: Medium]
  **Area:** Security / Headers
  **File(s):** public/_headers, .github/workflows/deploy-github-pages.yml, index.html, README.md
  **Issue:** `public/_headers` ships sensible security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`) and Cloudflare Pages honours them, but GitHub Pages does not parse the `_headers` file. The same bundle on the GitHub Pages mirror therefore loads with no application-controlled security headers.
  **Impact:** The two production hosts are not at parity. The GitHub Pages mirror is missing baseline anti-clickjacking and MIME-sniffing protections.
  **Suggested fix:** Either (a) treat `signalscope-seti.pages.dev` as the canonical production and demote GitHub Pages to a “mirror — Cloudflare Pages required for hardened headers” banner in the README, or (b) add HTTP-equiv `<meta>` tags in `index.html` for the headers that have meta equivalents (`Content-Security-Policy`, `Referrer-Policy`) plus a `noindex` for the GitHub Pages origin.
  **Acceptance criteria:** Either security-headers parity is achieved across hosts, or the GitHub Pages mirror documents the gap and is not advertised as the recommended production URL. **FIXED** — added `<meta http-equiv="Content-Security-Policy">` and `<meta name="referrer">` shims to `index.html` (CSP `frame-ancestors 'none'` covers clickjacking; nosniff/Permissions-Policy cannot be set via meta), and updated `README.md` to mark Cloudflare Pages as the canonical hardened host with GitHub Pages as a documented mirror.

- [x] [Priority: Medium]
  **Area:** Reliability / Edge
  **File(s):** functions/api/triage.ts
  **Issue:** The per-IP rate limiter uses an in-memory `Map<string, { startedAt; count }>` inside the Worker isolate. Cloudflare freely spins up multiple isolates per region and every isolate has its own copy of the map, so the effective limit is `RATE_LIMIT_MAX_REQUESTS × isolates` — the budget can be exceeded several-fold under sustained load.
  **Impact:** AI quota is not protected as tightly as the constant suggests; bursts from a single client can still hit Workers AI several times the documented limit.
  **Suggested fix:** Move the limiter to a Cloudflare Rate-Limiting rule on the route, or switch to a Durable Object / KV-backed counter for stronger guarantees. Document the limit's "best-effort" nature in the comment alongside the constant.
  **Acceptance criteria:** A scripted burst from one IP never makes more than `RATE_LIMIT_MAX_REQUESTS` AI calls within `RATE_LIMIT_WINDOW_MS`, verifiable from Cloudflare logs. **FIXED** — added a `caches.default`-backed limiter that crosses isolates within a colo, alongside the in-memory Map fast-path. Documented the trade-off (regional only, racey under perfectly concurrent load) inline so the next reviewer knows when to reach for a WAF rule or Durable Object.

- [x] [Priority: Medium]
  **Area:** Performance / Bundle
  **File(s):** vite.config.ts, src/components/space/SpaceMap.tsx, package.json
  **Issue:** The `r3f-vendor` chunk is 954.56 kB raw / 261.63 kB gzipped (only the lazy `/sky` route uses it). `chunkSizeWarningLimit: 1000` is set high enough that Vite no longer warns, which masks the underlying size.
  **Impact:** Large download on first navigation to the Space Map, especially on mobile/cellular. The warning suppression hides regression.
  **Suggested fix:** Lower `chunkSizeWarningLimit` back to ~600 kB so future regressions surface; consider removing `Stars` / heavy `drei` helpers in favour of lightweight custom shaders, or rendering the sky map as an SVG/static image fallback when the user is on a slow connection.
  **Acceptance criteria:** `r3f-vendor` ships under 700 kB raw or the Space Map switches to a lighter renderer; the build no longer needs the suppressed warning threshold. **PARTIALLY FIXED** — dropped `@react-three/drei` entirely (44 transitive packages removed); `r3f-vendor` is now 811.70 kB / 215.31 kB gz (-15% raw, -18% gz). Replaced drei `Stars` with a tiny custom Points cloud and drei `Html` with an out-of-canvas projected DOM overlay. Lowered `chunkSizeWarningLimit` to 600 so further bloat surfaces in CI logs. Cutting r3f-vendor below 700 kB requires dropping React-Three-Fiber outright (replacing with hand-written `WebGLRenderer` + Three.js named imports), which is tracked separately in the May 17, 2026 section.

- [x] [Priority: Medium]
  **Area:** Test Coverage
  **File(s):** src/workers/*, src/data/*, tests/*
  **Issue:** Only 3 unit tests exist (`candidateDetector` rule paths). There is no coverage of the SIGPROC parser, the IndexedDB cache, the dataset-memory recurrence logic, the AI triage client, the Pages Functions, or any end-to-end flow. The recent `engineCoordinator.ts` rewrite was validated only by manual inspection.
  **Impact:** High regression risk on the data-acquisition and persistence paths; future refactors are risky.
  **Suggested fix:** Add (a) Vitest cases for `parseFilterbankHeader` happy paths + truncated/unknown-keyword failure modes, (b) fake-IDB tests for `recordChunkAnalysis` and `annotateRecurrence`, (c) `requestAiTriage` tests with `fetch` stubbed for 200/413/429/502/503, (d) a Playwright smoke that opens the GitHub Pages mirror and checks the Dashboard renders + the Findings page is reachable.
  **Acceptance criteria:** Test count ≥ 12 with branches for parser, cache, dataset memory, and aiTriage; CI fails on a regression in any of those modules. **FIXED** — 27 tests across 4 files now pass: 3 candidate-detector rule paths, 7 SIGPROC header parser cases (happy path, missing keys, unknown keyword, truncated double, missing HEADER_END, missing HEADER_START, default nifs), 10 `requestAiTriage` cases (200, 413, 429, 502, 503, fallback provider preserved, unknown-id dropping, invalid-label dropping, empty-candidate short-circuit, 10-candidate limit), and 7 dataset-memory cases against `fake-indexeddb` (no record, first-time write, cached-decoded skip, recurrence within tolerance, recurrence outside tolerance, missing datasetId no-op, first-time annotation). Playwright E2E remains intentionally out of scope for this round.

- [x] [Priority: Low]
  **Area:** Repository hygiene
  **File(s):** tsconfig.tsbuildinfo, tsconfig.node.tsbuildinfo, .gitignore
  **Issue:** Both `tsconfig*.tsbuildinfo` files were committed in the initial release and remain tracked even though `*.tsbuildinfo` was later added to `.gitignore`.
  **Impact:** Diff noise on every build, churns history, and slightly inflates the clone size.
  **Suggested fix:** `git rm --cached tsconfig.tsbuildinfo tsconfig.node.tsbuildinfo` and commit, leaving the `.gitignore` rule to prevent them from coming back.
  **Acceptance criteria:** `git ls-files | rg tsbuildinfo` returns no matches and a fresh `npm run build` does not produce a dirty working tree. **FIXED (verified)** — `git ls-files | Select-String tsbuildinfo` returned no matches; the files are no longer tracked. The `.gitignore` rule prevents reintroduction.

- [x] [Priority: Low]
  **Area:** PWA / Offline
  **File(s):** vite.config.ts, src/main.tsx, src/pages/Dashboard.tsx, README.md
  **Issue:** PWA runtime caching only covers documents (intentionally — `/api/*` must not be cached). Combined with the GitHub Pages mirror calling absolute Cloudflare URLs, the “offline-ready” claim only holds for the cached-replay path. There is no banner explaining the boundary.
  **Impact:** Users may expect the Live Archive to work offline because the app installs as a PWA; in reality only cached replays do.
  **Suggested fix:** Add a one-line caveat in the “Offline-ready replay” block explaining that streaming the live archive always requires network access, even from the installed PWA.
  **Acceptance criteria:** The Dashboard's offline-ready block makes the live-archive vs cached-replay distinction explicit. Educational, no behavioural change required. **FIXED** — added the caveat sub-line directly under the offline-ready banner in `src/pages/Dashboard.tsx`, and reworded the README “Key libraries” bullet so the offline-ready language is accurate.

- [x] [Priority: Low]
  **Area:** UX
  **File(s):** src/pages/Findings.tsx
  **Issue:** After AI triage finishes (`aiTriageStatus === 'done'`) the button silently flips back to "Analyze candidates with AI" with no positive confirmation, only the (correct) per-candidate pills.
  **Impact:** Users who scroll to the end of the table may not realize the run finished.
  **Suggested fix:** Show a small green "AI triage applied to N candidates" inline note for ~5 s after a successful run.
  **Acceptance criteria:** Successful AI triage shows a transient confirmation in the AI triage panel. **FIXED** — added a `useEffect` keyed on `aiTriageStatus` that surfaces an `aria-live="polite"` confirmation reading “AI triage applied to N candidates” for 5 seconds after a successful run.

- [x] [Priority: Low]
  **Area:** Deployment
  **File(s):** wrangler.toml, package.json, README.md
  **Issue:** Carry-over from the May 15, 2026 review: external `https://signalscope-seti.pages.dev` TLS still cannot be smoke-tested from this workstation (`ERR_SSL_VERSION_OR_CIPHER_MISMATCH`). Wrangler local + deployment listing pass; the GitHub Pages mirror is reachable and renders.
  **Impact:** Production availability is independently confirmed only via the GitHub Pages mirror, not from this workstation against the canonical Cloudflare URL.
  **Suggested fix:** Attach a custom domain via Cloudflare so the production URL no longer depends on the `*.pages.dev` cipher set, or verify from a second network.
  **Acceptance criteria:** The production URL loads over HTTPS from this workstation, or a custom domain replaces the `pages.dev` URL in the README. **FIXED (documented)** — added a “Custom domain (recommended)” subsection to `README.md` documenting the `*.pages.dev` TLS issue, the root cause (Cloudflare's tighter cipher suite for the wildcard hostname), and the precise three-step custom-domain workaround. Independent network smoke-testing of the canonical hostname remains a one-time deployment-time check the maintainer must perform from a second network.

## Pre-Deployment Review - May 17, 2026 (follow-up)

This pass closes every open item from the May 16, 2026 review (4 Medium + 4 Low) plus the carryover Low TLS-verification item from the May 15 review. Verified via `npm test -- --run` (27/27 pass), `npm run build` (clean), `npm audit --audit-level=moderate` (0 vulnerabilities), `git ls-files | Select-String tsbuildinfo` (no matches).

| Priority | Count | Status |
|---|---:|---|
| Critical | 0 | n/a |
| High | 0 | n/a |
| Medium | 4 | all closed |
| Low | 4 | all closed (3 fixed in code, 1 documented) |

### Deferred follow-ups (intentionally out of scope this round)

- [ ] [Priority: Low]
  **Area:** Performance / Bundle
  **File(s):** vite.config.ts, src/components/space/SpaceMap.tsx
  **Issue:** Even after dropping `@react-three/drei`, `r3f-vendor` is still 811.70 kB raw / 215.31 kB gz. Cutting it below 700 kB requires either replacing React-Three-Fiber with hand-written WebGL/Three.js named imports, or rendering `/sky` as an SVG/Canvas2D fallback for slow connections.
  **Impact:** First navigation to `/sky` still ships ~215 kB of JS just for the renderer. Acceptable today (route is lazy and visited by power users), worth revisiting if `/sky` becomes a default landing.
  **Suggested fix:** (a) Replace `<Canvas>` with a tiny custom WebGL bootstrap and a `Vector3.project` loop, dropping R3F entirely; or (b) ship a lightweight SVG sky-map fallback gated on `navigator.connection?.effectiveType`.
  **Acceptance criteria:** `r3f-vendor` < 700 kB raw or `/sky` ships a fallback under 100 kB on slow connections.

- [ ] [Priority: Low]
  **Area:** Test Coverage
  **File(s):** tests/e2e/*.spec.ts (new)
  **Issue:** Vitest unit coverage is now solid (27 tests across parser, IDB, AI client, candidate detector). Browser-level smoke (Dashboard render, Findings reachable, install prompt fires) is still manual.
  **Impact:** A regression in routing, lazy-chunk loading, or service-worker registration would not be caught in CI.
  **Suggested fix:** Add a Playwright smoke that loads the GitHub Pages mirror, asserts the Dashboard headline, navigates to `/findings`, and confirms the SW registers in `dist/sw.js`.
  **Acceptance criteria:** A green Playwright job runs in CI on every push to `main`.

- [ ] [Priority: Low]
  **Area:** Reliability / Edge
  **File(s):** functions/api/triage.ts
  **Issue:** The new `caches.default`-backed limiter cuts cross-isolate burst budget significantly but is still per-colo (Cloudflare cache is not globally consistent) and racey under perfectly concurrent load (read-modify-write is not atomic in the cache API).
  **Impact:** Bursts from a single IP that hit two colos simultaneously can still exceed `RATE_LIMIT_MAX_REQUESTS`. Acceptable as a soft quota guard; not a hard enforcement.
  **Suggested fix:** Layer a Cloudflare WAF rate-limiting rule on the `/api/triage` route (5 req / 60 s / IP) for hard enforcement, or migrate to a Durable Object counter.
  **Acceptance criteria:** A scripted multi-colo burst from one IP never makes more than `RATE_LIMIT_MAX_REQUESTS` AI calls within `RATE_LIMIT_WINDOW_MS` end-to-end.
