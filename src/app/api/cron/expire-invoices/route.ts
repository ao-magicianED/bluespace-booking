import { NextRequest, NextResponse } from "next/server";
import { expireOverdueInvoices } from "@/lib/expire-invoices";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/expire-invoices
 * 請求書払いの期限切れ処理（枠解放・通知・遅延void・リマインダー）を高頻度で実行する。
 * GAS等の外部cronから10分おきに叩く想定（docs/gas-invoice-expiry-cron.md）。
 * 「期限後すみやかに」はベストエフォートであり保証ではない。GAS停止時は毎日3:00の
 * Vercel cron（/api/cron/maintenance）が同じ関数をフォールバックとして呼ぶ（リマインダーを除く）。
 *
 * 認証: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await expireOverdueInvoices();
  return NextResponse.json(result);
}
