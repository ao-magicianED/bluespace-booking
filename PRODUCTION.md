# PRODUCTION.md — 空室直前告知Bot ＆ DP 実装手順書（Sonnet 5向け）

最終更新: 2026-07-31 ／ 対応する設計書: [PLAN.md](PLAN.md)（設計判断の理由は必ずそちらを先に読む）

## 実装者への前提指示

1. **先に読む**: [PLAN.md](PLAN.md) → [DESIGN.md](DESIGN.md) §5/§8/§9 → [HANDOVER.md](HANDOVER.md) → `docs/phase3-design.md` §6-3（Phase 3のみ）。
2. **規約**: インデント2スペース。既存コードのパターン（cron認証・`sendAdminAlert`・admin画面の作り）を必ず踏襲。`git add` はファイル名指定（`git add .` 禁止）。1タスク＝1コミット目安。
3. **migration採番**: 次は **0021** から（0004が2本ある past事故に注意。番号重複禁止）。適用は Supabase MCP の `apply_migration` またはダッシュボードSQL Editor。適用前に必ずユーザーへ確認。
4. **秘密情報**: APIキー等の値はコード・本書・コミットに書かない。**キー名のみ**（`.env.example` に追記し、実値は Vercel 環境変数と `.env.local`）。
5. **テスト**: 純粋関数は vitest（`npm run test`）。既存テストを壊さないこと。APIルートは手元で `curl` 確認手順を本書に記載。
6. **fail-closed原則**: 迷ったら「投稿しない・価格を変えない」に倒す。
7. 各タスク末尾の**完了条件をすべて満たしてから**次へ。詰まったらユーザーに相談（勝手に設計変更しない）。

## 追加する環境変数（キー名のみ）

| キー名 | 用途 | フェーズ |
|---|---|---|
| `LINE_CRM_API_URL` | LINE Harness Worker のベースURL（例: `https://line-crm-worker.….workers.dev`） | 1 |
| `LINE_CRM_API_KEY` | LINE Harness の Bearer APIキー（staff用の専用キーを発行して使う。owner万能キーは使わない） | 1 |
| `ATTRIBUTION_SECRET` | `/r/{token}` 署名トークンのHMAC鍵（32byte以上のランダム文字列） | 1 |
| `VACANCY_BOT_ENABLED` | デプロイ単位の最終防波堤（`false`ならcron routeが即return）。即時停止の正はDB側 | 1 |

既存を流用: `CRON_SECRET`（cron認証）／`DISCORD_WEBHOOK_URL`（ドライラン・アラート）／`NEXT_PUBLIC_SITE_URL`。

---

## Phase 0: 手動準備（ユーザー作業・実装の前提条件）

コードを書く前にユーザーへ以下を依頼し、完了を確認する。

- [ ] **P0-1**: ブルースペース専用 LINE公式アカウントを新規開設（LINE Official Account Manager）。プランは無料（コミュニケーション）でOK。
- [ ] **P0-2**: LINE Harness（`C:/Users/04kc5/Desktop/ClaudeCodePJ/LINE公式アカウント自動化`・**別PJ作業**）に登録:
  - `line_accounts` に新アカウントを追加（channel_id / channel_secret / access token。`line-step-delivery` スキルの手順に従う）
  - タグ **「空き通知希望」** を作成（`POST /api/tags`）→ **tag id を控える**
  - キーワード応答「空き通知」→ 自動返信＋`add_tag`（空き通知希望）の automation を設定
  - ⚠️ 新規設定は必ず新アカウントの `line_account_id` に紐付ける（NULL=全アカウント共通になる既知の罠）
  - **Worker側の誤配信防止修正（同じく別PJ作業・推奨）**: 現行Workerは broadcast の line_account_id が解決できないと既定アカウント（`LINE_CHANNEL_ACCESS_TOKEN`＝別事業）へフォールバック送信する fail-open 挙動がある。`/api/broadcasts/:id/send` を「line_account_id 指定あり・解決失敗ならフォールバックせず4xxエラー」に修正する（Bot側のT1-5送信前アサートと二段構え）
- [ ] **P0-3**: LINE Harness の `staff_members` にBot専用 `api_key` を発行 → Vercel 環境変数 `LINE_CRM_API_KEY` / `LINE_CRM_API_URL` を設定
- [ ] **P0-4**: `ATTRIBUTION_SECRET` を生成して Vercel に設定
- [ ] **P0-5**: 控えた `line_account_id` と `tag_id` を後述 `bot_settings` 行に投入（T1-1の後）

---

## Phase 1: 告知Bot MVP（上野御徒町 × LINE、Discordドライランから開始）

### T1-1: DBマイグレーション `supabase/migrations/0021_vacancy_bot.sql`

**やること**: 以下のSQLを新規作成（そのまま使ってよい。既存スタイルに合わせたコメントを付けること）。

