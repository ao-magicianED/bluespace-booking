# 決済待ち予約の復旧導線 — 改善プロンプト（2026-09-08 障害を受けて）

このファイルの「■ 別セッションに貼るプロンプト」以下をそのままコピーして、
`bluespace-booking` フォルダで新規セッションを開いて貼り付けてください。

調査の出典: 2026-09-08 のマルチエージェント調査（13エージェント / 5設計案 × 敵対的検証）。
設計案は**5本すべて `needs-changes` 判定**でした。素直に実装すると二重決済・枠の二重販売・
「払ったのに未確定」を起こします。下のプロンプトはその「踏んではいけない罠」を全部含んでいます。

---

## ■ 別セッションに貼るプロンプト

bluespace-booking の「決済待ち（pending）予約から利用者が復旧できない」問題を修正したい。
2026-09-08 に実際に顧客クレームが発生し、手動で救済した。恒久対策を設計・実装してほしい。

### 実際に起きたこと（本番データで確認済み）

会員が 16:08 JST に ブルースペース京成小岩 17:30-18:30 / ¥1,000 を予約。
Stripe Checkout セッションは作成された（`cs_live_...` が `stripe_session_id` に保存済み）が、
決済画面で離脱し `payment_intent` は生成されなかった。結果:

- `booking_status=pending` / `payment_status=unpaid` のまま 16:38 に失効
- 顧客はマイページで「決済待ち」と表示されるだけで**支払いを再開する手段がゼロ**
- **メールも1通も届かない**（カード決済フローは仮予約メールを送っていない）
- 顧客が同じ枠を取り直そうとしても、自分の pending が枠を握っていて `slot_taken` になる

顧客からの問い合わせ原文:
「マイページでは決済待ちと表示されていますが、決済ページや決済ボタンが表示されず、
メールも届いていません。支払い方法をご確認いただけますでしょうか。」

### 確認済みの根本原因（3観点の独立検証で反証できず確定）

1. `src/app/my/[id]/page.tsx:131` — pending は「決済待ち」の文字列を出すだけ。支払い再開UIが無い
2. `src/app/api/checkout/route.ts:346-409` — カード決済分岐に `sendMail` が1つも無い
   （請求書払い分岐 `:298` にはある。これが手本になる）
3. 支払い再開のAPI/ページが存在しない。`checkout.sessions.create` はリポジトリ全体で4か所のみで、
   うち3か所は `booking_status === "confirmed"` ガード付き（`admin/adjust-price:55`,
   `admin/change-time:62`, `change-request` は `canSelfChange`）
4. `src/app/api/webhooks/stripe/route.ts:592-604`（handleExpired の通常予約分岐）は
   pending→expired にするだけで**利用者へのメールが無い**。
   change_request / adjustment の分岐には利用者宛メールがあるのと対照的
5. `src/app/api/cancel/route.ts:40` — 利用者は pending 予約を自分でキャンセルして枠を解放することもできない
6. 管理画面 `src/app/admin/bookings/[id]/page.tsx:212-224` — `stripe_payment_intent_id` が無いと
   Stripe欄は「—」。支払いリンク再送の手段が無い

### 併せて発見された潜在バグ（今回の障害とは別。優先度高）

`src/lib/availability.ts:58-65` は「`expires_at` + 猶予10分」を過ぎた pending を**空き枠として一般公開**する。
一方 `expire_stale_pendings` を回す cron は `vercel.json` で `0 18 * * *`（**1日1回・JST 03:00**）のみ。
つまり DB 上 `pending` のまま「空き」と表示され続ける時間帯が最大11時間ある。
`create_pending_booking`（`supabase/migrations/0022_price_bands_and_entry.sql:292-299`）が
INSERT 時に重なる期限切れ pending を掃除するので実害は限定的だが、状態としては明確に不整合。

### 作業の進め方

`docs/pending-payment-recovery-design.md` に調査結果がある。まずこれを読むこと。
そのうえで**サマリを鵜呑みにせず、必ず実ファイルを読んで file:line を再確認**してから設計に入る。
前回の調査では、設計案が「存在しない 422 レスポンス」「types.ts に無い `updated_at` 列」を
前提にするなどの事実誤認を複数回起こしている。

