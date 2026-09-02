import type { Metadata } from "next";
import Link from "next/link";
import ConsultingInquiryForm from "@/components/ConsultingInquiryForm";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
const PAGE_URL = `${SITE}/consulting`;

const PERSONAS = [
  {
    title: "スペース・物件はあるが活用できていない",
    body: "貸せるのは分かっているが、何から手をつければ収益化できるか分からない方へ。",
  },
  {
    title: "運営中だが予約が入らない",
    body: "外部モールには掲載しているのに、稼働率が伸びない・頭打ちになっている方へ。",
  },
  {
    title: "これから一人で立ち上げるのが不安",
    body: "物件契約・内装・写真・集客・運営体制、どこから手をつけるか分からない方へ。",
  },
];

const DIFFERENTIATORS = [
  {
    icon: "🧾",
    title: "自社予約システムを内製・手数料ゼロ運営",
    body: "自社予約サイトを開発し、仲介手数料ゼロで運営しています。プラットフォーム依存から抜け出す集客導線設計は、実際に自分たちがやってきたことです。",
  },
  {
    icon: "📊",
    title: "7拠点の実データに基づく助言",
    body: "日次で稼働率・予約状況を自動集計する仕組みを自社で構築し、感覚ではなくデータを見ながら7拠点を運営しています。同じ枠組みで支援先のスペースも見ます。",
  },
  {
    icon: "🤖",
    title: "AI活用との掛け算",
    body: "問い合わせ対応・レポート作成・価格見直しなど、運営の自動化ノウハウをAI活用コミュニティ「あおサロンAI」として別途発信しています。集客改善だけでなく、一人でも回せる運営体制づくりまで支援できます。",
  },
  {
    icon: "🏠",
    title: "民泊・トランクルーム運営との横断知見",
    body: "レンタルスペースに限らず、民泊・トランクルームまで空間活用ビジネスを横断して運営しています。用途変更や複合活用の相談にも対応できます。",
  },
];

const MENUS = [
  {
    name: "ライト相談",
    tag: "単発",
    body: "60〜90分のオンライン/対面相談。現状のスペース・掲載状況・稼働データを聞き取り、改善の方向性を診断書ベースで提示します。",
  },
  {
    name: "集客改善伴走",
    tag: "月次・3ヶ月〜",
    body: "掲載媒体の見直し・写真/価格/リスティング改善・自社サイトへの導線設計・月次の稼働レポートに基づく振り返りMTGを継続的に行います。",
  },
  {
    name: "立ち上げフルサポート",
    tag: "3〜6ヶ月",
    body: "物件探しの伴走・契約チェックリスト提供・内装/デザイン方向性・撮影・集客導線構築・(希望に応じて)運営代行までの一気通貫支援です。",
  },
];

const FLOW = [
  { step: "1", title: "お問い合わせ", body: "下のフォーム、またはあおサロンAI公式LINEからご相談ください。" },
  { step: "2", title: "無料ヒアリング", body: "現状・お悩み・スペースの状況をお伺いします（オンライン可）。" },
  { step: "3", title: "個別のご提案・お見積り", body: "状況に応じたメニューと料金をご案内します。料金はヒアリング内容により異なるため、事前の一律提示はしていません。" },
  { step: "4", title: "ご契約・支援開始", body: "ご納得いただいた上でご契約。伴走を開始します。" },
];

const FAQS = [
  {
    q: "料金はいくらですか？",
    a: "支援範囲・期間によって大きく異なるため、無料ヒアリングの後に個別でお見積りをお出ししています。ライト相談（単発）、集客改善伴走（月次）、立ち上げフルサポートの3つのメニューを軸にご提案します。",
  },
  {
    q: "必ず売上が上がりますか？",
    a: "成果を保証するものではありません。過去にご支援した案件の中には売上が大きく改善した事例もありますが、立地・投資額・競合状況・実施した施策等の条件によって結果は異なります。",
  },
  {
    q: "Blue Spaceの実績データは見られますか？",
    a: "noteの「Blue Space運営レポート」で拠点別の予約数・前月比・用途カテゴリを毎月公開しています（実額は非公開）。コンサルとしてご契約いただいた方には、対象拠点の実数データを期間限定・NDA前提で共有しながら伴走します。",
  },
  {
    q: "しつこい営業をされませんか？",
    a: "無理な勧誘は行いません。ヒアリング・ご提案の後、ご検討いただく時間を差し上げます。",
  },
  {
    q: "すぐに対応してもらえますか？",
    a: "7拠点の運営と並行して代表が直接ご対応するため、支援の質を保つ目的で月間の新規ご相談の受付を3件までとしています。その月の受付が埋まっている場合は、翌月以降のご案内となることがあります。お問い合わせいただいた時点の状況を個別にお伝えします。",
  },
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "レンタルスペース立ち上げ・集客改善コンサル｜Blue Space",
  description:
    "都内7拠点のレンタルスペースを自社予約システム・自動集計基盤で運営してきた知見をもとに、立ち上げ・集客改善をご支援します。料金は個別ヒアリング後にお見積り。",
  alternates: { canonical: PAGE_URL },
  // 【運用メモ】価格レンジがオーナー未確定（戦略書9章・付録C#5）、公式LINE導線の実接続、
  // クレーム初期対応体制（docs/complaint-response-readiness.md）の運用開始が完了するまでは
  // 検索エンジンにインデックスさせず、note/YouTubeからのリンクも本公開しない。
  // すべて整い次第 index: true に変更し、サイト内ナビにもリンクを追加すること。
  robots: { index: false, follow: false },
};

