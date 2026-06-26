# 管理画面: 店舗追加・ライセンスアップグレード機能 設計書

最終更新: 2026-06-26 / ステータス: 設計（実装前）

## 1. 目的

外販インスタンスにおいて、顧客が **管理画面から店舗追加** を行えるようにする。
追加は Stripe Checkout で課金完了後に自動で `license_limits.max_venues` が増える設計。

これにより:
- 顧客は「1部屋プランで安く始めて、後から追加」できる
- 販売側（あお）は介在せず、Stripe決済で自動的に売上発生
- DB制約により「決済なしで勝手に部屋追加」は物理的に不可能（[migration 0013](../supabase/migrations/0013_license_limits.sql)）

## 2. 価格マトリクス（[LP](../landing/index.html) と一致）

| 部屋数 | 通常価格（税込） | キャンペーン価格 |
|---|---|---|
| 1 | ¥78,500 | ¥55,000 |
| 2-3 | ¥125,700 | ¥88,000 |
| 4-5 | ¥188,500 | ¥132,000 |
| 6-10 | ¥282,800 | ¥198,000 |
| 11-20 | ¥424,200 | ¥297,000 |
| 21+ | 個別見積もり | 個別見積もり |

差額方式: 「現プラン → 上位プラン」へのアップグレードは **差額のみ請求**。
例: 1部屋プラン(¥55,000)契約後に2-3部屋プランへ → 差額 ¥33,000 で2部屋目を追加可能。

## 3. ユーザーフロー

```
[顧客] 管理画面 /admin/license にアクセス
   ↓
現状表示: 「3/3 部屋使用中（プラン: 2-3部屋）」
   ↓
「+1部屋追加」ボタン
   ↓
プラン変更ダイアログ表示:
  - 現プラン: 2-3部屋プラン
  - 新プラン: 4-5部屋プラン
  - 追加料金: ¥44,000（差額）
  - 「決済へ進む」ボタン
   ↓
Stripe Checkout（カード or 銀行振込）
   ↓
決済成功 → Stripe Webhook (/api/webhooks/stripe-license)
   ↓
[サーバー側]
  - license_limits.max_venues 更新（5に）
  - license_changes に履歴記録
   ↓
顧客の管理画面に戻る → 「+ 部屋を追加」ボタンが新たに使えるようになる
   ↓
顧客が venues.insert（API or 管理UI） → 物理的に追加可能
```

## 4. ファイル設計

### 新規ファイル

| パス | 役割 |
|---|---|
| `src/lib/license.ts` | ライセンス状態取得・差額計算 |
| `src/app/admin/license/page.tsx` | ライセンス管理画面（現状表示・アップグレードボタン） |
| `src/app/admin/venues/new/page.tsx` | 店舗追加画面（情報入力フォーム） |
| `src/app/api/admin/license-status/route.ts` | GET: 現状取得 |
| `src/app/api/admin/license-upgrade-checkout/route.ts` | POST: Stripe Checkout Session 作成 |
| `src/app/api/admin/license-upgrade-success/route.ts` | GET: 決済成功後の戻り先 |
| `src/app/api/webhooks/stripe-license/route.ts` | Webhook: 決済完了でDB更新 |
| `supabase/migrations/0013_license_limits.sql` | DB制約（**実装済み**） |

### 既存ファイルの修正

| パス | 修正内容 |
|---|---|
| `src/app/admin/page.tsx` | サイドメニューに「ライセンス管理」追加 |
| `src/app/api/webhooks/stripe/route.ts` | イベントタイプで分岐（既存予約 vs ライセンス購入） |

## 5. API 仕様

### GET `/api/admin/license-status`

**Response:**
```json
{
  "max_venues": 3,
  "used": 2,
  "remaining": 1,
  "plan_name": "starter_2-3",
  "available_upgrades": [
    { "to_plan": "starter_4-5", "max_venues": 5, "price": 44000 },
    { "to_plan": "starter_6-10", "max_venues": 10, "price": 110000 }
  ]
}
```

### POST `/api/admin/license-upgrade-checkout`

**Request:**
```json
{ "target_plan": "starter_4-5" }
```

**処理:**
1. 認証チェック（管理者のみ）
2. 現プランから target_plan への差額計算
3. Stripe Checkout Session 作成（mode: payment）
4. metadata: `{ "type": "license_upgrade", "target_plan": "...", "before_max": 3, "after_max": 5 }`
5. Checkout URL を返す

**Response:**
```json
{ "checkout_url": "https://checkout.stripe.com/c/pay/cs_..." }
```

### POST `/api/webhooks/stripe-license`

