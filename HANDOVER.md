# 引き継ぎドキュメント — ブルースペース予約システム

最終更新: 2026-07-09 / 作成: Claude Code（あお様の指示により次の担当AI/開発者向けに整理）

---

## 1. これは何か

ブルーステージ合同会社のレンタルスペース7拠点の**自社予約プラットフォーム**。
インスタベース等の仲介手数料（30〜35%）を回避し、Stripe手数料3.6%のみで運営する。
さらに同システムを他のスペース運営者へ販売する**外販（BlueReserve）**の仕組みも実装済み（§8）。

| 項目 | URL |
|---|---|
| **本番サイト** | https://bluespacerental.com |
| 管理画面 | https://bluespacerental.com/admin（パスワードは `.env.local` の `ADMIN_PASSWORD`） |
| 外販LP（BlueReserve） | https://bluereserve.pages.dev（Cloudflare Pages・`landing/` 参照） |
| コーポレートサイト（別リポジトリ） | https://bluestage-corporate.pages.dev |
| GitHub（このリポジトリ） | https://github.com/ao-magicianED/bluespace-booking |
| コーポレートのGitHub | https://github.com/ao-magicianED/bluestage-corporateHP-PJ |

## 2. フォルダ構成

**リポジトリ直下がそのまま Next.js 15 アプリ**（旧構成の `app/` サブディレクトリは廃止済み。
デプロイやテストで `cd app` は不要）。

```
bluespace-booking/（ローカルフォルダ名: レンタルスペース予約システム/）
├── HANDOVER.md          ← 本書
├── DESIGN.md            ← フェーズ1設計書（Codexレビュー2回反映済み）
├── docs/
│   ├── phase2-design.md        ← フェーズ2設計＋決定事項ログ
│   ├── license-upgrade-feature-design.md ← 外販ライセンス機能の設計書
│   ├── stripe-production-switch-guide.md ← Stripe本番モード切替の手順書
│   ├── two-site-strategy.md    ← コーポレート×予約サイトのSEO戦略（Codexレビュー済み）
│   ├── setup-guide.md          ← 外部サービスの初期設定手順
│   ├── competitor-research.md  ← 競合4社の予約UX調査
│   ├── onamae-dns-records.md   ← Resend用DNS設定の記録
│   ├── xserver-dns-setup.md    ← ドメイン接続の記録＋2027年移管計画
│   └── storage-business/       ← トランクルーム事業（ブルーストレージ）の市場調査・事業計画
├── landing/             ← BlueReserve外販LP（静的HTML・Cloudflare Pagesに別デプロイ）
├── supabase/migrations/ ← DBスキーマ（0001〜0015・§5参照）
├── scripts/import-photos-v2.mjs ← 写真取り込み（§7参照）
├── public/
├── src/
│   ├── app/             ← ページ・APIルート（App Router）
│   ├── components/      ← UI部品
│   ├── content/venues.ts ← 拠点の紹介コンテンツ（写真・コピー・FAQ等のデフォルト）
│   ├── lib/             ← コアロジック（下記）
│   └── middleware.ts
├── package.json / vercel.json / vitest.config.ts など
```

### lib/ の主要モジュール

