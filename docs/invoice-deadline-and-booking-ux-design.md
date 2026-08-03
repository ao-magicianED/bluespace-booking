# 設計書: 請求書払い期限短縮＋予約UX改修（追尾バー・即時料金）

- 作成日: 2026-08-03
- 作成: Claude（Fable 5）／実装: Sonnet 5 予定
- レビュー: ①マルチエージェント批判レビュー（決済整合性・運用・UXの3視点） ②Codexセカンドオピニオン（gpt-5.6-sol）— いずれも反映済み
- 改訂履歴:
  - v2 — 批判レビュー反映（voidの猶予分離・上限96h化・銀行休業日・申込前期限プレビュー等）
  - v3 — Codex反映(請求書発行サガの堅牢化・Webhook processing リース・funded誤警報修正・上限95h化・デプロイ順序修正等）

## 0. 背景と目的

2026-07-28、法人顧客が請求書払いを試みて4回失敗（Stripe銀行振込未有効化が原因）→ カード決済で予約完了、という事象が発生。銀行振込は 2026-08-03 に有効化を確認済み。これを機に以下を改善する。

1. **請求書払いの支払期限が長すぎる**（現行: 発行から3日）→ 枠が長時間 pending で塞がり機会損失。期限を「申込の翌営業日18:00」に短縮し、早期入金を促す
2. **期限切れの解放が1日1回のcronでしか動かない** → 高頻度チェックに（無料でやるためGAS外部cron）
3. **時間選択→予約ボタンまでの導線が弱い** → 画面下部の追尾バー＋選択即時の料金表示
4. （フェーズ2）リピーターのカード再入力を不要に

またレビュー過程で**現行本番に存在する決済バグ2件**（§4.6・§4.7）が見つかったため、PR-Aで同時に修正する。

## 1. スコープとフェーズ

| フェーズ | 内容 | PR |
|---|---|---|
| P1-A | 期限ルール変更＋期限切れ処理再設計（expired/void分離）＋高頻度チェック＋リマインダー＋期限プレビュー＋既存決済バグ2件修正＋文言・マイページ・管理画面改善 | PR-A |
| P1-B | 追尾予約バー＋選択即時の料金表示 | PR-B |
| P2 | リピーター向けカード保存・再利用（設計のみ本書§9、実装判断は別途） | PR-C |

前提: 請求書払いの**適格条件（法人＋利用開始72時間前まで）は変更しない**。

## 2. 決定事項サマリ

| 項目 | 決定 |
|---|---|
| 支払期限 | **申込の翌営業日18:00 JST**。上限2つ: ①申込+95h以内で最も遅い18:00（連休対策。DB上限4日に対しクロック差余裕1hを確保） ②利用開始−24h |
| 営業日判定 | 土日＋`jp_holidays`（国民の祝日）＋**固定の銀行休業日 12/31・1/2・1/3**。祝日DB障害時は土日＋固定休業日のみでスキップ（fail-open・期限が早まる方向） |
| 期限切れ処理 | **「枠の解放（expired化）」「お客様への通知」「請求書のvoid」を3つに分離**し、それぞれ独立に再試行可能にする。expired化=期限後すみやか（GAS cron・ベストエフォート）、通知=専用フラグでclaim、void=期限+24時間後 |
| 高頻度チェック | 新設 `GET /api/cron/expire-invoices` を GAS から10分おきに呼ぶ。既存の毎日3:00 Vercel cron はフォールバックとして維持 |
| リマインダー | 期限9時間前（＝期限当日の朝9:00頃）に未入金なら1回だけメール |
| 迷子入金の検知 | `customer_cash_balance_transaction.created` Webhook＋**void直後の残高チェック**の二段構え。誤警報防止のため「請求書がterminal（void済み等）のときだけ」アラート |
| 発行サガの堅牢化 | 請求書発行後のDB保存エラーを検査し、失敗時は補償処理（void＋予約失効）。Stripe顧客IDもDB保存。cash balanceの `reconciliation_mode: "automatic"` を明示 |
| Webhook信頼性 | `stripe_events` の `processing` 滞留にリース（15分）を導入し、処理中クラッシュ後の再送を受理できるようにする（**既存本番バグの修正**） |
| 期限の事前提示 | /api/quote レスポンスに期限プレビュー（`dueAt`・`dueOnNonBusinessDay` 等）を追加し、**申込前に「お支払い期限: 8/4（火）18:00」を表示**。全期限表示に曜日を付ける |
| DB関数の4日上限 | ロジック変更なし。リポジトリと本番の定義乖離を0021で解消（pg_get_functiondefで取得） |
| 追尾バー | `position:fixed` 下部バー。step="select" かつ選択ありで表示。FloatingNav とは body クラスで排他。CTAは既存と同一文言 |
| 即時料金 | 選択が最低利用時間に達したら /api/quote を即時呼び（既存300msデバウンス維持）。レートリミット 60→120回/5分 |

## 3. A: 支払期限ルール

### 3.1 新ルール（式）

```
営業日 = 土日でも、jp_holidays（国民の祝日）でも、銀行休業日（12/31, 1/2, 1/3）でもない日

候補1 = 申込翌日以降で最初の営業日の 18:00 JST
候補2 = 申込+95h の時点以前で最も遅い 18:00 JST    … 連休対策の上限（常にどこかの18:00）
基本期限 = min(候補1, 候補2)
最終期限 = min(基本期限, 利用開始 − 24h)            … 物理上限（時刻は任意になってよい）
```

- 上限を95hにした理由: 72hだと**通常の金曜申込ですら**期限が日曜18:00に切り詰められ「翌営業日18:00」の案内と矛盾する（金曜15:00→月曜18:00は75h）。DB関数の上限は4日（96h）だが、**アプリのnowとDBのnow()は別ホストでクロック差がありうる**ため、1時間の余裕を取り95hとする（Codex指摘）
- 95h上限が実際に効くのは「翌営業日が4日近く先」になる連休のみ。**3連休（例: 木曜申込＋金曜祝日→期限日曜18:00）でも発生する**ため、文言は「大型連休」ではなく「連休を挟む場合は早まることがあります」とし、申込前の期限プレビュー（§6.1）で必ず実期限を見せる

### 3.2 具体例

| 申込タイミング | 期限 | 猶予 |
|---|---|---|
| 火曜 11:00 | 水曜 18:00 | 31h |
| 月曜 23:30 | 火曜 18:00 | 18.5h（最短ケース） |
| 金曜 15:00 | 月曜 18:00 | 75h |
| 土曜 10:00 | 月曜 18:00 | 56h |
| 木曜 14:00（金曜が祝日の3連休） | 月曜18:00は100hで95h超 → 候補2: **日曜 18:00** | 76h |
| 12/30 10:00（12/31〜1/3は銀行休業日） | 候補1=1/4 18:00 は128hで95h超 → 候補2: **1/2 18:00** | 80h |
| 利用開始が期限より近い | 利用開始−24h（従来通り） | — |

- 最低でも**18時間**の猶予が保証される（申込23:59→翌営業日18:00）
- 12/31・1/2・1/3 は国民の祝日ではないため `jp_holidays` に入らない。**固定リスト `BANK_HOLIDAYS_MMDD = ["12-31", "01-02", "01-03"]`** を営業日判定に合流させる（1/1は祝日としてDBに入る）
- 期限が休日中に落ちるケースは「枠を4日以上塞がない」ためのトレードオフとして許容し、①申込前の期限プレビュー＋休日警告（§6.1） ②「土日祝も振込可能な金融機関（ネットバンキング等）のご利用をおすすめします」の文言で対処する

### 3.3 実装

`src/lib/invoice.ts` を改修。**テスト可能にするため祝日Setを注入する純関数＋asyncラッパーの2段構成**にする。

```ts
// 純関数（テスト対象）: holidaySet を注入
export function calcInvoiceDueAtWithHolidays(
  startAt: Date, now: Date, holidaySet: Set<string>
): Date

// asyncラッパー（本番用）: getHolidaySet で祝日を取得して純関数へ
export async function calcInvoiceDueAt(startAt: Date, now: Date): Promise<Date>
```

- 営業日探索は `addDaysJst` / `jstDayOfWeek` / `isHolidayDate`（すべて既存）＋ `BANK_HOLIDAYS_MMDD` 判定
- 祝日照会は「翌日から+6日分」を `getHolidaySet` に渡せば足りる
- `INVOICE_DUE_DAYS = 3` は廃止し、`INVOICE_MAX_DUE_HOURS = 95` と `INVOICE_DUE_HOUR_JST = 18` を新設
- 呼び出し側 `src/app/api/checkout/route.ts:190` は `await` に変更
- `isInvoiceEligible`（72h）は据え置き

### 3.4 DB上限との整合（重要・要注意ポイント）

`create_pending_booking` の expires_at 上限は**本番DBのみ「4日」に緩和済み**で、リポジトリ内の SQL（0001/0003）は `interval '31 minutes'` のまま（0004_invoice.sql:15-17 の注記が正）。

- 新期限式は候補2により常に申込+95h以内＋クロック差余裕1h → 上限に抵触しない → **DB関数のロジック変更は不要**
- ローカル/新環境の再構築で31分上限に戻る罠があるため、`0021` に**本番の現行定義を再掲**して乖離を解消する
- **取得手順（必須・手書き復元禁止）**: 本番DBで
  ```sql
  select pg_get_functiondef(oid) from pg_proc where proname = 'create_pending_booking';
  ```
  を実行し、返った定義を**そのまま**0021に貼る。0003_members.sql（31分版）からのコピペ改変は禁止（書き換え漏れで本番の請求書予約が全滅するため）

### 3.5 二重管理の解消

`BookingGrid.tsx:397-401` の72時間ハードコード（`invoice.ts` と二重管理）を解消する。`invoice.ts` は Stripe SDK を import するためクライアントから参照できない。

→ **`src/lib/invoice-rules.ts`（クライアント安全な定数・純関数のみ）を新設**し、`INVOICE_MIN_LEAD_HOURS` / `INVOICE_DUE_BEFORE_START_HOURS` / `INVOICE_MAX_DUE_HOURS` / `INVOICE_DUE_HOUR_JST` / `BANK_HOLIDAYS_MMDD` / `isInvoiceEligible` / `calcInvoiceDueAtWithHolidays` をここへ移動。`invoice.ts` は re-export で後方互換を保つ。

## 4. B: 期限切れ処理の再設計＋高頻度チェック＋決済堅牢化

### 4.1 現状の問題

- 請求書払いは Stripe が期限で自動 void しないため、cron でしか解放されない（現行: 毎日 JST 3:00 の1回のみ）
- **「期限後〜翌3:00まで請求書がopen」という現行の遅延は暗黙のセーフティネットだった**: 期限を数時間過ぎた着金でも `invoice.paid` が発火し、expired→confirmed 復旧で救済されていた。単純な高頻度cron化＋即時voidはこのネットを壊す

### 4.2 設計: expired化・通知・voidの3分離

**「枠の解放」は即時、「通知」は独立claim、「入金経路の遮断」は24時間の猶予後**。3つを分離するのは、途中クラッシュしてもそれぞれが次回cronで再試行できるようにするため（Codex指摘: expired化→メール送信を一体にすると、間で落ちたとき通知が永久に失われる）。

```
Q1a（枠解放）: pending ∧ invoice ∧ expires_at < now() → 原子的に expired 化（メールなし）
Q1b（通知）  : expired ∧ invoice ∧ invoice_expiry_notice_sent_at IS NULL
              ∧ expires_at < now() ∧ expires_at > now() − 48h
              → claim（フラグ更新）→ お客様メール＋管理者通知
Q2（遅延void）: expired ∧ invoice ∧ stripe_invoice_id IS NOT NULL
              ∧ invoice_voided_at IS NULL ∧ expires_at < now() − 24h
              → voidInvoice → invoice_voided_at 記録 → 残高チェック（§4.5）
Q3（リマインダー）: §5
```

- **Q1bの利点**: `create_pending_booking` 内部の掃除や `expire_stale_pendings` RPC など**別経路でexpired化された請求書予約にも通知が届く**（従来は通知漏れ）。`expires_at > now()−48h` は過去分への遡及送信を防ぐガード
- **猶予中（期限後〜+24h）に着金した場合**: 請求書はまだopenなので `invoice.paid` が発火 → 既存の expired→confirmed 復旧 → 枠が空いていれば予約復活、埋まっていれば既存の「返金確認」アラート。**資金が黙って滞留しない**
- **期限切れメールの文言**（「キャンセルされました」断定をやめる）:
  ```
  件名: 【お支払い期限切れ】ご予約の仮押さえを解除しました

  お支払い期限までに入金の確認ができなかったため、以下のご予約の仮押さえを解除しました。
  この時間帯は他のお客様が予約できる状態になっています。

  （予約内容）

  ※すでにお振込がお済みの場合は行き違いです。入金を確認でき次第、
    空き状況を再確認のうえ、予約の確定またはご返金のご連絡をいたします。
  ※これからのお振込はご遠慮ください。引き続きご利用をご希望の場合は、
    お手数ですが再度ご予約ください。
  ```
- `handleInvoiceVoided`（webhook）にも `invoice_voided_at` の記録を追加する（手動void・uncollectible時にQ2が永久に再試行するのを防ぐ・Codex指摘）。Q2側も「void不能エラー（既にvoid済み/paid済み等）」を受けたら `invoice_voided_at` を記録して再試行を止める
- 猶予24hの根拠: 非モアタイム銀行の「15時以降振込→翌営業日朝着金」を概ねカバー。期限は原則18:00なので+24hで翌日18:00までopen

### 4.3 実装

1. **`src/lib/expire-invoices.ts` 新設**:
   ```ts
   export async function expireOverdueInvoices(): Promise<{
     expired: number; notified: number; voided: number; reminded: number; errors: number;
   }>
   ```
   - Q1a〜Q3を順に実行。**各行の処理は行単位のtry/catchで包み、1件の異常が後続を止めない**（Codex指摘）。各クエリは `.limit(200)`
   - 一部失敗時は `errors` に計上し、レスポンスの HTTP ステータスは200のまま（GAS側の失敗検知はエンドポイント死活のみでよい。件数異常は管理者アラートで通知）
2. **`src/app/api/cron/expire-invoices/route.ts` 新設**（GET・`Authorization: Bearer CRON_SECRET`）
3. **`maintenance/route.ts` の 0-a ブロックを `expireOverdueInvoices()` 呼び出しに置換**（フォールバック継続）
4. **GAS から10分おきに呼ぶ**（§4.4）。「期限後10分以内」は保証ではなく**ベストエフォート**（GASトリガーの揺らぎ・障害時は最大で翌3:00のフォールバックまで遅延）と明記

処理量: 請求書予約は低頻度（月数件想定）のため1回のcronは通常0〜1件。Vercelの実行時間制限は問題にならない。

### 4.4 GASスクリプト（設置はあおさんの手作業）

`docs/gas-invoice-expiry-cron.md` として納品。**例外もtry/catchで失敗として扱い、通知は「成功→失敗の遷移時に1通」＋「失敗継続中は24時間ごとに1通」の状態遷移方式**（HTTP非200のみの検知ではタイムアウト/DNS失敗が漏れ、毎回送るとメール爆撃＋Gmail quota枯渇のため）:

```javascript
// ============================================================
// ★設定（スクリプトプロパティに設定: プロジェクトの設定 > スクリプト プロパティ）
//   ENDPOINT_URL … https://<本番ドメイン>/api/cron/expire-invoices
//   CRON_SECRET  … Vercelの環境変数 CRON_SECRET と同じ値
// ============================================================

function runExpireInvoices() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("ENDPOINT_URL");
  const secret = props.getProperty("CRON_SECRET");
  if (!url || !secret) throw new Error("スクリプトプロパティ ENDPOINT_URL / CRON_SECRET を設定してください");

  let ok = false;
  let detail = "";
  try {
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + secret },
      muteHttpExceptions: true,
    });
    ok = res.getResponseCode() === 200;
    detail = "HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 300);
  } catch (e) {
    ok = false;
    detail = "EXCEPTION: " + e; // タイムアウト・DNS失敗等もここで捕捉
  }

  const now = Date.now();
  const wasFailing = props.getProperty("FAILING_SINCE");
  if (ok) {
    if (wasFailing) props.deleteProperty("FAILING_SINCE");
    props.deleteProperty("LAST_ALERT_AT");
    return;
  }
  // 🚨 失敗: 初回遷移 or 24時間ごとに1通だけ通知
  if (!wasFailing) {
    props.setProperty("FAILING_SINCE", String(now));
    props.setProperty("LAST_ALERT_AT", String(now));
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      "🚨 [予約システム] 請求書期限チェックcronが失敗し始めました", detail);
  } else {
    const lastAlert = Number(props.getProperty("LAST_ALERT_AT") || 0);
    if (now - lastAlert > 24 * 60 * 60 * 1000) {
      props.setProperty("LAST_ALERT_AT", String(now));
      MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
        "🚨 [予約システム] 請求書期限チェックcronの失敗が継続中", detail);
    }
  }
}

// ✅ 疎通テスト（設置後に一度手動実行して Logger を確認）
function testConnection() {
  const props = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(props.getProperty("ENDPOINT_URL"), {
    method: "get",
    headers: { Authorization: "Bearer " + props.getProperty("CRON_SECRET") },
    muteHttpExceptions: true,
  });
  Logger.log("HTTP " + res.getResponseCode() + " / " + res.getContentText());
}
```

- トリガー: `runExpireInvoices` を時間主導型・**10分おき**
- フォールバックの非対称性（明記）: GAS停止中も毎日3:00のVercel cronが**期限切れ処理とvoid**を実行（最悪: 期限切れ後〜21時間保持）。**リマインダーは期限9時間前が条件のため3:00のcronでは原則発火せず、GAS停止中は止まる**（許容: 補助機能であり予約フローは壊れない）

### 4.5 迷子入金の検知（誤警報しない設計）

**重要な前提**: 猶予期間（期限後〜+24h）は「予約=expired・請求書=open」が正常状態であり、このとき着金すると `funded` → 自動充当 → `invoice.paid` → 復旧、が正しい流れ。**予約がexpiredというだけでアラートを出すと正常系を誤警報する**（レビュー指摘）。イベント配信順序も保証されないため、判定は「請求書がterminalか」で行う。

1. **`customer_cash_balance_transaction.created` ハンドラを新設**（webhooks/stripe/route.ts のswitchに追加）:
   - `type` が `"funded"` または `"unapplied_from_payment"` 以外は無視
   - 顧客のmetadata（`booking_id`）を取得。**booking_id が無い顧客は他サービスの決済なので黙って無視**（appタグ方針と同じ思想）
   - 予約の `stripe_invoice_id` から請求書を retrieve し、**status が `void` / `uncollectible` のときだけ**管理者アラート:「⚠️ 無効化済み請求書への入金が顧客残高に滞留しています。Stripeダッシュボードから返金してください（予約ID・金額 `net_amount`・顧客ID）」
   - 請求書が `open` / `paid` なら何もしない（自動充当の正常系）
2. **Q2のvoid直後に残高チェック**: void成功後 `customers.retrieveCashBalance(customerId)` を呼び、JPY残高が正なら同様のアラート（**部分入金**されたままvoidに至ったケースを検知。部分入金は `invoice.paid` を発火させないためWebhookだけでは漏れる・Codex指摘）
3. **過入金チェック**: `handleInvoicePaid` の確定処理後にも残高チェックを行い、正なら「過入金の可能性」アラート（低優先・ベストエフォート）
4. 月次見直し（毎月10日）でのStripe顧客残高の目視確認は保険として継続

※このために `bookings.stripe_invoice_customer_id` を保存する（§4.6）。Webhookの`customer` フィールドからも取れるが、Q2の残高チェックにはDB保存が必須。

### 4.6 請求書発行サガの堅牢化（既存本番バグ修正①）

現行 `checkout/route.ts:238-249` は請求書発行後のDB保存（`stripe_invoice_id` 等のUPDATE）の**エラーを検査していない**。失敗すると「Stripeでは請求書送信済み・DBでは `payment_method='card'`／`stripe_invoice_id=null`」の孤立状態になり、期限切れcronの対象外・入金Webhookは請求書ID不一致で自動確定不可になる（Codex指摘・critical）。

カードフローには同種の防御が既にある（`stripe_session_id` 保存失敗→セッション失効＋予約解放、route.ts:341-365）。請求書フローにも同じパターンを入れる:

1. UPDATEの `error` を検査し、**保存できたことを確認してから**お客様への受付メールを送る
2. 保存失敗時の補償処理: `voidInvoice(invoiceId)`（ベストエフォート）→ 予約をexpired化 → 管理者アラート → お客様には「請求書の発行に失敗しました」エラー応答（既存の請求書発行失敗パスに合流）
3. UPDATEに `stripe_invoice_customer_id`（customers.create の戻り値）も保存する（§4.5の残高チェック用）
4. `customers.create` に **`cash_balance: { settings: { reconciliation_mode: "automatic" } }` を明示**（現在はアカウント既定値に暗黙依存。既定が `manual` に変わると入金しても `invoice.paid` が発火しなくなる・Codex指摘）
5. 送信直前クラッシュ等の残存ウィンドウ（送信済みだがUPDATE前に落ちる）は、入金時のWebhook検証アラート（「請求書ID不一致」）で人間が検知できる。低頻度のため自動リコンサイルは見送り（将来課題としてメモ）

### 4.7 Webhookの`processing`滞留リース（既存本番バグ修正②）

現行のWebhook冪等化は `stripe_events` に `status='processing'` をINSERTしてから処理する方式だが、**処理中にプロセスが落ちると status が processing のまま残り、Stripeからの全再送が「重複」として永久にスキップされる**（webhooks/stripe/route.ts:49-59）。`invoice.paid` がこの状態になると入金済みなのに予約が確定されない（Codex指摘・critical）。

修正: **リース方式**を導入する。

- 0021で `stripe_events.processing_started_at timestamptz` を追加（default now()）
- 重複INSERT時に既存行が `processing` の場合、`processing_started_at < now() − 15分` なら**原子的に再claim**（`UPDATE ... SET processing_started_at = now() WHERE event_id = ? AND status = 'processing' AND processing_started_at < now() − interval '15 minutes'` が1行更新できた場合のみ再処理）して処理を続行。それ以外（新鮮なprocessing / processed）は従来通りスキップ
- 各ハンドラは元々冪等（原子的更新・claim方式）なので再処理は安全

## 5. C: 入金リマインダーメール

- **条件**: `pending` ∧ `invoice` ∧ 期限まで9時間以内 ∧ 期限未到来 ∧ `invoice_reminder_sent_at IS NULL`（期限は通常18:00なので当日朝9:00頃に届く）
- **冪等化**: 既存パターン踏襲（claim方式: 先にフラグUPDATE→送信失敗ならNULLに戻す）
- **請求書URL**: `stripe.invoices.retrieve(stripe_invoice_id)` で都度取得。失敗時はURL無しで送信（「Stripeからお送りした請求書メールをご確認ください」）
- **件名は期限日に依存しない表現**（期限が start−24h 由来で深夜のとき「本日期限」が誤りになるため・レビュー指摘）:
  ```
  件名: 【お支払い期限間近】お振込のお願い {拠点名} {期間}

  {customer_name} 様

  ご予約のお支払い期限が近づいてまいりました。

  ▼ご予約内容
  スペース: {拠点名}
  日時: {期間}
  金額: ¥{total_amount}
  お支払い期限: {expires_at を JST・曜日つきで（例: 8月4日（火）18:00）}

  ▼請求書（お振込先の確認はこちら）
  {hosted_invoice_url}

  期限までに入金が確認できない場合、ご予約の仮押さえは自動的に解除されます。
  ※すでにお振込済みの場合は行き違いですのでご容赦ください。着金確認まで少しお時間がかかることがあります。

  ブルーステージ合同会社
  ```

## 6. D: 文言・表示変更一覧（Web＋メール）

### 6.1 期限の事前提示（新規）

法人担当者は「経理の承認・振込が期限に間に合うか」を**申込前に**判断する必要がある。

- **/api/quote のレスポンスに期限プレビューを追加**（quoteルートのハンドラ内で `calcInvoiceDueAt` を呼ぶ。`buildQuote` には触らない）:
  ```ts
  invoicePreview: {
    eligible: boolean;
    dueAt: string | null;              // ISO
    dueOnNonBusinessDay: boolean;      // 期限日が土日祝・銀行休業日か（クライアントは祝日を知らないためサーバーで判定・Codex指摘）
    cappedBy: "next_business_day" | "max_hours" | "start_minus_24h" | null;
  }
  ```
- **BookingGrid の支払方法セクション**: 請求書ラジオ選択時に「**お支払い期限: 8月4日（火）18:00**」を即時表示。`dueOnNonBusinessDay` のときは「※期限日は金融機関の休業日です。土日祝も振込可能なネットバンキング等のご利用、または前営業日中のお振込をおすすめします」を添える
- プレビューは申込時の再計算と数分ずれうるが、いずれも「同じ日の18:00」に丸まるため実用上一致（18:00またぎで長時間放置した場合のみずれる。メール・完了パネルの表示が正）
- **すべての期限表示に曜日を付ける**: invoiceDoneパネル・受付確認メール・管理者通知・リマインダー

### 6.2 変更必須の文言

| 場所 | 現在 | 変更後 |
|---|---|---|
| BookingGrid.tsx:927（支払方法の説明） | お支払い期限は発行から3日以内（〜） | **お支払い期限は申込の翌営業日18:00です**（連休を挟む場合はこれより早まることがあります。正確な期限は上に表示されます。利用直前のご予約は利用開始24時間前まで）。期限までに入金が確認できない場合、仮押さえは自動解除されます |
| tokushoho/page.tsx:59（特商法・支払時期） | 請求書発行から3日以内、かつ利用開始の24時間前まで、いずれか早い方 | **申込の翌営業日18:00まで（連休を挟む場合など、これより早い期限となる場合があります）、かつ利用開始の24時間前まで、いずれか早い時点。正確な期限は予約時の画面および請求書に表示されます** ※実期限より遅く読める表記を法定表記に掲げないこと |
| checkout/route.ts の受付確認メール本文 | （期限は動的表示のみ) | 期限の動的表示（曜日つき）＋追記: 「**※お支払い期限は短めに設定されております。お早めのお振込をお願いいたします。**」「※期限を過ぎてからのお振込は予約確定できず、ご返金の手続きとなる場合があります」 |
| maintenance の期限切れメール | 「キャンセルされました」断定 | §4.2の「仮押さえ解除」文言（行き違い対応）に変更 |
| invoice.ts:4-8 設計コメント | min(発行から3日後, 利用開始の24時間前) | 新ルールの説明に更新 |
| HANDOVER.md:111 / docs/phase2-design.md:73,108-109 | 旧仕様の記述 | 新仕様に更新（ドキュメントのみ） |

