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

`tests/sw-cache-stall-runtime.test.mjs` separately exercises the actual Service Worker fetch handler with stalled cache open, match, enumeration and write callbacks. Runtime reads and writes have independent two-second limits; a healthy network response remains usable, late completions do not repeat downloads, and late rejections remain handled. Once the network response is obtained, its network timer no longer aborts the stream while an optional cache write waits. Complete staged-shell installation and activation requirements remain unchanged. These VM callback scenarios simulate disk stalls; they do not claim that a real Safari disk fault or installed iPhone was reproduced.

IME and held-key cases inject browser keyboard events; they do not claim that a physical iPhone or OS input method was exercised. The new request/storage tests block Service Workers for isolation; the separate existing real-worker offline checks still run. Production dependency versions and Render configuration remain unchanged.


## NGSL automatic example playback

NGSL grouped word cards (10 or 20 words, free study or study-plus-quiz) now play the full example three times on entry and actual card changes. First playback starts in the click/touch handler for iOS speech activation; the commit effect avoids canceling that queue. Each complete utterance's end event starts the next, not a duration estimate. Quiz, scene groups and single-word lookups do not auto-play. A visit-local toggle and an explicit three-repeat replay are available without adding storage keys or modifying backup formats. Restored pages without user activation wait for input. All existing manual audio, navigation, hidden-page and pagehide cancellation applies to pending repetitions.

`tests/speech-repeat-runtime.test.mjs` checks queue length, full text, cancellation, stale events, startup errors and ordinary speech compatibility. `scripts/browser-autoplay.mjs` exercises first-card activation, next/previous/rated cards, manual interruption, toggling, modal/quiz/navigation exits, visibility and restoration in Chromium and WebKit. Browser speech is instrumented to inspect exact utterances and callbacks, not to pretend that physical speakers or Bluetooth audio have been tested. Existing browser suites continue to run. The separate one-earbud clipping report remains outside this change.


## Installed-user NGSL autoplay and release identity

The running bundle and its HTML carry the same full build commit, independently of fetched build-info.json. NGSL auto-example controls show a short release ID; their final placement is below the primary actions (see mobile word-card layout below). Ten-word legacy saved groups lacking the optional kind field are covered, as are synchronous first-input resumes from Home and the learning navigation tab. Existing end-event-based three-repeat playback, manual interruption and quiz exclusion remain in force.

A version notice checks uncached server metadata on visible startup and periodically/on return to the app. It does not replace an already-open document automatically or force a waiting worker to control old pages. Updates require explicit action from Progress, successful read-only comparison of all in-memory learning records with persisted data, and a matching fresh HTML commit. Failed/offline/stale probes and unsaved/concurrent records keep the current document. Learning IDs, local storage keys, backup format and locked dependencies are unchanged.

Browser version checks cover current/new/failed probes, unchanged running documents, active learning, concurrent storage and stale HTML preflight in Chromium and WebKit. A separate migration audit builds the actual pre-autoplay release, installs its real Chromium Service Worker, publishes the repaired build at the same local origin, reproduces a waiting worker with the old UI, then verifies explicit same-origin reload preserves the ten-word session and supports exactly three complete example utterances. Speech callbacks are instrumented; this is not physical iPhone or Bluetooth audio acceptance.


## Actual static-host manifest delivery

The production .webmanifest was observed with binary/octet-stream, which the old shell installer rejected even though all HTTP checks passed. The worker repairs that header only for the exact same-origin application manifest after parsing and validating its app identity, scope, launch path and icon origins. HTML, malformed JSON, wrong app manifests, scripts and styles are not relaxed. Unit coverage reproduces the original binary-header failure and verifies install/activation and invalid-content preservation.

The production verifier now also opens fresh, isolated Chromium and WebKit contexts against the real served files, waits for actual Service Worker activation/control, verifies the cached manifest, and checks first/next/known/difficult NGSL actions with exactly three full example utterances. No existing browser storage is accessed. Speech is instrumented and is not a physical iPhone/headset listening test. Local rehearsal serves .webmanifest with the exact observed production MIME instead of the development server's favorable MIME. A still-open legacy chatgpt.site install is a different origin and cannot be upgraded by changing this Render repository.


## Mobile word-card layout: learning before audio settings

