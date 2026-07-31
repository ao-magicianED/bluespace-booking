# PLAN.md — 空室直前告知Bot ＆ 範囲限定ダイナミックプライシング 設計書

最終更新: 2026-07-31 ／ ステータス: **設計確定（実装前・コード未変更）**
実装手順は [PRODUCTION.md](PRODUCTION.md) を参照。本書は「何を・なぜそう決めたか」の記録。

> 用語1行解説は各所に付記。既存システムの前提は [DESIGN.md](DESIGN.md) / [HANDOVER.md](HANDOVER.md) を正とする。

---

## 0. 目的とKPI

- **目的**: 直近1〜3日以内に空きがある拠点・時間帯を自動で告知し、手数料ゼロの自社直販予約を増やす。将来は範囲限定の自動価格変動（ダイナミックプライシング、以下DP）で稼働率×単価を最適化する。
- **背景数値**（2026-07-31時点の実測）: 直近12日間の稼働率は最高でも上野御徒町の35%（=65%が空き）。自社直販は直近60日で4件のみ。ほぼ全予約が手数料30〜35%の外部モール経由 → 直販に1件流すだけで粗利が大きく改善する。
- **MVPのKPI**（2〜4週間で計測）: 告知数 ／ クリック数（告知リンク経由） ／ 告知経由の予約件数 ／ 告知経由売上（実収ベース）。※「増収額」の厳密な推定はholdout（後述）導入後。

## 1. 確定した設計判断（6点）

ユーザー確認済み（2026-07-31）。

| # | 判断 | 採用 | 理由 | 退けた案 |
|---|---|---|---|---|
| 1 | 空き状況の「正」 | **既存 `src/lib/availability.ts` を再利用**（Supabase予約＋Google Calendar FreeBusyの合成・fail-closed） | 予約画面と同一ロジック＝「告知したのに予約画面では埋まってる」という不一致が構造的に起きない。Googleカレンダーは外部モール予約・手動ブロックの集約ハブであることが既存設計で確立済み | 公開iCal（HPの`calendar.ts`移植）はGoogle側キャッシュで数時間遅れることがあり直前告知に鮮度不足。Supabase単独は外部モール予約が見えず誤告知がほぼ確実 |
| 2 | MVP拠点 | **上野御徒町（ueno-okachimachi）** | 稼働35%と需要が最も実証されており、2〜4週間で「告知→予約」の転換を観測できる可能性が最大（学習速度優先） | 白金高輪（5.8%）は空きが最大だが需要が弱く、MVP期間中に成果ゼロのリスク |
| 3 | 実行基盤 | **GitHub Actions cron → Vercel APIルート**（`POST /api/cron/vacancy-bot`、`CRON_SECRET`認証） | Vercel Cronは既に2本使用中でHobbyプランは日次×2本が上限。GitHub Actionsは無料・頻度自由で、HPの1日3回再ビルドで実証済みのパターン。ロジック・環境変数・`availability.ts`はVercel側に集約されたまま | Vercel Pro課金（$20/月の固定費増）、Supabase Edge Functions（availability.tsを移植する実装コスト最大） |
| 4 | MVP配信チャネル | **LINE公式アカウント（ブルースペース専用を新規開設）→ LINE Harness経由で配信** | ユーザー選択。友だち＝見込み顧客への直接プッシュで転換率が高い。既存LINE Harness（Cloudflare Workers）はマルチアカウント対応でHTTP APIから配信可能 | X（推奨だったが不採用）: ブルーステージ用Xアカウントが未整備。@AI_BizBoost相乗りはターゲット不一致 |
| 5 | 月次レポートの置き場所 | **計測レポート（Bot成果・稼働集計）はこのPJ。番頭プラン向け商品化は別途** | データ（告知・予約・稼働・外部モール実績）が全部このPJのDBにある。※「番頭プラン」の定義文書は全リポジトリに存在せず（ユーザー回答も保留）、商品化スコープは定義確定後に別途設計 | 全部別PJ切り出し（連携実装が増えるだけ） |
| 6 | DPの適用範囲 | **自動変動は自社直販（own）のみ。外部モールは`price_actions`への指示draft自動生成まで（適用はスタッフ手動）** | 外部モールには価格変更APIがなく自動適用は技術的に不可能。既存の週次STEP0ループ（指示→実施→効果測定）にそのまま接続できる | RPAによる外部自動適用（規約リスク・保守コスト大） |

