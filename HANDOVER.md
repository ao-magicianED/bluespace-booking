# 引き継ぎドキュメント — ブルースペース予約システム

最終更新: 2026-06-12 / 作成: Claude Code（あお様の指示により次の担当AI/開発者向けに整理）

---

## 1. これは何か

ブルーステージ合同会社のレンタルスペース7拠点の**自社予約プラットフォーム**。
インスタベース等の仲介手数料（30〜35%）を回避し、Stripe手数料3.6%のみで運営する。

| 項目 | URL |
|---|---|
| **本番サイト** | https://bluespacerental.com |
| 管理画面 | https://bluespacerental.com/admin（パスワードは `app/.env.local` の `ADMIN_PASSWORD`） |
| コーポレートサイト（別リポジトリ） | https://bluestage-corporate.pages.dev |
| GitHub（このリポジトリ） | ao-magicianED のリポジトリ内 `レンタルスペース予約システム/` フォルダ |
| コーポレートのGitHub | https://github.com/ao-magicianED/bluestage-corporateHP-PJ |

## 2. フォルダ構成

```
レンタルスペース予約システム/
├── HANDOVER.md          ← 本書
├── DESIGN.md            ← フェーズ1設計書（Codexレビュー2回反映済み）
├── docs/
│   ├── phase2-design.md       ← フェーズ2設計＋決定事項ログ
│   ├── two-site-strategy.md   ← コーポレート×予約サイトのSEO戦略（Codexレビュー済み）
│   ├── setup-guide.md         ← 外部サービスの初期設定手順
│   ├── competitor-research.md ← 競合4社の予約UX調査
│   ├── onamae-dns-records.md  ← Resend用DNS設定の記録
│   └── xserver-dns-setup.md   ← ドメイン接続の記録＋2027年移管計画
└── app/                 ← Next.js 15 アプリ本体（Vercelにデプロイ）
    ├── supabase/migrations/   ← DBスキーマ（0001〜0004、本番適用済み）
    ├── scripts/import-photos-v2.mjs ← 写真取り込み（後述）
    └── src/
        ├── app/         ← ページ・APIルート
        ├── components/  ← UI部品
        ├── content/venues.ts ← 拠点の紹介コンテンツ（写真・コピー・FAQ等）
        └── lib/         ← コアロジック（下記）
```

### lib/ の主要モジュール

| ファイル | 役割 |
|---|---|
| `slots.ts` | スロット計算・JST時刻処理（純粋関数・テスト済み） |
| `pricing.ts` | 価格計算 calcQuote v2（休日・割引・オプション・クーポン） |
| `quote.ts` | 見積もり構築＋検証（表示と決済で同一計算を保証） |
| `availability.ts` | 空き状況（DB予約＋Google FreeBusy合成・fail closed） |
| `google-calendar.ts` | FreeBusy読み・イベント書き込み |
| `confirm.ts` | 予約確定後の副作用（カレンダー登録・メール・冪等） |
| `cancel-booking.ts` | キャンセル実行部（返金・カレンダー削除・通知） |
| `cancellation.ts` | 段階制キャンセルポリシー計算 |
| `invoice.ts` | 請求書払い（Stripe Invoicing＋銀行振込） |
| `mail.ts` | Resendメール＋Discord通知 |
| `admin-auth.ts` / `auth-server.ts` / `auth-browser.ts` | 管理者・会員認証 |
| `holidays.ts` | 祝日（jp_holidaysテーブル・Cron自動更新） |

## 3. 技術スタック・外部サービス

