from pathlib import Path
p=Path('public/sw.js');s=p.read_text();anchor='async function fetchAndCache(request, timeoutMs = 0) {'
normalizer='''// Some static hosts label .webmanifest as binary/octet-stream. Do not reject
// a whole release for that header alone, and never accept an HTML error page.
// Only the exact application manifest gets this validated MIME repair.
async function normalizeManifestResponse(request, response) {
  if (!response || response.status !== 200) return response;
  const value = request instanceof Request ? request.url : String(request);
  const url = new URL(value, self.location.origin);
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (url.origin !== self.location.origin || url.pathname !== "/manifest.webmanifest"
    || !["binary/octet-stream", "application/octet-stream"].includes(contentType)) return response;
  try {
    const text = await response.clone().text();
    if (text.length > 64_000) return response;
    const manifest = JSON.parse(text);
    if (!manifest || manifest.name !== "词流英语" || manifest.start_url !== "/" || manifest.scope !== "/"
      || !Array.isArray(manifest.icons) || manifest.icons.length < 2
      || !manifest.icons.every((icon) => icon && typeof icon.src === "string" && new URL(icon.src, url).origin === self.location.origin)) return response;
    const headers = Object.fromEntries(response.headers.entries());
    headers["content-type"] = "application/manifest+json; charset=utf-8";
    delete headers["content-encoding"];
    delete headers["content-length"];
    return new Response(text, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}

'''
assert s.count(anchor)==1;s=s.replace(anchor,normalizer+anchor)
old='const response = await fetch(request, controller ? { signal: controller.signal } : undefined);';assert s.count(old)==1;s=s.replace(old,'const response = await normalizeManifestResponse(request, await fetch(request, controller ? { signal: controller.signal } : undefined));')
old='let response = await cache.match(url);';assert s.count(old)==1;s=s.replace(old,'let response = await normalizeManifestResponse(url, await cache.match(url));')
old='response = await fetchWithTimeout(url, OPTIONAL_CACHE_TIMEOUT);';assert s.count(old)==1;s=s.replace(old,'response = await normalizeManifestResponse(url, await fetchWithTimeout(url, OPTIONAL_CACHE_TIMEOUT));')
p.write_text(s)
p=Path('.github/workflows/validate.yml');s=p.read_text();anchor='\n  browser:\n';assert s.count(anchor)==1
steps='''
      - name: Install isolated live PWA verifier
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: |
          npm install --prefix /tmp/english-flow-live --no-save --package-lock=false playwright@1.56.1
          node /tmp/english-flow-live/node_modules/playwright/cli.js install --with-deps chromium webkit > /tmp/live-browser-install.log 2>&1 || { tail -50 /tmp/live-browser-install.log; exit 1; }

      - name: Verify actual live PWA installation and NGSL card actions
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        run: node scripts/verify-live-pwa.mjs
        env:
          PLAYWRIGHT_MODULE: /tmp/english-flow-live/node_modules/playwright/index.mjs
          PRODUCTION_URL: https://english-flow-mwnn.onrender.com/
          EXPECTED_COMMIT: ${{ github.sha }}
'''
s=s.replace(anchor,'\n'+steps+anchor);p.write_text(s)
p=Path('TESTING.md');p.write_text(p.read_text()+'''\n\n## Actual static-host manifest delivery\n\nThe production .webmanifest was observed with binary/octet-stream, which the old shell installer rejected even though all HTTP checks passed. The worker repairs that header only for the exact same-origin application manifest after parsing and validating its app identity, scope, launch path and icon origins. HTML, malformed JSON, wrong app manifests, scripts and styles are not relaxed. Unit coverage reproduces the original binary-header failure and verifies install/activation and invalid-content preservation.\n\nThe production verifier now also opens fresh, isolated Chromium and WebKit contexts against the real served files, waits for actual Service Worker activation/control, verifies the cached manifest, and checks first/next/known/difficult NGSL actions with exactly three full example utterances. No existing browser storage is accessed. Speech is instrumented and is not a physical iPhone/headset listening test. Local rehearsal serves .webmanifest with the exact observed production MIME instead of the development server's favorable MIME. A still-open legacy chatgpt.site install is a different origin and cannot be upgraded by changing this Render repository.\n''')
print('Patched exact-manifest MIME recovery and added actual live installation gate; no learning schema or dependencies changed.')