| ファイル | 役割 |
|---|---|
| `slots.ts` | スロット計算・JST時刻処理（**30分単位**・純粋関数・テスト済み） |
| `pricing.ts` | 価格計算 calcQuote v2（休日・割引・オプション・クーポン） |
| `quote.ts` | 見積もり構築＋検証（表示と決済で同一計算を保証） |
| `availability.ts` | 空き状況（DB予約＋Google FreeBusy合成・fail closed） |
| `google-calendar.ts` | FreeBusy読み・イベント書き込み・イベント時刻更新 |
| `confirm.ts` | 予約確定後の副作用（カレンダー登録・メール・冪等） |
| `cancel-booking.ts` | キャンセル実行部（返金・カレンダー削除・通知） |
| `cancellation.ts` | 段階制キャンセルポリシー計算 |
| `change-request.ts` | 予約変更申請（延長=決済で自動確定 / 短縮・時間ずらし=管理者承認制） |
| `apply-time-change.ts` | 時間変更の確定反映（カレンダー更新・DB・差額返金・通知の共通部） |
| `adjustment.ts` | 料金の事後調整（増額請求・減額返金）・実効金額・PaymentIntent収集 |
| `ledger.ts` | 会計帳簿（会員番号 BS-00001 形式・**実収額 realizedRevenue()**） |
| `occupancy.ts` / `occupancy-report.ts` | 稼働率計算（純粋ロジック）と日次レポート生成 |
| `campaigns.ts` | 自動クーポン配布（初回/2回目サンクス・30日/90日掘り起こし） |
| `license.ts` | 外販ライセンス管理（プラン定義・拠点数上限） |
| `invoice.ts` | 請求書払い（Stripe Invoicing＋銀行振込） |
| `mail.ts` | Resendメール＋Discord通知 |
| `rate-limit.ts` | 簡易レートリミット（インメモリ・本命ガードはDB側のpending上限） |
| `site-url.ts` | サイトURL・管理画面URLの一元化 |
| `admin-auth.ts` / `auth-server.ts` / `auth-browser.ts` | 管理者・会員認証 |
| `holidays.ts` | 祝日（jp_holidaysテーブル・Cron自動更新） |

## 3. 技術スタック・外部サービス

| 役割 | サービス | 識別子 |
|---|---|---|
| ホスティング | Vercel | プロジェクト `aosalonais-projects/bluestage-booking` |
| DB | Supabase | プロジェクト `ybvhjmyryztwjdnturrc`（東京・無料枠） |
| 決済 | Stripe | アカウント Bluestage-lcc（**2026-06-12時点テストモード**。切替手順は docs/stripe-production-switch-guide.md） |
| メール | Resend | 認証済みドメイン `send.bluestage-lcc.com`（東京リージョン・無料枠） |
| カレンダー | Google Calendar API | サービスアカウント `renspe-booking-bot@property-master-bs.iam.gserviceaccount.com`（7拠点に「予定の変更」権限で共有済み・全拠点書き込み検証済み 2026-06-12） |
| ドメイン | bluespacerental.com | XサーバーDNS（A→76.76.21.21=Vercel）。2027年末にCloudflareへ移管予定（docs/xserver-dns-setup.md） |
| 通知 | Discord Webhook | 環境変数 `DISCORD_WEBHOOK_URL` |
| 外販LP | Cloudflare Pages | プロジェクト `bluereserve`（`landing/README.md` にデプロイ手順） |

### 環境変数（値は `.env.local` と Vercel Production に設定済み）

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` /
`GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` / `RESEND_API_KEY` / `MAIL_FROM` / `ADMIN_EMAIL` /
`DISCORD_WEBHOOK_URL` / `NEXT_PUBLIC_SITE_URL` / `CRON_SECRET` / `ADMIN_PASSWORD` /
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`（公開可） / `INVOICE_REGISTRATION_NUMBER`

> ⚠️ **Vercelに環境変数を入れるときはPowerShellのパイプを使わないこと**（改行が混入して
> HTTPヘッダーが壊れ、メール送信や認証が無言で死ぬ）。bashの `printf '%s' "$VAL" | npx vercel env add ...` を使う。

## 4. 実装済み機能（全フェーズ）

### 予約・決済コア
- **予約コア**: **30分単位**（最小30分・上限は venues.min_hours / max_hours で拠点ごとに設定）・7日グリッド・60日先まで・**開始1分前まで受付**（直前予約を最大限取る設計）
- **ダブルブッキング防止**: PostgreSQL排他制約（EXCLUDE gist）＋FreeBusy照合＋仮押さえ30分＋猶予10分
- **決済**: Stripe Checkout（カード）。Webhook署名検証・イベント冪等化（stripe_events）・金額5点照合
- **請求書払い**（法人）: Stripe Invoicing＋銀行振込（顧客専用口座）。開始72h前まで選択可、期限=min(3日,開始24h前)、入金で自動確定、期限切れ自動キャンセル。**本番E2E検証済み**
- **料金**: 平日/土日祝の2本立て＋直前割（当日10%）＋早割（30日前10%）＋自前クーポン（couponsテーブル・原子的消化ですり抜け防止）＋オプション（venue_options）

