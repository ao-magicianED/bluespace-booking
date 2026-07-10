# ブルーステージ レンタルスペース予約システム（フェーズ1）

1時間単位のスロット予約 → Stripeクレカ決済 → Googleカレンダー自動登録。

- 設計書: [../DESIGN.md](../DESIGN.md)
- セットアップ手順: [../docs/setup-guide.md](../docs/setup-guide.md)
- 競合調査: [../docs/competitor-research.md](../docs/competitor-research.md)

## 開発

```bash
cp .env.example .env.local  # 値を設定
npm install
npm run dev    # http://localhost:3000
npm test       # ユニットテスト
npm run build  # 本番ビルド確認
```

## 構成

- `src/app/` — ページとAPIルート（availability / checkout / webhooks/stripe / cron/maintenance / cron/daily-report=稼働レポート）
- `src/lib/` — コアロジック（slots=スロット計算, pricing=価格計算, confirm=確定後処理 など）
- `supabase/migrations/` — DBスキーマ（Supabase SQL Editorで実行）
