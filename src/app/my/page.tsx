import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { formatMemberNo } from "@/lib/ledger";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "決済待ち",
  confirmed: "確定",
  cancelled: "キャンセル済み",
  expired: "期限切れ",
};

export default async function MyPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const db = getDb();
  // 会員予約（user_id一致）＋同じメールで行ったゲスト予約をまとめて表示
  const [{ data: bookings, error }, { data: member }] = await Promise.all([
    db
      .from("bookings")
      .select("*, venues(name)")
      .or(`user_id.eq.${user.id},customer_email.eq.${user.email}`)
      .in("booking_status", ["pending", "confirmed", "cancelled"])
      .order("start_at", { ascending: false })
      .limit(50),
    db.from("member_profiles").select("member_no").eq("user_id", user.id).maybeSingle(),
  ]);

  if (error) {
    console.error("[my]", error);
    return <div className="notice error">予約履歴の取得に失敗しました。</div>;
  }

  const list = (bookings ?? []) as (Booking & { venues: { name: string } | null })[];
  const now = new Date().toISOString();

  return (
    <>
      <h1>マイページ</h1>
      <p>
        {user.user_metadata?.full_name ?? user.email} さんの予約履歴
        {member?.member_no != null && (
          <span className="policy">　会員番号: {formatMemberNo(member.member_no)}</span>
        )}
        <Link href="/my/profile" style={{ marginLeft: "0.75rem" }}>
          ⚙ 会員情報の変更
        </Link>
      </p>
      {list.length === 0 && (
        <p>
          予約履歴はまだありません。<Link href="/">スペースを予約する</Link>
        </p>
      )}
      <div className="booking-list">
        {list.map((b) => (
          <Link key={b.id} href={`/my/${b.id}`} className="booking-card">
            <div>
              <strong>{b.venues?.name ?? ""}</strong>　{formatBookingPeriod(b)}
            </div>
            <div>
              <span className={`status-badge st-${b.booking_status}`}>
                {STATUS_LABEL[b.booking_status] ?? b.booking_status}
              </span>
              　¥{b.total_amount.toLocaleString()}
              {b.booking_status === "confirmed" && b.end_at < now && "　✔ 利用済み"}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
