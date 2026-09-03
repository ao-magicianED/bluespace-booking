import type { Metadata } from "next";
import Link from "next/link";
import ConsultingInquiryForm from "@/components/ConsultingInquiryForm";

export const dynamic = "force-static";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
const PAGE_URL = `${SITE}/consulting`;
/** あおサロンAI公式LINE（aosalonai.com の公式プロフィールに掲載されている友だち追加リンク） */
const LINE_URL = "https://lin.ee/CKsJsWB";

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
    price: "45,000円(税別)",
    body: "60〜90分のオンライン/対面相談。現状のスペース・掲載状況・稼働データを聞き取り、改善の方向性を診断書ベースで提示します。",
  },
  {
    name: "集客改善伴走",
    tag: "月次・3ヶ月〜",
    price: "月額 80,000円(税別)",
    body: "掲載媒体の見直し・写真/価格/リスティング改善・自社サイトへの導線設計・月次の稼働レポートに基づく振り返りMTGを継続的に行います。",
  },
  {
    name: "立ち上げフルサポート",
    tag: "3〜6ヶ月",
    price: "400,000円(税別)〜",
    body: "物件探しの伴走・契約チェックリスト提供・内装/デザイン方向性・撮影・集客導線構築・(希望に応じて)運営代行までの一気通貫支援です。運営代行をご希望の場合は別途月額。",
  },
];

/**
 * 費用の目安(匿名比較)。
 * 景表法の比較広告ガイドライン(実証性・正確性・公正性)に沿うため、
 * - 各社の「公開情報に記載がある事実」だけを載せる
 * - 記載が無い項目は「公開情報に記載なし」と書き、"提供していない"とは書かない
 * - 取得日と、範囲差により単純比較できない旨を明示する
 * 出典と取得日は docs/competitor-creator-research.md の追補を参照。
 */
const MARKET_SURVEYED_ON = "2026年9月3日";

const MARKET_ROWS = [
  {
    label: "サービスの型",
    self: "立ち上げフルサポート",
    others: ["開業サポート", "個人コンサル", "コミュニティ"],
  },
  {
    // 税別/税込は各社の表記に合わせてセルごとに記載する（一括で「税別」と括ると、
    // 表記を確認できていない事業者について不正確な断定になるため）
    label: "費用",
    self: "400,000円〜(税別)",
    others: ["450,000円(税別)", "200,000円(税別)", "入会金 3,980円(買い切り/月額なし)"],
  },
  {
    label: "支援期間",
    self: "3〜6ヶ月",
    others: ["開業前〜開業2ヶ月後", "公開情報に記載なし", "公開情報に記載なし"],
  },
  {
    label: "公開情報に記載のある支援範囲",
    self: "物件探し・内装/デザイン方向性・撮影・集客導線構築。希望に応じて開業後の運営代行にも対応(運営代行は別途月額)",
    others: [
      "エリアリサーチ・物件探し・選定/交渉・内装アドバイス・掲載サポート・運営指導(撮影は別料金)",
      "物件選定アドバイス・コンセプト設計・レイアウト/内装提案・無人運営の立ち上げ指導・運営コミュニティ参加権",
      "週次の物件情報共有・トラブル対応ノウハウ・オフ会(個別支援の記載なし)",
    ],
  },
];

const FLOW = [
  { step: "1", title: "お問い合わせ", body: "下のフォーム、またはあおサロンAI公式LINE(lin.ee/CKsJsWB)からご相談ください。" },
  { step: "2", title: "無料ヒアリング", body: "現状・お悩み・スペースの状況をお伺いします（オンライン可）。" },
  { step: "3", title: "個別のご提案・お見積り", body: "状況に応じたメニューと、目安からの増減を含めた正式なお見積りをご案内します。ご契約前に必ず金額と支援範囲を書面でご提示します。" },
  { step: "4", title: "ご契約・支援開始", body: "ご納得いただいた上でご契約。伴走を開始します。" },
];

const FAQS = [
  {
    q: "料金はいくらですか？",
    a: "目安は、ライト相談（単発）45,000円、集客改善伴走（月次・3ヶ月〜）月額80,000円、立ち上げフルサポート400,000円〜です（いずれも税別、運営代行は別途月額）。支援範囲・期間により変わるため、無料ヒアリングの後に正式なお見積りをお出しします。",
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
    "都内7拠点のレンタルスペースを自社予約システム・自動集計基盤で運営してきた知見をもとに、立ち上げ・集客改善をご支援します。ライト相談45,000円〜、立ち上げフルサポート400,000円〜（税別）。",
  alternates: { canonical: PAGE_URL },
  // 【運用メモ】価格（2026-09-03オーナー承認済み）と公式LINE導線は解決済み。
  // 残る公開ゲートは、クレーム初期対応体制（docs/complaint-response-readiness.md 5章の
  // チェックリスト4項目）の運用開始のみ。これが完了したら index: true に変更し、
  // サイト内ナビにもリンクを追加すること。
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
            <span className="policy">
              通常1〜2営業日でご返信／無理な営業はいたしません／
              <a href={LINE_URL} target="_blank" rel="noopener noreferrer">
                公式LINEからも相談できます
              </a>
            </span>
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
          下記は目安の料金です。実際の金額は支援範囲・期間により異なるため、無料ヒアリングの後に個別でお見積りします。
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
              <p className="consulting-menu-price">{m.price}</p>
              <p>{m.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="storage-pricing" id="market">
        <h2>費用の目安と、当社の立ち位置</h2>
        <p className="policy storage-pricing-lead">
          レンタルスペースの立ち上げ支援は、事業者によって支援範囲も費用も大きく異なります。
          ご判断の材料にしていただくため、各社が公開している情報をもとに費用の目安を整理しました。
        </p>
        <div className="compare-wrap">
          <table className="compare-table">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col" className="is-self">
                  Blue Space(当社)
                </th>
                <th scope="col">他社コンサルA</th>
                <th scope="col">他社コンサルB</th>
                <th scope="col">他社コミュニティC</th>
              </tr>
            </thead>
            <tbody>
              {MARKET_ROWS.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="is-self">{row.self}</td>
                  {row.others.map((cell, i) => (
                    <td key={i}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="policy">
          ※{MARKET_SURVEYED_ON}時点で各社が公開している情報に基づく整理です。費用・提供内容は各社の改定により変動します。最新の内容は各社の公式情報をご確認ください。
          <br />
          ※支援範囲・期間が事業者ごとに異なるため、金額のみでの単純な比較はできません。「公開情報に記載なし」は、その項目が公開情報から確認できなかったことを示すもので、提供の有無を示すものではありません。
          <br />
          ※別料金・別途費用が生じる項目は、当社分を含めて括弧内に記載しています。
        </p>
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
            下記フォームからご相談ください。
            <a href={LINE_URL} target="_blank" rel="noopener noreferrer">
              あおサロンAI公式LINE
            </a>
            からのご相談も受け付けています。
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