## 2. 全体アーキテクチャ

```
[GitHub Actions cron]  平日/毎日 朝9時JST（+必要なら夕方）
   │ POST /api/cron/vacancy-bot（Bearer CRON_SECRET）
   ▼
[Next.js on Vercel]  /api/cron/vacancy-bot
   ├─ ① bot_settings 読込（enabled? 予算残? ← DBが即時停止スイッチの正）
   ├─ ② availability.ts で対象拠点の空き枠を fresh 取得
   │     （Supabase予約 + GCal FreeBusy 合成・fail-closed。エラー時は投稿しない）
   ├─ ③ 誤告知ガード群（§4.4）を通過した枠だけ告知対象に
   ├─ ④ bot_announcements に行を claim（状態機械で二重投稿防止）
   ├─ ⑤ LINE Harness Worker へ HTTP POST（タグ配信・lineAccountId明示）
   │     └ ドライラン期間は Discord Webhook に投稿（channel='discord'）
   └─ ⑥ 結果を bot_announcements に記録・失敗時 Discord アラート

[告知メッセージ内リンク]
   └ https://<予約サイト>/r/{署名トークン}
        └ /r/[token]: クリック記録(bot_events) → first-party cookie 保存
             → 302 → /ueno-okachimachi?utm_source=line&…（GA4にも乗る）

[予約フロー（既存）]
   checkout API が cookie の attribution を検証
     → create_pending_booking RPC 内で booking_attributions に原子的保存
     → Stripe Webhook 確定（既存5点照合・STRIPE_APP_TAG維持）
     → 月次レポートが「告知経由の予約・売上」を集計
```

- **1行解説**: fail-closed＝外部APIエラー時は「安全側＝何もしない」に倒す方針。claim＝処理前にDBに「これからやる」と行を書いて他の実行と衝突しないよう占有すること。

## 3. フェーズ構成

| フェーズ | 内容 | 期間目安 | 拡大条件 |
|---|---|---|---|
| **0** | 手動準備: LINE公式アカウント開設・LINE Harness登録・友だち導線 | 実装と並行 | — |
| **1** | 告知Bot MVP（上野御徒町×LINE、計測込み）＋Discordドライラン1週間 | 実装1〜2週＋運用2〜4週 | 誤告知ゼロ＋告知経由予約の観測 |
| **2** | 計測の完成・月次レポート・管理画面 | Phase 1運用と並行 | — |
| **3a** | DP: 日単位の範囲限定自動変動（own）＋提案フロー＋監査ログ＋外部指示draft生成 | Phase 1の計測結果を見てから着手 | 直販流入が恒常化していること |
| **3b** | DP: 時間帯単位係数・孤立枠割引（大規模改修） | 3aの効果確認後 | phase3-design.md §6-3 の警告どおり慎重に |

**MVPの絞り**: 1拠点（上野御徒町）×1チャネル（LINE）。他6拠点・X展開は Phase 1 の計測結果を見てから。拠点追加は `bot_settings` に行を足すだけの設計にしておく（コード変更不要で拡大可能）。

## 4. Phase 1 詳細設計: 空室直前告知Bot

### 4.1 空き判定（データソース）

- `availability.ts` の既存関数を再利用し、**投稿直前に毎回 fresh 取得**。予約投稿（先に文面を作って後で流す方式）は行わない。
- fail-closed を踏襲: FreeBusy APIエラー・タイムアウト時はその回の投稿を**中止**（誤告知するくらいなら投稿しない）。
- **calendar_id 未設定は投稿禁止**: 現行 `google-calendar.ts` は calendar_id が空だと busy=空配列を返す（事実上 fail-open）。Botは「calendar_id が空の拠点は対象外」を明示チェックする（Codex指摘）。

### 4.2 実行スケジュール

- GitHub Actions cron: **毎日 JST 9:00**（`0 0 * * *` UTC）1本から開始。`workflow_dispatch`（手動実行）併設。夕方便の追加は運用を見て。
- GitHub Actions 側対策（Codex指摘反映）: `concurrency` で同時実行禁止・タイムアウト設定・失敗時は Actions の通知＋Bot側 Discord アラート。GitHub cron は数分〜数十分遅延し得るが、告知用途では許容。

### 4.3 配信（LINE）