### 6.3 変更不要（確認済み）

- BookingGrid.tsx:919「※利用開始の3日前までのご予約で選択できます」（適格条件は据え置き）
- checkout/route.ts:178 の適格性エラーメッセージ
- 請求書void通知（handleInvoiceVoided。既存ガードで二重送信なし）

### 6.4 「入金待ち」表示の分岐（マイページ＋管理画面）

`payment_method === 'invoice' && booking_status === 'pending'` の判定ヘルパーを共通化して以下を分岐:

| 画面 | 変更 |
|---|---|
| my/[id]/page.tsx:117-126 | 「**入金待ち（お支払い期限: {expires_at・曜日つき}）**」＋「お振込先はメールの請求書をご確認ください」 |
| my/page.tsx:11-16, 29 | ①一覧バッジを「入金待ち」に分岐 ②**一覧クエリに expired を含める**（現在は除外されており期限切れ予約がマイページから消える。定義済みの「期限切れ」バッジを表示） |
| my/[id]/page.tsx:124 | expired の表示を「期限切れ（お支払い期限までに入金が確認できなかったため仮押さえを解除しました）」に |
| admin/page.tsx / admin/ledger/page.tsx / api/admin/ledger-csv/route.ts / admin/bookings/[id]/page.tsx | pending ラベルを invoice なら「入金待ち」に分岐 |
| confirm.ts:164 確定メール | 請求書払いなら「料金: ¥xxx（銀行振込・入金確認済み）」に分岐 |

