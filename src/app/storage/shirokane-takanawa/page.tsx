import type { Metadata } from "next";
import Link from "next/link";
import StorageInquiryForm from "@/components/StorageInquiryForm";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
const PAGE_URL = `${SITE}/storage/shirokane-takanawa`;
const PRODUCT = "ブルーストレージ白金高輪";

const PLANS = [
  "3ヶ月お試しプラン 月額168,000円（税込・最人気・通常¥200,000）",
  "6ヶ月プラン 月額168,000円（税込・年間 約38万円お得）",
  "1年プラン 月額158,000円（税込・最安・年間 約50万円お得）",
  "安心パック（3点セット・追加¥10,000/月・途中解約不可）希望",
  "机・椅子レンタル希望（¥2,000/月・1セット = テーブル1＋椅子2）",
  "オプションは個別に相談したい",
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
    a: "3ヶ月お試し／6ヶ月／1年の3プランからお選びいただけます（最低3ヶ月から）。まずは『3ヶ月お試しプラン』で気軽にスタートし、継続される場合はそのまま6ヶ月／1年プランに移行いただけます。1年プランは月額158,000円（税込）まで割引される最安プランです。",
  },
  {
    q: "初期費用はいくらですか？保証金はありますか？",
    a: "通常は事務手数料¥200,000＋保証金（家賃1ヶ月分）¥200,000＝計¥400,000を申し受けます。現在、3ヶ月以上のご契約者様向けに、この¥400,000相当を全額免除する初回限定キャンペーンを実施中です。ただし、一度解約後に再契約される場合は通常通り発生します。保証金は退去時に未払い分・原状回復費を差し引いてご返金いたします。",
  },
  {
    q: "見学はできますか？",
    a: "はい、ぜひお越しください。下のフォームから希望日を添えてお問い合わせください。1〜2営業日以内に日程調整のご返信をします。",
  },
  {
    q: "Amazonやヤマトなど配送業者からの荷物受取はどうすればいいですか？",
    a: "推奨は『営業所留めで送ってもらい、契約者様が週1〜2回まとめて運び入れる』運用です。共用部への置き配も可能ですが、小型・低額品の臨時利用に限り推奨しています。スマートロックの暗証番号を配送員に伝える運用は防犯上推奨いたしません。契約後に『配送業者宛て依頼文テンプレ』を含む非公式の運用ガイドをお送りしますので、参考にしてご利用ください（運用と責任は契約者様に帰属します）。",
  },
  {
    q: "ブルースペース（時間貸しの会議室）も使えますか？",
    a: "はい、倉庫契約期間中は当社運営のレンタルスペース『ブルースペース』全7拠点（白金高輪・上野・京成小岩ほか）を通常価格より10%OFFでご利用いただけます。打ち合わせ・撮影・面接など『倉庫＋会議室』をワンセットでお使いいただけます。",
  },
  {
    q: "オプションサービスはどんなものがありますか？",
    a: "任意の月額オプションとして4つご用意しています。①環境モニタリング（温湿度ログ＋エアコン遠隔操作 月¥6,000）、②防犯カメラ映像閲覧（C200カメラのライブ＋7日分アーカイブ 月¥5,500）、③物損補償オプション保険（火災・水濡れ・盗難補償 月¥3,500）、④机・椅子レンタル（2名がけテーブル1台＋椅子2脚を1セット 月¥2,000・最大2セット）。①②③の3点セット『安心パック』なら月¥10,000（単品合計¥15,000 → ¥5,000 OFF・契約期間中の途中解約不可）。机・椅子と単品オプションは翌月反映で柔軟に追加・解除OKです。",
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
      name: "3ヶ月お試しプラン（最人気）",
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
      name: "1年プラン（最安）",
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
            <li>🌱 まずは3ヶ月お試し（最人気）</li>
            <li>💴 1年プラン 158,000円／月〜（最安）</li>
            <li>🏢 ブルースペース会議室 10%OFF優待</li>
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

      <section className="storage-perks">
        <h2>ブルーストレージだけの3つの特典</h2>
        <p className="policy storage-perks-lead">
          ブルーステージが運営する既存「ブルースペース」7拠点と、長年の運用ノウハウを活かした<br />
          法人専用のサービスを標準でご用意しています。
        </p>
        <div className="storage-perks-grid">
          <div className="storage-perk">
            <span className="storage-perk-icon" aria-hidden="true">🏢</span>
            <h3>ブルースペース会議室の優待利用</h3>
            <p>
              倉庫契約期間中、当社運営の<strong>7拠点のレンタルスペース（白金高輪・上野・京成小岩ほか）</strong>を
              通常価格より <strong>10%OFF</strong> でご利用いただけます。打ち合わせ・撮影・面接で「倉庫＋会議室」がワンセットに。
            </p>
          </div>
          <div className="storage-perk">
            <span className="storage-perk-icon" aria-hidden="true">💬</span>
            <h3>法人専属メール・LINEサポート</h3>
            <p>
              契約者専用の連絡窓口で、運用相談・配送のご相談・トラブル対応まで
              <strong>1〜2営業日以内</strong>に必ずご返信。一般のトランクルームでは得られない「相談できる相手」がいる安心感。
            </p>
          </div>
          <div className="storage-perk">
            <span className="storage-perk-icon" aria-hidden="true">📑</span>
            <h3>決算月・予算サイクルに合わせた契約調整</h3>
            <p>
              法人決算月をまたぐ年契約の請求月調整、複数月一括前払い、年度内予算消化に合わせた契約開始月の前倒し等、
              <strong>経理ご担当者の手間を減らす個別調整</strong>を承ります。月次の請求書発行も標準対応。
            </p>
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

      <section className="storage-delivery">
        <h2>配送・受取の運用について</h2>
        <p className="policy storage-delivery-lead">
          ブルーストレージは「スペース貸し」であり、配送業者からの受取はお客様自身でご運用いただくのが大前提です。<br />
          ただし、運用がスムーズに回るよう、契約後に<strong>非公式の参考資料</strong>として運用ガイドをお送りしています。
        </p>
        <div className="storage-delivery-grid">
          <div className="storage-delivery-card">
            <span className="storage-delivery-emoji" aria-hidden="true">🚚</span>
            <strong>営業所留めで受取（推奨）</strong>
            <p>
              ヤマト運輸・佐川急便・日本郵便の「営業所留め」で送ってもらい、契約者様が週1〜2回まとめて運び入れる運用が最もトラブルが少ないです。
            </p>
          </div>
          <div className="storage-delivery-card">
            <span className="storage-delivery-emoji" aria-hidden="true">📦</span>
            <strong>共用部 置き配（小型・低額品のみ）</strong>
            <p>
              ビル1階エントランス前への置き配指定で受け取り、契約者様が後で運び入れる方法。盗難リスクがあるため小型・低額品の臨時利用に限ります。
            </p>
          </div>
          <div className="storage-delivery-card">
            <span className="storage-delivery-emoji" aria-hidden="true">📝</span>
            <strong>配送業者宛て依頼文テンプレも提供</strong>
            <p>
              送り状の備考欄にコピペで使える「営業所留め依頼文」「時間指定依頼文」を契約後にお渡しします。経験ベースのテンプレで余計なトラブルを未然に防ぎます。
            </p>
          </div>
        </div>
        <p className="storage-delivery-note policy">
          ※ 配送業者へのスマートロック暗証番号の伝達は<strong>推奨しておりません</strong>（防犯リスクのため）。<br />
          ※ 室内および共用部での荷物の紛失・破損・盗難について、運営は責任を負いかねます（契約者様と配送業者間で解決）。
        </p>
      </section>

      <section className="storage-options" id="options">
        <h2>オプションサービス（任意・月額）</h2>
        <p className="policy storage-options-lead">
          ご希望に応じて、月額オプションをご利用いただけます。<br />
          すべて<strong>任意</strong>ですので、必要なものだけお選びください。
        </p>

        <h3 className="storage-options-subhead">
          <span className="storage-options-subhead-num">A.</span>
          セキュリティ＆補償オプション
          <small>― セットがお得、単品契約もOK</small>
        </h3>
        <div className="storage-options-bundle-hero">
          <span className="bundle-hero-tag">⭐ おすすめ・3点セット ⭐</span>
          <h3 className="bundle-hero-title">安心パック</h3>
          <div className="bundle-hero-price">
            <span className="bundle-hero-strike">単品合計 ¥15,000</span>
            <span className="bundle-hero-amount">¥10,000</span>
            <span className="bundle-hero-unit">/月（税込）</span>
            <span className="bundle-hero-off">¥5,000 OFF</span>
          </div>
          <p className="bundle-hero-desc">
            環境モニタリング・防犯カメラ閲覧・物損補償保険の3点をセットで。<br />
            <strong>高額在庫・精密機器・代替不能の備品</strong>を置く法人様におすすめ。
          </p>
          <p className="bundle-hero-note">
            ※安心パックは<strong>契約期間中の途中解約・単品解除はできません</strong>。3ヶ月／6ヶ月／1年プランの満了タイミングで継続/解除をご判断いただきます。
          </p>
        </div>

        <p className="policy storage-options-singles-lead">
          下記3点は単品でもご契約いただけます（単品は月単位で追加・解除OK）。
        </p>
        <div className="storage-options-grid">
          <div className="storage-option-card">
            <div className="storage-option-tag">人気No.1</div>
            <span className="storage-option-emoji" aria-hidden="true">🌡️</span>
            <h3>環境モニタリング</h3>
            <div className="storage-option-price">
              <span className="amount">¥6,000</span>
              <span className="unit">/月（税込）</span>
            </div>
            <ul>
              <li>SwitchBot温湿度計のデータをスマホで閲覧</li>
              <li>エアコンの遠隔操作（オン/オフ・温度）</li>
              <li>異常値検知時のアラート通知</li>
              <li>精密機器・革製品・書類保管に最適</li>
            </ul>
          </div>
          <div className="storage-option-card">
            <span className="storage-option-emoji" aria-hidden="true">📹</span>
            <h3>防犯カメラ映像閲覧</h3>
            <div className="storage-option-price">
              <span className="amount">¥5,500</span>
              <span className="unit">/月（税込）</span>
            </div>
            <ul>
              <li>室内設置C200カメラのライブ映像</li>
              <li>過去7日分の映像アーカイブ閲覧</li>
              <li>動体検知時のスマホ通知</li>
              <li>高額品・在庫管理の見える化に</li>
            </ul>
          </div>
          <div className="storage-option-card">
            <span className="storage-option-emoji" aria-hidden="true">🛡️</span>
            <h3>物損補償オプション保険</h3>
            <div className="storage-option-price">
              <span className="amount">¥3,500</span>
              <span className="unit">/月（税込）</span>
            </div>
            <ul>
              <li>運営側の施設保険に<strong>契約者の物品も対象に追加</strong></li>
              <li>火災・水濡れ・盗難等の補償</li>
              <li>補償上限 100万円／1事故</li>
              <li>EC在庫・電子機器・什器の補償に</li>
            </ul>
          </div>
        </div>

        <h3 className="storage-options-subhead storage-options-subhead-furniture">
          <span className="storage-options-subhead-num">B.</span>
          設備レンタルオプション
          <small>― 作業スペース化したい方へ</small>
        </h3>
        <div className="storage-options-grid storage-options-grid-furniture">
          <div className="storage-option-card storage-option-card-furniture">
            <div className="storage-option-tag tag-limited">在庫わずか</div>
            <span className="storage-option-emoji" aria-hidden="true">🪑</span>
            <h3>机・椅子レンタル</h3>
            <div className="storage-option-price">
              <span className="amount">¥2,000</span>
              <span className="unit">/月・1セット（税込）</span>
            </div>
            <ul>
              <li>1セット＝<strong>2名がけテーブル1台＋椅子2脚</strong></li>
              <li>最大<strong>2セット</strong>までご用意可能（在庫限り）</li>
              <li>荷受け・梱包・PC作業の作業台として</li>
              <li>不要になれば翌月から解除OK（月単位）</li>
            </ul>
            <p className="storage-option-card-note">
              倉庫内をちょっとした作業スペースとしても使いたい方向け。来客対応や軽作業に便利です。
            </p>
          </div>
        </div>
        <p className="policy storage-options-note">
          ※ 保険オプションは運営側で加入している施設保険に契約者物品を追加する形式です。詳細条件は契約時にご案内します。<br />
          ※ 単品オプションは翌月反映で追加・解除OK。安心パックは契約期間中の途中解約・単品解除はできません。
        </p>
      </section>

      <section className="storage-pricing" id="pricing">
        <h2>料金プラン</h2>
        <p className="policy storage-pricing-lead">
          15㎡（約9畳）を1社まるごと貸し切るプラン。<br />
          ご利用期間に応じて3つの料金プランからお選びいただけます（すべて税込）。
        </p>
        <div className="storage-pricing-grid">
          <div className="storage-plan featured">
            <div className="storage-plan-badge">最人気</div>
            <div className="storage-plan-head">3ヶ月お試しプラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥168,000</span>
              <span className="unit">/月</span>
              <span className="strike">通常 ¥200,000</span>
            </div>
            <ul>
              <li>
                <strong>まずは3ヶ月で気軽にスタート</strong>
              </li>
              <li>長期プランと同じ月額単価でお試し</li>
              <li>継続時はそのまま6ヶ月／1年プランへ</li>
              <li>請求書払い対応・解約も柔軟</li>
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
          <div className="storage-plan cheapest">
            <div className="storage-plan-badge cheapest-badge">最安プラン</div>
            <div className="storage-plan-head">1年プラン</div>
            <div className="storage-plan-price">
              <span className="amount">¥158,000</span>
              <span className="unit">/月</span>
              <span className="strike">通常 ¥200,000</span>
            </div>
            <ul>
              <li>
                <strong>もっとも面積単価を抑えられる最安プラン</strong>
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
            <li>※すべてのプラン（3ヶ月お試し／6ヶ月／1年）が初回キャンペーン対象です。</li>
            <li>
              ※<strong>一度解約後に再契約される場合</strong>は、事務手数料 ¥200,000 と保証金 ¥200,000 を別途申し受けます。
            </li>
            <li>※保証金は退去時に未払い分・原状回復費を差し引いてご返金します。</li>
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