```sql
-- 0021: 空室直前告知Bot（bot_settings / bot_announcements / bot_events / booking_attributions）
-- 設計: PLAN.md §4。RLSは0001と同方針（クライアント直アクセス全面禁止・service_role経由のみ）

create table if not exists bot_settings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id),            -- null = グローバル設定行（全体kill switch）
  channel text not null check (channel in ('discord', 'line')),
  enabled boolean not null default false,          -- 既定OFF（明示的にONにするまで動かない）
  min_contiguous_minutes int not null default 120 check (min_contiguous_minutes >= 30),
  minimum_lead_minutes int not null default 180 check (minimum_lead_minutes >= 0),
  lookahead_days int not null default 3 check (lookahead_days between 1 and 7),
  cooldown_minutes int not null default 60 check (cooldown_minutes >= 0),
  monthly_push_budget int not null default 180 check (monthly_push_budget >= 0),
  line_account_id text,                            -- LINE Harness の line_accounts.id（channel='line'時必須）
  line_tag_id text,                                -- 「空き通知希望」タグID
  updated_by text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (channel <> 'line' or venue_id is null or (line_account_id is not null and line_tag_id is not null))
);
create unique index if not exists uq_bot_settings_venue_channel
  on bot_settings (coalesce(venue_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);
alter table bot_settings enable row level security;

create table if not exists bot_announcements (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  channel text not null check (channel in ('discord', 'line')),
  publish_date_jst date not null,
  target_dates jsonb not null default '[]'::jsonb,   -- 告知対象日 ["2026-08-01", ...]
  slot_hash text not null default '',                -- 正規化した空き枠構成のsha256（重複内容判定用）
  content text not null default '',                  -- 実際に送った本文（監査用）
  status text not null default 'publishing'
    check (status in ('publishing', 'published', 'failed', 'unknown', 'skipped')),
  skip_reason text,                                  -- skipped時の理由（no_slots/budget/disabled/calendar_error/cooldown/duplicate 等）
  external_post_id text,                             -- LINE broadcast id（Discordはnull）
  recipient_count int,                               -- 送信時のタグ対象人数（LINE通数消費の記録）
  settings_snapshot jsonb not null default '{}'::jsonb,
  availability_checked_at timestamptz,
  published_at timestamptz,
  attempt_count int not null default 1,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 1拠点×1チャネル×1日1回（skipped/failedは再試行を妨げない）
create unique index if not exists uq_bot_announcements_daily
  on bot_announcements (channel, venue_id, publish_date_jst)
  where status in ('publishing', 'published', 'unknown');
create unique index if not exists uq_bot_announcements_external
  on bot_announcements (channel, external_post_id)
  where external_post_id is not null;
create index if not exists idx_bot_announcements_venue_date
  on bot_announcements (venue_id, publish_date_jst);
alter table bot_announcements enable row level security;

create table if not exists bot_events (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid references bot_announcements(id),
  event_type text not null check (event_type in ('click')),
  occurred_at timestamptz not null default now(),
  user_agent text,
  referer text
);
create index if not exists idx_bot_events_announcement on bot_events (announcement_id, occurred_at);
alter table bot_events enable row level security;

create table if not exists booking_attributions (
  booking_id uuid primary key references bookings(id),
  announcement_id uuid references bot_announcements(id),
  source text not null default '',
  campaign text not null default '',
  clicked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table booking_attributions enable row level security;
```

さらに同ファイルで `create_pending_booking` を拡張する:
- 現行の最新定義は **`0003_members.sql:16` の11引数版**（`p_venue_id`〜末尾 `p_user_id uuid default null`）。この**全文をコピー**し、末尾に `p_attribution jsonb default null` を追加した**12引数版**を `create or replace` で定義（0001の10引数版は0003が既にdrop済み）。
- 関数本体の INSERT 成功後（`v_id` 確定後・同一トランザクション内）に:
  ```sql
  if p_attribution is not null then
    insert into booking_attributions (booking_id, announcement_id, source, campaign, clicked_at)
    values (
      v_id,
      nullif(p_attribution->>'announcement_id', '')::uuid,
      coalesce(p_attribution->>'source', ''),
      coalesce(p_attribution->>'campaign', ''),
      nullif(p_attribution->>'clicked_at', '')::timestamptz
    );
  end if;
  ```
- ⚠️ **旧11引数版は `drop function` で削除**（シグネチャ違いの関数が並存すると RPC 呼び出しが曖昧になる）。drop対象シグネチャは `create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid)`。呼び出し側（checkout）は同PR内で新引数対応にする（T1-8）。
- ⚠️ **新12引数版に対する権限の再宣言を必ず書く**（セキュリティ上必須）: Postgresは新規関数にデフォルトで PUBLIC の EXECUTE を付与するため、`0003_members.sql:84-85` と同じ流儀で `revoke execute ... from public, anon, authenticated;` ＋ `grant execute ... to service_role;` を**新シグネチャで**再宣言する。これを漏らすと anon キーの PostgREST RPC から checkout を迂回して仮押さえを直接作成できてしまう。コピー元にある**旧シグネチャ向けの revoke/grant 行はコピーしない**（drop後に存在しない関数を参照して migration が失敗する）。
- **down SQL を用意**: 適用前の11引数版の全文（revoke/grant含む）を `supabase/migrations/0021_vacancy_bot.down.sql`（gitignore不要・適用はしない）として保存し、障害時に SQL Editor で戻せるようにする。