- **アカウント**: ブルースペース専用 LINE公式アカウントを新規開設（Phase 0・手動）。既存 LINE Harness の `line_accounts` に追加登録（マルチアカウント対応済み）。
- **配信方式**: タグ配信。「空き通知希望」タグの友だちにのみ配信。
  - `POST /api/broadcasts`（`targetType:'tag'`・**`lineAccountId` 必須明示**＝誤って別事業アカウントへ配信する事故の防止）→ `POST /api/broadcasts/:id/send`。
  - 認証は Bearer APIキー（LINE Messaging APIのトークンはWorker側管理。Bot側はキー名 `LINE_CRM_API_KEY` のみ保持）。
- **通数バジェット**（無料プランは push 200通/月・追加購入不可）:
  - 消費見込み＝対象タグの友だち数×配信回数。送信前に当月累計＋今回見込みを計算し、`bot_settings.monthly_push_budget`（既定180通・安全マージン）を超えるなら**投稿skip＋Discordアラート**。
  - 友だちが増えて予算が常時逼迫したらLINEライトプラン（5,000通/月）へ移行判断。
- **友だち獲得導線**（友だちゼロでは配信先がない。Phase 0〜1で必須）:
  1. 予約確認メール（既存Resend）に友だち追加リンク＋「直前空き情報が届く」訴求
  2. 予約サイト各拠点ページにバナー
  3. 現地掲示QR（`a4-print` スキルで別途制作）
  4. キーワード応答「空き通知」→ 自動返信＋「空き通知希望」タグ自動付与（LINE Harness 側設定・`line-step-delivery` スキルの型を利用）

### 4.4 誤告知対策（7つのガード）

必須要件（Codexセカンドオピニオン2回分を反映）:

| # | ガード | 実装 |
|---|---|---|
| 1 | データ更新遅延で埋まった枠を告知しない | 投稿直前 fresh 取得＋fail-closed（§4.1）。さらに**外部モール→GCal同期遅延はfreshでも防げない**ため、`minimum_lead_minutes`（既定180分＝開始3時間以上先の枠のみ告知）を設定。当日枠よりも**翌日〜3日先の枠を優先**して告知 |
| 2 | 同一枠の重複告知防止 | `bot_announcements` に部分ユニーク制約 `(channel, venue_id, publish_date_jst)`（1拠点1チャネル1日1回）。加えて空き構成のハッシュ（slot_hash）を保存し、前回と同一内容なら skip |
| 3 | 予約直後の再投稿防止 | pending仮押さえ中の枠も busy 扱い（availability.ts既存挙動）＋「直近cooldown分以内にその拠点の予約作成があれば今回skip」 |
| 4 | 二重投稿防止（exactly-once） | 状態機械: `publishing → published / failed / unknown`。投稿前にDB行をclaim。**unknown（送信後に応答不明・HTTP 5xx含む）は自動再投稿しない**（Discordに通知して人間がLINE配信履歴で確認・手動確定）。`publishing` のまま30分以上滞留した行（実行中クラッシュ）もアラート対象とし、人間が手動確定する |
| 5 | 即時停止スイッチ | **DBフラグが正**: `bot_settings.enabled`（拠点×チャネル別）＋グローバル行。実行冒頭と送信直前の2回確認・DB取得失敗時は投稿しない。環境変数 `VACANCY_BOT_ENABLED` はデプロイ単位の最終防波堤（Vercelの環境変数変更は再デプロイが必要なため「即時」はDB側が担う）。※停止スイッチは**投稿済みメッセージを取り消せない**ことを運用上明記 |
| 6 | 空きなし日は投稿しない | 告知条件（連続 `min_contiguous_minutes`＝既定120分以上の空きがある枠）を満たさない日は skip し、skip理由を記録 |
| 7 | 古い投稿の陳腐化対策 | 投稿文に「◯時◯分時点の空き状況」と明記し、「最新はリンク先で確認」を必ず添える（リンク先＝予約ページは常にlive） |

### 4.5 計測設計

- **リンク**: 告知内リンクは `/r/{署名トークン}` （自社リダイレクタ）。
  - トークン＝`announcement_id`＋拠点＋有効期限をHMAC署名（`ATTRIBUTION_SECRET`）。改ざん・期限切れは検証で弾く。
  - `/r/` はクリックを `bot_events` に記録 → first-party cookie（httpOnly）に attribution 保存 → `302` で拠点ページへ（URLに `utm_source=line&utm_medium=social&utm_campaign=vacancy_bot` を付与しGA4でも自動計測）。
  - **1行解説**: first-party cookie＝自社ドメインが発行するcookie。LINEアプリ内ブラウザでもリダイレクト時に確実に付与でき、sessionStorage単独より欠損が少ない。
