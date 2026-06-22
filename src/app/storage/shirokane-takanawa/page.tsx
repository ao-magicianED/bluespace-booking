import type { Metadata } from "next";
import Link from "next/link";
import StorageInquiryForm from "@/components/StorageInquiryForm";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
const PAGE_URL = `${SITE}/storage/shirokane-takanawa`;
const PRODUCT = "ブルーストレージ白金高輪";

const PLANS = [
  "1年プラン 月額158,000円（税込・年間 約50万円お得）",
  "6ヶ月プラン 月額168,000円（税込・年間 約38万円お得）",
  "3ヶ月お試しプラン 月額168,000円（税込・6ヶ月と同価格）",
  "単月プラン 月額200,000円（税込・契約期間なし）",
  "まずは見学・相談だけ",
];

const FEATURES = [
  {
    icon: "🏢",
    title: "1社専用・完全個室",
    body: "15㎡（約9畳）を1部屋まるごと使えます。棚を自由に配置して『第2のバックヤード』を構築できます。",
  },
  {
    icon: "🔑",
    title: "24時間スマートロック入退室",
    body: "深夜・早朝でもスマートフォン1つで入退室。防犯カメラ完備でセキュリティも安心です。",
  },
  {
    icon: "📝",
    title: "法人向け柔軟契約",
    body: "最短3ヶ月のお試しから1年契約まで。請求書払い対応・保証金なし・年払い即決割引あり。",
  },
];

const USES = [
  {
    emoji: "📦",
    label: "EC・物販",
    body: "自社の在庫・梱包材・撮影小物の置き場所に。電源あり、短時間の荷受け・棚入れ作業もご相談ください。",
  },
  {
    emoji: "💇",
    label: "美容室・サロン",
    body: "タオル、消耗品、季節備品、販促物のサブ収納庫として。",
  },
  {
    emoji: "📚",
    label: "学習塾・教室",
    body: "教材、机、椅子、イベント用品を置く第2のバックヤードとして。",
  },
  {
    emoji: "🏗️",
    label: "不動産・建築",
    body: "看板、パンフレット、内見備品、資材を置くサブ拠点として。",
  },
];

const AMENITIES = [
  "スマートロック（24時間入退室可）",
  "防犯カメラ（24時間録画）",
  "除湿機・空調",
  "電源コンセント（100V）",
  "Wi-Fi（共用）",
  "棚・什器の持ち込み自由",
];