**完了条件**: マイグレーションが本番Supabaseに適用でき、`select * from bot_settings` 等4テーブルが空で返る。既存の予約作成（RPC呼び出し）が壊れていない。**anonキーでの `create_pending_booking` 直接RPC呼び出しが権限エラーで拒否される**。down SQL が保存されている。
**テスト**: Supabase SQL Editor で `select create_pending_booking(...)` を試験値で呼び、`p_attribution` なし／ありの両方で bookings＋booking_attributions が期待どおり作られることを確認（テスト行は削除）。

### T1-2: 空き枠ダイジェスト純関数 `src/lib/vacancy-bot/digest.ts`

**やること**: `availability.ts` の `getAvailability(venue, fromDate, numDays)` の結果（スロット状態の配列）を入力に、告知候補を返す**純粋関数**を作る（I/Oなし・テスト可能に）。

```ts
export interface VacancyWindow { dateIso: string; startHour: number; endHour: number }
export interface DigestOptions {
  minContiguousMinutes: number;   // 既定120
  minimumLeadMinutes: number;     // 既定180（今から開始までの猶予）
  lookaheadDays: number;          // 既定3（今日を含む）
  nowJst: Date;                   // テスト注入用に必ず引数で受ける
}
export function buildVacancyDigest(avail: AvailabilityResponse, opts: DigestOptions): {
  windows: VacancyWindow[];      // 告知対象の連続空き枠
  slotHash: string;              // windowsの正規化sha256（node:crypto）
}
```

- ロジック: `available` スロットを日ごとに連結 → `minContiguousMinutes` 未満の窓は除外 → 開始時刻が `nowJst + minimumLeadMinutes` より前の窓は先頭を切り詰め（切り詰め後に短すぎれば除外）→ `lookaheadDays` 超の日は対象外。
- **スロットは30分刻み**（`SLOT_MINUTES=30`・`slots.ts`）のため `startHour`/`endHour` は 0.5 刻みの小数になり得る（10.5＝10:30）。窓の長さは連続スロット数×30分で算出する。
- 表示は当日枠より翌日以降を先に並べる（PLAN.md §4.4-1）。

**完了条件**: vitest で以下ケースがgreen: ①2時間未満の窓が落ちる ②リードタイム内の枠が切り詰められる ③空きゼロで windows=[] ④同一入力→同一slotHash・窓が1つ変わるとhash変化 ⑤lookahead境界 ⑥10:30開始など0.5刻み境界の窓長計算が正しい。
**テスト**: `src/lib/vacancy-bot/digest.test.ts` を新規作成し `npm run test`。

### T1-3: 文面生成 `src/lib/vacancy-bot/message.ts`

**やること**: `buildAnnouncementText(venueName, windows, checkedAtJst, linkUrl, priceLabel)` を実装。純粋関数・vitest対象。

文面テンプレート（LINE向け・Discordドライランも同一文面）:

```
【直前空きあり】{venueName}
{M/D(曜)} {HH:MM}〜{HH:MM} ほか

{checkedAt HH:MM}時点の空き状況です。
{priceLabel}（例: 平日¥1,300/h）
▼ 空き確認・予約はこちら（手数料なしの公式サイト）
{linkUrl}
※最新の空き状況はリンク先でご確認ください。
```

- 窓は最大5件まで表示、超過分は「ほか◯枠」。
- 時点明記と「最新はリンク先」は**削除禁止**（誤告知対策の一部。PLAN.md §4.4-7）。

**完了条件**: vitest green（窓0件で例外／5件超の省略表示／時点文言が必ず含まれる）。

### T1-4: 署名トークン `src/lib/attribution.ts`

**やること**: `node:crypto` の HMAC-SHA256 で署名付きトークンを実装（外部ライブラリ追加禁止）。

```ts
export interface AttributionPayload { an: string /* announcement_id */; v: string /* venue slug */; exp: number /* unix秒 */ }
export function signAttributionToken(payload: AttributionPayload, secret: string): string   // base64url(json).base64url(hmac)
export function verifyAttributionToken(token: string, secret: string, nowUnix: number): AttributionPayload | null
```

- 検証失敗（改ざん・期限切れ・形式不正）は `null`（例外にしない）。有効期限は発行から7日。
- cookie名は `bs_attr`（値はトークンそのまま）。

**完了条件**: vitest green（正常署名→verify成功／1文字改ざん→null／期限切れ→null／不正形式→null）。

### T1-5: LINE Harness クライアント `src/lib/vacancy-bot/line-client.ts`

