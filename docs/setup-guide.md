# セットアップガイド（フェーズ1）

初めてでも順番にやれば動くように書いています。所要時間: 約60〜90分。
すべて無料枠で始められます（Stripeは決済発生時のみ手数料3.6%）。

---

## 0. 全体像

| サービス | 役割 | 取得するもの |
|---|---|---|
| Supabase | 予約データベース | URL と service_role キー |
| Stripe | クレカ決済 | シークレットキーと Webhook シークレット |
| Google Cloud | カレンダー連携 | サービスアカウントのJSONキー |
| Resend | 確認メール送信 | APIキー（任意。なくても動く） |
| Vercel | 公開サーバー | GitHub連携のみ |

## 1. Supabase（データベース）

1. https://supabase.com で無料アカウント作成 → 「New project」（リージョンは Tokyo 推奨）
2. 左メニュー **SQL Editor** → `app/supabase/migrations/0001_init.sql` の中身を貼り付けて **Run**
3. 続けて `app/supabase/seed.sql` を貼り付けて **Run**（サンプル拠点が入る）
4. **Project Settings → API** から以下をメモ:
   - `URL` → 環境変数 `SUPABASE_URL`
   - `service_role` キー → 環境変数 `SUPABASE_SERVICE_ROLE_KEY`
   - ⚠️ service_role キーは**絶対に公開しない**（サーバー専用の万能キー）

5. **Table Editor → venues** で実際の拠点情報に修正:
   - `hourly_price`（時給・円）
   - `calendar_id`（手順3で取得するGoogleカレンダーID）
   - `open_hour` / `close_hour`（24時間営業なら 0 / 24）

## 2. Stripe（決済）

1. https://dashboard.stripe.com → まずは**テストモード**で進める
2. **開発者 → APIキー** → シークレットキー（`sk_test_...`）→ `STRIPE_SECRET_KEY`
3. Webhook（決済完了通知の受け口）は **Vercel公開後** に設定:
   - **開発者 → Webhook → エンドポイントを追加**
   - URL: `https://<あなたのドメイン>/api/webhooks/stripe`
   - イベント: `checkout.session.completed` と `checkout.session.expired` の2つ
   - 表示される署名シークレット（`whsec_...`）→ `STRIPE_WEBHOOK_SECRET`
4. **設定 → 顧客のメール** で「支払いの領収書を自動送信」をON推奨
5. 本番公開時はStripeの本番申請（事業情報の入力）を済ませ、本番キーに差し替える

### ローカルでWebhookをテストする場合
```bash
# Stripe CLIをインストール後
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# 表示される whsec_... を .env.local の STRIPE_WEBHOOK_SECRET に設定
```
テストカード番号: `4242 4242 4242 4242`（期限・CVCは適当でOK）

## 3. Google Calendar（サービスアカウント）

1. https://console.cloud.google.com → プロジェクト作成（例: bluestage-booking）
2. **APIとサービス → ライブラリ** → 「Google Calendar API」を検索して **有効化**
3. **APIとサービス → 認証情報 → 認証情報を作成 → サービスアカウント**
   - 名前: booking-bot など。ロールは不要（スキップ）
