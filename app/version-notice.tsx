"use client";

import { useEffect, useRef, useState } from "react";
import { APP_BUILD_COMMIT, isPublishedVersion, versionReloadUrl } from "./version-utils";

type Props = { showDetails: boolean; beforeReload: () => boolean };

export default function VersionNotice({ showDetails, beforeReload }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [latest, setLatest] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reloadLock = useRef(false);
  const guard = useRef(beforeReload);
  useEffect(() => { guard.current = beforeReload; }, [beforeReload]);

  useEffect(() => {
    if (!/^[0-9a-f]{40}$/.test(APP_BUILD_COMMIT)) return;
    let disposed = false;
    let checking = false;
    let checkedAt = 0;
    const controllers = new Set<AbortController>();
    const check = async () => {
      if (disposed || checking || document.hidden || Date.now() - checkedAt < 60_000) return;
      checking = true;
      checkedAt = Date.now();
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = window.setTimeout(() => controller.abort(), 8_000);
      try {
        // The nonce also bypasses cache-first workers from older releases.
        const response = await fetch(`/build-info.json?ef-check=${APP_BUILD_COMMIT}-${Date.now()}`, { cache: "no-store", signal: controller.signal });
        if (response.status !== 200) throw new Error("Version request failed");
        const value: unknown = await response.json();
        if (!isPublishedVersion(value, window.location.origin)) throw new Error("Invalid version response");
        if (!disposed) {
          setLatest(value.commit === APP_BUILD_COMMIT ? null : value.commit);
          setMessage(value.commit === APP_BUILD_COMMIT ? "当前已是最新版" : "发现新版本，当前学习不会被打断。");
        }
        if ("serviceWorker" in navigator) void navigator.serviceWorker.getRegistration().then((registration) => registration?.update()).catch(() => undefined);
      } catch {
        if (!disposed) setMessage("暂时无法检查更新；当前学习和记录不受影响。");
      } finally {
        window.clearTimeout(timeout);
        controllers.delete(controller);
        checking = false;
      }
    };
    const timer = window.setTimeout(check, 0);
    const interval = window.setInterval(check, 300_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      window.clearInterval(interval);
      controllers.forEach((controller) => controller.abort());
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [attempt]);

  const update = async () => {
    if (reloadLock.current || !latest) return;
    if (!guard.current()) {
      setMessage("请先到进度页再更新。若有记录尚未保存，请先导出备份；不会强制刷新。");
      return;
    }
    reloadLock.current = true;
    setBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
      const href = versionReloadUrl(window.location.href, latest);
      const response = await fetch(href, { cache: "no-store", signal: controller.signal });
      if (response.status !== 200) throw new Error("Unable to obtain updated page");
      const html = new DOMParser().parseFromString(await response.text(), "text/html");
      if (html.title !== "词流英语" || html.querySelector('meta[name="english-flow-build"]')?.getAttribute("content") !== latest) throw new Error("Old or incomplete document");
      if (!guard.current()) throw new Error("Progress changed during update");
      // Never force activation, clear storage, or reload another open window.
      window.location.replace(href);
    } catch {
      setMessage("新页面暂未就绪，或有记录尚未保存。已保留当前页面，请稍后重试或先导出备份。");
      reloadLock.current = false;
      setBusy(false);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  if (!showDetails && !latest) return null;
  return <section className="app-version-panel" aria-label="应用版本">
    <div><b>当前版本 {APP_BUILD_COMMIT.slice(0, 7)}</b><p role="status">{message || "NGSL 词卡支持例句自动播放三遍"}</p></div>
    {latest && !showDetails && <small>可先继续学习，稍后到“进度”页更新。</small>}
    <div className="app-version-actions">
      <button disabled={busy} onClick={() => { setMessage("正在检查更新…"); setAttempt((value) => value + 1); }}>检查更新</button>
      {latest && <button disabled={busy || !showDetails} onClick={update}>{busy ? "正在准备更新…" : "更新并保留进度"}</button>}
    </div>
  </section>;
}