## 7. E: 追尾予約バー＋選択即時の料金表示（PR-B）

### 7.1 動作仕様

- **表示条件**: `selection !== null && selectedSlots.length > 0 && step === "select"`（toggleSlot が必ず step="select" に戻すため他ステップとの二重表示は起きない）
- **表示内容**:
  - 日付・時間帯・利用時間（例: `8/15（金） 13:00〜15:00（2時間）`）
  - 料金: `¥3,300（税込）` — /api/quote の `breakdown.total`
    - 取得中: 「計算中…」
    - 最低利用時間未満: 「あと30分選択してください」（quoteは呼ばない）
    - **quoteエラー時（429等）: 金額を出さず「料金は次の画面で表示されます」**（CTAは押せるまま） 
  - 割引バッジ（`breakdown.discount` / DISCOUNT_LABEL 既存定数）
  - CTA「**この時間で予約に進む →**」→ 既存 `proceedToConfirm()`（scrollIntoView維持）。ラベルは既存ボタンと**同一文言**（「予約する」は完了を示唆するため不可）
- **既存 selection-summary との関係**: ブロックは残して料金表示を追加。**バー表示中は selection-summary 側のボタンを非表示**（二重CTA回避。最低時間未満の警告文は残す）

### 7.2 即時見積もりの実装

