"use client";

import { useEffect, useState } from "react";
import { getSpeechDiagnostic, isSpeechSupported, SPEECH_DIAGNOSTIC_EVENT, stopSpeech, testSpeech, type SpeechDiagnostic } from "./speech-playback";

export function speechFailureMessage(error: string) {
  const code = error.replace(/^chinese-/, "");
  const language = error.startsWith("chinese-") ? "中文" : "英文";
  if (code === "not-allowed") return "浏览器阻止了朗读，请直接点一次播放；仍无声可到首页的“记录与设置”检查语音。";
  if (code === "start-timeout") return `${language}语音一直没有启动。可到首页的“记录与设置”检查语音，或换个声音试播。`;
  if (code === "language-unavailable" || code === "voice-unavailable") return `${language}音色不可用。可到首页的“记录与设置”换个声音试播。`;
  if (code === "unsupported") return "当前浏览器不支持系统朗读，请在 Safari、Chrome 或 Edge 打开。";
  if (code === "audio-busy") return `${language}语音暂时无法播放，声音可能正被其他应用占用。请暂停其他音频，再点一次播放。`;
  if (code === "audio-hardware") return `${language}语音无法使用当前音频设备。请检查媒体音量和蓝牙输出，再点一次播放。`;
  if (code === "network") return `${language}语音需要的网络连接失败。请检查网络，或到首页的“记录与设置”换个声音试播。`;
  if (code === "text-too-long") return `${language}朗读内容超过了当前音色的长度限制。可到首页的“记录与设置”换个声音试播。`;
  return `${language}语音未能完成。请点一次重播；仍无声可到首页的“记录与设置”检查语音或换个声音试播。`;
}

export default function SpeechCheck() {
  const [result, setResult] = useState<SpeechDiagnostic>(getSpeechDiagnostic);
  useEffect(() => {
    const update = (event: Event) => setResult((event as CustomEvent<SpeechDiagnostic>).detail);
    window.addEventListener(SPEECH_DIAGNOSTIC_EVENT, update);
    return () => window.removeEventListener(SPEECH_DIAGNOSTIC_EVENT, update);
  }, []);
  const play = (next: "en-US" | "zh-CN", alternate = false) => {
    testSpeech(next, alternate);
  };
  const message = result.phase === "requested" ? "正在等待系统语音启动…"
    : result.phase === "recovering" ? "当前声音没有启动，正在尝试另一条播放路径…"
      : result.phase === "started" ? "系统报告已开始朗读，请以实际听到的声音为准。"
        : result.phase === "ended" ? "系统报告朗读结束。若没有听到，请点“换个声音试播”。"
          : result.phase === "failed" ? speechFailureMessage(`${result.language === "zh-CN" ? "chinese-" : ""}${result.error || "unavailable"}`)
            : "点下面的按钮试听英文和中文。";
  return <details className="setup-details speech-check" onToggle={(event) => {
    if (!event.currentTarget.open) stopSpeech();
  }}>
    <summary>语音检查</summary>
    <div className="source-card">
      <p>无声时可在这里试听。检查只使用测试句子，不改变学习进度。</p>
      <div className="speech-check-actions">
        <button onClick={() => play("en-US")}>试听英文</button>
        <button onClick={() => play("zh-CN")}>试听中文</button>
      </div>
      <div className="speech-check-actions">
        <button onClick={() => play(result.language === "zh-CN" ? "zh-CN" : "en-US", true)}>换个声音试播</button>
        <button onClick={() => { if (stopSpeech()) setResult({ ...getSpeechDiagnostic(), phase: "idle" }); }}>停止试听</button>
      </div>
      <p role="status" aria-live="polite">{message}</p>
      <p>{result.language === "zh-CN" ? "中文" : "英文"} · {result.voice}{result.error ? ` · 错误：${result.error}` : ""}{!isSpeechSupported() ? " · 浏览器不支持朗读" : ""}</p>
      <p>系统报告播放却仍无声时，请在播放过程中调高媒体音量，并检查声音是否输出到蓝牙设备；也可试用上面的备用声音。本次访问中，后续学习会沿用你试播选择的声音。</p>
    </div>
  </details>;
}
