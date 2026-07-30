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
}: {
  bookingId: string;
  amount: number;
  venueName: string;
}) {
  useEffect(() => {
    const key = `ga4_purchase_${bookingId}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      // プライベートモード等でstorage不可でも計測は続行（transaction_idで重複排除される）
    }
    gaEvent("purchase", {
      transaction_id: bookingId,
      value: amount,
      currency: "JPY",
      items: [{ item_name: venueName, price: amount, quantity: 1 }],
    });
  }, [bookingId, amount, venueName]);

  return null;
}
