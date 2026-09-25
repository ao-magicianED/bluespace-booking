# CLAUDE.md（bluespace-booking）

構成・運用の詳細は [HANDOVER.md](HANDOVER.md) を参照。

## IMPORTANT: DBマイグレーションは自動では本番に入らない

- `supabase/migrations/*.sql` は **Supabase MCP の `apply_migration` で手動適用**している（`supabase db push` は使っていない）。
- コードだけ本番に出てDBが古いままだと、エラーにならず金額が記録されない等の事故になる
  （2026-09-25: 0016/0017 未適用のまま約2か月半稼働し、返金額が `refunded_amount` に記録されなかった）。
- リモートのマイグレーション名は「タイムスタンプ＋短い名前」（例: `20260703131022 extra_paid_amount`）で、
  ローカルのファイル名（`0015_extra_paid_amount.sql`）と一致しない。**名前の突き合わせだけで適用済みと判断しない**。

### `supabase/migrations/` にファイルを追加するPRのチェックリスト

1. `src/lib/schema-manifest.ts` に同名のエントリを追加する（作ったテーブル・追加した列・コードが呼ぶRPC）。
   忘れると `npm test`（schema-check.test.ts）が落ちる。
2. PR本文に「本番適用が必要なマイグレーション: 00xx_名前.sql」と明記する。
3. マージ後、**本番デプロイ（Vercel）の前に** 本番DB（project `ybvhjmyryztwjdnturrc`）へ `apply_migration` で適用する。
   追加だけのマイグレーションなら、先に適用しても稼働中の旧コードは壊れない。
4. `list_migrations` で適用されたことを確認する。
5. 翌朝の `/api/cron/maintenance`（毎日JST 3時）で「⚠️ DBマイグレーション未適用の疑い」アラートが来ないことを確認する。
   このcronは台帳のテーブル・列・RPCが本番DBに存在するかを毎日確認し、無ければ管理者（Discord・メール）へ通知する。
