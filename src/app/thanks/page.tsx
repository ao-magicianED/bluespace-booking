import Link from "next/link";
import { getStripe } from "@/lib/stripe";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { mapSearchUrl } from "@/lib/site-url";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

type Result =
  | {
      kind: "confirmed";
      shortId: string;
      period: string;
      amount: number;
      bookingId: string;
      isMember: boolean;
      venueName: string;
      venueAddress: string;
    }
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
      const { data: venue } = await getDb()
        .from("venues")
        .select("name, address")
        .eq("id", booking.venue_id)
        .maybeSingle<Pick<Venue, "name" | "address">>();
      return {
        kind: "confirmed",
        shortId: booking.id.replace(/-/g, "").slice(-8),
        period: formatBookingPeriod(booking),
        amount: booking.total_amount,
        bookingId: booking.id,
        isMember: booking.user_id != null,
        venueName: venue?.name ?? "",
        venueAddress: venue?.address ?? "",
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
          スペース: {result.venueName}
          <br />
          {result.venueAddress && (
            <>
              住所: {result.venueAddress}（
              <a href={mapSearchUrl(result.venueAddress)} target="_blank" rel="noopener noreferrer">
                地図を見る
              </a>
              ）
              <br />
            </>
          )}
          予約番号: <strong>{result.shortId}</strong>
          <br />
          日時: {result.period}
          <br />
          お支払い金額: ¥{result.amount.toLocaleString()}
        </p>
        <p>確認メールをお送りしています。届かない場合は迷惑メールフォルダをご確認ください。</p>
        <p>
          <Link href={`/my/${result.bookingId}`}>マイページで予約を確認する（キャンセル・領収書発行も可能）</Link>
        </p>
        {!result.isMember && (
          <p className="policy">
            ご予約時のメールアドレスで会員登録いただくと、マイページから予約の確認・時間変更・キャンセル・領収書の発行ができるようになります。
          </p>
        )}
        <p>
          <Link href="/">トップへ戻る</Link>
        </p>
      </div>
    );
  }

  if (result.kind === "processing") {
    return (
      <div className="thanks-box">
        {/* Webhook処理の完了を待つ間、数秒おきに自動で再読み込みする */}
        <meta httpEquiv="refresh" content="4" />
        <h1>決済を確認しています</h1>
        <p>
          お支払いは完了しています。予約の確定処理中です（通常1分以内）。
          このページは自動的に更新されます。確定すると確認メールが届きます。
        </p>
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