### 会員・予約の変更
- **会員制**: Supabase Auth（ゲスト予約と併存）・マイページ・予約履歴・会員番号（BS-00001形式）・プロフィール・メール変更・パスワードリセット
- **段階制キャンセル自動返金**・領収書発行（インボイス番号 T6010503005539 印字・宛名変更は1回まで）
- **予約変更（時間変更）申請**: 会員がマイページから利用開始2h前まで申請可。**延長=差額をStripe Checkoutで決済→自動確定**。短縮・時間ずらし=管理者承認制（差額は自動返金）。申請は72hで自動失効。管理者側は即時変更も可能（booking_change_requestsが監査ログを兼ねる）
- **料金調整（管理者）**: 確定予約への増額請求（Checkoutリンク送付・72h期限）／減額返金。booking_adjustmentsに全履歴を記録

### クーポン・販促
- **自動クーポン配布**（Cronから毎日・冪等）: 初回利用翌日10%OFF／2回目利用翌日10%OFF／最終利用30日後・90日後の掘り起こし10%OFF。本人メール専用（restrict_email）で横流し不可
- **管理者による個別クーポン付与**（/admin/coupons）

### 管理画面 `/admin`
- 統計トップ・**分析ページ**（月別グラフ・会員予約回数）・**稼働率分析**（/admin/occupancy）
- 予約一覧/検索・予約詳細（キャンセル返金ワンクリック（規定/全額）・時間変更・料金調整・変更申請の承認/却下）
- **会計帳簿**（/admin/ledger・実収額ベース・**CSV出力**あり）
- **拠点管理UI**（/admin/venues・FAQ上書き・写真ギャラリー管理（Supabase Storage）・入退室案内の編集）
- クーポン管理・ライセンス状況（/admin/license）・カレンダー再同期

### 通知・レポート
- 確定/キャンセル/変更/アラート → メール（Resend）＋Discord
- **前日リマインダーメール**（明日の予約に自動送信・入退室案内つき・冪等）
- **稼働率日次レポート**（毎朝7時: 全拠点の来週予約 vs 過去4週平均・低稼働アラート → メール＋Discord）

### その他
- **SEO**: 拠点ページ×7（写真ギャラリー・LocalBusiness/FAQPage構造化データ・sitemap・robots・ファビコン・OGP・サーチコンソール認証済み）
- **空き状況ダイジェスト**: 拠点ページに今日/明日バナー＋7日間サマリ表示
- **トランクルーム（ブルーストレージ）**: `/storage/shirokane-takanawa` にLP＋問い合わせフォーム（追従CTA・料金3プラン・特典）。事業資料は docs/storage-business/
- **レート制限**: 問い合わせ・予約系APIに簡易レートリミット（+DB側で同一メールのpending上限2件）
- **外販ライセンス制御**: §8参照

### Cron（vercel.json・認証は `Authorization: Bearer CRON_SECRET`）

| パス | スケジュール | 内容 |
|---|---|---|
| `/api/cron/maintenance` | 毎日 UTC18時＝**JST 3時** | 請求書期限切れvoid→自動キャンセル・祝日更新・期限切れpending掃除・カレンダー同期/確認メール再試行・**前日リマインダー送信**・**自動クーポン配布**・変更申請/追加請求の期限切れ処理 |
| `/api/cron/daily-report` | 毎日 UTC22時＝**JST 朝7時** | 稼働率日次レポート（低稼働アラート判定つき）をメール＋Discordへ |

## 5. DBマイグレーション（supabase/migrations・本番適用済み）

**0001〜0015の16ファイル**。⚠️ **0004は2本ある**（`0004_cancellation.sql` と `0004_invoice.sql`。
番号が重複しているが両方適用済み。新規migrationは必ず既存の最大番号+1を確認してから振ること）。