**やること**: LINE Harness Worker のHTTP APIを叩く薄いクライアント。

```ts
export async function countTagFriends(tagId: string, lineAccountId: string): Promise<number>
export async function sendTagBroadcast(params: {
  lineAccountId: string;   // 必須。未指定だと既定アカウント（別事業）に飛ぶ事故があるため必ず明示
  tagId: string;
  text: string;
}): Promise<{ broadcastId: string }>
```

- API仕様（レビュー時に実コードで確認済み。疑わしければ `C:/Users/04kc5/Desktop/ClaudeCodePJ/LINE公式アカウント自動化/apps/worker/src/routes/broadcasts.ts` を読む。別プロジェクトのためセッションの追加作業ディレクトリ許可が必要——読めない場合はユーザーに依頼）:
  1. 作成: `POST {LINE_CRM_API_URL}/api/broadcasts` — body は `{ title, messageType: 'text', messageContent: <本文>, targetType: 'tag', targetTagId, lineAccountId }`（**`title` は必須**。`messages` というフィールドは存在しない）
  2. 送信前アサート: `GET /api/broadcasts/{id}` でレスポンスの lineAccountId が `bot_settings` の値と一致することを確認してから send を呼ぶ（不一致・null なら**中止してエラー扱い**。Worker側は line_account_id を解決できないと既定アカウント＝別事業へフォールバック送信する fail-open 挙動があるため、この確認は削除禁止）
  3. 送信: `POST /api/broadcasts/{id}/send`
- `countTagFriends` は `GET /api/friends?tagId=..&lineAccountId=..&limit=1` のレスポンス `total` を使う。
- 認証ヘッダ `Authorization: Bearer {LINE_CRM_API_KEY}`。10秒タイムアウト。
- **エラー分類ルール（exactly-once保証の核・削除禁止）**: 作成（手順1〜2）段階のエラーは通常の失敗（未送信確定→呼び出し側で status='failed'・再試行可）。**send（手順3）を呼び出した後のエラーは、HTTPエラー（5xx等）もタイムアウトもすべて `UnknownDeliveryError`** を投げる（Workerは送信開始後の例外を500で返すことがあり、500でも実際には配信済みの可能性がある。呼び出し側で status='unknown'・自動再送しない）。

**完了条件**: vitest（fetchをモック）で ①正しいbody形式・認証ヘッダ ②lineAccountId不一致で中止 ③send後の500/タイムアウトが `UnknownDeliveryError` になる、がgreen。実配信の確認は T1-12 の切替時でよい。

### T1-6: リダイレクタ `src/app/r/[token]/route.ts`

**やること**: GETルート。

処理順: ①`verifyAttributionToken`（失敗時はトップ`/`へ302・cookieなし）②`bot_events` に click 記録（失敗しても続行）③httpOnly cookie `bs_attr` を7日で設定 ④`302` → `/{venueSlug}?utm_source=line&utm_medium=social&utm_campaign=vacancy_bot`。

- ドライラン（Discord）の告知リンクも同じ `/r/` を通す（計測経路を本番同一にする）。utm_source はトークンのchannel情報から `line`/`discord` を出し分けてよい（payloadに `ch` を足す場合はT1-4も更新）。
- **クリック水増し対策**（KPIの信頼性のため必須）:
  - 既存 `src/lib/rate-limit.ts` の `checkRateLimit` をIP単位で適用。超過時は **click記録のみスキップし、リダイレクトは継続**（正規ユーザーを壊さない）
  - 既知プレビューbotのUA（`Discordbot` / `facebookexternalhit` / `Twitterbot` / LINE系プレビュー等）は click記録と cookie 付与をスキップ（DiscordやLINEはリンク投稿のたびにプレビュー取得で `/r/` をGETするため、除外しないとクリック数が構造的に水増しされる）
  - `user_agent` / `referer` は保存前に256文字でtruncate

**完了条件**: 手元で有効トークンURL→拠点ページに飛びcookieが付く／改ざんトークン→`/`に飛ぶ／`bot_events` に行が増える／curlでUAを `Discordbot` にすると行が増えない。

### T1-7: Bot本体 `src/app/api/cron/vacancy-bot/route.ts`

**やること**: POSTルート（**GET不可**）。

処理フロー（この順で実装。**skipを `bot_announcements` に status='skipped' で行記録するのは step 3（拠点別処理）のみ**。step 0〜2 はレスポンスJSONと `console.log` への記録だけでよい——`bot_announcements.venue_id` は not null のため拠点コンテキストのないskipは行にできない）:

