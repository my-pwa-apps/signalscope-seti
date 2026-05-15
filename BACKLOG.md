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
