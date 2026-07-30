"use client";

import { useEffect } from "react";
import { gaEvent } from "@/lib/gtag";

/**
 * 予約確定（決済完了）をGA4のpurchaseイベントとして送る。
 * thanksページは処理待ちの自動リロードや確認メールからの再訪問があるため、
 * localStorageとtransaction_id（GA4側の重複排除）の二段構えで二重計上を防ぐ。
 */
export default function PurchaseTracker({
  bookingId,
  amount,
  venueName,
  venueSlug,
}: {
  bookingId: string;
  amount: number;
  venueName: string;
  venueSlug: string;
}) {
  useEffect(() => {
    const key = `ga4_purchase_${bookingId}`;
    try {
      if (localStorage.getItem(key)) return;
    } catch {
      // プライベートモード等でstorage不可でも計測は続行（transaction_idで重複排除される）
    }
    gaEvent("purchase", {
      transaction_id: bookingId,
      value: amount,
      currency: "JPY",
      // item_idはbegin_checkoutと同じvenueSlugで統一（拠点別ファネルを分断しない）
      items: [{ item_id: venueSlug, item_name: venueName, price: amount, quantity: 1 }],
    });
    // 送信済みマークはイベントを積めた「後」に付ける。
    // 先にマークすると、積む前にページを閉じた場合などに永久欠測になる。
    try {
      localStorage.setItem(key, "1");
    } catch {
      // storage不可なら次回もtransaction_idの重複排除に任せる
    }
  }, [bookingId, amount, venueName, venueSlug]);

  return null;
}
