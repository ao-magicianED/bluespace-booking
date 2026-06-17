# レンタルスペース予約システム 設計書（ブルーステージ合同会社）

最終更新: 2026-06-11 / ステータス: フェーズ1設計（Codexレビュー反映済み v1.1）

---

## 1. 目的

- インスタベース・スペースマーケット・UPNOW等の **手数料（30〜35%）をゼロに** する自社予約システムを作る（残るのはStripe決済手数料3.6%のみ）。
- **クレカ決済（Stripe）** で予約時に即時決済。
- 予約が入ったら **Googleカレンダーに自動登録** → 既存の他プラットフォームとも空き状況が連動。
- 将来的には **freee請求書連携（法人・長期利用）** と **動的価格** に拡張する。

競合4社（よやクル / スペースマーケット / インスタベース / UPNOW）の予約UX調査は `docs/competitor-research.md` を参照。

## 2. フェーズ計画

| フェーズ | 内容 | 状態 |
|---|---|---|
| **1** | 1時間単位の予約：空き表示 → スロット選択 → Stripe決済 → Googleカレンダー登録 → 確認メール＋管理者通知＋同期失敗検知 | 今回実装 |
| 2 | キャンセル・返金フロー、管理画面（予約一覧・同期状態表示）、freee連携（適格請求書） | 次回 |
| 3 | 時間帯別・曜日別価格（pricing_rules）、クーポン、リピーター割 | 将来 |
| 4 | 動的価格（稼働率・リードタイムで自動変動）、複数拠点横断検索 | 将来 |

> Codex指摘により、LINE/Discord/Notion連携・公開iCal・動的価格などはフェーズ1から **意図的に除外**（運用負荷最小の原則）。

## 3. 技術スタック（選定理由つき）

| 役割 | 採用 | 理由 |
|---|---|---|
| フロント＋API | **Next.js 15（App Router）** | 予約APIとWebhook（決済完了通知の受け口）が同居できる。Vercelに無料デプロイ可 |
| ホスティング | **Vercel** | push連動の自動デプロイ。Cron（定期実行）も無料枠あり |
| データベース | **Supabase（PostgreSQL）** | 無料枠あり。**排他制約**（同じ時間帯の予約をDBレベルで物理的に禁止する仕組み）が使えるのが決定打 |
| 決済 | **Stripe Checkout** | カード情報を一切自サーバーで扱わない（Stripeのページで決済）。手数料3.6%のみ |
| カレンダー | **Google Calendar API（サービスアカウント）** | サービスアカウント＝プログラム専用のGoogleアカウント。拠点カレンダーを共有すれば読み書き可能 |
| メール | **Resend** | 予約確認メール送信。無料枠 月3,000通。未設定でも動く（スキップされる）実装 |

> ※ Astro + Cloudflare Pages（既存HPの構成）にしない理由：予約システムは「サーバー側の処理」（決済Webhook、在庫の排他制御）が主役。Next.js + Vercel の方が実装も運用もシンプルで事例が多い。HPはそのまま、予約ページへリンクで飛ばす構成にする。

## 4. 全体アーキテクチャ

```
[利用者ブラウザ]
   │ ① 空き状況を見る
   ▼
[Next.js (Vercel)]
   │ GET /api/availability
   ├──► [Supabase] 自社予約(pending/confirmed)を取得
   ├──► [Google Calendar FreeBusy API] 他サイト経由の予約・手動ブロックを取得
   │      └ 両方を合成して「空き/予約済み」を判定（API失敗時は予約不可扱い＝fail closed）
   │
   │ ② スロット選択 → 予約者情報入力 → POST /api/checkout
   ├──► [Supabase] pending予約を作成（30分の仮押さえ。排他制約で重複は物理的に不可）
   └──► [Stripe Checkout] 決済ページへリダイレクト（有効期限30分で一致させる）
              │ ③ カード決済完了
              ▼
   [Stripe Webhook] POST /api/webhooks/stripe（署名検証＋イベントID重複排除）
   ├──► [Supabase] 予約を confirmed に更新（金額照合のうえ原子的に）
   ├──► [Google Calendar API] 予約イベントを作成 ←★他サイトと在庫連動
   │      └ 失敗時: calendar_sync_status=failed → 管理者通知 → Cronで再試行
   └──► [Resend] 利用者へ予約確認メール＋管理者へ通知

   [Vercel Cron] /api/cron/maintenance（5分ごと）
   ├──► 期限切れpendingの掃除
   └──► カレンダー同期失敗の再試行
```

### 用語1行解説
- **Webhook**: 「決済が完了したよ」とStripeが自社サーバーに自動で知らせてくる仕組み。
- **FreeBusy API**: Googleカレンダーの「埋まっている時間帯」だけを返すAPI。予定の中身は見ない。
- **pending（仮押さえ）**: 決済ページに進んだ瞬間に30分間その枠を確保。決済されなければ自動で解放。
- **fail closed**: 外部APIがエラーのときは「安全側＝予約不可」に倒す方針。

