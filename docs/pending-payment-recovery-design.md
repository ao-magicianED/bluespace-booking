# 決済待ち予約の復旧導線 — 改善プロンプト（2026-09-08 障害を受けて）

このファイルの「■ 別セッションに貼るプロンプト」以下をそのままコピーして、
`bluespace-booking` フォルダで新規セッションを開いて貼り付けてください。

調査の出典: 2026-09-08 のマルチエージェント調査（13エージェント / 5設計案 × 敵対的検証）。
設計案は**5本すべて `needs-changes` 判定**でした。素直に実装すると二重決済・枠の二重販売・
「払ったのに未確定」を起こします。下のプロンプトはその「踏んではいけない罠」を全部含んでいます。

---

## 2026-09-08 再検証メモ（実装セッション・P0-a）

下のプロンプトが挙げる file:line を実ファイルで読み直した結果と、P0-a で確定した設計判断。
**以降の段階（P0-b〜P3）もこの節を先に読み、古くなった行番号は再確認すること。**

### file:line の再確認結果

| 主張 | 結果 |
|---|---|
| `my/[id]/page.tsx:131` pending は「決済待ち」表示のみ | ✅ 一致（:128-133） |
| `checkout/route.ts:346-409` カード分岐に `sendMail` 無し／請求書分岐 `:298` が手本 | ✅ 一致（実装前のベースライン。P0-a 実装後はカード分岐からも受付メールを送る） |
| `webhooks/stripe/route.ts:592-604` handleExpired 通常分岐は expired にするだけ | ✅ 一致（handleExpired 本体は :507〜。change_request 分岐 :511-550・adjustment 分岐 :553-590 には利用者メールあり） |
| `cancel/route.ts:40` pending は自己キャンセル不可 | ✅ 一致 |
| `admin/bookings/[id]/page.tsx:212-224` PI 無しは「—」 | ✅ 一致 |
| `availability.ts:58-65` 猶予10分／`vercel.json` cron は `0 18 * * *` のみ | ✅ 一致（期限切れ掃除を含む maintenance cron が `0 18 * * *` の1日1回。`vercel.json` には daily-report の `0 22 * * *` もあるが掃除には関与しない） |
| `types.ts` の `Booking` に `updated_at` が無い | ✅ 型には無い。ただし **DB列は存在**（`0001_init.sql:62`）。「型に無い」だけで、クエリで使うこと自体は既存コードも多数（lookback 基準に使わない理由は「管理画面編集で動く」の方） |
| `handleCompleted` の検証5点セット `:141` | ✅ 一致（:141-149） |
| 送信済みフラグの前例 | `confirmation_email_sent_at`（0001）／`reminder_email_sent_at`（0014）／`review_request_sent_at`（0016）。全て nullable `timestamptz`（`confirmation_email_sent_at` は 0001 の create table 内、他2つは `add column if not exists`） |
| マイグレーション番号 | 最新は 0022。**0021 は未マージの別ブランチ2本（`0021_ad_attribution` / `0021_invoice_lifecycle`）が使用中**なので、この一連の作業は **0023 から**採番する |

### 再検証で新たに見つかった事実（プロンプト本文に無いもの）

- `src/lib/mail.ts:40-60` `sendMail` は失敗時に throw せず `false` を返す契約。ただし `fetch` に**タイムアウトが無い**（:43）。決済応答の直前で無制限に await すると Checkout URL の返却が止まり得る。
- `checkout/route.ts:366` の Stripe `expires_at` は処理開始時（:114）の `now` から計算している。FreeBusy・見積・RPC の処理時間ぶんだけ Stripe から見た期限が30分を下回る（Stripe の最短は30分）。P0-a でセッション作成直前の `Date.now()` に修正。
- `session.url` は Stripe の型上 `null` になり得るが、実装前のコードは `{ url: null }` をそのまま返し、クライアントは `window.location.href = json.url`（`BookingGrid.tsx:476`）を実行していた。＝「pending なのに支払い手段なし」を作る別経路。P0-a でガードを追加（URL 無しならセッション失効＋仮押さえ解放）。
- `slots.ts:14` `LEAD_TIME_MINUTES = 1` に対し Checkout は30分有効。受付メールで支払い導線が増えると「利用開始後に支払える」ケースも増える。**既存問題のため P0-a では扱わず、別課題**（P1 の再開 API では `start_at` が未来であることを必ず再確認する）。
- `vitest.config.ts:4` の対象は `src/**/*.test.ts`（`src/lib` 限定ではない）。ルートの挿入位置を守るテストは `src/lib/tier-server-only.test.ts:25` と同じ「ソースを読んで形を検査する」方式が現実的（ただし形の検査だけでは不十分で、外部 I/O を依存注入にして挙動テストも書く）。
- Stripe Checkout の `expires_at` 下限は「セッション作成から30分」（`node_modules/stripe/types/Checkout/SessionsResource.d.ts` の `expires_at` 注記）。ちょうど30分の指定は通信時間・秒境界・時計差で間欠的に拒否され得るため、P0-a で 60 秒のマージンを加算。
- Stripe SDK の既定は timeout 80 秒×ネットワーク再試行 2 回（`node_modules/stripe/cjs/stripe.core.js`）。巻き戻しで Stripe を先に await すると関数の実行上限に達して DB 解放に辿り着かず「URL の無い pending」が残り得る → 巻き戻しは **DB 先・Stripe は timeout 10 秒/再試行なし** にする。

### P0-a の確定設計（Codex `gpt-5.6-sol` / ultra レビュー「修正のうえ実装可」を反映済み）

