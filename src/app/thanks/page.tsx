import Link from "next/link";
import { getStripe } from "@/lib/stripe";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

type Result =
  | { kind: "confirmed"; shortId: string; period: string; amount: number }
  | { kind: "processing" }
  | { kind: "unknown" };

/**
 * 決済完了後の着地ページ。
 * クエリのsession_idを基にStripe・DBの実際の状態を確認してから表示する
 * （URLを直接叩いただけでは「確定」と表示されない）。
 */
async function verify(sessionId: string | undefined): Promise<Result> {
  if (!sessionId || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) return { kind: "unknown" };
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return { kind: "unknown" };
    const bookingId = session.metadata?.booking_id;
    if (!bookingId) return { kind: "unknown" };

    const { data: booking } = await getDb()
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .eq("stripe_session_id", sessionId)
      .maybeSingle<Booking>();
    if (!booking) return { kind: "unknown" };

    if (booking.booking_status === "confirmed") {
      return {
        kind: "confirmed",
        shortId: booking.id.replace(/-/g, "").slice(-8),
        period: formatBookingPeriod(booking),
        amount: booking.total_amount,
      };
    }
    // 決済は済んでいるがWebhook処理が未着（数秒〜数分のラグ）
    return { kind: "processing" };
  } catch (e) {
    console.error("[thanks] 検証失敗:", e);
    return { kind: "unknown" };
  }
}

export default async function ThanksPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const result = await verify(session_id);

  if (result.kind === "confirmed") {
    return (
      <div className="thanks-box">
        <h1>ご予約ありがとうございます</h1>
        <p>決済が完了し、ご予約が確定しました。</p>
        <p>
          予約番号: <strong>{result.shortId}</strong>
          <br />
          日時: {result.period}
          <br />
          お支払い金額: ¥{result.amount.toLocaleString()}
        </p>
        <p>確認メールをお送りしています。届かない場合は迷惑メールフォルダをご確認ください。</p>
        <p>
          <Link href="/">トップへ戻る</Link>
        </p>
      </div>
    );
  }

  if (result.kind === "processing") {
    return (
      <div className="thanks-box">
        <h1>決済を確認しています</h1>
        <p>
          お支払いは完了しています。予約の確定処理中です（通常1分以内）。
          確定すると確認メールが届きます。
        </p>
        <p>このページを再読み込みすると最新の状態が表示されます。</p>
        <p>
          <Link href="/">トップへ戻る</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="thanks-box">
      <h1>予約状態を確認できませんでした</h1>
      <p>
        お支払い・ご予約の状態が確認できません。確認メールが届いていない場合は、
        お手数ですが <Link href="/contact">お問い合わせフォーム</Link> からご連絡ください。
      </p>
      <p>
        <Link href="/">トップへ戻る</Link>
      </p>
    </div>
  );
}