## 5. ダブルブッキング防止（最重要設計）

3重のガード＋後始末：

1. **表示時**: Googleカレンダー busy + 自社予約（pending/confirmed）を合成して埋まり枠を非表示。FreeBusyがエラーなら全枠予約不可表示（fail closed）。
2. **仮押さえ時（DB排他制約）**: PostgreSQLの `EXCLUDE` 制約（`btree_gist` 拡張）で「同じ拠点・重なる時間帯」の行は **DBが挿入を拒否**。アプリのバグでも二重予約は物理的に起きない。
   ```sql
   CONSTRAINT no_double_booking EXCLUDE USING gist (
     venue_id WITH =,
     tstzrange(start_at, end_at, '[)') WITH &&
   ) WHERE (booking_status IN ('pending', 'confirmed'))
   ```
3. **仮押さえ直前の再チェック**: checkout API内で Google Calendar busy を再確認（他サイトで直前に入った予約を弾く）。

**【Codex指摘反映】期限切れpendingの後始末**
- 期限切れの `pending` 行は排他制約に引っかかり続けるため、「空き計算で無視する」だけでは不十分。
- → 仮押さえ作成は **DB関数（ストアドプロシージャ）1回の呼び出し** で行い、その中で「重なる期限切れpendingを `expired` に更新 → INSERT」を同一トランザクションで実行する。
- → さらにVercel Cronが5分ごとに全体を掃除（Webhook取りこぼしの保険）。

**【Codex指摘反映】仮押さえ時間とStripeの整合**
- Stripe Checkoutの最短有効期限は30分。**pending保持も30分に統一**し、DBの `expires_at` はStripeセッションの実際の `expires_at` を保存する。

**残存リスク（仕様上ゼロにできない）**
- 「他サイトで予約 → Googleカレンダー反映までの数分」の間に自社で同枠が売れる可能性は残る。発生時の運用手順（即時返金→代替提案→お詫び連絡）を `docs/setup-guide.md` に明記。繁忙枠は外部サイト側をリクエスト承認制に寄せる運用も検討。

## 6. データベース設計（Supabase / PostgreSQL）

### venues（拠点）
| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | |
| slug | text unique | URL用ID（例: keisei-koiwa） |
| name / address / description | text | 拠点情報 |
| open_hour / close_hour | int | 営業時間（0〜24。24時間営業は 0/24） |
| hourly_price | int | 基本時給（円・税込） |
| min_hours / max_hours | int | 最低・最大連続利用時間（デフォルト1 / 8） |
| calendar_id | text | 連動するGoogleカレンダーID |
| external_booking_url | text | 外部予約URL（並記用） |
| active | boolean | 公開フラグ |

### bookings（予約）【Codex指摘反映: 予約状態と決済状態を分離】
| 列 | 型 | 説明 |
|---|---|---|
| id | uuid PK | |
| venue_id | uuid FK | |
| start_at / end_at | timestamptz | 利用開始・終了（UTC保存、表示はAsia/Tokyo）。`CHECK (start_at < end_at)` |
| booking_status | text | pending / confirmed / cancelled / expired |
| payment_status | text | unpaid / paid / refunded / partially_refunded |
| customer_name / customer_email / customer_phone | text | 予約者情報 |
| purpose | text | 利用目的（任意） |
| total_amount | int | 合計金額（円・税込） |
| currency | text | 'jpy' 固定（将来用） |
| price_breakdown | jsonb | **価格スナップショット**（時給×時間の内訳。フェーズ3でルールが変わっても過去予約の根拠を再現できる） |
| stripe_session_id | text | Stripe Checkout セッションID |
| stripe_payment_intent_id | text | 決済ID（返金時に使う） |
| calendar_event_id | text | 作成済みGoogleカレンダーイベントID（冪等化＋削除用） |
| calendar_sync_status | text | none / synced / failed（失敗検知→Cron再試行） |
| confirmation_email_sent_at | timestamptz | メール二重送信防止 |
| expires_at | timestamptz | pendingの失効時刻（Stripeセッションと同値） |
| cancelled_at / cancel_reason | timestamptz / text | フェーズ2用 |
| refunded_amount | int | フェーズ2用 |
| created_at / updated_at | timestamptz | |

### stripe_events（Webhook冪等化）【Codex指摘反映】
| 列 | 型 | 説明 |
|---|---|---|
| event_id | text PK | StripeイベントID。**同じイベントの再送を1回しか処理しない** ための記録 |
| type | text | イベント種別 |
| processed_at | timestamptz | |