0. **認証**: `Authorization: Bearer CRON_SECRET` を検証、不一致は401で即return（既存 `daily-report/route.ts` と同型。ただしメソッドはPOST）
1. `VACANCY_BOT_ENABLED !== 'true'` なら即200（`{skipped:'env_disabled'}`）
2. `bot_settings` 読込。**取得失敗→投稿せず終了**（fail-closed）。グローバル行（venue_id null）と対象拠点行の両方が `enabled=true` のチャネルだけ処理。あわせて**30分以上前の `publishing` 滞留行**（前回実行がクラッシュした痕跡）があればDiscordアラート（自動遷移はさせない・人間がT1-10の画面で確定する）
3. 対象拠点ごと（MVPは上野御徒町1件）:
   a. `venues.calendar_id` が空なら skip（`calendar_error`）
   b. `getAvailability` を try/catch で fresh 実行。**①例外（DB取得エラー等）②戻り値の `calendarError === true`（FreeBusy失敗時は例外ではなくこのフラグで返る——`availability.ts:56-63`）のどちらも skip（`calendar_error`）＋Discordアラート**。※フラグを見落とすとカレンダー障害が `no_slots` に化けて監視が無効になる
   c. 直近 `cooldown_minutes` 以内にその拠点の bookings 作成があれば skip（`cooldown`）
   d. `buildVacancyDigest` → windows空なら skip（`no_slots`）
   e. 前回 published の `slot_hash` と同一なら skip（`duplicate`）
   f. **claim**: `insert into bot_announcements (…status 'publishing'…)`。unique制約違反（=本日投稿済み）なら skip（`already_posted`）
   g. LINEのみ: `countTagFriends` を実行し、**取得した人数を claim 済み行の `recipient_count` にこの時点で保存**（送信結果に関わらず残す＝unknown時も通数を保守的に数えるため）。当月予算集計は `status in ('publishing','published','unknown')` の `sum(recipient_count)` を対象とし（failedのみ除外）、＋今回人数が `monthly_push_budget` 超なら行を skipped に更新（`budget`）＋Discordアラート
   h. **送信直前に bot_settings を再読込**して enabled 再確認（即時停止の2回目チェック）
   i. 送信: channel='discord' → `DISCORD_WEBHOOK_URL` にPOST／channel='line' → `sendTagBroadcast`
   j. 結果分類（T1-5のエラー分類ルールと対応）: 成功 → status='published'・external_post_id・published_at 更新。**broadcast作成段階の失敗 → 'failed'＋last_error（未送信確定・翌日以降の再実行可）。send呼び出し後の失敗（5xx・タイムアウト含む＝`UnknownDeliveryError`）→ 'unknown'＋Discordアラート（自動再送禁止・人間がLINE管理画面の配信履歴で確認して手動確定）**
4. レスポンスに処理サマリ（published/skipped件数と理由）をJSONで返し、`console.log` にも出す

**完了条件**: `curl -X POST -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/vacancy-bot` で、(a) settings未投入時に全skip (b) Discord設定投入後にDiscordへテスト投稿が届く (c) 同日2回目は `already_posted` になる (d) 認証ヘッダなし→401 (e) テスト用venueの calendar_id を一時的に不正値にして実行→ skip_reason='calendar_error'＋Discordアラートが届く（確認後に戻す）。
**テスト**: フローの分岐は digest/message等の純関数側でカバー済み。route自体は上記手動シナリオ＋`npm run build` 成功。

### T1-8: checkout への attribution 連結（`src/app/api/checkout/route.ts` ほか）

**やること**:
- checkout API 冒頭で cookie `bs_attr` を読み `verifyAttributionToken`。有効なら `create_pending_booking` RPC呼び出しに `p_attribution: { announcement_id, source, campaign, clicked_at }` を追加（無効・無しなら渡さない）。
- RPC呼び出し箇所すべて（member経由等があれば grep で洗い出し）を12引数版に追従。
- ⚠️ 決済フロー本体（金額計算・5点照合・`STRIPE_APP_TAG`）には**一切触れない**。

**完了条件**: 手元でトークン付き遷移→テスト予約（Stripeテストモード）→ `booking_attributions` に1行入る。トークン無し予約では入らない。既存テストgreen・`npm run build` 成功。

### T1-9: GitHub Actions `.github/workflows/vacancy-bot.yml`

**やること**（このリポジトリ初のworkflow。HPリポの `daily-rebuild.yml` を参考に）:

```yaml
name: vacancy-bot
on:
  schedule:
    - cron: '0 0 * * *'   # JST 9:00
  workflow_dispatch:
concurrency:
  group: vacancy-bot
  cancel-in-progress: false
jobs:
  post:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Call vacancy-bot endpoint
        run: |
          curl -sS --fail-with-body --max-time 120 -X POST \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            "${{ vars.SITE_URL }}/api/cron/vacancy-bot"
```

- GitHub リポジトリに Secret `CRON_SECRET`（Vercelと同値）と Variable `SITE_URL` を設定（ユーザー作業として依頼）。
- 失敗時はGitHub Actionsの標準通知＋Bot側アラートで検知（追加の通知stepは不要）。
- ⚠️ **このファイルは vacancy-bot 専用**。GitHub Actions の `on.schedule` は **workflow単位**で発火する（cronを複数並べるとどのcronでも全jobが走る）ため、別スケジュールの処理（月次レポート・pricing-eval・週次draft）を同一ファイルに足してはいけない。T2-2 / T3-5 / T3-7 は**必ず別workflowファイル**を作る。