| # | 内容 |
|---|---|
| 0001 | 初期スキーマ（venues/bookings/stripe_events・排他制約・仮押さえ関数・RLS全面禁止） |
| 0002 | 料金体系（休日料金・直前割・早割）・オプション・クーポン・祝日 |
| 0003 | 会員制（Supabase Auth紐付け）＋領収書 |
| 0004_cancellation | 段階制キャンセルポリシー（venueごと上書き可） |
| 0004_invoice | 請求書払い（仮押さえ期限を30分→4日に緩和） |
| 0005 | **スロット30分単位化**（min_hours/max_hours を numeric に） |
| 0006 | 予約人数（party_size）・領収書宛名変更1回制限・入退室案内（access_info） |
| 0007 | FAQの拠点別上書き（jsonb）＋写真ギャラリーのDB管理化（Storage公開バケット） |
| 0008 | 会員番号（member_profiles・登録順連番・トリガー付与） |
| 0009 | 自動クーポン配布（restrict_email・二重配布防止の台帳） |
| 0010 | クーポン使用回数の原子的消化（1回限りクーポンのすり抜け防止） |
| 0011 | 料金の事後調整（booking_adjustments・adjusted_total） |
| 0012 | 予約時間変更申請（booking_change_requests・重複申請防止） |
| 0013 | 外販ライセンス制御（license_limits・license_changes・venues INSERTトリガー） |
| 0014 | 前日リマインダーメールの送信済みフラグ |
| 0015 | **extra_paid_amount 追加（実収額の二重控除バグ修正**・§9の6参照） |

### 料金設定（DB venuesテーブルが正。以下は2026-06-12時点の値）

| slug | 平日 | 土日祝 |
|---|---|---|
| keisei-koiwa | 1,000 | 2,000 |
| kanda / ueno-okachimachi | 1,300 | 2,000 |
| ueno-4a | 1,500 | 2,300 |
| ueno-4b | 1,400 | 2,200 |
| nishi-shinjuku / shirokane-takanawa | 1,200 | 1,200 |

クーポン `OPEN10`（10%・無期限）が有効状態で存在。ほかに自動配布クーポン（§4）が随時発行される。

## 6. 運用ルーチン

- **日常**: 予約・キャンセル・変更申請はDiscord/メール通知で把握。詳細は /admin。毎朝7時に稼働率レポートが届く
- **クーポン発行**: /admin/coupons から付与、または Supabase Table Editor → coupons に1行追加（code, percent_off or amount_off, ends_at, max_uses, min_amount, venue_id）
- **料金変更**: venues の hourly_price / holiday_hourly_price を更新（即反映）
- **FAQ・写真・入退室案内の変更**: /admin/venues の管理UIから編集可能（コード変更不要）
- **写真の一括取り込み**: マスター `H:\共有ドライブ\BS写真\{拠点}\★HP掲載写真`（室内/備品/外観周辺施設/地図のカテゴリ分け）→ `node scripts/import-photos-v2.mjs`（dHash知覚ハッシュで構図の多様性を最大化して自動選定・圧縮）→ venues.ts の枚数を合わせて deploy
- **拠点追加**: ①venuesにINSERT（ライセンス上限に注意・§8） ②content/venues.tsにエントリ追加 ③写真取り込み ④カレンダーをサービスアカウントに共有
- **デプロイ**: リポジトリ直下で `npx vercel deploy --prod --yes`（ビルド検証は `npm run build`、テストは `npm test`＝vitest **71件**）
- **外販LPのデプロイ**: `landing/README.md` 参照（Cloudflare Pages・wrangler）
- **コーポレート側のデプロイ**: push後 `gh workflow run daily-rebuild.yml -R ao-magicianED/bluestage-corporateHP-PJ`

## 7. 外販（BlueReserve）の状況

このシステムを他のレンタルスペース運営者に販売する事業。**2026-07-09時点で営業開始は保留中**
（LPは完成・公開済み、X/note告知はこれから）。

- **LP**: `landing/index.html`（単一HTML・問い合わせはGoogle Apps Script→スプレッドシート＋メール通知。セットアップは `landing/SETUP_FORM.md`）
- **プラン**（`src/lib/license.ts` の LICENSE_PLANS がLP料金表と一致）:
  1部屋 ¥55,000 / 2-3部屋 ¥88,000 / 4-5部屋 ¥132,000 / 6-10部屋 ¥198,000
- **ライセンス制御**: シングルテナント設計（顧客ごとに独立したSupabaseプロジェクト）。
  license_limits テーブル（1行固定）の max_venues を超える拠点追加はDBトリガーで拒否。
  変更履歴は license_changes。状況確認は /admin/license。
  ブルーステージ本体のDBは max_venues=7, plan_name='internal' に設定する運用
- **設計書**: docs/license-upgrade-feature-design.md（アップグレード決済フロー等の将来設計を含む）

