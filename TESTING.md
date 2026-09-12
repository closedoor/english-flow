# English Flow testing

Run the repository's locked dependencies and standard checks:

```sh
npm ci
npm test
npm run typecheck
npm run lint
npm run build:render
```

## Browser regression checks

The validation workflow builds the existing app and tests it in real headless Chromium and WebKit engines, with isolated synthetic local learning records. No user records or production storage are accessed. The browser runner refuses non-local test origins.

The browser tools are deliberately installed outside the application's dependency graph. To run the same suite on a development machine:

```sh
npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1
node /tmp/english-flow-browser/node_modules/playwright/cli.js install chromium webkit
RENDER_EXTERNAL_URL=http://127.0.0.1:4173 npm run build:render
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/client
```

In another terminal:

```sh
PLAYWRIGHT_MODULE=/tmp/english-flow-browser/node_modules/playwright/index.mjs npm run test:browser
```

The suite exercises all six tabs at 320, 375, 390, 480 and 1280 CSS pixels; word and quiz resume; sentence speaking and pattern substitution; reading answers; valid and damaged backups; review undo; blocked storage; stale-window protection; and synthetic single-/multi-finger gestures. No browser check counts simulated audio as a successful physical speaker test. Screenshots on failure go to the temporary `english-flow-evidence` folder (override with `BROWSER_EVIDENCE_DIR`).

### Coverage limits

Full offline document reload is verified in Chromium with an activated Service Worker and a newly created document. WebKit verifies already-loaded content while offline, not offline reload: Playwright's WebKit offline-navigation simulation reports an internal browser error and its Service Worker automation is not supported like Chromium (https://playwright.dev/docs/service-workers). A physical iPhone/Safari installed-PWA cold start, OS voice playback, sharing sheet, pinch zoom and keyboard remain manual acceptance checks. Passing a headless WebKit test is not a claim of physical iPhone verification.

No storage keys, learning IDs or backup format were changed by the touch/layout maintenance. Regression tests continue to exercise existing backups and save/restore paths.

## Partial network and cache faults

The browser command also runs `scripts/browser-network.mjs` in Chromium and WebKit. These isolated local-only scenarios hold unrelated sentence requests open and verify that already loaded search results remain usable, the selected loaded pack can start and resume, each newly returned pack appears before slower packs finish, and unfinished empty searches do not falsely claim no matches. Service Workers are blocked only in these request-interception tests; the existing offline-shell suite remains separate and unchanged.

Cache fault tests isolate failures in enumeration, opening a cache, reading one key and cleaning damaged JSON. Offline recovery must continue to other valid copies, while online learning remains usable if all cache storage fails. No learning records, IDs, backup keys or dependency versions are changed.

The standard validation job now also runs an explicit TypeScript check (`npm run typecheck`) without emitting files or relying on the production bundler to detect type errors.


## Failed requests and in-page recovery

`test:browser` also runs `scripts/browser-recovery.mjs` in Chromium and WebKit. Local request interception rejects missing sentence packs and verifies that search, favorites and reinforcement lists do not claim definitive absence; partial result counts disclose their coverage; retry preserves the document, query and learning records; and already loaded practice still resumes after reload. Complete genuinely empty searches and returning to a loaded selection remain covered. Recovery controls are checked at 320 CSS pixels. The full-document reload action remains available for cached dynamic-import failures. These tests use synthetic records, never the production site's storage. No learning identifiers, local-storage keys, backup format or locked dependency versions change.