- **予約への紐付け**: checkout API がcookieを検証 → `create_pending_booking` RPC の引数に渡し、**予約行と同一トランザクションで `booking_attributions` に保存**（後からのUPDATE方式はWebhookと競合し得るため不採用・Codex指摘）。
- **成果の数え方**（レポートで3つを区別）:
  1. 告知経由売上（gross）: attributed予約の `total_amount` 合計
  2. 実収: `total_amount + extra_paid_amount - refunded_amount`（返金・追加請求を反映）
  3. 増収額（推定）: **holdout**（告知可能だったのに意図的に投稿しない日を無作為に設ける）との比較で推定。MVP期間はholdout無しで1・2のみ、Phase 2以降に導入判断
- **問い合わせの計測**: 拠点ページの問い合わせ導線にも同じutmが乗る（GA4）。フォーム側のattribution連携はMVPではGA4集計で代替。
- **窓**: 告知後7日以内の予約を成果と見なす（cookie有効期限=7日）。

### 4.6 ドライラン

- 最初の1週間は `channel='discord'`（既存の Discord Webhook）に同じ文面を投稿し、**誤告知ゼロ・skip判定の妥当性**を人間が検証。問題なければ `bot_settings` で LINE に切替（コード変更不要）。

## 5. Phase 2: 計測の完成・月次レポート

- **月次レポートcron**: `POST /api/cron/monthly-bot-report`（GitHub Actionsから毎月1日 JST朝に呼ぶ。Vercel Cron第3枠は使わない）。内容: 告知数・skip数（理由別）・クリック数・attributed予約数・告知経由売上（gross/実収）・LINE通数消費・拠点別稼働率推移。Discord＋メール配信（既存 `sendAdminAlert` パターン流用）。
- **管理画面**: `/admin/vacancy-bot` — bot_settings のトグル（即時停止・予算・閾値）、告知履歴、成果一覧。既存 `/admin` の認証・UIパターンに従う。
- **番頭プラン向け商品化**: 番頭プランの定義が確定したら別途設計（このPJは集計データとレポート生成基盤を提供する側）。既存の外販LPには「アナリティクスレポート 月額¥5,500」の記述があり、本レポートはその原型になり得る。

## 6. Phase 3: 範囲限定ダイナミックプライシング（設計のみ・着手はPhase 1計測後）

### 6.1 原則

1. **人間が拠点ごとに下限/上限（bounds）を設定し、自動変動は常にその範囲内へクリップして適用する**（クリップ後の実効価格が「正」で、請求額・監査ログ・画面表示は常に同値）。ルール計算がboundsを超えた日は、クリップ前の生の計算値を「提案」として起票し、人間がboundsの見直しを判断する。**boundsの外の価格が請求されることは決してない**（「範囲外は提案のみ」の正確な意味）。
2. **適用は自社直販（own）の自動変動のみ**。外部モールは `price_actions` への指示draft自動生成まで（適用はスタッフ手動・既存の週次STEP0ループに接続）。
3. **全価格変更を追記専用の監査ログに記録**。
4. **既存の安全機構を壊さない**: 表示額=請求額の同一計算（`quote.ts`）、Webhookの金額5点照合（スナップショット照合方式を維持・再計算しない）、`price_breakdown` スナップショット、`STRIPE_APP_TAG` metadata（同一StripeアカウントをあおサロンAIと共用しているため必須）。
5. **既存の人間ルールを自動側にも強制**: 拠点別下限価格・土日祝の値下げ禁止を共通validator化し、手動台帳と自動変動の両方が通る（現在 `price-actions.ts` にあるガードレールを抽出）。※「上野3拠点は孤立枠のみ値下げ」は時間帯単位の値下げに対する制約（現行実装もwarning止まり）のため、**日単位のR1直前割には適用しない**（時間帯単位DPを扱う3bで自動化を検討）。

### 6.2 変動ルール案（比較と推奨）

