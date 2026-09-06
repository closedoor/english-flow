import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.ENGLISH_FLOW_RENDER_EXPORT === "1" && process.env.RENDER_EXTERNAL_URL
      ? process.env.RENDER_EXTERNAL_URL
      : "https://english-flow.iscream95.chatgpt.site",
  ),
  title: "词流英语",
  description: "用 NGSL 高频词、3,000 组日常长短句、核心句型替换和分级阅读，练习听懂、记住并主动说出英语。",
  openGraph: {
    title: "词流英语",
    description: "高频词 · 日常长短句 · 核心句型 · 分级阅读",
    url: "/",
    siteName: "词流英语",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "词流英语学习内容概览" }],
    locale: "zh_CN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "词流英语",
    description: "高频词 · 日常长短句 · 核心句型 · 分级阅读",
    images: ["/og.png"],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "词流英语",
  },
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  themeColor: "#f7f6f1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