### 実装の優先順位（この順で。1本ずつPRを分ける）

**P0-a. カード決済の仮予約受付メール（最小・最も効果的）**
これだけで今回の障害は9割防げる。`checkout/route.ts` のカード分岐に、Stripe Checkout URL と
30分の期限を載せたメールを追加する。請求書分岐の `sendMail`（`:298`）が手本。

- ⚠️ **挿入位置が命**: `stripe_session_id` 保存 CAS の**成功後・`return` の直前**に置くこと。
  CAS の前に送ると、保存失敗→予約 expired／セッション失効の巻き戻し後に、
  顧客の手元に生きて見える決済リンクだけが残る（Stripe の expire が失敗すれば実際に支払える）
- メール送信失敗が決済フロー本体をブロックしないこと
- 冪等化のため送信済みフラグ列を追加する

**P0-b. 失効通知メール**
`handleExpired` の通常予約分岐に「お支払いが確認できなかったため枠を解放しました／再度ご予約ください」を追加。

- ⚠️ cron 側にフォールバックを足す場合、`cron/maintenance/route.ts` の 0-a と 1（`expire_stale_pendings`）は
  **try/catch の外**にある。列が無い状態で新しいクエリを前方に差し込むと cron 全体が落ち、
  期限切れ掃除が止まって枠が塞がり続ける。マイグレーション適用→デプロイの順序を守ること
- ⚠️ lookback の基準に `updated_at` を使わない（管理画面の編集で動く。かつ `types.ts` の `Booking` 型に存在しない）。
  `expires_at` か `created_at` を使う

**P1. マイページの「お支払いに進む」ボタン＋再開API**
ここが最も事故りやすい。以下は前回の敵対的検証で見つかった**必須の防御**:

- 生きた Checkout セッションが**常に1本だけ**になることを構造的に保証する。
  既存セッションが `open` なら**再利用**し、`expired` のときだけ再発行する
- ⚠️ 旧セッションを先に `sessions.expire()` してはいけない。その瞬間 Stripe が
  `checkout.session.expired` を送り、DB にはまだ旧IDが入っているので
  `handleExpired`（`:592-604`）の条件に一致して**予約が expired に落ちる**（顧客が支払おうとしている最中に枠が解放される）
- ⚠️ CAS 失敗時のロールバックでは、`booking.stripe_session_id !== 自分が作った session.id` の
  ときだけ失効させること。無条件に expire すると、たった今有効になった他リクエストのセッションを殺す
- ⚠️ 金額は `booking.total_amount` のスナップショットをそのまま使う。`buildQuote` で再見積すると
  `session.amount_total` とズレて `handleCompleted` の検証5点セット（`:141`）で
  「金額不一致」→**払われたのに未確定**になる
- ⚠️ `status: "complete"` かつ `payment_status: "unpaid"`（非同期決済の処理中）を
  「支払い完了」と一律に扱わない。`async_payment_failed` 後に二度と払えなくなる
- ⚠️ URL を返す前に**必ず** `getBusyRanges` で Google カレンダーを fail-closed で再確認する
  （`checkout/route.ts:120-137` と同じ）。外部サイト（Airbnb等）で埋まった枠への支払い口を開かないため。
  `runConfirmationSideEffects` の衝突チェック（`confirm.ts:77-103`）は**アラートを出すだけで確定は止めない**
- ⚠️ 再開回数の上限は DB 側の原子的インクリメントで（`increment_extra_paid_amount`（0017）が手本）。
  アプリ側の read-modify-write は同時実行で上限をすり抜ける
- ⚠️ 上限到達・期限超過で「取り直してください」と案内するなら、**同時に pending 行を解放すること**。
  解放しないと今回とまったく同じ「案内どおりにやっても絶対に成功しない」状態を再生産する
- ⚠️ 再開セッションの `expires_at`（最短30分）が予約の `expires_at` を追い越さないこと。
  追い越すと「枠は他人に売れたのに顧客はまだ払える」状態になる