**処理（checkout.session.completed の場合）:**
1. 署名検証
2. `stripe_events` で冪等化（既存テーブル流用）
3. metadata.type が `license_upgrade` でなければスキップ
4. payment_status=paid, amount_total が想定額と一致するか検証
5. 原子的UPDATE:
   ```sql
   begin;
     update license_limits
       set max_venues = $after_max,
           plan_name = $target_plan,
           updated_at = now()
       where id = 1 and max_venues = $before_max;  -- 楽観ロック
     insert into license_changes (
       change_type, before_limit, after_limit,
       plan_before, plan_after,
       stripe_session_id, stripe_payment_intent_id, amount_paid
     ) values (...);
   commit;
   ```
6. 失敗時は管理者にDiscord通知（手動返金フロー）

## 6. UI モックアップ（テキスト）

### `/admin/license`

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ライセンス管理
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

現在のプラン: 2-3部屋プラン
使用状況: ●●○ (2/3 部屋使用中)

[+ 新しい部屋を追加]  ← 残枠あれば即押せる
[↑ プランをアップグレード]  ← 上位プランに移行

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
利用可能なアップグレード
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▸ 4-5部屋プラン
  最大5部屋 / 差額 ¥44,000
  [このプランへ →]

▸ 6-10部屋プラン
  最大10部屋 / 差額 ¥110,000
  [このプランへ →]

▸ 11-20部屋プラン
  最大20部屋 / 差額 ¥209,000
  [このプランへ →]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
変更履歴
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

2026-06-15 starter → 2-3部屋  ¥33,000 (Stripe)
2026-05-01 初回契約 starter   ¥55,000 (Stripe)
```

## 7. エッジケース

### 7-1. アップグレード後の店舗追加失敗

**症状**: max_venues=5 になったが、顧客が venues.insert 時にエラー
**原因**: トリガーで `active=true` の物理チェック → 整合性は保てている
**対応**: エラーメッセージに「ライセンス管理画面で残枠を確認してください」と案内

### 7-2. ダウングレード（5→3部屋）

**問題**: 既に5部屋 active があるのに max_venues=3 に下げると整合性破綻
**対応（フェーズ1）**: ダウングレードは管理画面では受け付けない（メール相談ベース）
**対応（フェーズ2）**: 「使用中の部屋を非表示にしてください」エラーを出して、顧客自身に整理させる

### 7-3. 決済失敗 / 中断

**処理**:
- Stripe Checkout の expired 時刻まで保留
- 決済完了 Webhook が来なければ何もしない（license_limits 据え置き）
- 顧客は再度アップグレード操作可能

### 7-4. Webhook 取りこぼし

**保険**: Vercel Cron `/api/cron/maintenance` で Stripe Sessions API を polling し、未反映の決済を検出 → 同じ更新ロジックを実行（既存パターン踏襲）

## 8. セキュリティ

| 項目 | 対策 |
|---|---|
| 管理画面アクセス | 既存の `ADMIN_PASSWORD` 認証を継承 |
| Webhook 署名検証 | `STRIPE_WEBHOOK_SECRET` で検証（既存パターン） |
| 金額改ざん | client から金額受け取らず、server で `target_plan` から計算 |
| イベント重複 | `stripe_events` テーブルで冪等化（既存テーブル流用） |
| DBへの直アクセス | RLS 有効、service_role キーのみが license_limits 操作可能 |
| ライセンス上限突破 | DBトリガー（migration 0013）で物理的に拒否 |

## 9. 実装ステップ（推奨順）

1. ✅ **migration 0013** 適用（Supabase）
2. `src/lib/license.ts` 作成（プラン定義 + 差額計算ロジック）
3. `/api/admin/license-status` 実装 + テスト
4. `/admin/license` ページ実装（読み取りのみ）
5. `/api/admin/license-upgrade-checkout` 実装 + Stripe Checkout 動作確認（テストモード）
6. `/api/webhooks/stripe-license` 実装 + E2E テスト
7. `/api/cron/maintenance` に保険ロジック追加
8. 本番デプロイ + Stripe 本番モード切り替え時に動作確認

## 10. 料金プラン定義（実装時参照）

```typescript
// src/lib/license.ts
export const LICENSE_PLANS = {
  starter_1:     { max_venues: 1,  price: 55_000,  label: '1部屋プラン' },
  starter_2_3:   { max_venues: 3,  price: 88_000,  label: '2-3部屋プラン' },
  starter_4_5:   { max_venues: 5,  price: 132_000, label: '4-5部屋プラン' },
  starter_6_10:  { max_venues: 10, price: 198_000, label: '6-10部屋プラン' },
  starter_11_20: { max_venues: 20, price: 297_000, label: '11-20部屋プラン' },
} as const;
```

差額は `target.price - current.price` で計算。

## 11. 関連ドキュメント

- [migration 0013](../supabase/migrations/0013_license_limits.sql) - DBスキーマ
- [LP](../landing/index.html) - 表示価格（マスター）
- [HANDOVER.md](../HANDOVER.md) - 既存システムの全体像
- [DESIGN.md](../DESIGN.md) - フェーズ1設計