## 8. ハマりどころ（実際に踏んだもの）

1. **Vercel env改行混入**（→§3警告）。ADMIN_PASSWORD/RESEND_API_KEY/MAIL_FROMで実際に発生した
2. **カレンダーIDの取り違え**: 当初京成小岩に白金高輪のIDが設定されていた。正しいマッピングはコーポレートrepoのCLAUDE.md「7拠点カレンダーID」表が正
3. **fail closed設計**: FreeBusy取得失敗時は全枠「受付外」表示になる（安全側）。「全部受付外」の問い合わせが来たらまずカレンダー権限/IDを疑う
4. **undiciの日本語ヘッダ/ボディ**: fetchで日本語を含むメールを送る際は `TextEncoder` でUint8Array化（mail.ts実装済み）。From名はRFC2047エンコード
5. **Stripeの最低決済額は¥50**: クーポンで下回る場合はcheckoutが拒否する仕様
6. **adjusted_total は増額/減額で意味が違う地雷**: 増額時は「実際に払われた新総額」、減額時は「返金後の目標金額（差額はrefunded_amountにも計上済み）」。素朴に `adjusted_total - refunded_amount` とすると減額分が二重控除される。**実収額は `ledger.ts` の `realizedRevenue()`（total_amount + extra_paid_amount - refunded_amount）が唯一の正**（0015で修正済み）。売上集計を書くときは必ずこれを使う
7. **expired→confirmed復旧**: 期限ギリギリ入金はWebhookが排他制約込みで復旧を試みる。失敗時は管理者アラート→手動返金
8. **migration番号の重複**: 0004が2本ある（§5）。新規作成時は番号の採番に注意

## 9. 残タスク（優先順）

1. **GBPウェブサイトURL統一（2026-06-12時点で残り5件）**: 白金高輪・西新宿403は完了済み。残り＝京成小岩/神田/上野御徒町/上野4A/上野4B。
   GBPグループ: https://business.google.com/groups/102124491183677146513/locations
   各拠点の鉛筆→連絡先→ウェブサイトに `https://bluespacerental.com/{slug}` を設定
2. **特商法ページ** `src/app/legal/tokushoho/page.tsx`: 登記住所・電話番号が未記入のまま（「公開前に記載」プレースホルダあり。公開前に必須）
3. **Stripe本番モード切替**（実売開始時）: **手順書 docs/stripe-production-switch-guide.md に従うこと**。本番キーへ差し替え→Webhookエンドポイントを本番モードで再作成→`STRIPE_WEBHOOK_SECRET`更新→テスト予約1件で確認。銀行振込（customer_balance）が本番で有効化されているか要確認
4. **Supabase AuthのSMTP**: 会員確認メールが現在Supabase内蔵SMTP（時間あたり数通制限）。Authentication→Emails→SMTP SettingsにResendのSMTPを設定する
5. **BlueReserve外販の営業開始**: LP公開済み・告知（X/note）は保留中。開始時はライセンス初期設定手順の整備も
6. **ドメイン移管**（2027年11月頃）: bluespacerental.com をXサーバー→Cloudflare Registrar（docs/xserver-dns-setup.md参照）
7. コーポレートの拠点詳細ページ→予約サイトへの301リダイレクト（two-site-strategy.md Phase D。コンテンツ移植は完了済みなので実施可能）

## 10. テスト方法

- ユニット: `npm test`（vitest **71件**: slots 23 / pricing 12 / cancellation 7 / occupancy 20 / ledger 9）
- カード決済E2E: テストカード `4242 4242 4242 4242`
- 請求書払いE2E: 法人予約→Stripeダッシュボードで請求書確認→`stripe.testHelpers.customers.fundCashBalance(customerId, {amount, currency:'jpy'})` で擬似入金→自動確定を確認
- 予約変更（延長）E2E: マイページ→時間変更→延長を選択→差額Checkout（テストカード）→自動確定・カレンダー時刻更新を確認
- Webhook再送テスト: Stripeダッシュボード→Webhook→イベント再送（冪等化されるため安全）
- Cron手動実行: `curl -H "Authorization: Bearer $CRON_SECRET" https://bluespacerental.com/api/cron/maintenance`（daily-reportも同様）
