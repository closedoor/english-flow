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
npm install --prefix /tmp/english-flow-browser --no-save --package-lock=false playwright@1.56.1 axe-core@4.10.3
node /tmp/english-flow-browser/node_modules/playwright/cli.js install chromium webkit
RENDER_EXTERNAL_URL=http://127.0.0.1:4173 npm run build:render
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist/client
```

In another terminal:

```sh
PLAYWRIGHT_MODULE=/tmp/english-flow-browser/node_modules/playwright/index.mjs AXE_SOURCE=/tmp/english-flow-browser/node_modules/axe-core/axe.min.js npm run test:browser
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


## Core-content recovery and accessibility

The browser command injects a transient failure into one NGSL data pack in Chromium and WebKit. It verifies that the loading screen can retry inside the same document, preserve local records, reuse the packs already cached successfully and still retain full-page reload as a fallback. The suite also checks reduced-motion behavior and runs axe-core WCAG A/AA rules on the six primary screens after their lazy content is ready. Critical or serious violations fail CI. The audit dependency remains isolated from the application dependency graph and does not change the lock file or production bundle.


## Daily-use stability and stalled storage

`test:browser` also runs `scripts/browser-daily.mjs` in isolated Chromium and WebKit contexts. Scenarios cover legacy IME confirmation (`keyCode: 229`), repeated Enter, a separate intentional submit/advance, stalled cache reads/writes, 36 consecutive tab switches with delayed content, a complete ten-word learning/exam session with a paused draft and wrong-word-only retry, and a backup round-trip containing 2,000 word records and a year of study days.

The cache-stall runtime tests bound current-cache lookup, legacy lookup, offline write and old-copy cleanup separately. Successful ordinary writes remain awaited; a stalled write allows validated content for the current visit with an unconfirmed-offline-save warning. A housekeeping timeout never reports a saved pack as lost. Cache deadlines touch only public learning content, not localStorage records, backup formats or learning IDs. An older copy remains fallback-only.

IME and held-key cases inject browser keyboard events; they do not claim that a physical iPhone or OS input method was exercised. The new request/storage tests block Service Workers for isolation; the separate existing real-worker offline checks still run. Production dependency versions and Render configuration remain unchanged.


## NGSL automatic example playback

NGSL grouped word cards (10 or 20 words, free study or study-plus-quiz) now play the full example three times on entry and actual card changes. First playback starts in the click/touch handler for iOS speech activation; the commit effect avoids canceling that queue. Each complete utterance's end event starts the next, not a duration estimate. Quiz, scene groups and single-word lookups do not auto-play. A visit-local toggle and an explicit three-repeat replay are available without adding storage keys or modifying backup formats. Restored pages without user activation wait for input. All existing manual audio, navigation, hidden-page and pagehide cancellation applies to pending repetitions.

`tests/speech-repeat-runtime.test.mjs` checks queue length, full text, cancellation, stale events, startup errors and ordinary speech compatibility. `scripts/browser-autoplay.mjs` exercises first-card activation, next/previous/rated cards, manual interruption, toggling, modal/quiz/navigation exits, visibility and restoration in Chromium and WebKit. Browser speech is instrumented to inspect exact utterances and callbacks, not to pretend that physical speakers or Bluetooth audio have been tested. Existing browser suites continue to run. The separate one-earbud clipping report remains outside this change.


## Installed-user NGSL autoplay and release identity

The running bundle and its HTML carry the same full build commit, independently of fetched build-info.json. NGSL auto-example controls are above the word card and show a short release ID. Ten-word legacy saved groups lacking the optional kind field are covered, as are synchronous first-input resumes from Home and the learning navigation tab. Existing end-event-based three-repeat playback, manual interruption and quiz exclusion remain in force.

A version notice checks uncached server metadata on visible startup and periodically/on return to the app. It does not replace an already-open document automatically or force a waiting worker to control old pages. Updates require explicit action from Progress, successful read-only comparison of all in-memory learning records with persisted data, and a matching fresh HTML commit. Failed/offline/stale probes and unsaved/concurrent records keep the current document. Learning IDs, local storage keys, backup format and locked dependencies are unchanged.

Browser version checks cover current/new/failed probes, unchanged running documents, active learning, concurrent storage and stale HTML preflight in Chromium and WebKit. A separate migration audit builds the actual pre-autoplay release, installs its real Chromium Service Worker, publishes the repaired build at the same local origin, reproduces a waiting worker with the old UI, then verifies explicit same-origin reload preserves the ten-word session and supports exactly three complete example utterances. Speech callbacks are instrumented; this is not physical iPhone or Bluetooth audio acceptance.


## Actual static-host manifest delivery

The production .webmanifest was observed with binary/octet-stream, which the old shell installer rejected even though all HTTP checks passed. The worker repairs that header only for the exact same-origin application manifest after parsing and validating its app identity, scope, launch path and icon origins. HTML, malformed JSON, wrong app manifests, scripts and styles are not relaxed. Unit coverage reproduces the original binary-header failure and verifies install/activation and invalid-content preservation.

The production verifier now also opens fresh, isolated Chromium and WebKit contexts against the real served files, waits for actual Service Worker activation/control, verifies the cached manifest, and checks first/next/known/difficult NGSL actions with exactly three full example utterances. No existing browser storage is accessed. Speech is instrumented and is not a physical iPhone/headset listening test. Local rehearsal serves .webmanifest with the exact observed production MIME instead of the development server's favorable MIME. A still-open legacy chatgpt.site install is a different origin and cannot be upgraded by changing this Render repository.