| 案 | 内容 | 判断材料 | 評価 |
|---|---|---|---|
| **R1: 段階直前割**（推奨・3aで実装） | 現行「当日10%」を lead-time ladder に置換。例: 7日前まで定価 → 3日前5% → 前日10% → 当日15%引（boundsでクリップ） | リードタイムのみ（決定的・説明可能） | ◎ 実装が軽く効果検証しやすい。告知Botとの相乗効果（「直前割やってます」を告知文に載せられる） |
| **R2: 需要期増額**（推奨・3aで実装） | 特定日・曜日・祝日単位の増額係数（例: 金土・祝前日+15%、ハロウィン等の特異日+20%）。`jp_holidays` テーブル連動 | カレンダー（決定的） | ◎ 既存の休日単価の細分化。取りはぐれ防止 |
| R3: 予約カーブ連動 | `occupancy_pace_snapshots`（35日先の予約カーブを毎日記録済み）で「同曜日の過去平均より埋まりが遅い日」を検出し割引を**提案**（自動適用しない） | 蓄積データ（統計的） | ○ データが貯まる3aの2〜3ヶ月後に「提案エンジン」として追加。最初から自動適用はしない |
| R4: 孤立枠割引 | 前後が埋まった孤立1〜2時間枠のみ値下げ（上野ルールの自動化） | スロット構成 | △ スロット単位の価格が必要＝3b送り（後述の技術的な壁） |

**推奨**: 3aは R1＋R2 のみ（ルールが決定的で、顧客に説明できる。データ不足の段階でのML・統計ベース自動変動はしない）。R3は提案専用として後追い、R4は3b。

### 6.3 技術的な壁と段階設計（3a→3b）

- 現行データ構造は**価格が「日単位」**（`DaySlots.pricePerHour`）。スロット（時間帯）単位の価格は availability API・BookingGrid・quote・Webhook照合まで広範囲の改修になると `docs/phase3-design.md` §6-3 が警告済み。
- → **3a は「日単位の実効時給調整」に限定**（R1・R2とも日単位で表現可能。Codex指摘により「曜日×時間帯係数」は時間帯部分を3bへ延期）。
- 3aでも `calcQuote` だけでなく **availability API の `pricePerHour` と公開ページの価格表示を同時に更新**しないと表示=請求が崩れる点に注意（実装タスクに明記済み）。

### 6.4 データモデル（新設4テーブル・詳細は PRODUCTION.md）

| テーブル | 役割 | 要点 |
|---|---|---|
| `venue_pricing_bounds` | 人間が設定する下限/上限 | 現行 `VENUE_PRICING_POLICY`（コード内ハードコード）をDB化。`floor <= ceiling` CHECK。判定対象は「自動調整・直前割適用後の基本時給（クーポン・オプション適用前）」と明文化 |
| `dynamic_pricing_rules` | 変動ルール | `rule_type`・`priority`・調整値は `adjustment_bps`（万分率・浮動小数の丸め誤差回避）・有効期間・`version`/`supersedes_id`・承認者。有効ルールの期間重複禁止 |
| `price_proposals` | 範囲外の変更提案 | 自動計算が bounds を超えた場合・R3の提案はここに起票 → admin画面で承認/却下。承認だけが適用される |
| `price_change_log` | 監査ログ | 追記専用（UPDATE/DELETE禁止をRLS/権限で強制）。before/after・実効価格・boundsスナップショット・rule_id/version・actor（system/human）・request_id一意 |

- `price_breakdown` はルールセットIDと適用順を含む **v3** に上げ、旧v2ロジックは過去予約の再現用に残す（既存方針の踏襲）。

## 7. リスク・未決事項

| 項目 | 内容 | 対応 |
|---|---|---|
| LINE友だちの立ち上がり | 新規アカウント＝友だちゼロから。友だちが少ない間は告知の絶対効果が小さい | Phase 0の導線4本を先行整備。MVP判定は「誤告知ゼロ＋仕組みの実証」を含めて評価（予約件数だけで判断しない） |
| 外部モール→GCal同期遅延 | 同期経路（公式連携か手動か）と遅延実績が未計測 | `minimum_lead_minutes`＝180分から開始し、運用で実測して調整 |
| 番頭プランの定義 | 全リポジトリに定義なし・ユーザー回答も保留 | Phase 2の商品化スコープは定義確定まで凍結。計測基盤はこのPJで先行 |
| LINE無料枠200通/月 | 友だち増で早期に枯渇し得る | 通数バジェット監視＋アラート。逼迫したらライトプラン移行を提案 |
| 投稿済み告知の陳腐化 | 停止スイッチでも投稿済みは消えない | 文面に時点明記＋「最新はリンク先」。LINEは1日1回配信なので露出時間が限定的 |
| Vercelプラン | Hobby前提で設計（cron追加なし） | Pro化した場合もGitHub Actions方式のまま動く（移行不要） |

