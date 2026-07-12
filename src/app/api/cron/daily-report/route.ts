import { NextRequest, NextResponse } from "next/server";
import { sendAdminAlert } from "@/lib/mail";
import { buildOccupancyReport } from "@/lib/occupancy-report";
import { saveDailySnapshots } from "@/lib/occupancy-snapshots";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/daily-report
 * 稼働状況の日次レポート（Vercel Cron: 毎日 UTC 22:00 = JST 朝7:00）。
 * 全拠点の「来週の予約 vs 過去4週平均」を判定し、管理者へメール＋Discordで送る。
 *
 * 認証: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const { subject, text, html, alerts, calendarErrors, snapshots } = await buildOccupancyReport(
      new Date()
    );
    // 分析用の蓄積が失敗しても、日次レポートの通知自体は止めない（再送すると重複配信になるため500では返さず、
    // レスポンスにフラグを残すだけにとどめる）
    let snapshotSaveFailed = false;
    try {
      await saveDailySnapshots(snapshots);
    } catch (e) {
      snapshotSaveFailed = true;
      console.error("[cron/daily-report] スナップショット保存に失敗:", e);
    }
    const delivered = await sendAdminAlert(subject, text, html);
    if (!delivered.discord && !delivered.email) {
      // レポートは生成できたが誰にも届いていない＝ジョブとしては失敗（Vercelのログで気づけるようにする）
      console.error("[cron/daily-report] 全チャネルで配信失敗（Discord・メールとも未達）");
      return NextResponse.json(
        { error: "delivery_failed", alerts, calendarErrors, snapshotSaveFailed },
        { status: 500 }
      );
    }
    return NextResponse.json({ ok: true, delivered, alerts, calendarErrors, snapshotSaveFailed });
  } catch (e) {
    console.error("[cron/daily-report] レポート生成に失敗:", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