Autoplay, replay, help and the release label follow the word card and both primary action rows in DOM order. On portrait-sized mobile viewports the two action rows share one bottom-sticky toolbar above the existing navigation and safe area. The toolbar remains in document flow, without hiding or truncating the example or locking page scrolling. Short landscape viewports and desktop retain normal flow. Only word-card layout and spacing change; the speech handlers, recording rules, IDs, backups, dependency lockfile and deployment settings are unchanged.

`browser-word-layout.mjs` uses Chromium and WebKit at 320x568, 375x667, 390x650, 390x844 and 430x932, plus large-text/simulated-safe-area and desktop/landscape cases. It verifies actual button rectangles and hit targets before direct coordinate taps (no Playwright auto-scroll), repeated card changes with three complete instrumented utterances, footer access, long text, and no horizontal overflow. The reported viewport tests do not claim physical iPhone listening verification.


## Top-of-page group starts

The word, daily-sentence and core-pattern setup each render exactly one start button immediately after the page header, before the options and content preview/browser. The reactive selection summary sits below the button and is connected with aria-describedby. All three setup buttons use a scoped normal-flow override, retaining their selection, loading, same-settings resume and replacement-confirmation guards. No storage, learning ID, backup or dependency changes.

`scripts/browser-setup-start.mjs` verifies first-screen position and actual coordinate taps (no locator auto-scroll), all three modules at small/standard/large phone sizes, browser-height constraints, larger text and desktop. It also verifies saved word choices, sentence mode/length/count, pending sentence-pack disablement/recovery, pattern scenes and the existing paused-session replacement confirmations. Local synthetic records only. Main production verification additionally measures the top starts against the real Render page and starts sentence/pattern groups in isolated profiles. The tests do not claim physical iPhone or audio-device acceptance.


## Sentence daily listening and same-session resumption

Returning from sentence cards to unchanged setup and pressing Start resumes the saved IDs, ratings and position without a discard dialog or new practice rotation. Deliberate replacement of a progressed session still requires confirmation; an untouched first card does not. A separate new-group action remains explicit. Storage keys, snapshot formats, English word playback and the currency-converter files are unchanged.

Bilingual sentence cards show their Chinese translation directly. Every actual card transition starts three full English utterances and one Mandarin utterance, in order, using the shared cancellation token and end callbacks. Chinese gets zh-CN and a matching voice or the platform language default, never the English voice. Speaking-first mode still hides the English answer and never auto-reads it. Settings are visit-local and below navigation/rating controls. Native speech is instrumented in tests, not a claim of physical iPhone/headset listening.

## Daily-use maintenance across modules

`browser-maintenance.mjs` checks reading position when leaving and returning to the same article during a visit, intentional top-of-page navigation for a new or reopened article, and reading-list focus. This position is visit-local; reload still restores the existing article record without adding a storage key or changing backups.

Sentence favorites, reinforcement lists and nonempty full-library searches span all loaded bands and scenes without changing the next practice group's choices. Empty searches return to the selected practice range. Runtime and isolated Chromium/WebKit checks cover preference persistence, single-card return, search and starting the original group.

Word groups with a visited later card retain their position when exit confirmation is canceled; an untouched first card can still exit directly. `browser-word-layout.mjs` and `browser-sentence-daily.mjs` check direct coordinate taps with speech, cache and offline notices, including large text and safe-area layouts. Notice positioning follows the actual sticky toolbar bounds during scrolling for both word and sentence cards. Accessibility checks now include active cards, recalled answers, quiz feedback/results, reading details and confirmation dialogs in addition to the six primary screens.

Reset stores zero practice rotation in the same rollback-protected transaction as clearing progress. The version regression checks that a completed reset passes the saved-record guard while still rejecting stale update HTML. Its new-version response is simulated; it is not a claim that the test deployed a release.

The live PWA verifier also calls `verify-live-maintenance.mjs` against the official Render site. Fresh disposable profiles verify full HTML/client commit identity and the repaired sentence, word-exit, reading, notice and reset interactions. The future-version/stale-HTML safety check and speech error are explicitly simulated; the current site identity and UI actions are real. Physical audio and real-worker installation retain their separate acceptance boundaries.

## Storage reads, pattern continuity and result navigation

Startup reads all existing learning-storage keys before applying defaults, normalization or save effects. If access to localStorage or any read throws, the app keeps the loading/recovery screen and leaves all original values untouched. Retry rereads the same records in the same document; genuinely missing optional keys and existing valid old backups still use their compatible defaults. `storage-read-recovery-runtime.test.mjs` executes the actual hydration effect with a fault at every existing key. `browser-storage-read.mjs` checks transient and persistent getter/read failures, zero writes while blocked and restoration of synthetic paused sessions in Chromium and WebKit. These injected failures do not claim reproduction of a real Safari disk fault.