4. 作成したサービスアカウント → **キー → 鍵を追加 → JSON** → ダウンロード
5. JSONをBase64に変換（PowerShell）:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("ダウンロードしたファイル.json"))
   ```
   → 出力された長い文字列を `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` に設定
   → 変換後、**JSONファイルは削除**（漏えい防止）
6. **各拠点のGoogleカレンダーをサービスアカウントに共有**:
   - Googleカレンダー → 対象カレンダーの設定 → 「特定のユーザーと共有」
   - サービスアカウントのメールアドレス（`xxx@xxx.iam.gserviceaccount.com`）を追加
   - 権限: **「予定の変更」**
7. カレンダー設定の「カレンダーID」（`xxx@group.calendar.google.com`）を Supabase の `venues.calendar_id` に設定

## 4. Resend（メール・任意）

1. https://resend.com で無料アカウント → ドメイン（bluestage-lcc.com）を認証（DNSにレコード追加）
2. APIキー作成 → `RESEND_API_KEY`
3. `MAIL_FROM` は認証済みドメインのアドレス（例: `ブルーステージ予約 <noreply@bluestage-lcc.com>`）
4. `ADMIN_EMAIL` に通知を受けたいアドレス（info@bluestage-lcc.com）

※未設定でも予約システム自体は動く（メールがスキップされるだけ）。ただし本番運用では必須。

## 5. ローカルで動かす

```bash
cd レンタルスペース予約システム/app
cp .env.example .env.local   # ← 値を埋める
npm install
npm run dev                  # http://localhost:3000
```

## 6. Vercelへ公開

1. GitHubにpush済みであることを確認
2. https://vercel.com → 「Add New → Project」→ リポジトリを選択
3. **Root Directory** に `レンタルスペース予約システム/app` を指定
4. **Environment Variables** に `.env.example` の項目をすべて登録
   - `NEXT_PUBLIC_SITE_URL` は本番URL（例: `https://booking.bluestage-lcc.com`）
   - `CRON_SECRET` はランダムな長い文字列（パスワード生成ツールで作る）
5. Deploy → 公開URLが出たら **手順2-3のStripe Webhook** を設定
6. 独自ドメインを使う場合は Vercel の Domains 設定から追加

### 定期メンテナンス（Cron）について

`vercel.json` で1日1回（JST朝3時）の掃除が動く。**より確実にするため、GAS（Google Apps Script）で5分おきに叩くのを推奨**:

```javascript
// GASに貼り付け、時間主導型トリガー（5分おき）を設定
function pingMaintenance() {
  UrlFetchApp.fetch('https://<本番URL>/api/cron/maintenance', {
    headers: { Authorization: 'Bearer <CRON_SECRETの値>' },
    muteHttpExceptions: true,
  });
}
```

## 7. 動作確認チェックリスト

- [ ] トップに拠点が表示される
- [ ] 予約ページで空き枠（◯）が出る。Googleカレンダーに予定を入れると×になる
- [ ] スロット選択 → 情報入力 → テストカードで決済できる
- [ ] 決済後、Supabaseの bookings が `confirmed / paid` になる
- [ ] Googleカレンダーに「【自社予約】#xxxxxxxx」イベントが作成される
- [ ] 確認メール・管理者メールが届く（Resend設定時）
- [ ] 決済せず30分放置 → 枠が空きに戻る

## 8. 運用手順

### キャンセル依頼が来たとき（順番厳守）
1. **Stripe** ダッシュボード → 該当の支払い → 返金
2. **Googleカレンダー** → 該当イベント（#予約番号）を削除
3. **Supabase** → bookings → 該当行の `booking_status` を `cancelled`、`payment_status` を `refunded` に変更
4. お客様へ返金完了メールを返信

### 二重予約が起きたとき（外部サイトの同期遅延・まれ）
1. 後から入った方へ即連絡 → 全額返金（上記手順）
2. 代替日時・代替拠点を提案
3. 頻発する場合は外部サイト側をリクエスト承認制に変更検討

### 「カレンダー登録失敗」メールが来たとき
1. Googleカレンダーに手動で該当時間の予定を入れる（外部サイトとの二重予約防止が最優先）
2. 原因（カレンダー共有切れ等）を確認。Cronが自動再試行もする

## 9. よくあるトラブル

| 症状 | 原因と対処 |
|---|---|
| 全部の枠が「受付外」 | Googleカレンダー連携エラー（fail closed）。サービスアカウントの共有・カレンダーIDを確認 |
| 決済したのに confirmed にならない | Webhook未設定/シークレット間違い。Stripeダッシュボード→Webhook→配信ログを確認 |
| メールが届かない | RESEND_API_KEY未設定、またはドメイン未認証 |
| 「未決済の仮予約が多すぎます」 | 同一メールで決済せず2件仮押さえ中。30分待つと自動解放 |
