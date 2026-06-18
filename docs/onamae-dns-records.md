# お名前.comでのDNSレコード追加（コピペ用）

対象ドメイン: **bluestage-lcc.com**
所要時間: 5〜10分

## お名前.comでの操作場所

1. https://navi.onamae.com にログイン
2. 「ドメイン → DNS関連機能の設定」→ bluestage-lcc.com を選択
3. 「DNSレコード設定を利用する」→「設定」
4. 下の4つのレコードを追加 → 一番下の「確認画面へ進む」→「設定する」

## 追加するDNSレコード（4件）

> ⚠️ お名前.comの仕様: 「ホスト名」欄には**サブドメイン部分だけ**を入れます（bluestage-lcc.com は自動で付くので不要）。

### ① DKIM（認証用 / TXT）

| 項目 | 値 |
|---|---|
| ホスト名 | `resend._domainkey.send` |
| TYPE | TXT |
| TTL | 3600 |
| VALUE | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDhzX5O7qfi6iF0p6jKwFHSl+Uc2L/p83ksLfkXRw4BzJFNIHu9PobsgaRg+txgCuF91k...QIDAQAB` |

※VALUEは長いので、Resend画面の「Content」横の **コピーボタンを押してそのまま貼り付け**てください（途中で改行が入ると失敗します）

### ② SPF MX

| 項目 | 値 |
|---|---|
| ホスト名 | `send.send` |
| TYPE | MX |
| TTL | 3600 |
| 優先 | 10 |
| VALUE | `feedback-smtp.ap-northeast-1.amazonses.com` |

### ③ SPF TXT

| 項目 | 値 |
|---|---|
| ホスト名 | `send.send` |
| TYPE | TXT |
| TTL | 3600 |
| VALUE | `v=spf1 include:amazonses.com ~all` |

### ④ DMARC（推奨）

| 項目 | 値 |
|---|---|
| ホスト名 | `_dmarc.send` |
| TYPE | TXT |
| TTL | 3600 |
| VALUE | `v=DMARC1; p=none;` |

## なぜホスト名が `send.send` なのか

サブドメイン `send.bluestage-lcc.com` をResendに登録したため、本来 `send.send.bluestage-lcc.com` というフルネームのDNSレコードが必要になります。お名前.comでは「bluestage-lcc.com」が自動で末尾に付くので、ホスト名欄には `send.send` だけを入れる形になります。

## 反映時間

通常 数分〜30分で世界中のDNSに伝わります。

## 終わったら教えてください

「DNS入れた」と教えてくれたら、Resend画面で「I've added the records」を押して認証 → APIキー作成 → Vercel/Supabaseに設定 → テスト送信、まで一気に進めます。
