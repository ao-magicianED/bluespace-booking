import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { isConfigured, missingConfig, uploadClickConversions } from "@/lib/google-ads";
import type { ClickConversion } from "@/lib/google-ads";
import { sendAdminAlert } from "@/lib/mail";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/google-ads-sync
 * 決済が確定した予約を Google Ads へオフラインコンバージョンとして送る。
 *
 * なぜ必要か:
 *   ブラウザのタグだけでは広告ブロッカー・タブの即閉じ・リダイレクト失敗で取りこぼす。
 *   旧直販サイト（UPNOW）は完了ページが他社ドメインでタグを置けず、
 *   コンバージョンが一度も取れなかった。
 *   ここでは「Stripeで決済が確定した」というサーバー事実だけを根拠にするので欠測しない。
 *
 * 冪等性:
 *   ①送信対象は conversion_exported_at が null の予約だけ
 *   ②Google Ads 側も orderId（予約ID）で重複排除する
 *   の二段構え。二重計上は起きない。
 *
 * 記録の順序:
 *   送信が成功してから conversion_exported_at を立てる。
 *   逆にすると送信失敗時に永久欠測になるため、順序は変えないこと。
 *
 * 認証: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 開発者トークンの審査待ちなど、設定が揃っていない間は静かに終了する。
  // その間はCSV手動アップロード（/api/admin/google-ads-conversions）で運用する。
  if (!isConfigured()) {
    return NextResponse.json({
      skipped: "Google Ads APIが未設定のためスキップしました",
      missing: missingConfig(),
      hint: "設定が揃うまでは管理画面のCSVダウンロードで代替できます",
    });
  }

  const db = getDb();
  const { data, error } = await db
    .from("google_ads_conversions")
    .select("*")
    // 1回のAPI呼び出しの上限に配慮して分割。残りは次回のCronで送る
    .limit(2000);

  if (error) {
    return NextResponse.json(
      { error: `対象の取得に失敗しました: ${error.message}` },
      { status: 500 }
    );
  }

  type Row = {
    gclid: string | null;
    gbraid: string | null;
    wbraid: string | null;
    conversion_time: string;
    conversion_value: number;
    booking_id: string;
  };
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return NextResponse.json({ uploaded: 0, message: "送信対象はありませんでした" });
  }

  // クリックIDの種類を決める。gclidが本命、iOS計測はgbraid/wbraid
  const conversions: ClickConversion[] = [];
  for (const r of rows) {
    const pick: [string | null, ClickConversion["clickIdType"]][] = [
      [r.gclid, "gclid"],
      [r.gbraid, "gbraid"],
      [r.wbraid, "wbraid"],
    ];
    const hit = pick.find(([v]) => Boolean(v));
    if (!hit) continue;
    conversions.push({
      clickId: hit[0]!,
      clickIdType: hit[1],
      conversionDateTime: r.conversion_time,
      conversionValue: r.conversion_value,
      orderId: r.booking_id,
    });
  }

  if (conversions.length === 0) {
    return NextResponse.json({ uploaded: 0, message: "有効なクリックIDがありませんでした" });
  }

  try {
    const result = await uploadClickConversions(conversions);

    // 送信が通ってから送信済みにする（順序を逆にしない）
    // 対象は「実際に取り込まれた分だけ」。部分失敗した予約まで送信済みにすると
    // 次回の抽出から外れて永久欠測になる。
    if (result.succeededOrderIds.length > 0) {
      const { error: updErr } = await db
        .from("bookings")
        .update({ conversion_exported_at: new Date().toISOString() })
        .in("id", result.succeededOrderIds);
      if (updErr) {
        // ここで失敗すると次回に再送されるが、orderIdで重複排除されるので実害はない。
        // ただし気づけるようにアラートは出す。
        await sendAdminAlert(
          "Google Ads: 送信済みフラグの更新に失敗",
          `${result.succeededOrderIds.length}件は送信できましたが、送信済みの記録に失敗しました。\n` +
            `次回のCronで再送されますが、orderIdによる重複排除が効くため二重計上にはなりません。\n\n` +
            `エラー: ${updErr.message}`
        );
      }
    }

    if (result.errors.length > 0) {
      await sendAdminAlert(
        "Google Ads: 一部のコンバージョンが取り込めませんでした",
        `対象 ${conversions.length}件 / 取込 ${result.uploaded}件\n` +
          `取り込めなかった分は送信済みにしていないので、次回のCronで再送されます。\n\n` +
          result.errors.map((e) => `- ${e.orderId}: ${e.message}`).join("\n")
      );
    }

    return NextResponse.json({
      target: conversions.length,
      uploaded: result.uploaded,
      errors: result.errors,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // 送信失敗時は conversion_exported_at を立てないので、次回のCronで自動的に再送される
    await sendAdminAlert(
      "Google Ads: コンバージョン送信に失敗",
      `対象 ${conversions.length}件の送信に失敗しました。次回のCronで再送されます。\n\n${message}`
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