const FAQS = [
  {
    q: "倉庫業の登録はされていますか？荷物の保管責任はどうなりますか？",
    a: "本サービスは『お荷物をお預かりする』倉庫業ではなく、施設賃貸借契約に基づく『スペース貸し』です。室内に置かれた物品の管理責任はご利用者様にあります（保管環境は除湿機・防犯カメラで適切に維持します）。",
  },
  {
    q: "契約は何ヶ月から可能ですか？",
    a: "単月（契約期間の縛りなし）／3ヶ月お試し／6ヶ月／1年の4プランからお選びいただけます。長くお使いいただくほど月額単価が下がり、1年プランは月額158,000円（税込）まで割引されます。",
  },
    q: "初期費用はいくらですか？保証金はありますか？",
    a: "通常は事務手数料¥200,000＋保証金（家賃1ヶ月分）¥200,000＝計¥400,000を申し受けます。現在、3ヶ月以上のご契約者様向けに、この¥400,000相当を全額免除する初回限定キャンペーンを実施中です。ただし、一度解約後に再契約される場合は通常通り発生します。保証金は退去時に未払い分・原状回復費を差し引いてご返金いたします。",
  },
  {
    q: "見学はできますか？",
    a: "はい、ぜひお越しください。下のフォームから希望日を添えてお問い合わせください。1〜2営業日以内に日程調整のご返信をします。",
  },
  {
    q: "保管できないものはありますか？",
    a: "居住・宿泊・作業場としての利用、危険物、食品、動植物、生体、現金、貴金属、その他法令で禁止されたものはお断りしています。詳細は契約時にご説明します。",
  },
  {
    q: "請求書払いに対応していますか？",
    a: "対応しています。法人様には月次の請求書を発行いたします。クレジットカード・銀行振込のいずれもご利用可能です。",
  },
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "ブルーストレージ白金高輪｜法人専用・15㎡完全個室ミニ倉庫【限定1室】",
  description:
    "港区白金3-1-12（白金高輪駅 徒歩7分）の15㎡完全個室ミニ倉庫。EC・サロン・教室・不動産業の『第2バックヤード』に。1年プラン月額158,000円〜・初回限定¥400,000相当が無料キャンペーン中。24時間スマートロック・法人向け請求書払い対応・限定1室。",
  alternates: { canonical: PAGE_URL },
  openGraph: {
    url: PAGE_URL,
    title: "ブルーストレージ白金高輪｜法人専用・15㎡完全個室ミニ倉庫【限定1室】",
    description:
      "白金高輪駅 徒歩7分。15㎡を1社まるごと貸し切り。1年プラン月額158,000円・保証金0円・初回限定で事務手数料無料。EC・サロン・教室の『第2バックヤード』に。24時間スマートロック・除湿機・電源・Wi-Fi完備。",
    type: "website",
    locale: "ja_JP",
    siteName: "ブルーストレージ",
    images: [{ url: `${SITE}/venues/shirokane-takanawa/hero.jpg` }],
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "SelfStorage",
  name: "ブルーストレージ白金高輪",
  description:
    "港区白金高輪の15㎡完全個室・法人向けミニ倉庫。1社専用・スマートロック24時間入退室・除湿機・電源・Wi-Fi完備。",
  url: PAGE_URL,
  image: `${SITE}/venues/shirokane-takanawa/hero.jpg`,
  address: {
    "@type": "PostalAddress",
    streetAddress: "白金3-1-12 第2浅野ビル301",
    addressLocality: "港区",
    addressRegion: "東京都",
    postalCode: "108-0072",
    addressCountry: "JP",
  },
  geo: { "@type": "GeoCoordinates", latitude: 35.6438, longitude: 139.7363 },
  amenityFeature: AMENITIES.map((a) => ({
    "@type": "LocationFeatureSpecification",
    name: a,
    value: true,
  })),
  offers: [
    {
      "@type": "Offer",
      name: "単月プラン",
      price: "200000",
      priceCurrency: "JPY",
      eligibleDuration: { "@type": "QuantitativeValue", value: 1, unitCode: "MON" },
      availability: "https://schema.org/LimitedAvailability",
    },
    {
      "@type": "Offer",
      name: "3ヶ月お試しプラン",
      price: "168000",
      priceCurrency: "JPY",
      eligibleDuration: { "@type": "QuantitativeValue", value: 3, unitCode: "MON" },
      availability: "https://schema.org/LimitedAvailability",
    },
    {
      "@type": "Offer",
      name: "6ヶ月プラン",
      price: "168000",
      priceCurrency: "JPY",
      eligibleDuration: { "@type": "QuantitativeValue", value: 6, unitCode: "MON" },
      availability: "https://schema.org/LimitedAvailability",
    },
    {
      "@type": "Offer",
      name: "1年プラン",
      price: "158000",
      priceCurrency: "JPY",
      eligibleDuration: { "@type": "QuantitativeValue", value: 12, unitCode: "MON" },
      availability: "https://schema.org/LimitedAvailability",
    },
  ],
  provider: {
    "@type": "Organization",
    name: "ブルーステージ合同会社",
    url: "https://bluestage-lcc.com",
  },
};