**完了条件**: `workflow_dispatch` 手動実行が成功し、Vercelのログに実行が記録される。
**テスト**: 手動実行→bot_announcements に行が増える（skippedでも可）。

### T1-10: 管理画面 `/admin/vacancy-bot`

**やること**: 既存 `/admin` の認証・レイアウトパターン踏襲で1ページ追加。
- 上段: `bot_settings` 一覧と編集（enabled トグル＝**即時停止スイッチ**、予算・閾値の数値編集、updated_by 記録）
- 下段: `bot_announcements` 直近30件（日付・拠点・チャネル・status・skip_reason・recipient_count・クリック数join）
- **要対応行の警告表示＋手動確定ボタン**: 対象は「`unknown`」と「作成から30分以上経過した `publishing`（実行中クラッシュの痕跡）」の両方。人間がLINE配信履歴を確認して published/failed に手動更新する（自動遷移はさせない）

**完了条件**: 管理画面から enabled を OFF→cron手動実行→全skip（`disabled`）になることをE2Eで確認。

### T1-11: 友だち獲得導線

**やること**:
- 予約確認メール（本文の組み立ては `src/lib/confirm.ts`。`mail.ts` は送信基盤のみでテンプレートを持たない）にLINE友だち追加URL＋「空きが出たら通知が届きます」文言を追加（URLは `bot_settings` でなく環境変数不要のただの公開URLなので直書き可。ただし拠点非依存の1アカウント）
- 拠点ページ（`/[slug]`）にLINEバナー1箇所（既存デザイントーン踏襲・CSS変数使用）

**完了条件**: メールプレビューとページ表示を確認。`npm run build` 成功。
（現地掲示QRは `a4-print` スキルで別セッション対応・本書スコープ外）

### T1-12: ドライラン→本番切替（運用タスク・コード変更なし）

1. `bot_settings` に投入: グローバル行（channel別・enabled=true）＋上野御徒町×discord（enabled=true）。LINE行は enabled=false で作成
2. 1週間、毎朝のDiscord投稿を人間が確認: 誤告知ゼロ（投稿枠が実際に空いているか予約画面と突合）・skip理由が妥当か
3. 問題なければ admin画面で discord→OFF・line→ON（P0-5のID投入済み確認）
4. **LINE切替直後の誤配信チェック**: 運用者のみが「空き通知希望」タグを持つ状態で1通目を送り、①届いたアカウントがブルースペースの新アカウントであること（別事業アカウントに届いていないこと）②本文・リンク遷移・cookie→テスト予約→ `booking_attributions` 記録、までをLINEアプリの実機で確認してから一般友だちへのタグ付与導線を開放する

**完了条件**: LINE本配信1回目で attribution 経路が実機で動作。以後2〜4週間の計測運用へ。

---

## Phase 2: 計測の完成・月次レポート

### T2-1: 月次集計 `src/lib/vacancy-bot/report.ts`

**やること**: 対象月の集計を返す関数（純関数＋DB読み分離）。
- 告知数（published）・skip数（理由別）・クリック数（bot_events）・attributed予約数・告知経由売上 gross（`total_amount` 合計）と**実収（必ず `src/lib/ledger.ts` の `realizedRevenue` を再利用する**。対象は payment_status が paid / partially_refunded の予約のみ。`adjusted_total` は減額返金と二重控除になるため使わない——ledger.ts:14-29 の設計コメントどおり）・LINE通数消費（`sum(recipient_count)`・failedを除く）・拠点別稼働率（`occupancy_daily_snapshots`）。
**完了条件**: vitest（集計ロジックの純関数部分）green。対象データが0件の月でも0埋めレポートが生成されエラーにならない。

### T2-2: `src/app/api/cron/monthly-bot-report/route.ts` ＋ 専用workflow

**やること**: POST＋CRON_SECRET（T1-7と同じ認証パターン）。前月分を集計し、既存 `sendAdminAlert` パターンでメール＋Discord配信。
- workflowは **新規ファイル `.github/workflows/monthly-bot-report.yml`** を作る（`vacancy-bot.yml` への追記は禁止——T1-9の注意どおり同一workflow内の複数cronは全job同時発火する）。cron式は **`0 0 1 * *`（毎月1日 0:00 UTC＝1日 9:00 JST）** の1本のみ＋`workflow_dispatch`。構成はT1-9の雛形を流用しエンドポイントだけ変える。
**完了条件**: 手動実行でDiscordにレポートが届く。対象データ0件の月でも正常配信される。
**テスト**: シードデータ月で数値が手計算と一致。

### T2-3: admin成果表示

**やること**: `/admin/vacancy-bot` に月次サマリ（T2-1の関数を再利用）を表示。
**完了条件**: 画面で当月・前月が切り替えられる。