- `quoteParams`: `step === "select"` のときは `startHour` / `durationHours`、それ以外は従来通り confirm系
- 見積もりuseEffect（264行）: `step === "select"` での一律スキップをやめ、**`step === "select" && durationHours < minHours` のときだけスキップ**
- 既存の300msデバウンス・stale応答破棄はそのまま
- **クーポン保護**: 既存effectはエラー時に `appliedCoupon` を空にする副作用がある（286-291行）。**selectステップでのエラーでは appliedCoupon をクリアしない**ガードを追加（スロット操作中の429でクーポンが黙って外れる事故防止）
- **レートリミット**: /api/quote 60→**120回/5分**（quote/route.ts:15-18 の第2引数のみ）

### 7.3 CSS・レイアウト

- 新クラス `.booking-sticky-bar`: `position: fixed; left:0; right:0; bottom:0; z-index:90`。構造・出現アニメは `.storage-sticky-cta`（globals.css:3548-3604）踏襲: `translateY(120%)` → `.show` で 0
- inner は `max-width:1120px`、モバイル（767px以下）は日時・料金を1行に、CTA全幅
- **FloatingNav（bottom:1rem・z-index:60）との排他**: バー表示中は `document.body.classList.add("booking-bar-open")`、CSSで `body.booking-bar-open .floating-nav { transform: translate(-50%, 150%); }`。useEffectクリーンアップで必ず解除
- `body.booking-bar-open` に `padding-bottom`（88px / モバイル96px）
- SSR初期は非表示（マウント後に .show。既存 day-tabs と同様のちらつき対策）