const FAQ_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function StorageShirokaneTakanawaPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(FAQ_JSON_LD).replace(/</g, "\\u003c"),
        }}
      />

      <section className="storage-hero">
        <div className="storage-hero-inner">
          <span className="storage-eyebrow">限定1室・先着順・法人専用</span>
          <h1>
            15㎡まるごと使える<br />
            <span className="accent">完全個室ミニ倉庫。</span>
          </h1>
          <p className="lead">
            店舗・オフィスの「置ききれない」を解決します。<br />
            白金高輪駅 徒歩7分・1社専用の<strong>『第2バックヤード』</strong>として。
          </p>
          <ul className="storage-quick-facts">
            <li>📐 約15㎡（9畳）／1社専用</li>
            <li>🔑 24時間スマートロック</li>
            <li>📝 単月〜1年／請求書払い可</li>
            <li>💴 1年プラン 158,000円〜（税込）</li>
            <li>🎉 初回限定 ¥400,000相当が無料</li>
          </ul>
          <div className="storage-hero-cta">
            <a href="#inquiry" className="storage-cta-btn">
              限定1室を確保する・見学を申し込む →
            </a>
            <span className="policy">通常1〜2営業日でご返信／無理な営業はいたしません</span>
          </div>
        </div>
      </section>

      <section className="storage-pain">
        <h2>こんなお悩み、ありませんか？</h2>
        <div className="storage-pain-grid">
          <div>
            <strong>店舗のバックヤードがパンパン</strong>
            <p className="policy">タオル・商材・季節備品の置き場に困っている</p>
          </div>
          <div>
            <strong>在庫を自宅に置きたくない</strong>
            <p className="policy">EC・物販の在庫と梱包材の保管場所が必要</p>
          </div>
          <div>
            <strong>大手トランクルームの大型サイズが満室</strong>
            <p className="policy">小区画ではなく1部屋まるごと借りたい</p>
          </div>
          <div>
            <strong>事務所を借りるほどではない</strong>
            <p className="policy">荷物だけ置ける「サブ拠点」を低コストで持ちたい</p>
          </div>
        </div>
      </section>

      <section className="storage-features">
        <h2>ブルーストレージ白金高輪の3つの特徴</h2>
        <div className="storage-feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="storage-feature">
              <span className="storage-feature-icon" aria-hidden="true">
                {f.icon}
              </span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-pricing" id="pricing">
        <h2>料金プラン</h2>
        <p className="policy storage-pricing-lead">
          15㎡（約9畳）を1社まるごと貸し切るプラン。<br />
          ご利用期間に応じて4つの料金プランからお選びいただけます（すべて税込）。
        </p>
        <div className="storage-pricing-grid storage-pricing-4col">
          <div className="storage-plan">
            <div className="storage-plan-head">単月プラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥200,000</span>
              <span className="unit">/月</span>
            </div>
            <ul>
              <li>契約期間の縛りなし</li>
              <li>1ヶ月単位で利用可能</li>
              <li>柔軟に解約OK</li>
              <li>請求書払い対応</li>
            </ul>
          </div>
          <div className="storage-plan">
            <div className="storage-plan-head">3ヶ月お試しプラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥168,000</span>
              <span className="unit">/月</span>
              <span className="strike">通常 ¥200,000</span>
            </div>
            <ul>
              <li>
                <strong>6ヶ月プランと同価格でお試し</strong>
              </li>
              <li>3ヶ月から気軽に開始</li>
              <li>継続時はそのまま長期プランへ</li>
              <li>月 ¥32,000 お得</li>
            </ul>
          </div>
          <div className="storage-plan">
            <div className="storage-plan-head">6ヶ月プラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥168,000</span>
              <span className="unit">/月</span>
              <span className="strike">通常 ¥200,000</span>
            </div>
            <ul>
              <li>半年腰を据えて利用したい方に</li>
              <li>
                <strong>年換算で約 ¥384,000 お得</strong>
              </li>
              <li>更新・延長OK</li>
              <li>請求書払い対応</li>
            </ul>
          </div>
          <div className="storage-plan featured">
            <div className="storage-plan-badge">最人気</div>
            <div className="storage-plan-head">1年プラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥158,000</span>
              <span className="unit">/月</span>
              <span className="strike">通常 ¥200,000</span>
            </div>
            <ul>
              <li>
                <strong>もっとも面積単価を抑えられる人気プラン</strong>
              </li>
              <li>
                年換算で <strong>約 ¥504,000 お得</strong>
              </li>
              <li>請求書払い・分割払い相談可</li>
              <li>更新は同条件で継続可</li>
            </ul>
          </div>
        </div>
        <div className="storage-initial-fee">
          <h3>
            <span className="campaign-tag">初回限定 ¥400,000 相当が ¥0！</span>
          </h3>
          <p className="storage-fee-headline">
            <span className="strike-amount">通常 ¥400,000</span>
            <span className="big-zero">
              → <strong>¥0</strong>
            </span>
            <span className="fee-headline-sub">（初回限定キャンペーン）</span>
          </p>
          <div className="storage-fee-grid">
            <div className="storage-fee-card">
              <span className="fee-label">事務手数料</span>
              <span className="fee-strike">通常 ¥200,000</span>
              <span className="fee-now">
                <strong>¥0</strong>
                <small>（初回限定）</small>
              </span>
            </div>
            <div className="storage-fee-card">
              <span className="fee-label">保証金（家賃1ヶ月分）</span>
              <span className="fee-strike">通常 ¥200,000</span>
              <span className="fee-now">
                <strong>¥0</strong>
                <small>（初回限定）</small>
              </span>
            </div>
            <div className="storage-fee-card">
              <span className="fee-label">鍵・カード代</span>
              <span className="fee-now">
                <strong>¥0</strong>
                <small>（スマートロックのため不要）</small>
              </span>
            </div>
          </div>
          <ul className="storage-fee-conditions">
            <li>
              ※3ヶ月以上のご契約が初回キャンペーン適用条件です（単月プランは対象外）。
            </li>
            <li>
              ※<strong>一度解約後に再契約される場合</strong>は、事務手数料 ¥200,000 と保証金 ¥200,000 を別途申し受けます。
            </li>
            <li>※保証金は通常時、退去時に未払い分・原状回復費を差し引いてご返金します。</li>
          </ul>
        </div>
        <p className="storage-limit-note">
          ※<strong>限定1室</strong>の貸し切り型のため、契約者が決まり次第募集を終了します。
        </p>
      </section>

      <section className="storage-uses">
        <h2>こんな業種・用途におすすめ</h2>
        <div className="storage-uses-grid">
          {USES.map((u) => (
            <div key={u.label} className="storage-use">
              <span className="storage-use-emoji" aria-hidden="true">
                {u.emoji}
              </span>
              <strong>{u.label}</strong>
              <p>{u.body}</p>
            </div>
          ))}
        </div>
        <p className="policy">
          ※居住・宿泊・作業場としての利用、危険物・食品・動植物等の保管は固くお断りしております。
        </p>
      </section>

      <section className="storage-spec">
        <h2>施設概要・設備</h2>
        <div className="storage-spec-grid">
          <div>
            <h3>施設概要</h3>
            <dl className="storage-dl">
              <dt>所在地</dt>
              <dd>東京都港区白金3-1-12 第2浅野ビル301</dd>
              <dt>アクセス</dt>
              <dd>東京メトロ南北線・都営三田線「白金高輪駅」徒歩7分</dd>
              <dt>広さ</dt>
              <dd>約15㎡（約9畳）／完全個室・1社専用</dd>
              <dt>運営会社</dt>
              <dd>
                <a href="https://bluestage-lcc.com" target="_blank" rel="noopener noreferrer">
                  ブルーステージ合同会社
                </a>
              </dd>
            </dl>
          </div>
          <div>
            <h3>設備</h3>
            <ul className="storage-amenities">
              {AMENITIES.map((a) => (
                <li key={a}>✓ {a}</li>
              ))}
            </ul>
          </div>
        </div>
        <div className="storage-map">
          <iframe
            src="https://maps.google.com/maps?q=%E6%9D%B1%E4%BA%AC%E9%83%BD%E6%B8%AF%E5%8C%BA%E7%99%BD%E9%87%913-1-12&hl=ja&z=17&output=embed"
            title="ブルーストレージ白金高輪 地図"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            allowFullScreen
          />
        </div>
      </section>

      <section className="storage-inquiry" id="inquiry">
        <div className="storage-inquiry-inner">
          <span className="storage-eyebrow light">限定1室・先着順</span>
          <h2>見学・お問い合わせ</h2>
          <p>
            メールアドレスを含む3項目でお気軽にお問い合わせください。<br />
            通常1〜2営業日以内に担当者よりご返信いたします。
          </p>
          <StorageInquiryForm storageProduct={PRODUCT} plans={PLANS} />
        </div>
      </section>

      <section className="storage-faq">
        <h2>よくあるご質問</h2>
        <div className="storage-faq-list">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="storage-footer-cta">
        <h2>
          <span className="accent">限定1室</span>・空き状況はお問い合わせください
        </h2>
        <p>
          時間貸しレンタルスペース「ブルースペース」もご利用可能です。
          <br />
          一時的にスペースが必要な方は{" "}
          <Link href="/" className="policy">
            時間貸しのご予約はこちら →
          </Link>
        </p>
        <a href="#inquiry" className="storage-cta-btn">
          見学・お問い合わせを送る →
        </a>
      </section>
    </>
  );
}
