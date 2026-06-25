import type { Metadata } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記",
  description: "ブルースペース（レンタルスペース予約サービス）の特定商取引法に基づく表記です。",
  alternates: { canonical: `${SITE}/legal/tokushoho` },
};

export default function TokushohoPage() {
  return (
    <>
      <h1>特定商取引法に基づく表記</h1>
      <table className="legal-table">
        <tbody>
          <tr>
            <th>販売事業者</th>
            <td>ブルーステージ合同会社</td>
          </tr>
          <tr>
            <th>運営責任者</th>
            <td>通信販売業務責任者　菅野 雄策</td>
          </tr>
          <tr>
            <th>所在地</th>
            <td>東京都千代田区鍛冶町2丁目8-7 光起ビル B1F</td>
          </tr>
          <tr>
            <th>連絡先</th>
            <td>
              メール: bluespace@bluestage-lcc.com
              <br />
              お問い合わせフォーム: <a href="/contact">https://bluespacerental.com/contact</a>
              <br />
              電話番号: 請求があった場合、遅滞なく開示いたします。お問い合わせフォームよりご連絡ください。
              <br />
              ※電話でのお問い合わせは受け付けておりません。
            </td>
          </tr>
          <tr>
            <th>販売価格</th>
            <td>各スペースの予約ページに表示する金額（消費税込み）</td>
          </tr>
          <tr>
            <th>商品代金以外の必要料金</th>
            <td>なし（インターネット接続にかかる通信費はお客様負担）</td>
          </tr>
          <tr>
            <th>支払方法</th>
            <td>クレジットカード（Stripe決済）</td>
          </tr>
          <tr>
            <th>支払時期</th>
            <td>予約手続き時にお支払いが確定します</td>
          </tr>
          <tr>
            <th>役務の提供時期</th>
            <td>予約時に指定いただいた日時にスペースをご利用いただけます</td>
          </tr>
          <tr>
            <th>キャンセル・返金</th>
            <td>
              利用日の8日以上前: 全額返金
              <br />
              利用日の7〜2日前: 50%返金（キャンセル料50%）
              <br />
              利用日の前日・当日: 返金不可
              <br />
              キャンセルは会員マイページから手続きできます。
            </td>
          </tr>
          <tr>
            <th>適格請求書発行事業者登録番号</th>
            <td>T6010503005539</td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