### 7.4 アクセシビリティ

- 料金表示に `aria-live="polite"`、バーは `role="region" aria-label="選択中の予約内容"`

## 8. F: マイページ・管理画面・確定メールの改善

（§6.4 に統合）

## 9. G: フェーズ2設計 — リピーターのカード再利用

**今回は実装しない。** 実装判断のための設計のみ。

### 9.1 方式: Stripe Checkout の顧客紐付け＋カード保存（推奨）

完全ワンクリック決済（off_session）は3Dセキュアの複雑さがあるため見送り、**Checkoutページ上での保存カード選択**を採用:

1. `0022_stripe_customer.sql`: `member_profiles.stripe_customer_id text` 追加
2. ログイン会員のカード決済時、`checkout.sessions.create` に:
   - 既存 `stripe_customer_id` があれば `customer` を渡す（保存済みカードが出て再入力不要）
   - なければ `customer_creation: "always"` ＋ `saved_payment_method_options: { payment_method_save: "enabled" }`
3. `checkout.session.completed` Webhook で `session.customer` を保存（未保存の場合のみ）
4. ゲスト予約は現状維持

### 9.2 請求書払いの顧客は使い捨てを維持（重要）

「請求書ごとにStripe顧客を新規作成」は**意図的な設計**として維持。customer_balance の入金は顧客単位口座に紐づくため、顧客再利用は複数請求書並行時の充当誤りリスクがある。使い捨て＝予約ごとに専用口座＝突合が確実（§4.5の検知も booking_id メタデータ前提）。