> **番頭プラン向け商品化**はスコープ外（定義確定待ち・PLAN.md §5）。T2-1の集計関数を将来のレポートAPIとして再利用できるよう、DB読みと整形を分離しておくこと。

---

## Phase 3a: 範囲限定ダイナミックプライシング（着手条件: Phase 1の2〜4週計測完了＋ユーザー承認）

> 原則は PLAN.md §6。**表示=請求の同一計算・Webhook 5点照合（スナップショット照合方式）・`STRIPE_APP_TAG`・price_breakdown保存を壊さないこと**が絶対条件。

### T3-1: migration `0022_dynamic_pricing.sql`

**やること**: 4テーブル新設（詳細列は PLAN.md §6.4 とCodex指摘リストに従う）:
- `venue_pricing_bounds`: `venue_id` unique・`floor_hourly int`・`ceiling_hourly int`・`check (floor_hourly <= ceiling_hourly)`・updated_by。**初期データは `src/lib/price-actions.ts` の `VENUE_PRICING_POLICY` の値をINSERT**（コードのハードコードは残し、T3-2でDB優先に切替）
- `dynamic_pricing_rules`: `venue_id`・`rule_type`（`'last_minute_ladder' | 'demand_uplift'`）・`params jsonb`（例: ladder=`{"steps":[{"daysBefore":3,"bps":-500},{"daysBefore":1,"bps":-1000},{"daysBefore":0,"bps":-1500}]}`）・`adjustment` は **bps（万分率int）**・`priority int`・`effective_from/to date`・`status('draft','active','retired')`・`version int`・`supersedes_id`・`created_by/approved_by`・`reason`。同一拠点×rule_typeのactive期間重複を防ぐ制約（EXCLUDE using gist または部分unique＋アプリ側検証。0001の排他制約の流儀を参考）
- `price_proposals`: bounds超過やR3提案の起票先。`venue_id`・`target_date`・`current_price`・`proposed_price`・`rule_id`・`reason`・`status('pending','approved','rejected','expired')`・`decided_by/decided_at`
- `price_change_log`: **追記専用**。`event_type`・`venue_id`・`target_date`・`channel('own')`・`before jsonb`・`after jsonb`・`effective_hourly int`・`bounds_snapshot jsonb`・`rule_id/rule_version`・`actor_type('system','human')/actor_id`・`request_id text unique`・`reason`・`created_at`。UPDATE/DELETEを`revoke`で禁止

**完了条件**: 適用成功・boundsに7拠点分の初期値が入る。

### T3-2: ガードレール共通化 `src/lib/pricing-guardrails.ts`

**やること**: `price-actions.ts` にある検証（拠点別下限・土日祝の値下げ禁止・上野3拠点は孤立枠のみ値下げ）を共通モジュールへ抽出し、**手動台帳（price_actions）と自動DP評価の両方**が同じ関数を通る構造にする。bounds は DB（`venue_pricing_bounds`）優先・フォールバックでコード定数。

ルール適用マトリクス（迷わないための判定表）:

| ガードレール | 手動台帳（price_actions） | 自動DP（3a・日単位） |
|---|---|---|
| 拠点別下限（floor） | block（現行どおり） | block（boundsクリップ） |
| 土日祝の値下げ禁止 | block（現行どおり） | block（ladderは土日祝に値下げ方向を適用しない） |
| 上野3拠点は孤立枠のみ値下げ | warning のみ（現行実装どおり・blockしない） | **判定対象外**（このルールは時間帯単位の値下げに対する制約。日単位のR1直前割には適用しない。時間帯単位DPは3bで扱う） |

**完了条件**: 既存の price_actions バリデーションの挙動が変わらない（既存テストgreen＋手動確認）。vitest で「祝日値下げがブロックされる」「floor割れがブロックされる」ケース追加。

### T3-3: calcQuote v3（`src/lib/pricing.ts`）

**やること**:
- DPレイヤーを追加: 対象日の実効時給 = 基本時給（平日/休日）→ `demand_uplift` 適用 → `last_minute_ladder` 適用 → **bounds でクリップ**（クリップ対象は「クーポン・オプション適用前の基本時給」＝PLAN.md §6.4）→ 100円単位丸め（丸め方向は切り捨て・`rounding` として breakdown に記録）
- **bounds超過時の統一セマンティクス（T3-5と共通・矛盾させないこと）**: 自動変動は常にbounds内へ**クリップして適用**し、クリップ後の実効価格が「正」（予約請求額・change_log・表示すべて同値）。クリップが発生した事実とクリップ前の生の計算値は T3-5 が `price_proposals` に起票して人間の bounds 見直し判断に回す。「範囲外は提案のみ」とは**boundsの外の価格が請求されることは決してない**という意味であり、「クリップ発生日は定価に戻す」ではない
- 既存の `last_minute_percent`（venues列・当日10%）は DPルールが active な拠点では**無効化**（二重割引防止）。ruleが無い拠点は現行v2挙動のまま
- `price_breakdown` を **v3** に: `ruleSetId`・`ruleVersion`・定価・実効時給・適用順リスト・bounds・丸め・`evaluatedAt` を含める。**v2の計算関数は削除せず残す**（過去予約の再現用）
- Webhook側は変更しない（スナップショット照合方式を維持）

