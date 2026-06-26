# BlueReserve LP お問い合わせフォーム セットアップガイド（Apps Script版）

このガイドの通りに進めれば、LP のお問い合わせフォームから送信された内容が **info@bluestage-lcc.com に自動メール通知 + Googleスプレッドシートに自動記録** されるようになります。

所要時間: **約15分**

**この方式の良いところ:**
- ✅ 送信元 = あなた自身のGmailアカウント → **迷惑メール判定されにくい**
- ✅ 返信ボタンで **お客様に直接返信できる**（replyTo自動設定）
- ✅ スプレッドシートに自動蓄積（過去履歴を一覧で見える）
- ✅ 完全無料（1日100通の送信制限内、Workspaceなら1日1,500通）

---

## 全体像

```
LPの問い合わせフォーム
   ↓ (HTTPS送信)
Google Apps Script Webアプリ
   ├─ スプレッドシートに1行追記
   └─ あおさんのGmailから info@bluestage-lcc.com に通知メール送信
```

---

## Step 1: 受信用スプレッドシートを作る

1. https://docs.google.com/spreadsheets/ にアクセス
2. 左上の「**＋ 空白のスプレッドシート**」をクリック
3. 左上のタイトル「無題のスプレッドシート」をクリックして **「BlueReserve お問い合わせ」** に変更
4. **URLバーから ID をコピー**:

```
https://docs.google.com/spreadsheets/d/【ここがID】/edit
                                       ^^^^^^^^^^^^^
                                       この部分をコピー
```

メモ帳などに保存しておく。

---

## Step 2: Apps Script プロジェクトを作る

1. https://script.google.com/ にアクセス
2. 左上の「**＋ 新しいプロジェクト**」をクリック
3. 左上のタイトル「無題のプロジェクト」をクリックして **「BlueReserve Contact Endpoint」** に変更

---

## Step 3: コードを貼り付ける

1. 画面中央のエディタに既に書かれているコードを **全消し**
2. `landing/apps-script.gs` の中身を **全文コピー**
3. Apps Script エディタに貼り付け

---

## Step 4: SPREADSHEET_ID を書き換える

コードの上の方:

```javascript
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // ← Step1でコピーしたIDに置き換え
const NOTIFY_EMAIL = 'info@bluestage-lcc.com';      // ← このままでOK
```

例:
```javascript
const SPREADSHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz';
const NOTIFY_EMAIL = 'info@bluestage-lcc.com';
```

**保存** は `Ctrl + S`（または上部のフロッピーディスクアイコン）

---

## Step 5: 動作テスト（デプロイ前に確認）

1. 上部メニューの **関数選択** ドロップダウンで `testSend` を選択
2. **「実行」** ボタンをクリック
3. 初回は権限承認ダイアログが出る:
   - **「アクセスを承認」** → Googleアカウント選択 → **「詳細」** → **「BlueReserve Contact Endpoint（安全ではないページ）に移動」** → **「許可」**
4. 実行ログに `{"ok":true}` が出る
5. **info@bluestage-lcc.com** にテストメールが届く
6. **スプレッドシート** に1行追加されている

ここまで OK なら、Webアプリ化に進む。

---

## Step 6: Webアプリとしてデプロイ

1. 右上の **「デプロイ」** ボタン → **「新しいデプロイ」**
2. 左上の歯車アイコン → **「ウェブアプリ」** を選択
3. 設定:
   - **説明**: BlueReserve Contact v1（自由でOK）
   - **次のユーザーとして実行**: **自分**
   - **アクセスできるユーザー**: **全員**（重要・必ず変更）
4. **「デプロイ」** をクリック

---

## Step 7: ウェブアプリ URL をコピー

デプロイ完了後、以下のような URL が表示されます:

```
https://script.google.com/macros/s/AKfycbxXXXXXXX/exec
```

**「コピー」ボタン** でコピーしてあおまで連絡してください。

---

## Step 8: index.html に URL を貼り付け（あお側で対応）

URL を受け取ったらこちらで以下を実施します:

1. `landing/index.html` の `APPS_SCRIPT_URL` に貼り付け
2. Vercel 再デプロイ
3. 実機ブラウザでテスト送信
4. info@bluestage-lcc.com に届くか確認

---

## トラブルシューティング

### ❌ Step 5 で「権限を承認」エラー

→ 「詳細」リンクが出るまで待って、「安全ではないページに移動」をクリック。自分で書いたスクリプトなので安全です。

### ❌ Step 5 で「SpreadsheetApp.openById is not a function」

→ コードの貼り付けが不完全。もう一度全文コピペし直す。

### ❌ メールが届かない

→ 以下を確認:
1. 迷惑メールフォルダ（初回のみ稀に入る、フィルタ設定で解決）
2. NOTIFY_EMAIL のスペルミス
3. Apps Script の送信枠超過（無料Gmailなら1日100通、Workspaceなら1,500通）

### ❌ スプレッドシートに記録されない

→ `SPREADSHEET_ID` が間違っている。URLから取得し直す。

### ❌ デプロイの「アクセスできるユーザー」を「自分のみ」にしてしまった

→ 「デプロイを管理」→ 鉛筆アイコン → 「アクセスできるユーザー」を **全員** に変更

---

## デプロイし直すとURLは変わる？

**変わりません**（同じ「デプロイID」を使い続ければ）。

コードを修正する場合:
1. 「デプロイ」→ **「デプロイを管理」**
2. 既存のデプロイの **鉛筆アイコン** をクリック
3. **「バージョン」を「新バージョン」** に変更
4. 「デプロイ」 → 同じURLで最新コード適用

「新しいデプロイ」を作ると別URLになるので注意。

---

## メリット vs Web3Forms

| 項目 | Apps Script | Web3Forms |
|---|---|---|
| 送信元 | **自分のGmail** | web3forms.com |
| 迷惑メール率 | ◎ 低い | △ 初回は高い |
| 月間送信数 | 100通/日（Workspaceなら1,500通/日） | 250通/月 |
| スプレッドシート蓄積 | ◎ 標準 | × |
| 返信先設定 | ◎ お客様に直接返信 | △ replyto 設定可 |
| セットアップ | 15分（権限承認あり） | 5分 |

---

## 完了！

スクリプトURLを連絡いただければ、あおが index.html に貼り付け→再デプロイします。