## 10. DB変更まとめ（0021_invoice_lifecycle.sql）

```sql
-- 請求書ライフサイクル管理
alter table bookings add column if not exists invoice_reminder_sent_at timestamptz;
alter table bookings add column if not exists invoice_expiry_notice_sent_at timestamptz;
alter table bookings add column if not exists invoice_voided_at timestamptz;
alter table bookings add column if not exists stripe_invoice_customer_id text;

-- Webhook processing リース（§4.7）
alter table stripe_events add column if not exists processing_started_at timestamptz not null default now();

-- 期限チェックcron用 partial index
create index if not exists idx_bookings_invoice_pending
  on bookings (expires_at)
  where booking_status = 'pending' and payment_method = 'invoice';

-- create_pending_booking 本番定義の再掲（pg_get_functiondef で取得したものをそのまま貼る・§3.4）
```

P2: `0022_stripe_customer.sql`（member_profiles.stripe_customer_id）

## 11. テスト計画

- **`src/lib/invoice-rules.test.ts`（新規・最重要）**: `calcInvoiceDueAtWithHolidays` の純関数テスト
  - 平日昼申込 → 翌営業日18:00 ／ 23:59申込 → 翌営業日18:00（18h保証境界）
  - **金曜15:00申込 → 月曜18:00**（95h上限内・旧72h案の退行防止）
  - 土曜申込 → 月曜18:00 ／ 祝日を挟む → スキップ（holidaySet注入）
  - 木曜申込＋金曜祝日の3連休 → 候補2発動で日曜18:00
  - **12/30申込 → 期限が12/31にならない**（銀行休業日スキップ。jp_holidaysに依存しないこと）
  - 年末年始級の長連休 → 候補2上限で申込+95h以内の18:00
  - 利用開始が近い → start−24h が勝つ
  - holidaySet空（fail-open） → 土日＋銀行休業日のみスキップ
  - **すべての結果が「申込+95h以内」かつ「未来」**（DB4日上限＋クロック差余裕の保証）
  - `isInvoiceEligible` 境界（72hちょうど・±1分）
