"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { captureAttribution } from "@/lib/attribution";

/**
 * 広告クリックIDの取りこぼしを防ぐための着地監視。
 *
 * Next.jsのApp Routerはページ遷移でフルリロードしないため、
 * 最初の1回だけでなく **URLが変わるたび** に拾い直す
 * （広告 → 拠点ページ → 予約 と遷移してもクリックIDを保持できる）。
 *
 * 保存先はlocalStorage。決済リクエスト時に同梱してDBへ書き、
 * Stripeの決済確定と結びつけてGoogle広告へ取り込む。
 */
export default function AttributionCapture() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    captureAttribution();
  }, [pathname, searchParams]);

  return null;
}
