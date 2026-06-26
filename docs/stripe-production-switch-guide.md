# Stripe 本番モード切替 手順書

最終更新: 2026-06-26 / ステータス: 初契約時に実行
所要時間: **約30分**（テストカードでの最終確認込み）

---

## このドキュメントは何か

現在 Stripe は **テストモード** で運用中。初めて実売（外販含む）を受ける前に **本番モード** に切り替える必要がある。
この手順書は **「順番ミス＝二度と取り戻せない事故」を防ぐためのチェックリスト**。1ステップずつ確認しながら進める。

> ⚠️ **必ず初契約のお客様から決済を受ける 1日前までに完了** すること。リアルタイムで切り替えるとWebhook受信に欠落が出る可能性あり。

---

## 0. 事前準備（切替の数日前）

### Stripe本番アカウント情報の整備

1. https://dashboard.stripe.com/ にログイン
2. 右上のモード切替トグルが **本番（青色）** になっていることを確認
3. **アカウント設定** → **本番化に必要な情報** をすべて入力:
   - 事業形態: **法人**（ブルーステージ合同会社）
   - 会社情報: 商号・住所・電話・代表者名
   - 銀行口座（売上振込先）: 法人口座を登録
   - 本人確認書類: 代表者の身分証
   - **適格請求書発行事業者番号: T6010503005539**（インボイス対応）

> ⚠️ 銀行口座と本人確認は審査に数日かかる場合があるので、**最低1週間前** に申請開始。

### 本番モードの動作対象を有効化

4. **Settings → 決済方法** で以下を有効化:
   - **カード決済**（必須）
   - **銀行振込（顧客残高 / customer_balance）**（請求書払いで使用）
   - その他は使わないなら無効でOK
5. **Settings → 請求書発行**:
   - インボイス情報を会社情報に転記
   - 自動領収書メール送信: **ON**
6. **Settings → ブランディング**:
   - ロゴ・ブランドカラーを設定（顧客がCheckout画面で見る）

---

## 1. Webhook エンドポイントを本番モードで作成

### 1-1. 本番モードのWebhook を新規作成

1. https://dashboard.stripe.com/webhooks（**本番モード** であることを再確認）
2. **「エンドポイントを追加」**
3. **エンドポイントURL**: `https://bluespacerental.com/api/webhooks/stripe`
   - ※BlueReserve（外販）顧客の場合は、その顧客のドメインに置き換える
4. **イベント選択** (以下を全てチェック):
   - `checkout.session.completed`
   - `checkout.session.expired`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `charge.refunded`（フェーズ2のキャンセル返金で使用）
5. **「エンドポイントを追加」** をクリック
6. 作成後、**「Signing secret」を表示** で署名シークレット `whsec_...` をコピー

### 1-2. テストモードのWebhook を **削除しない**（保険）

念のため、テストモードのWebhook（`we_1TgxgnAU4uV7yQ8GgZTtTlIC`）は **そのまま残しておく**。実売開始後 1ヶ月程度経って事故なければ削除。

---

## 2. Vercel 環境変数の差し替え

### 2-1. 本番モードのキー2点を取得

1. https://dashboard.stripe.com/apikeys （**本番モード**）
2. **シークレットキー** をコピー (`sk_live_...`)
3. ステップ1-6でコピーした **Signing secret** (`whsec_...`)

### 2-2. Vercel に反映

```bash
cd レンタルスペース予約システム

# STRIPE_SECRET_KEY を本番値に上書き
printf '%s' "sk_live_..." | npx vercel env rm STRIPE_SECRET_KEY production --yes
printf '%s' "sk_live_..." | npx vercel env add STRIPE_SECRET_KEY production

# STRIPE_WEBHOOK_SECRET を本番値に上書き
printf '%s' "whsec_..." | npx vercel env rm STRIPE_WEBHOOK_SECRET production --yes
printf '%s' "whsec_..." | npx vercel env add STRIPE_WEBHOOK_SECRET production
```

> ⚠️ **重要**: PowerShellのパイプ `|` は改行を混入させるため使わない。**Git Bash の bash で実行** すること（HANDOVER.md より）。

### 2-3. 本番にデプロイし直す（環境変数を反映）

```bash
cd レンタルスペース予約システム
npx vercel deploy --prod --yes
```

---

## 3. テストカードで本番動作確認

### 3-1. テスト用予約を実施