- `expireOverdueInvoices`: Q1a/Q1b/Q2/Q3の対象抽出条件（可能ならユニット、難しければ手動E2E）
- Stripe test mode での手動E2E（§14）: 期限後入金（猶予中）・void後入金・部分入金→void・手動void→Q2再試行なし・processing リース再claim

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| 期限内に振込操作したが着金が期限後になる | **void24h猶予**で invoice.paid → 復旧。枠が埋まっていた場合は既存の返金アラート |
| void後の着金・部分入金・過入金が顧客残高に滞留 | `funded`/`unapplied_from_payment` Webhook（請求書terminal時のみアラート）＋void直後の残高チェック＋invoice.paid後の過入金チェック＋月次目視（§4.5） |
| 猶予中の正常入金を誤警報 | アラート条件を「請求書がvoid/uncollectible」に限定（§4.5） |
| 発行後のDB保存失敗で請求書が孤立 | エラー検査＋補償void＋予約解放（§4.6）。残存ウィンドウはWebhook検証アラートで検知 |
| Webhook処理中クラッシュで invoice.paid が失われる | processing リース15分で再claim（§4.7） |
| 手動void時にQ2が永久再試行 | handleInvoiceVoided でも invoice_voided_at 記録＋Q2はvoid不能エラーで記録 |
| expired化後のクラッシュで通知が失われる | 通知を独立claim（Q1b・invoice_expiry_notice_sent_at）。別経路でexpiredになった予約too |
| GAS停止 | 毎日3:00のVercel cronがフォールバック。GASは状態遷移方式で失敗通知（例外含む）。リマインダーのみフォールバックなし（許容） |
| 銀行休業日・連休に期限が落ちる | 12/31〜1/3除外＋期限プレビューの休日警告＋ネットバンキング案内。特商法は実期限より遅く読める表記を禁止 |
| Stripe側の自動督促メールとの矛盾（猶予中openなのに「振り込むな」と案内） | デプロイ前にStripeダッシュボードの請求書リマインダー設定を監査（アカウント共有のため他サービス影響も確認・§14） |
| クーポンが黙って外れる（select中429） | selectステップではappliedCouponをクリアしない（§7.2） |
| 0021の関数再掲ミス | pg_get_functiondef必須・手書き禁止＋適用直後にinvoiceテスト予約（§14） |