const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Service",
  serviceType: "レンタルスペース立ち上げ・集客改善コンサルティング",
  name: "Blue Space 立ち上げ・集客改善コンサル",
  description:
    "都内7拠点のレンタルスペース運営実績をもとにした、物件探し・集客改善・立ち上げ支援コンサルティング。",
  provider: {
    "@type": "Organization",
    name: "ブルーステージ合同会社",
    url: SITE,
  },
  areaServed: "JP",
  url: PAGE_URL,
};

export default function ConsultingPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c"),
        }}
      />

      <section className="storage-hero">
        <div className="storage-hero-inner">
          <span className="storage-eyebrow">立ち上げ・集客改善コンサル</span>
          <h1>
            レンタルスペースの立ち上げ・集客改善を、
            <br />
            <span className="accent">実データで伴走します。</span>
          </h1>
          <p className="lead">
            都内7拠点のレンタルスペース「Blue Space」を、自社予約システム・自動集計基盤で運営してきた知見をもとに、
            物件探しから集客改善、立ち上げの伴走まで対応します。
          </p>
          <ul className="storage-quick-facts">
            <li>🏢 都内7拠点運営の実績</li>
            <li>🧾 自社予約システム内製・手数料ゼロ</li>
            <li>📊 日次自動集計基盤による実データ運営</li>
            <li>🙋 月間の新規ご相談は3件まで</li>
            <li>💬 無料ヒアリングの上で個別ご提案</li>
          </ul>
          <div className="storage-hero-cta">
            <a href="#inquiry" className="storage-cta-btn">
              無料ヒアリングを申し込む →
            </a>
            <span className="policy">通常1〜2営業日でご返信／無理な営業はいたしません</span>
          </div>
        </div>
      </section>

      <section className="storage-pain">
        <h2>こんなお悩み、ありませんか？</h2>
        <div className="storage-pain-grid">
          {PERSONAS.map((p) => (
            <div key={p.title}>
              <strong>{p.title}</strong>
              <p className="policy">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-features">
        <h2>Blue Spaceが選ばれる理由</h2>
        <div className="storage-feature-grid">
          {DIFFERENTIATORS.map((d) => (
            <div key={d.title} className="storage-feature">
              <span className="storage-feature-icon" aria-hidden="true">
                {d.icon}
              </span>
              <h3>{d.title}</h3>
              <p>{d.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-perks">
        <h2>メニュー(概要)</h2>
        <p className="policy storage-perks-lead">
          料金は支援範囲・期間により異なるため、無料ヒアリングの後に個別でお見積りします。
          <br />
          支援の質を保つため、<strong>月間の新規ご相談の受付は3件まで</strong>とさせていただいています。
        </p>
        <div className="storage-perks-grid">
          {MENUS.map((m) => (
            <div key={m.name} className="storage-perk">
              <span className="storage-perk-icon" aria-hidden="true">
                📋
              </span>
              <h3>
                {m.name}
                <br />
                <small className="policy">{m.tag}</small>
              </h3>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-pain">
        <h2>ご相談の流れ</h2>
        <div className="storage-pain-grid">
          {FLOW.map((f) => (
            <div key={f.step}>
              <strong>
                {f.step}. {f.title}
              </strong>
              <p className="policy">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-inquiry" id="inquiry">
        <div className="storage-inquiry-inner">
          <span className="storage-eyebrow light">無料ヒアリング</span>
          <h2>お問い合わせ・ご相談</h2>
          <p>
            下記フォームからご相談ください。あおサロンAI公式LINEをご利用中の方は、そちらからのご相談も受け付けています。
            <br />
            通常1〜2営業日以内に担当者よりご返信いたします。
          </p>
          <ConsultingInquiryForm />
          <p className="policy" style={{ marginTop: "1rem" }}>
            料金・支援範囲は個別のヒアリング後にご案内します。過去にご支援した案件の中には売上が大きく改善した事例もありますが、
            立地・投資額・競合状況・実施した施策等の条件によって結果は異なり、同様の成果を保証するものではありません。
          </p>
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
        <h2>まずは無料ヒアリングから</h2>
        <p>
          レンタルスペースの立ち上げ・集客改善でお悩みの方は、お気軽にご相談ください。
          <br />
          <Link href="/" className="policy">
            Blue Spaceの拠点一覧・ご予約はこちら →
          </Link>
        </p>
        <a href="#inquiry" className="storage-cta-btn">
          無料ヒアリングを申し込む →
        </a>
        <p className="policy" style={{ marginTop: "1rem" }}>
          <Link href="/consulting/tokushoho">特定商取引法に基づく表記</Link>
        </p>
      </section>
    </>
  );
}