1. `supabase/migrations/0023_pending_payment_email.sql`: `bookings.pending_payment_email_sent_at timestamptz`（nullable）を追加。
2. `src/lib/pending-payment-mail.ts`: 純関数 `buildPendingPaymentMail()` で件名・本文を組み立て、依存注入つき `notifyPendingPayment()` が「送信→失敗なら管理者通知／成功なら記録」を行う（どちらも vitest で挙動テスト）。期限は `JST_OFFSET_MS` 加算後に UTC getter で整形（実行環境のタイムゾーン非依存・**日付込み**「2026年9月8日 16:38（日本時間）」）。金額は `toLocaleString("ja-JP")` を明示。
3. `checkout/route.ts`:
   - Stripe `expires_at` を `Date.now()` ＋ 30 分 ＋ **60 秒マージン** に修正。DB とメールは **Stripe が返した実値** `session.expires_at` を権威にする（実際の猶予は 31 分程度）。
   - セッション作成直後・CAS 前に `session.url` null ガード。URL 無しと CAS 失敗はどちらも `CheckoutAbortError`（セッション ID 付き）で外側 catch に集約し、`rollbackCheckout()`（`src/lib/checkout-rollback.ts`）が **DB 解放 → Stripe 失効（timeout 10 秒・再試行なし）** の順で巻き戻す。DB 側のエラーもログに残す。`sessions.expire()` を直接呼ぶ箇所は巻き戻しの 1 か所だけ。
   - **CAS 成功後・`return { url }` の直前**で `after()`（`next/server`）に通知処理を登録し、レスポンス返却後に実行する。利用者を待たせず、Vercel は `after()` の完了（関数の最大実行時間内）まで関数を維持するので「レスポンス後に打ち切られてメール無し・記録 null が黙って残る」ことがない。**`after()` が追跡するのはコールバックが返す Promise まで**なので、`Promise.race` でタイマー側が先に抜ける書き方は禁止（追跡外になる）。通知は最後まで await し、8 秒を超えたら遅延ログを出すだけ（`runNotifyWithSlowLog`）。
   - `after()` の登録自体が同期 throw する環境（request scope 外・`waitUntil` 無し）でも決済本体に波及させない: `scheduleAfterResponse()`（`src/lib/after-response.ts`）が登録失敗をログしてその場で inline 実行にフォールバックする。inline 経路は決済本体の応答を止め得る（`mail.ts` の fetch にタイムアウトが無い）ので**この経路だけ総時間上限 8 秒**を設け、超過時は劣化ログを残して URL 応答を優先する（メールは届かない可能性）。task は run-once で包み、「登録してから throw」する実装でも二重実行しない。応答オブジェクトは登録前に構築する（登録後に応答生成が throw すると、巻き戻し後に失効 URL のメールが送られる経路ができるため）。
   - セッション作成直後に ID を catch の外側の変数（`createdSessionId`）に保持し、`CheckoutAbortError` 以外の想定外の例外（CAS クエリの throw 等）でも巻き戻しで失効できるようにする。
   - 送信受理時のみフラグ更新。**CAS の update には同居させない**（デプロイ→マイグレーションの順序が逆転しても壊れるのはフラグ更新だけで済み、CAS 失敗＝セッション失効＋予約 expired を巻き込まない）。フラグ更新に `booking_status='pending'` 条件は付けない（送信直後に Webhook で confirmed になっても送信事実は記録する）。
   - `sendMail` が `false` のときは `sendAdminAlert` で管理者へフォロー依頼（`confirm.ts:195` と同方針）。**Checkout URL は通知・ログに載せない**（bearer リンク）。
4. 文面の要点: 「仮予約（仮押さえ）」「予約確定ではない」「決済完了後に確定メール」／期限後は「**仮予約は順次失効**」とし「自動キャンセル」とは書かない（キャンセル料のある確定予約との混同回避）。料金は「お支払いが完了しないまま失効した場合、この仮予約について料金は発生しない」と**条件付き**で書く（期限直前の決済は Webhook が復旧または返金調査に回すため無条件に断定しない）／「空き状況への反映に10分ほどかかる場合がある」「同じ日時の空きは保証しない」／「URL を知る人は誰でもアクセスできるので転送・共有しない」「心当たりが無ければ支払わず連絡」。マイページ URL は **載せない**（P1 まではマイページに支払いボタンが無く、今回と同じ「案内どおりにしても何もできない」を再生産するため）。
5. フラグの意味: 「Resend がリクエストを受理した時刻」の best-effort 記録。配信完了の保証ではなく、厳密な冪等化キーでもない（送信後に記録するため、記録失敗時は null のまま）。**将来 null を根拠に再送するなら送信前 claim か outbox が必要**。
6. P0-a でやらないこと: 管理者への pending 通知（離脱率が高くノイズ）／管理画面の表示／マイページの支払いボタン（P1）／失効通知（P0-b）／新セッション発行・既存セッション失効・Webhook 変更（P1 の排他設計を迂回しない）／Stripe の `after_expiration.recovery` は有効化しない。

### デプロイ順序（P0-a）

1. Supabase SQL Editor で `0023_pending_payment_email.sql` を実行
2. PR をマージ → Vercel 自動デプロイ

順序が逆になっても決済は止まらない（`after()` 内の送信記録だけが失敗してログに残り、その期間の監査時刻は null のまま）が、原則は上の順。

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
つまり DB 上 `pending` のまま「空き」と表示され続ける時間帯が最大でほぼ24時間ある（maintenance cron は1日1回のため、競合する新規予約による掃除が無ければ次の cron まで残る。※当初「最大11時間」と書いていたのは誤り）。
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