**完了条件**: vitest で v3 の代表ケース（ladder各段・uplift・boundsクリップ・rule無し拠点はv2と同額）green。`/api/quote` と `/api/checkout` の金額が常に一致（quote.tsの既存保証が通る）。

### T3-4: 表示側の追従（`src/lib/availability.ts`・拠点ページ）

**やること**: availability API の `pricePerHour`（日単位）とBookingGrid・拠点ページの価格表示を「DP適用後の実効時給」に更新（calcQuoteと同じ関数から導出。**別実装を書かない**）。
**完了条件**: 予約グリッドに表示される単価×時間＝最終確認画面＝Stripe請求額、がDP有効拠点で一致（手動E2E）。

### T3-5: 日次価格評価cron `src/app/api/cron/pricing-eval/route.ts` ＋ 専用workflow

**やること**: 毎日1回（**新規ファイル `.github/workflows/pricing-eval.yml`**・JST 8:30目安＝`30 23 * * *` UTC。vacancy-bot.yml への追記は禁止）、全DP有効拠点×先35日を評価:
- ルール適用後の実効時給（**boundsクリップ後**＝T3-3の統一セマンティクス）を計算し、前日評価から変化した日を `price_change_log` に記録（クリップ発生フラグ含む。`request_id` = `{venue}-{date}-{実行日}` で冪等）
- **クリップが発生した日は、クリップ前の生の計算値を** `price_proposals` に起票＋Discord通知（人間が bounds 拡張を判断する材料。適用される価格はあくまでクリップ後の値）
- R3（予約カーブ提案）はここに後日追加する設計とし、コメントで拡張点を明示
**完了条件**: 手動実行で change_log と proposals が期待どおり増減。同日2回実行しても重複しない（request_id）。change_log の実効価格と実際の見積額（/api/quote）が一致する。

### T3-6: admin DP画面 `/admin/pricing`

**やること**: bounds編集（floor/ceiling・変更は price_change_log に actor_type='human' で記録）／ルール一覧・有効化（approved_by 記録）／proposals の承認・却下（承認時のみ適用ログ記録）／change_log 閲覧（読み取り専用）。
**完了条件**: 承認フローがE2Eで通る。**却下された提案が価格に影響しない**こと。

### T3-7: 外部モール指示draft自動生成

**やること**: 週次（月曜朝・**新規ファイル `.github/workflows/weekly-price-draft.yml`**。既存workflowへの追記は禁止）で、DP評価結果から外部モール向けの `price_actions` を **status='draft'** で自動生成（channel別・`reason` に根拠数値を記載）。適用はスタッフが従来どおり手動＋admin台帳で applied 記録（既存STEP0ループ）。
**完了条件**: draft が既存の `/admin/price-actions` 画面に表示され、既存の手動フローがそのまま使える。

---

## リリースチェックリスト（Phase 1）

- [ ] migration 0021 適用済み・既存予約フロー回帰確認（テスト予約1件）
- [ ] Vercel 環境変数4種設定済み（`LINE_CRM_API_URL` / `LINE_CRM_API_KEY` / `ATTRIBUTION_SECRET` / `VACANCY_BOT_ENABLED=true`）
- [ ] GitHub Secrets/Variables（`CRON_SECRET` / `SITE_URL`）設定済み
- [ ] `bot_settings` 投入済み（グローバル行＋上野御徒町。LINE行は line_account_id / line_tag_id あり）
- [ ] Discordドライラン1週間で誤告知ゼロを確認
- [ ] 即時停止テスト: admin で enabled OFF → 手動実行 → skip を確認
- [ ] `npm run test` / `npm run build` green

## ロールバック手順

1. **即時停止**: `/admin/vacancy-bot` で enabled を全OFF（デプロイ不要・次回実行から停止）
2. 恒久停止: GitHub Actions の workflow を disable（Actions タブ）
3. 最終手段: Vercel 環境変数 `VACANCY_BOT_ENABLED=false` → 再デプロイ
4. ⚠️ 投稿済みのLINE/Discordメッセージは取り消せない。誤告知が発覚した場合は同チャネルに訂正文を手動投稿し、`bot_announcements.last_error` に経緯を記録
5. **予約作成自体が失敗するようになった場合**（0021のRPC置換に起因するバグ＝Bot停止では直らない最重要ケース）: T1-1で保存した down SQL（旧11引数版の全文）を SQL Editor で適用して関数を旧定義へ戻し、あわせて Vercel を直前デプロイへロールバックする
6. DP（Phase 3）: 該当 `dynamic_pricing_rules.status='retired'` に更新すれば次回評価から定価に戻る（変更は price_change_log に残る）
