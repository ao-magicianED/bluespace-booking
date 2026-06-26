# BlueReserve LP

レンタルスペース予約システム外販用ランディングページ。

## ファイル

| ファイル | 用途 |
|---|---|
| `index.html` | LP本体（単一HTMLで完結） |
| `apps-script.gs` | お問い合わせフォーム受信用 Google Apps Script |
| `_headers` | Cloudflare Pages セキュリティヘッダ設定 |

## デプロイ済URL

- 本番: https://bluereserve.pages.dev（デプロイ後に確定）

## デプロイ方法

```bash
# このディレクトリで実行
CLOUDFLARE_ACCOUNT_ID=9ed124d538632a4f936e77031e20c8f5 \
  npx wrangler@4 pages deploy . \
  --project-name=bluereserve \
  --branch=main \
  --commit-message="update LP"
```

## お問い合わせフォームのセットアップ手順

### 1. スプレッドシートを作成
- https://docs.google.com/spreadsheets/ で新規作成
- URLの `/d/` と `/edit` の間にあるIDをコピー（例: `1AbCdEfGhIjKl...`）

### 2. Google Apps Script を設定
1. https://script.google.com/ で新規プロジェクト作成
2. `apps-script.gs` の中身を全文コピペ
3. `SPREADSHEET_ID` をステップ1のIDに置き換え
4. `NOTIFY_EMAIL` を通知先メールに変更
5. 保存 → メニュー「デプロイ」→「新しいデプロイ」
   - 種類: **ウェブアプリ**
   - 実行ユーザー: **自分**
   - アクセスできるユーザー: **全員**
6. 発行されるURLをコピー（`https://script.google.com/macros/s/.../exec`）

### 3. index.html に URL を貼り付け
`index.html` の以下の部分を編集:

```js
const APPS_SCRIPT_URL = ''; // ← ここに上記URLを貼る
```

### 4. 再デプロイ
```bash
CLOUDFLARE_ACCOUNT_ID=9ed124d538632a4f936e77031e20c8f5 \
  npx wrangler@4 pages deploy . \
  --project-name=bluereserve \
  --branch=main \
  --commit-message="add form endpoint"
```

## 動作確認チェックリスト

- [ ] LP表示（PC/スマホ）
- [ ] 機能比較表が表示される
- [ ] 料金プランカードが表示される
- [ ] シミュレーターでスライダーを動かすと数字が変わる
- [ ] FAQの開閉が動作する
- [ ] フォーム送信成功 → 完了画面表示 → スプレッドシート記録 → 通知メール受信

## カスタマイズ箇所

| 内容 | ファイル | 検索文字列 |
|---|---|---|
| お問い合わせメール宛先 | `index.html` | `contact@bluestage-lcc.com` |
| 商品名 | `index.html` | `BlueReserve` |
| キャンペーン文言 | `index.html` | `先着10社限定 30% OFF` |
| 料金プラン金額 | `index.html` | `getMyPrice` 関数 |
| 比較表の項目 | `index.html` | `const features = [` |