## 8. Codexセカンドオピニオン反映記録（2026-07-31・gpt-5.6-sol）

| 重大度 | 指摘 | 反映 |
|---|---|---|
| 高 | 外部モール→GCal同期遅延はfresh取得でも防げない | `minimum_lead_minutes`＋翌日枠優先（§4.4-1） |
| 高 | calendar_id空はfail-openの穴 | Bot側で「calendar_id必須・空なら対象外」（§4.1） |
| 高 | X/LINE投稿のexactly-once未保証 | claim＋状態機械＋unknownは自動再投稿しない（§4.4-4） |
| 高 | sessionStorage単独の計測は欠損する | `/r/`署名リダイレクト＋first-party cookie＋RPC内原子的保存（§4.5） |
| 高 | 環境変数は即時停止にならない | DBフラグを正・2回確認・env はデプロイ単位の防波堤（§4.4-5） |
| 中 | 「増収額」と「告知経由売上」の混同 | gross/実収/holdout推定の3段区別（§4.5） |
| 中 | 月次レポートでVercel Cron第3枠を使うな | GitHub Actionsから月次routeを呼ぶ（§5） |
| 中 | 曜日×時間帯係数は日単位価格と矛盾 | 3aは日単位限定・時間帯は3bへ（§6.3） |
| 中 | availability/公開ページの価格表示も更新必要 | 3aタスクに明記（§6.3） |
| 中 | bounds判定対象の明文化・監査ログの追記専用化・adjustment_bps | テーブル設計に反映（§6.4） |

## 9. 内部設計レビュー反映記録（2026-07-31・4視点並列レビュー）

本書と PRODUCTION.md の初稿に対する多視点レビュー（要件カバレッジ／実装可能性／曖昧性／安全性）の主な反映:

| 重大度 | 指摘 | 反映先 |
|---|---|---|
| 高 | `create_pending_booking` 新シグネチャへの revoke/grant 再宣言が漏れると anon から予約RPCを直接叩ける | PRODUCTION T1-1（権限再宣言・anon拒否を完了条件化・down SQL） |
| 高 | 引数カウントの誤記（現行は11引数、拡張後12引数） | PRODUCTION T1-1/T1-8 修正 |
| 高 | `getAvailability` はFreeBusyエラーで例外を投げず `calendarError` フラグで返る | PRODUCTION T1-7 3-b（フラグ判定に修正） |
| 高 | GitHub Actions の `on.schedule` はworkflow単位発火（複数cron同居で月次レポートが毎日走る） | PRODUCTION T1-9/T2-2/T3-5/T3-7（workflowファイル分離を明記） |
| 高 | LINE Harness API の body 形式が初稿と不一致（`title`/`messageType`/`messageContent` が正） | PRODUCTION T1-5（実仕様を直接記載） |
| 高 | Worker側は line_account_id 解決失敗時に別事業アカウントへフォールバック送信（fail-open） | PRODUCTION P0-2（Worker修正）＋T1-5（送信前アサート）＋T1-12（実機確認） |
| 中 | send後の5xxは配信済みの可能性があり failed 扱いだと再実行で二重配信 | PRODUCTION T1-5/T1-7（send後は全て unknown・自動再送禁止）・本書§4.4-4 |
| 中 | boundsクリップ（T3-3）と「範囲外は適用しない」（T3-5）の矛盾 | 本書§6.1-1・PRODUCTION T3-3/T3-5（クリップ適用＋生値を提案起票に統一） |
| 中 | 上野孤立枠ルールと日単位直前割R1の矛盾 | 本書§6.1-5・PRODUCTION T3-2（適用マトリクス） |
| 中 | 実収計算は `ledger.ts` の `realizedRevenue` を再利用（adjusted_total は二重控除） | PRODUCTION T2-1 |
| 中 | `/r/` のクリック水増し（プレビューbot・連打） | PRODUCTION T1-6（レートリミット・bot UA除外・truncate） |
| 中 | unknown時に通数が予算集計から漏れ無料枠200通を超過し得る | PRODUCTION T1-7 g（recipient_countを送信前に保存・failedのみ除外） |