## 13. 実装タスク（Sonnet 5向け・PR分割）

### PR-A: 請求書期限短縮＋期限切れ処理再設計＋決済堅牢化＋文言

実装順序は原則この並び（DBが先・Codex指摘）:

1. `supabase/migrations/0021_invoice_lifecycle.sql`（§10。create_pending_booking は**本番からpg_get_functiondefで取得**）
2. `src/lib/invoice-rules.ts` 新設＋`invoice.ts` 改修（re-export・asyncラッパー・`cash_balance.settings.reconciliation_mode:"automatic"`・コメント更新）
3. `checkout/route.ts`: 発行サガ堅牢化（§4.6: UPDATE エラー検査→補償void・customer ID保存・メールは保存成功後）・`await calcInvoiceDueAt`・受付メール文言＋曜日
4. `src/lib/expire-invoices.ts` 新設（Q1a/Q1b/Q2/Q3・行単位try/catch・limit 200）
5. `src/app/api/cron/expire-invoices/route.ts` 新設
6. `maintenance/route.ts` 0-a を置換
7. `webhooks/stripe/route.ts`: ①processing リース（§4.7） ②handleInvoicePaid のstale-read修正（0件更新後はDB再取得で分岐） ③handleInvoiceVoided に invoice_voided_at 記録 ④`customer_cash_balance_transaction.created` ハンドラ（§4.5・booking_id無しは黙って無視） ⑤invoice.paid後の過入金チェック
8. `quote/route.ts`: `invoicePreview` 追加（4フィールド・§6.1）
9. `BookingGrid.tsx`: 期限プレビュー表示＋休日警告・:927文言・invoiceDoneパネル曜日
10. `confirm.ts`: 確定メール分岐
11. `my/[id]/page.tsx`・`my/page.tsx`: 入金待ち/期限切れ表示（一覧クエリにexpired追加）
12. 管理画面4箇所: 「入金待ち」分岐（共通ヘルパー）
13. `tokushoho/page.tsx:59`
14. `types.ts` に新4カラム
15. `src/lib/invoice-rules.test.ts`
16. `docs/gas-invoice-expiry-cron.md`
17. HANDOVER.md / docs/phase2-design.md 更新

### PR-B: 追尾バー＋即時料金

1. `BookingGrid.tsx`: quoteParams select対応・ガード変更・クーポン保護・追尾バーJSX・bodyクラス制御・selection-summary側ボタン排他
2. `globals.css`: `.booking-sticky-bar`＋`body.booking-bar-open`
3. `quote/route.ts`: レートリミット 60→120
4. selection-summary への料金表示追加

### 実装時の注意（recon・レビューで判明した罠）

- マイグレーション番号は **0021 から**（0004 が2つある）
- `PENDING_GRACE_MINUTES=10` はDB関数の `interval '10 minutes'` と一致必須（今回触らないが隣接コード）
- `Booking` 型に `updated_at` が無い（DBには存在）
- `sendMail` は失敗しても throw せず false を返す契約
- 祝日判定は fail-open の `getHolidaySet`（strict版は価格ガードレール用）
- Stripeアカウントは他サービスと共有。cash balanceハンドラは booking_id メタデータの有無でガード（無ければ黙って無視）
- cash balance の金額フィールドは `amount` ではなく **`net_amount`**（Codex確認済み・Stripe SDK 18.5.0）

## 14. デプロイ・検証手順（順序厳守）

1. **Supabase に 0021 適用**（後方互換・先行適用が安全）
2. PR-A マージ → Vercel 自動デプロイ
3. **デプロイ直後に請求書払いのテスト予約を1件通す**（invalid_expiry退行の即時検知。invoice経路で）
4. Stripeダッシュボード: ①Webhookエンドポイントに `customer_cash_balance_transaction.created` の購読を追加 ②**請求書の自動リマインダー/督促メール設定を監査**（期限後24hのopen期間に矛盾メールが飛ばないか。アカウント共有のため他サービスへの影響も確認）
5. あおさん作業: GAS設置（スクリプト貼付→プロパティ設定→`testConnection`→10分トリガー）
6. 本番E2E: 法人テスト予約（少額）→ 期限プレビューと発行後期限が「翌営業日18:00・曜日つき」で一致 → 放置して期限後すみやかに仮押さえ解除メール → 期限+24h後にStripe側で請求書void＋残高チェックが走ることを確認
7. PR-B マージ → スマホ実機で追尾バー・料金・FloatingNav排他・quoteエラーフォールバックを確認
