"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { GA_MEASUREMENT_ID, ensureGaInit, gaEvent } from "@/lib/gtag";

/**
 * GA4計測タグ。App Routerのクライアント遷移ではスクリプトが再実行されないため、
 * send_page_viewを無効化した上でpathnameの変化を監視して手動でpage_viewを送る。
 * 管理画面（/admin配下）は運営者自身のアクセスなので計測しない。
 */
export default function GoogleAnalytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname.startsWith("/admin")) return;
    ensureGaInit();
    gaEvent("page_view", { page_path: pathname });
  }, [pathname]);

  // 測定ID無し（ローカル開発・Preview等）ではタグ自体を読み込まない
  if (!GA_MEASUREMENT_ID) return null;

  return (
    <Script
      src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
      strategy="afterInteractive"
    />
  );
}