- `checkRateLimit`（`src/lib/rate-limit.ts`）と Stripe の `idempotencyKey`
  （`admin/adjust-price/route.ts:278` が手本）、Origin 検証を入れる
- 再開の入口検証は `isBookingOwner` だけでは不足。`booking_status='pending'` /
  `payment_status='unpaid'` / `cancelled_at is null` / `start_at` が未来、を全部再確認する

**P2. 管理画面からの救済（支払いリンク再発行／手動確定）**

- ⚠️ `sessions.expire()` が「completed」で失敗するケースは、**まさに顧客が今支払った瞬間**。
  これを無害として飲み込むと、カード課金済みの予約に現金も受け取って**二重受領**になる。
  飲み込んでよいのは `already expired` だけ
- ⚠️ 手動確定は `runConfirmationSideEffects` を通すこと（カレンダー登録＋確認メールが走る）。
  ただし「金を受け取っていないのに確定できる」危険への歯止め（入金方法必須・監査列・通知）を必ず設計に含める
- ⚠️ 返金の歯止めについて事実確認: `src/lib/cancel-booking.ts:128-133` の `executeCancellation` は
  PaymentIntent が0件でも**アラートを出すだけでキャンセルを続行**し、`refunded_amount=0` のまま残る
  （満額が売上に残ったままキャンセル済みになる）。422 で止まる実装には**なっていない**
- ⚠️ `src/components/ReceiptClient.tsx:148` は `payment_method` で支払方法を印字する。
  現金で受け取って手動確定すると、適格請求書に「クレジットカード」と印字される

**P3. availability と cron の不整合（上記「潜在バグ」）**
`PENDING_HOLD_MINUTES` の短縮は**採用しないこと**。Stripe Checkout の最短30分に阻まれ、
DB 側だけ縮めると「支払えるのに枠がない」返金事故になる。
cron の実行頻度を上げるか、`availability.ts` の公開条件と DB の状態を一致させる方向で。

### 制約

- Codex（`gpt-5.6-sol` / `model_reasoning_effort: "ultra"`）にセカンドオピニオンを取ること。
  決済まわりの後戻りしにくい変更にあたる
- `no_double_booking` 排他制約（`0001_init.sql:65-68`）と
  `uq_bookings_session`（`:74-75`）を壊さないこと
- Stripe は Bluestage-lcc アカウントをあおサロンAIと共用している。
  新しいアラートを足すときは必ず `session.metadata?.app !== STRIPE_APP_TAG` でガードする
  （`src/lib/stripe.ts` のコメント参照）
- 1PR / 1目的。`git add .` 禁止（ファイル名を指定して add）
- 各段階で `vitest` のテストを書くこと（`src/lib/*.test.ts` が手本）

---

## 参考: 2026-09-08 の手動救済の記録

| 時刻(JST) | 出来事 |
|---|---|
| 16:08 | 顧客が予約。Stripe セッション作成、決済未完了 |
| 16:26 | 問い合わせ受領・調査開始 |
| 16:38 | `expires_at` 到達 → Stripe の `checkout.session.expired` で `expired` に |
| 16:40 | `067_京成小岩会議室` カレンダーに仮押さえ予定を入れて枠を確保 |
| 16:47 | Stripe Payment Link を作成（`restrictions.completed_sessions.limit=1` で二重決済防止、metadata に `booking_id`・`app` を入れず誤アラート回避） |
| 16:49 | 顧客がリンクを開く（Checkout Session `open`） |

手動確定の手順（今後も使う）:
1. カレンダー仮押さえ予定を**先に削除**（`confirm.ts:80` の衝突チェックが誤アラートを出すため）
2. 予約を `confirmed` + `paid` に更新
3. 管理画面の「再同期」を押す → `runConfirmationSideEffects` がカレンダー登録＋
   入退室案内入りの確定メールを自動送信

領収書・売上台帳・リピート回数はいずれも `booking_status='confirmed'` と
`payment_status='paid'` だけで正しく動く（`stripe_payment_intent_id` は不要。
ただし返金操作には必要なので後から入れる）。