### pricing_rules
フェーズ1では **テーブルを作らない**（Codex指摘: 未使用テーブルより price_breakdown スナップショットを先に入れる方が安全）。価格計算関数 `pricing.ts` だけ「ルールが無ければ基本時給」の形にしておき、フェーズ3でテーブル＋ルール読込を追加する。

### セキュリティ
- **RLS（行レベルセキュリティ）有効・クライアント直アクセス禁止**。DBへの読み書きはすべてNext.jsのサーバー側（service_roleキー）経由。

## 7. 予約フロー詳細（フェーズ1）

### 画面
1. `/`: 拠点一覧
2. `/[slug]`: 拠点予約ページ。**7日間 × 1時間スロットのタイムテーブル**（インスタベース型グリッドUI）。週送りで最大60日先まで。**同日内の連続スロット複数選択可**（最大 `max_hours` 時間）。
3. 同ページ下部で氏名・メール・電話・利用目的を入力。**最終確認に日時・金額・キャンセルポリシーを表示**してから「決済へ進む」
4. Stripe Checkout（Stripeがホストする決済ページ）
5. `/thanks`: 完了ページ / 決済中断時は予約ページへ戻る

### スロットの状態
- `available`（空き）/ `booked`（埋まり）/ `closed`（受付対象外: 過去・締切後・60日超）
- 受付締切: 開始時刻の **1時間前** まで予約可（定数で調整可能）。

### checkout API の処理順序
1. 入力バリデーション（営業時間内・連続性・最大時間・60日以内・締切前）
2. Google Calendar busy 再確認（エラー時は409で拒否＝fail closed）
3. サーバー側で価格計算（クライアントから金額は受け取らない）
4. DB関数 `create_pending_booking` 呼び出し（期限切れpending掃除→INSERT、排他制約違反なら409）
5. Stripe Checkout Session作成（30分期限、metadata.booking_id）→ セッションIDと期限をbookingに保存
6. セッション作成に失敗したら booking を expired に戻す
7. **荒らし対策**: 同一メールアドレスのactive pendingは2件まで。IP単位の簡易レートリミット。

## 8. Stripe設計【Codex指摘反映】

- **Checkout Session（payment モード）**。金額はサーバー計算のみ。
- Webhookは署名検証（`STRIPE_WEBHOOK_SECRET`）必須。
- **冪等性**: `stripe_events` にイベントIDをINSERT（unique制約）→ 重複なら即200で終了。
- **checkout.session.completed の検証**: ①metadata.booking_idの予約が存在 ②session.id が保存値と一致 ③`payment_status=paid` ④`amount_total` がDBの `total_amount` と一致 ⑤`currency=jpy`。1つでも不一致なら confirmed にせず管理者へアラートメール（返金調査行き）。
- **状態遷移は原子的に**: `UPDATE ... WHERE booking_status='pending'` で更新し、confirmed を expired で上書きしない（イベント順序の入れ替わり対策）。
- **checkout.session.expired**: pending → expired（confirmedには触らない）。
- 領収書: Stripeの自動領収書メールを有効化。**適格請求書（インボイス）が必要な法人にはフェーズ2のfreee連携で対応**。それまでは手動発行（メール依頼ベース）と明記。
- 返金: フェーズ1はStripeダッシュボードから手動。

## 9. Google Calendar設計【Codex指摘反映】

- GCPでサービスアカウントを作成し、各拠点カレンダーを「予定の変更」権限で共有。
- 読み: FreeBusy API（空き判定・fail closed・指数バックオフ）。書き: Events API（確定時にイベント作成）。
- **PII（個人情報）をカレンダーに書かない**: 拠点カレンダーは公開iCalでHPにも使われているため、イベントタイトルは `【自社予約】#予約ID下8桁` のみ。氏名・電話などはDBと管理者メールに限定。
- **冪等化**: `calendar_event_id` が既にあれば再作成しない。
- **失敗時**: `calendar_sync_status='failed'` にして管理者通知 → Cronで再試行。これを怠ると外部サイトに空きのまま残り二重予約の温床になる。

## 10. セキュリティ・法務チェックリスト

- [x] カード情報は自サーバー非通過（Stripe Checkout）
- [x] APIキー類はすべて環境変数（Vercel環境変数 + `.env.local`、gitにコミットしない）
- [x] Supabase RLS有効、クライアントにDBキーを置かない
- [x] Webhook署名検証＋イベント冪等化
- [x] 予約APIバリデーション＋金額のサーバー側計算＋Webhookでの金額照合
- [x] 仮押さえ荒らし対策（pending上限・レートリミット）
- [ ] 特定商取引法ページ: 事業者名/住所/電話/責任者/価格/支払時期・方法/役務提供時期/キャンセル条件/追加費用を明記（ひな形は実装に含む。**正式版は会社情報を入れて公開前に確認**）
- [ ] キャンセルポリシー明記（予約ページ最終確認・確認メール・特商法ページ）
- [ ] プライバシーポリシー
- [ ] インボイス対応方針の決定（フェーズ2でfreee連携、当面は依頼ベース手動発行）