| 役割 | サービス | 識別子 |
|---|---|---|
| ホスティング | Vercel | プロジェクト `aosalonais-projects/bluestage-booking` |
| DB | Supabase | プロジェクト `ybvhjmyryztwjdnturrc`（東京・無料枠） |
| 決済 | Stripe | アカウント Bluestage-lcc（**現在テストモード**）。Webhook: `we_1TgxgnAU4uV7yQ8GgZTtTlIC` |
| メール | Resend | 認証済みドメイン `send.bluestage-lcc.com`（東京リージョン・無料枠） |
| カレンダー | Google Calendar API | サービスアカウント `renspe-booking-bot@property-master-bs.iam.gserviceaccount.com`（7拠点に「予定の変更」権限で共有済み・全拠点書き込み検証済み 2026-06-12） |
| ドメイン | bluespacerental.com | XサーバーDNS（A→76.76.21.21=Vercel）。2027年末にCloudflareへ移管予定（docs/xserver-dns-setup.md） |
| 通知 | Discord Webhook | 環境変数 `DISCORD_WEBHOOK_URL` |

### 環境変数（値は app/.env.local と Vercel Production に設定済み）

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
`GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` / `RESEND_API_KEY` / `MAIL_FROM` / `ADMIN_EMAIL` /
`DISCORD_WEBHOOK_URL` / `NEXT_PUBLIC_SITE_URL` / `CRON_SECRET` / `ADMIN_PASSWORD` /
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（公開可） / `INVOICE_REGISTRATION_NUMBER`

> ⚠️ **Vercelに環境変数を入れるときはPowerShellのパイプを使わないこと**（改行が混入して
> HTTPヘッダーが壊れ、メール送信や認証が無言で死ぬ）。bashの `printf '%s' "$VAL" | npx vercel env add ...` を使う。

## 4. 実装済み機能（全フェーズ）

- **予約コア**: 1時間単位・連続最大8h・7日グリッド・60日先まで・開始1h前締切
- **ダブルブッキング防止**: PostgreSQL排他制約（EXCLUDE gist）＋FreeBusy照合＋仮押さえ30分＋猶予10分
- **決済**: Stripe Checkout（カード）。Webhook署名検証・イベント冪等化（stripe_events）・金額5点照合
- **請求書払い**（法人）: Stripe Invoicing＋銀行振込（顧客専用口座）。開始72h前まで選択可、期限=min(3日,開始24h前)、入金で自動確定、期限切れ自動キャンセル。**本番E2E検証済み**
- **料金**: 平日/土日祝の2本立て＋直前割（当日10%）＋早割（30日前10%）＋自前クーポン（couponsテーブル）＋オプション（venue_options）
- **会員制**: Supabase Auth（ゲスト予約と併存）・マイページ・予約履歴・**段階制キャンセル自動返金**・領収書発行（インボイス番号 T6010503005539 印字）
- **管理画面** `/admin`: 統計・予約一覧/検索・キャンセル返金ワンクリック（規定/全額）・カレンダー再同期
- **通知**: 確定/キャンセル/アラート → メール（Resend）＋Discord
- **SEO**: 拠点ページ×7（写真ギャラリー・LocalBusiness/FAQPage構造化データ・sitemap・robots）
- **Cron** `/api/cron/maintenance`（Vercel cron 毎日JST3時 + 手動可）: 期限切れ掃除・請求書void・カレンダー再試行・祝日更新

### 料金設定（DB venuesテーブル・2026-06-12時点）

| slug | 平日 | 土日祝 |
|---|---|---|
| keisei-koiwa | 1,000 | 2,000 |
| kanda / ueno-okachimachi | 1,300 | 2,000 |
| ueno-4a | 1,500 | 2,300 |
| ueno-4b | 1,400 | 2,200 |
| nishi-shinjuku / shirokane-takanawa | 1,200 | 1,200 |

クーポン `OPEN10`（10%・無期限）が有効状態で存在。

## 5. 運用ルーチン