1. https://bluespacerental.com の最も安い拠点・最短時間で予約フォームに進む
2. Stripe Checkout 画面で **本物のクレジットカード** を使用
3. 決済完了
4. 以下を即座に確認:
   - ✅ 確定メールが顧客側に届く
   - ✅ Discord通知が来る
   - ✅ Google Calendar に予定登録される
   - ✅ Stripe Dashboard（本番モード）の Payments に表示される

### 3-2. 即返金（本番テストの取り消し）

5. Stripe Dashboard → Payments → 該当決済 → **「返金」** で全額返金
6. キャンセルフロー確認:
   - ✅ 顧客に返金完了メール
   - ✅ Google Calendar の予定削除
   - ✅ Supabase の booking_status=cancelled / payment_status=refunded

> ⚠️ Stripe手数料3.6%は返金されない（数十円〜数百円の損失）。これは「本番動作確認の必要コスト」と割り切る。

---

## 4. BlueReserve 外販顧客の場合の追加手順

### 4-1. 顧客自身のStripeアカウントへ移行

外販モデルでは **顧客が自身のStripeアカウント** を持つ。

1. お客様にStripeアカウント開設を依頼（こちらが「Stripe導入支援」プラン¥33,000で代行可能）
2. お客様の Stripe Dashboard で:
   - 上記 1-1〜1-2 の Webhook 設定
   - 上記 2-1 のキー取得
3. お客様の Vercel（または同等ホスティング）に上記 2-2 の環境変数設定
4. テスト決済（上記 3-1〜3-2 同様）

### 4-2. インボイス番号は顧客のものに差し替え

`src/lib/invoice.ts` の `INVOICE_REGISTRATION_NUMBER` 環境変数を **顧客の適格請求書発行事業者番号** に差し替え（または顧客が未取得なら未設定）。

---

## 5. 完了後のチェックリスト

- [ ] 本番モードでテスト決済が成功した
- [ ] 返金が成功した
- [ ] 確定メール・Discord・Google Calendar 連動 全部動いた
- [ ] Webhook 署名検証エラーが Vercel Logs に出ていない
- [ ] テストモード環境変数を保管（必要なら別環境変数名で残す）

---

## 6. ロールバック方法（万が一の場合）

何か致命的な問題が起きたら **テストモードに戻す**:

```bash
# Vercel 環境変数を元のテストモード値に戻す
printf '%s' "sk_test_..." | npx vercel env rm STRIPE_SECRET_KEY production --yes
printf '%s' "sk_test_..." | npx vercel env add STRIPE_SECRET_KEY production
printf '%s' "whsec_test_..." | npx vercel env rm STRIPE_WEBHOOK_SECRET production --yes
printf '%s' "whsec_test_..." | npx vercel env add STRIPE_WEBHOOK_SECRET production
npx vercel deploy --prod --yes
```

ただし、既に本番カードで決済された予約は手動で取り消す必要あり。

---

## 7. よくあるトラブル

### ❌ Webhook が動かない（署名検証エラー）

→ `STRIPE_WEBHOOK_SECRET` の値が古い or テストモードのもの。Step 1-6 で取得し直し、Step 2-2 で再設定。

### ❌ 「customer_balance」が決済できない

→ Stripe Dashboard の Settings → 決済方法で「銀行振込（顧客残高）」を有効化（Step 0-4）。

### ❌ 顧客に「テスト決済です」表示が出る

→ APIキーがまだ `sk_test_...` のまま。Step 2-2 を再確認。

### ❌ Vercel デプロイ後も環境変数が反映されない

→ `vercel env` でセット後、必ず `vercel deploy --prod` が必要（既存デプロイには反映されない）。

---

## 8. 関連ドキュメント

- [HANDOVER.md](../HANDOVER.md) - 既存システム全体像
- [DESIGN.md](../DESIGN.md) - フェーズ1設計（Stripe Webhook冪等化 etc.）
- [license-upgrade-feature-design.md](./license-upgrade-feature-design.md) - 外販向け管理画面（ライセンスアップグレード）

---

## 補足: 切替タイミングの判断

| 状況 | 推奨タイミング |
|---|---|
| 自社拠点（bluespacerental.com）の初予約見込みが立った | **その1週間前** |
| 外販プラン契約者の初予約見込みが立った | **顧客側で別途実施**（このドキュメントを顧客に渡す） |
| まだ予約見込みが立っていない | **保留**。テストモードのまま運用継続でOK |