## 11. 環境変数一覧

| 変数 | 用途 |
|---|---|
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | DB接続（サーバー専用） |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | 決済 |
| `GOOGLE_SERVICE_ACCOUNT_KEY_BASE64` | カレンダー読み書き（サービスアカウントJSONをBase64で1行化） |
| `RESEND_API_KEY` / `MAIL_FROM` / `ADMIN_EMAIL` | メール通知（未設定ならスキップ） |
| `NEXT_PUBLIC_SITE_URL` | リダイレクトURL生成 |
| `CRON_SECRET` | Cronエンドポイント保護 |

## 12. ディレクトリ構成

```
レンタルスペース予約システム/
├── DESIGN.md（本書）
├── docs/
│   ├── setup-guide.md         ← Stripe/Supabase/GCPの初期設定手順（初心者向け）
│   └── competitor-research.md ← 競合4社の予約UX調査
└── app/                       ← Next.jsアプリ本体
    ├── package.json
    ├── vercel.json            ← Cron設定
    ├── supabase/migrations/   ← DBスキーマSQL（btree_gist・排他制約・DB関数）
    └── src/
        ├── app/
        │   ├── page.tsx                  ← 拠点一覧
        │   ├── [slug]/page.tsx           ← 予約ページ（タイムテーブル）
        │   ├── thanks/page.tsx
        │   ├── legal/tokushoho/page.tsx  ← 特商法表記（ひな形）
        │   └── api/
        │       ├── availability/route.ts
        │       ├── checkout/route.ts
        │       ├── webhooks/stripe/route.ts
        │       └── cron/maintenance/route.ts
        ├── components/        ← タイムテーブル等のUI部品
        └── lib/
            ├── supabase.ts / stripe.ts / google-calendar.ts / mail.ts
            ├── slots.ts       ← スロット計算（純粋関数・テスト対象）
            └── pricing.ts     ← 価格計算（フェーズ3拡張ポイント・breakdown出力）
```

## 13. 運用イメージ（フェーズ1）

- 予約が入る → Googleカレンダーに自動登録＋管理者メール → スマホ通知で気づく
- 予約一覧はSupabase Table Editorで確認（フェーズ2で専用管理画面）
- キャンセル依頼時の手順書（順序ミス防止チェックリスト）: ①Stripeで返金 → ②Googleカレンダーのイベント削除 → ③Supabaseで booking_status=cancelled / payment_status=refunded に更新 → ④お詫び・完了メール。詳細は `docs/setup-guide.md`
- 二重予約発生時（外部サイト同期遅延）: 即時返金 → 代替日時提案 → お詫び

## 14. Codexセカンドオピニオン反映記録（2026-06-11）

| 重大度 | 指摘 | 対応 |
|---|---|---|
| 高 | pending15分とCheckout30分の不整合 | 30分に統一、StripeのexpiresをDBに保存（§5） |
| 高 | 期限切れpendingが排他制約に残る | DB関数内で掃除→INSERTを同一トランザクション化＋Cron（§5） |
| 高 | Webhook冪等性・順序ずれ | stripe_eventsテーブル＋原子的UPDATE＋confirmed不可逆（§8） |
| 高 | Webhookでの金額照合不足 | session.id/amount/currency/payment_statusの5点照合（§8） |
| 高 | カレンダー作成失敗→外部在庫ずれ | calendar_sync_status＋管理者通知＋Cron再試行（§9） |
| 高 | 外部サイト同期遅延は不可避 | 運用手順明文化・繁忙枠は承認制寄せ（§5） |
| 中 | 枠押さえ荒らし | pending上限＋レートリミット（§7） |
| 中 | 予約状態と決済状態の分離 | booking_status / payment_status 分離＋返金系カラム（§6） |
| 中 | 価格スナップショット | price_breakdown jsonb、pricing_rulesテーブルはフェーズ3送り（§6） |
| 中 | カレンダーへのPII露出 | タイトルは予約IDのみ（§9） |
| 中 | FreeBusy失敗時の挙動 | fail closed＋バックオフ（§5,9） |
| 中 | 手動キャンセルの事故 | 手順チェックリスト化（§13）、フェーズ2でワンクリック化 |
| 中 | 特商法の具体化 / インボイス | §10に明記、当面は手動発行→フェーズ2でfreee |
| 低 | フェーズ1の絞り込み | LINE/Notion等は除外（§2） |
| 低 | btree_gist等の実装注意 | migrationに明記（§6） |