- **日常**: 予約・キャンセルはDiscord/メール通知で把握。詳細は /admin
- **クーポン発行**: Supabase Table Editor → coupons に1行追加（code, percent_off or amount_off, ends_at, max_uses, min_amount, venue_id）
- **料金変更**: venues の hourly_price / holiday_hourly_price を更新（即反映）
- **写真更新**: マスター `H:\共有ドライブ\BS写真\{拠点}\★HP掲載写真`（室内/備品/外観周辺施設/地図のカテゴリ分け）→ `node scripts/import-photos-v2.mjs`（dHash知覚ハッシュで構図の多様性を最大化して自動選定・圧縮）→ venues.ts の枚数を合わせて deploy
- **拠点追加**: ①venuesにINSERT ②content/venues.tsにエントリ追加 ③写真取り込み ④カレンダーをサービスアカウントに共有
- **デプロイ**: `cd app && npx vercel deploy --prod --yes`（ビルド検証は `npm run build`、テストは `npm test`＝vitest 36件）
- **コーポレート側のデプロイ**: push後 `gh workflow run daily-rebuild.yml -R ao-magicianED/bluestage-corporateHP-PJ`

## 6. ハマりどころ（実際に踏んだもの）

1. **Vercel env改行混入**（→§3警告）。ADMIN_PASSWORD/RESEND_API_KEY/MAIL_FROMで実際に発生した
2. **カレンダーIDの取り違え**: 当初京成小岩に白金高輪のIDが設定されていた。正しいマッピングはコーポレートrepoのCLAUDE.md「7拠点カレンダーID」表が正
3. **fail closed設計**: FreeBusy取得失敗時は全枠「受付外」表示になる（安全側）。「全部受付外」の問い合わせが来たらまずカレンダー権限/IDを疑う
4. **undiciの日本語ヘッダ/ボディ**: fetchで日本語を含むメールを送る際は `TextEncoder` でUint8Array化（mail.ts実装済み）。From名はRFC2047エンコード
5. **Stripeの最低決済額は¥50**: クーポンで下回る場合はcheckoutが拒否する仕様
6. **expired→confirmed復旧**: 期限ギリギリ入金はWebhookが排他制約込みで復旧を試みる。失敗時は管理者アラート→手動返金

## 7. 残タスク（優先順）

1. **GBPウェブサイトURL統一（残り5件）**: 白金高輪・西新宿403は完了済み。残り＝京成小岩/神田/上野御徒町/上野4A/上野4B。
   GBPグループ: https://business.google.com/groups/102124491183677146513/locations
   各拠点の鉛筆→連絡先→ウェブサイトに `https://bluespacerental.com/{slug}` を設定
2. **特商法ページ** `app/src/app/legal/tokushoho/page.tsx`: 運営責任者名・住所・電話が未記入（公開前に必須）
3. **Stripe本番モード切替**（実売開始時）: 本番キーへ差し替え→Webhookエンドポイントを本番モードで再作成→`STRIPE_WEBHOOK_SECRET`更新→テスト予約1件で確認。銀行振込（customer_balance）が本番で有効化されているか要確認
4. **Supabase AuthのSMTP**: 会員確認メールが現在Supabase内蔵SMTP（時間あたり数通制限）。Authentication→Emails→SMTP SettingsにResendのSMTPを設定する
5. **ドメイン移管**（2027年11月頃）: bluespacerental.com をXサーバー→Cloudflare Registrar（docs/xserver-dns-setup.md参照）
6. コーポレートの拠点詳細ページ→予約サイトへの301リダイレクト（two-site-strategy.md Phase D。コンテンツ移植は完了済みなので実施可能）

## 8. テスト方法

- ユニット: `cd app && npm test`（slots/pricing/cancellation 36件）
- カード決済E2E: テストカード `4242 4242 4242 4242`
- 請求書払いE2E: 法人予約→Stripeダッシュボードで請求書確認→`stripe.testHelpers.customers.fundCashBalance(customerId, {amount, currency:'jpy'})` で擬似入金→自動確定を確認
- Webhook再送テスト: Stripeダッシュボード→Webhook→イベント再送（冪等化されるため安全）
