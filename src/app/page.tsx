import Link from "next/link";
import Image from "next/image";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { getVenueContent } from "@/content/venues";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!isDbConfigured()) {
    return (
      <div className="notice error">
        <strong>セットアップ未完了:</strong> 環境変数 SUPABASE_URL /
        SUPABASE_SERVICE_ROLE_KEY を設定してください（docs/setup-guide.md 参照）。
      </div>
    );
  }

  const db = getDb();
  const { data: venues, error } = await db
    .from("venues")
    .select("*")
    .eq("active", true)
    .order("name");

  if (error) {
    return <div className="notice error">拠点情報の取得に失敗しました。</div>;
  }

  const list = (venues ?? []) as Venue[];

  return (
    <>
      <section className="home-hero">
        <span className="hero-eyebrow">公式予約・仲介手数料なし</span>
        <h1>
          スペースを選んで、<br />
          <span className="accent">そのまま予約。</span>
        </h1>
        <p>
          ブルースペースの公式予約サイトです。仲介手数料がかからないため、いつでも最安値。
          空き状況を見て、クレジットカードでそのまま予約が完了します。
        </p>
        <ul className="feature-chips">
          <li>🕐 30分単位で予約</li>
          <li>⚡ 開始直前まで受付</li>
          <li>💴 当日予約10%OFF</li>
          <li>🧾 領収書発行OK</li>
        </ul>
      </section>

      <div className="venue-grid">
        {list.map((v) => {
          const c = getVenueContent(v.slug);
          const minPrice =
            v.holiday_hourly_price != null && v.holiday_hourly_price < v.hourly_price
              ? v.holiday_hourly_price
              : v.hourly_price;
          return (
            <Link key={v.id} href={`/${v.slug}`} className="venue-card">
              <div className="venue-card-photo">
                <span className="photo-badge">¥{minPrice.toLocaleString()}〜 / 時間</span>
                <Image
                  src={`/venues/${v.slug}/hero.jpg`}
                  alt={v.name}
                  fill
                  sizes="(max-width: 700px) 100vw, 360px"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div className="venue-card-body">
                <h2>{v.name}</h2>
                {c && <p className="addr">🚉 {c.station}</p>}
                {c && <p className="addr">👥 {c.capacityShort}</p>}
                <p className="price">
                  {v.holiday_hourly_price != null && v.holiday_hourly_price !== v.hourly_price
                    ? `平日 ¥${v.hourly_price.toLocaleString()} / 土日祝 ¥${v.holiday_hourly_price.toLocaleString()}（1時間・税込）`
                    : `¥${v.hourly_price.toLocaleString()} / 時間（税込）`}
                </p>
                <p className="desc">{v.description}</p>
                <span className="venue-card-cta">空き状況を見て予約</span>
              </div>
            </Link>
          );
        })}
        {list.length === 0 && <p>現在予約可能なスペースはありません。</p>}
      </div>

      <section className="home-contact-cta">
        <h2>長期利用・定期利用は常時10%OFF</h2>
        <p>
          「月に3回、会議で使いたい」「毎週レッスンで利用したい」など、定期でのご利用は
          常時10%OFFでご提供。お問い合わせフォームからご利用ペースをお知らせください。お見積もりをお送りします。
        </p>
        <Link href="/contact?type=longterm" className="hero-book-btn">
          長期・定期利用の相談をする
        </Link>
      </section>
    </>
  );
}
