import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const page = await readFile(new URL("../public/huilv/index.html", import.meta.url), "utf8");
const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
const exposed = script.replace(/\}\)\(\);\s*$/, `window.fxTest={setRaw,activate,converted,refresh,chooseCurrency,renderRates,validateRates,isStale,keypress,buildCopyText:typeof buildCopyText==='function'?buildCopyText:null,copyResults:typeof copyResults==='function'?copyResults:null,state:()=>({amount,active,codes,snapshot})};})();`);
const CACHE = "local-fx.rates.v1", PREF = "local-fx.preferences.v1";

class Element {
  constructor() { this.hidden = false; this.value = ""; this.textContent = ""; this.innerHTML = ""; this.disabled = false; this.open = false; this.dataset = {}; this.classList = { toggle() {} }; }
  addEventListener() {}
  querySelectorAll() { return []; }
  setAttribute() {}
  getAttribute() { return "true"; }
  focus() {}
  select() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
}

function boot({ storage = {}, fail = false, status = 200, clipboardFail = false, blockedStorage = false } = {}) {
  let now = Date.now(), calls = 0;
  const elements = new Map(), listeners = new Map(), copied = [];
  const el = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  el("ratesView").hidden = true;
  const document = { getElementById: el, querySelectorAll: () => [], querySelector: () => new Element(), addEventListener() {}, hidden: false };
  // Synthetic test quotes only. The application itself always fetches its rates.
  const quote = { result: "success", base_code: "USD", time_last_update_unix: Math.floor((now - 3600000) / 1000), time_next_update_unix: Math.floor((now + 23 * 3600000) / 1000), rates: { USD: 1, CNY: 7, JPY: 150, GBP: 0.8, HKD: 7.8, KRW: 1300, EUR: 0.9, AUD: 1.5, CAD: 1.3, CHF: 0.9 } };
  class Clock extends Date { static now() { return now; } }
  const navigator = { onLine: true, clipboard: { async writeText(value) { if (clipboardFail) throw Error("Clipboard unavailable"); copied.push(value); } } };
  const context = { document, navigator, Intl, Date: Clock, AbortController, console, localStorage: { getItem(k) { if (blockedStorage) throw Error("Blocked"); return storage[k] || null; }, setItem(k, v) { if (blockedStorage) throw Error("Blocked"); storage[k] = v; } }, fetch: async () => { calls++; if (fail) throw Error("Network failed"); return { ok: status === 200, status, json: async () => structuredClone(quote) }; }, requestAnimationFrame() {}, setInterval() {}, setTimeout: () => 1, clearTimeout() {}, window: { addEventListener(type, handler) { listeners.set(type, handler); } } };
  vm.runInNewContext(exposed, context);
  return { api: context.window.fxTest, el, storage, copied, navigator, listeners, quote, advance(ms) { now += ms; }, calls: () => calls };
}
const settled = () => new Promise((resolve) => setImmediate(resolve));

test("large converted amounts survive reopening the app", async () => {
  const app = boot(); await settled();
  assert.equal(app.api.setRaw("999999999999"), true);
  app.api.activate("JPY");
  const expected = app.api.state().amount;
  assert.ok(expected > 1e12);
  const restored = boot({ storage: structuredClone(app.storage) }); await settled();
  assert.equal(restored.api.state().active, "JPY");
  assert.equal(restored.api.state().amount, expected);
  restored.api.keypress("back");
  assert.equal(restored.api.state().amount, Number(String(expected).slice(0, -1)), "deleting an oversized converted amount must still work");
  assert.equal(restored.api.setRaw("9999999999999"), false, "new oversized input is still rejected");
});

test("switching the input currency without quotes keeps the entered number and no invented result", async () => {
  const app = boot({ fail: true }); await settled();
  app.api.setRaw("123.45"); app.api.activate("CNY");
  assert.equal(app.api.state().amount, 123.45);
  assert.equal(app.api.converted("USD"), null);
  assert.equal(app.api.converted("CNY"), 123.45);
});

test("a failed update can be retried after five seconds instead of a success cooldown", async () => {
  const app = boot({ fail: true }); await settled();
  await app.api.refresh(true); assert.equal(app.calls(), 1);
  assert.doesNotMatch(app.el("toast").textContent, /刚刚已检查/);
  app.advance(5100); await app.api.refresh(true); assert.equal(app.calls(), 2);
});

