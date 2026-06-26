# お名前.com で DNSレコード追加 — `bluereserve.bluestage-lcc.com`

対象ドメイン: **bluestage-lcc.com**
作成するサブドメイン: **bluereserve.bluestage-lcc.com**
所要時間: **3〜5分**（DNS反映 数分〜30分）

---

## お名前.comでの操作場所

1. https://navi.onamae.com にログイン
2. 上部メニュー「ドメイン」→「**DNS関連機能の設定**」
3. ドメイン一覧から **`bluestage-lcc.com`** を選択 →「次へ」
4. 「**DNSレコード設定を利用する**」→ 右の「**設定する**」をクリック

---

## 追加するDNSレコード（1件のみ）

| 項目 | 値 |
|---|---|
| **ホスト名** | `bluereserve` |
| **TYPE** | `A` |
| **TTL** | `3600` |
| **VALUE** | `76.76.21.21` |
| 状態 | 有効 ✓ |

> ⚠️ お名前.comの仕様: 「ホスト名」欄には**サブドメイン部分だけ**を入れます（`.bluestage-lcc.com` は自動で付くので不要）。

---

## 入力手順（画面イメージ）

1. DNSレコード設定画面の「**A/AAAA/CNAME/MX/NS/TXT/SRV/CAA/DSレコード**」セクションへ
2. 「**追加**」ボタンをクリック（または既存リストの空欄を埋める）
3. 上記の値を入力:
   - ホスト名: `bluereserve`
   - TYPE: `A`（プルダウンから選択）
   - TTL: `3600`
   - VALUE: `76.76.21.21`
4. 一番下までスクロール →「**確認画面へ進む**」
5. 内容確認後「**設定する**」
6. 完了画面が出れば終わり

---

## 反映確認

通常 **5〜30分** で世界中のDNSに伝わる。

確認方法（任意）:
- ブラウザで https://bluereserve.bluestage-lcc.com を開く
- BlueReserve LP が表示されれば成功
- 「This site can't be reached」等が出ても、しばらく待つ（最大1時間程度）

または、コマンドで確認:
```bash
nslookup bluereserve.bluestage-lcc.com
```
`76.76.21.21` が返ってくれば反映完了。

---

## SSL証明書（HTTPS化）

Vercel が **自動的に発行**します。DNSが反映されてから数分以内に `https://` でアクセス可能に。

特別な操作は不要。

---

## 完了後の状態

| URL | 用途 |
|---|---|
| https://bluereserve.bluestage-lcc.com | **公式LP（カスタムドメイン）** |
| https://bluereserve-lp.vercel.app | バックアップ（自動で同じ内容を表示） |

両方とも自動で更新されます（Vercel が同じデプロイを配信）。

---

## 終わったら教えてください

「DNS入れた」と教えてくれたら:
1. 反映確認（数分待ってブラウザで開く）
2. SSL証明書発行確認
3. https://bluereserve.bluestage-lcc.com を本番URLとして案内開始

---

## トラブルシューティング

### ❌ お名前.com で「指定されたホスト名は既に登録されています」エラー

→ `bluereserve` ホスト名が既に他のレコードで使われている。一覧から該当行を探して削除 or 編集。

### ❌ Vercel ダッシュボードで「Invalid Configuration」表示が消えない

→ DNS反映待ち（最大1時間）。または、お名前.comの「DNSレコード設定を利用する」のチェックが入ってない可能性。

### ❌ HTTPSでアクセスできない

→ DNS反映後、Vercel が SSL を発行するまで 1〜10分かかる。少し待つ。

---

## 補足: なぜ CNAME ではなく A レコード？

Vercel は固定IP（76.76.21.21）を使っているため、Aレコードで OK です。
CNAME (`cname.vercel-dns.com`) でも動きますが、お名前.comでは A レコードの方が安定して動きます（過去事例より）。