Pattern practice now follows the sentence group's same-settings resume behavior: normal Start retains IDs, index, substitution, ratings and practice rotation without a discard dialog. Explicit new groups, changed scenes and reinforcement protect progressed sessions. An untouched first substitution can still be replaced directly; completion and difficult-only retry retain their existing behavior. `browser-pattern-maintenance.mjs` exercises these paths, including reload, Home resume and hidden English answers. Speech remains instrumented.

Word and sentence result lists return to the first item when effective search/filter criteria change. Showing more, receiving a delayed content pack and returning from a lookup preserve position. Equivalent normalized searches also preserve position. The actual query effects have runtime regressions, with corresponding scenarios in `browser-maintenance.mjs`.

## PWA update retries and document identity

Each explicit HTML update preflight has a unique URL so an older installed cache-first worker cannot pin retries to its first stale response. The current worker always fetches these probes from the network, without adding them to the offline shell or substituting cached HTML on failure. Existing full-title/commit and saved-record guards still decide whether the current document may navigate.

Shell installation additionally verifies the English app title, a single full build identity matching the installing worker, and a same-origin JavaScript entry before accepting the complete asset graph. A 200 maintenance page, missing entry or mismatched deployment cannot replace the previous complete offline shell. Normal navigation accepts a valid newer release and falls back to the usable old shell when a wrong document arrives. Runtime and stamping tests cover these faults, inline hydration entries and body-read deadlines. Version browser tests verify distinct retry URLs and unchanged learning records; simulated future/stale responses are safety tests, not evidence that a future release was deployed.

The Render build clears only generated `dist` before bundling, so reused workspaces cannot publish obsolete hashed chunks from an earlier build. Source/public files and learner records are unaffected. The actual-built-worker runtime regression continues to require every published JavaScript/CSS asset to be available offline, without weakening the assertion for stale files. Production verification checks matching full commits in HTML, build-info and the stamped worker; live UI checks separately verify the executing client.


## Reachable pattern and quiz controls, review correction and backup rescue

Pattern substitution navigation and the final rating share the existing mobile card toolbar above the navigation/safe area. Revealing still requires an explicit learner action; returning to a substitution hides its full answer again. `browser-pattern-layout.mjs` checks direct coordinate taps across small/standard/large phones, larger text with a simulated safe area, long answers, warning stacks, desktop and landscape. Content stays scrollable and manual speech retains its existing cancellation behavior.

The quiz submit/next and unknown-answer actions share a mobile bottom toolbar. The input or complete feedback scrolls into the unobscured area only when needed, after ordinary navigation restores the page position. Warning stacks reserve scroll space and participate in visibility checks. `quiz-feedback-layout-runtime.test.mjs` executes the actual effects for correct/wrong/restored feedback, focus, resize, visibility, dialogs and cleanup. `browser-quiz-layout.mjs` verifies real rectangles and hit targets, including empty-answer reveal, feedback under stacked warnings, held Enter, long answers, larger text, resumed feedback and resized available height. Viewport/font/resize/IME scenarios are simulations, not physical phone keyboard or pinch-zoom acceptance.

Review undo cancels its previous action timer before restoring the exact record. An immediate intentional correction is accepted while duplicate ratings remain guarded, and an older timer cannot unlock a newer rating. `review-undo-lock-runtime.test.mjs` uses the actual handlers and controlled timers; `browser-review-undo.mjs` uses three real pointer clicks within the original 350ms window in both due review and the wordbook, then verifies unrelated records and reload persistence.

The stale-window dialog offers a read-only export of that page's in-memory records before explicit reload, including changes that failed to save. It does not merge or overwrite the other window's records. Export/reload stay disabled during export, and its success/error appears inside the dialog; cancellation cannot reuse an earlier success message. `sync-backup-runtime.test.mjs` renders the real dialog and export handler. `browser-data-protection.mjs` uses two real pages with isolated records, a simulated single-page save failure and simulated share/fallback outcomes to check downloads, cancellation, retry and pending-export protection. The existing 19 keys and backup format remain unchanged. Native iPhone sharing remains manual.

The existing live maintenance verifier also checks the small-phone pattern/quiz flows, immediate review correction and a two-page backup export against the full expected production commit. Production profiles are disposable; local fault injection and physical acceptance boundaries remain separate.