test("provider throttling preserves cache and cannot be bypassed by a reconnect event", async () => {
  const seed = boot(); await settled();
  const storage = structuredClone(seed.storage), cached = JSON.parse(storage[CACHE]); cached.fetchedAt -= 7200000; storage[CACHE] = JSON.stringify(cached);
  const app = boot({ storage, status: 429 }); await settled();
  assert.equal(app.api.converted("CNY"), 512 * 7);
  app.advance(61000); await app.api.refresh(true); assert.equal(app.calls(), 1);
  app.listeners.get("online")(); await settled(); assert.equal(app.calls(), 1);
  assert.match(app.el("message").textContent, /频繁|受限/);
});

test("a normal successful quote still avoids repeated network requests", async () => {
  const app = boot(); await settled(); await app.api.refresh(true);
  assert.equal(app.calls(), 1);
  app.advance(61000); await app.api.refresh(true); assert.equal(app.calls(), 2);
});

test("input validation and repeated currency switching preserve numeric precision", async () => {
  const app = boot(); await settled(); app.api.setRaw("1234.56");
  for (let i = 0; i < 10; i++) { app.api.activate("CNY"); app.api.activate("USD"); }
  assert.ok(Math.abs(app.api.state().amount - 1234.56) < 1e-8);
  for (const invalid of ["-1", "1e3", "1..2", "1000000000000", "0.1234567"]) assert.equal(app.api.setRaw(invalid), false);
  app.api.setRaw("0"); assert.equal(app.api.converted("JPY"), 0);
});

test("choosing a currency already on the screen keeps five distinct currencies", async () => {
  const app = boot(); await settled(); app.api.chooseCurrency(0, "GBP");
  const state = app.api.state(); assert.equal(new Set(state.codes).size, 5); assert.equal(state.codes[0], "GBP"); assert.equal(state.active, "USD");
});

test("copied results contain the real quote timestamp, source and cache status", async () => {
  const app = boot(); await settled(); app.api.setRaw("100");
  await app.api.copyResults();
  assert.equal(app.copied.length, 1);
  assert.ok(app.copied[0].split("\n").length >= 9, "copied currencies and source should be on separate lines");
  assert.match(app.copied[0], /100\.00 USD/); assert.match(app.copied[0], /700\.00 CNY/);
  assert.match(app.copied[0], /报价时间/); assert.match(app.copied[0], /ExchangeRate-API/);
  app.advance(72 * 3600000); assert.match(app.api.buildCopyText(), /过期/);
  app.navigator.onLine = false; assert.match(app.api.buildCopyText(), /缓存/);
});

test("unavailable clipboard opens a manual copy sheet instead of a false success", async () => {
  const app = boot({ clipboardFail: true }); await settled(); await app.api.copyResults();
  assert.equal(app.el("copyDialog").open, true); assert.match(app.el("copyText").value, /ExchangeRate-API/);
  assert.doesNotMatch(app.el("toast").textContent, /已复制/);
});

test("copying without a valid quote is disabled", async () => {
  const app = boot({ fail: true }); await settled();
  assert.equal(app.el("copyResults").disabled, true);
  assert.throws(() => app.api.buildCopyText(), /汇率|报价/);
});

test("rate-table search filters Chinese names and ISO codes and explains an empty result", async () => {
  const app = boot(); await settled();
  for (const query of ["美元", "usd"]) {
    app.el("ratesSearch").value = query; app.api.renderRates();
    assert.match(app.el("rateRows").innerHTML, /USD/); assert.doesNotMatch(app.el("rateRows").innerHTML, /CNY/);
  }
  app.el("ratesSearch").value = "不存在的币种"; app.api.renderRates();
  assert.match(app.el("rateRows").innerHTML, /没有找到/);
});

test("blocked local storage still allows fetching, converting and copying in this session", async () => {
  const app = boot({ blockedStorage: true }); await settled();
  assert.equal(app.api.converted("CNY"), 512 * 7);
  await app.api.copyResults(); assert.equal(app.copied.length, 1);
});

test("malformed preferences fall back safely without overwriting valid quote data", async () => {
  const app = boot({ storage: { [PREF]: JSON.stringify({ codes: ["USD", "USD"], amount: -1 }) } }); await settled();
  assert.equal(app.api.state().codes.length, 5); assert.equal(app.api.state().amount, 512);
});
