# AI設定オペレーション設計メモ

最終更新: 2026-06-25

## 目的

管理画面を大量に作り込まず、Claude Code / Codex / 管理者が自然言語で予約サイトの設定を変更できる土台を用意する。

ただし、AIが直接DBを書き換える設計にはしない。必ず以下の流れを通す。

1. 指示を受け取る
2. 安全な操作JSONへ解釈する
3. 現在値との差分をプレビューする
4. 管理者が承認する
5. 適用直前に現在値のドリフトを検査する
6. DBへ反映する
7. 監査ログを残す

## 実装箇所

- 管理画面: `/admin/ai-ops`
- プレビューAPI: `POST /api/admin/ai-ops/preview`
- 適用API: `POST /api/admin/ai-ops/apply`
- コアロジック: `src/lib/ai-ops.ts`
- 監査ログ: `ai_operation_logs`
- migration: `supabase/migrations/0013_ai_operation_logs.sql`

## 現在対応している操作

### 拠点料金

```json
{
  "type": "update_venue_pricing",
  "venueSlug": "kanda",
  "weekdayHourlyPrice": 1300,
  "holidayHourlyPrice": 2500,
  "lastMinutePercent": 10,
  "earlyBirdPercent": 10,
  "earlyBirdDays": 30
}
```

### 受付条件

```json
{
  "type": "update_venue_booking_rules",
  "venueSlug": "keisei-koiwa",
  "openHour": 9,
  "closeHour": 22,
  "minHours": 1,
  "maxHours": 8,
  "active": true
}
```

### クーポン作成

```json
{
  "type": "create_coupon",
  "code": "REPEAT10",
  "percentOff": 10,
  "venueSlug": "kanda",
  "maxUses": 100,
  "minAmount": 2000
}
```

### クーポン停止

```json
{
  "type": "deactivate_coupon",
  "code": "REPEAT10"
}
```

## 自然言語の例

- 神田の土日祝料金を2500円にして
- 上野4Aの平日料金を1800円に変更
- 京成小岩の営業時間を9時から22時にして
- 白金高輪を受付停止にして
- クーポン REPEAT10 10% 上限100回 最低2000円

## Codex / Claude Code から使う場合

最も安全なのは、自然言語をそのまま投げるのではなく、上記の構造化operationを生成してpreview APIへ渡すこと。

```http
POST /api/admin/ai-ops/preview
Content-Type: application/json

{
  "source": "codex",
  "text": "神田の土日祝料金を2500円にして",
  "operation": {
    "type": "update_venue_pricing",
    "venueSlug": "kanda",
    "holidayHourlyPrice": 2500
  }
}
```

返ってきた `operationId` を管理者承認後に apply API へ渡す。

```http
POST /api/admin/ai-ops/apply
Content-Type: application/json

{ "operationId": "..." }
```

## セーフティ設計

- 管理者CookieがないとAPIを呼べない
- service_roleはサーバー側のみ
- preview時点の変更前値と、apply直前の現在値が違う場合は適用しない
- 既存予約の金額は変更しない
- すべて `ai_operation_logs` に保存する

## 次に増やす候補

- 手動ブロック枠
- 予約リマインダー文面
- 顧客メモ/ブロック
- 定期予約作成
- 月次売上レポート送信
