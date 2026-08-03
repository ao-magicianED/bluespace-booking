# GAS外部cron設置手順（請求書払い・高頻度期限チェック）

`/api/cron/expire-invoices` を10分おきに叩くためのGoogle Apps Scriptの設置手順。
既存の毎日3:00 Vercel cron（`/api/cron/maintenance`）は変更不要（フォールバックとして残す）。

## 1. GASプロジェクトを作成

1. [script.google.com](https://script.google.com) → 新しいプロジェクト
2. プロジェクト名を「bluespace-invoice-expiry-cron」などに変更

## 2. スクリプトを貼り付け

`コード.gs` の内容を全て消し、以下を貼り付ける。**CRON_SECRETの値は書かない**（次のスクリプトプロパティ手順で設定する）。

```javascript
// ============================================================
// ★設定（このスクリプトの本文には機密を書かない。
//   プロジェクトの設定 > スクリプト プロパティ に以下2つを設定すること）
//   ENDPOINT_URL … https://<本番ドメイン>/api/cron/expire-invoices
//   CRON_SECRET  … Vercelの環境変数 CRON_SECRET と同じ値
// ============================================================

function runExpireInvoices() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty("ENDPOINT_URL");
  const secret = props.getProperty("CRON_SECRET");
  if (!url || !secret) throw new Error("スクリプトプロパティ ENDPOINT_URL / CRON_SECRET を設定してください");

  let ok = false;
  let detail = "";
  try {
    const res = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + secret },
      muteHttpExceptions: true,
    });
    ok = res.getResponseCode() === 200;
    detail = "HTTP " + res.getResponseCode() + " " + res.getContentText().slice(0, 300);
  } catch (e) {
    ok = false;
    detail = "EXCEPTION: " + e; // タイムアウト・DNS失敗等もここで捕捉する
  }

  const now = Date.now();
  const wasFailing = props.getProperty("FAILING_SINCE");
  if (ok) {
    if (wasFailing) props.deleteProperty("FAILING_SINCE");
    props.deleteProperty("LAST_ALERT_AT");
    return;
  }
  // 失敗: 初回遷移時、または継続中なら24時間ごとに1通だけ通知する
  // （毎回送るとメール爆撃になり無料アカウントのGmail日次上限を食い潰すため）
  if (!wasFailing) {
    props.setProperty("FAILING_SINCE", String(now));
    props.setProperty("LAST_ALERT_AT", String(now));
    MailApp.sendEmail(
      Session.getEffectiveUser().getEmail(),
      "🚨 [予約システム] 請求書期限チェックcronが失敗し始めました",
      detail
    );
  } else {
    const lastAlert = Number(props.getProperty("LAST_ALERT_AT") || 0);
    if (now - lastAlert > 24 * 60 * 60 * 1000) {
      props.setProperty("LAST_ALERT_AT", String(now));
      MailApp.sendEmail(
        Session.getEffectiveUser().getEmail(),
        "🚨 [予約システム] 請求書期限チェックcronの失敗が継続中",
        detail
      );
    }
  }
}

// 疎通テスト用（設置後に一度手動実行して実行ログを確認する）
function testConnection() {
  const props = PropertiesService.getScriptProperties();
  const res = UrlFetchApp.fetch(props.getProperty("ENDPOINT_URL"), {
    method: "get",
    headers: { Authorization: "Bearer " + props.getProperty("CRON_SECRET") },
    muteHttpExceptions: true,
  });
  Logger.log("HTTP " + res.getResponseCode() + " / " + res.getContentText());
}
```

## 3. スクリプトプロパティを設定（機密はここに置く）

1. 左メニュー「プロジェクトの設定」（歯車アイコン）
2. 「スクリプト プロパティ」→「スクリプト プロパティを追加」
3. 以下の2つを追加:
   - `ENDPOINT_URL` = `https://<本番ドメイン>/api/cron/expire-invoices`
   - `CRON_SECRET` = Vercelの環境変数 `CRON_SECRET` と同じ値（`.env.local` や Vercel の Environment Variables から確認）

## 4. 疎通テスト

1. エディタで関数選択を `testConnection` に切り替えて実行（▶）
2. 初回は権限の承認画面が出るので許可する
3. 「実行ログを表示」で `HTTP 200 ...` が出ていればOK
4. `HTTP 401` などが出たら `CRON_SECRET` の値がVercelと一致しているか確認する

## 5. トリガーを設定

1. 左メニュー「トリガー」（時計アイコン）→「トリガーを追加」
2. 実行する関数: `runExpireInvoices`
3. イベントのソース: 時間主導型
4. 時間ベースのトリガーのタイプ: 分ベースのタイマー
5. 間隔: **10分おき**
6. 保存

## 動作の仕組み・注意点

- 「期限後すみやかに」枠を解放するのはベストエフォートであり、GASのトリガー実行タイミングの揺らぎ・Vercel側の障害等で厳密な保証はない
- GASが完全に停止しても、毎日3:00のVercel cron（`/api/cron/maintenance`）が同じ処理（枠解放・遅延void）をフォールバックとして実行する（最悪ケースで期限後〜21時間保持）
- **入金リマインダー（期限9時間前メール）だけは、3:00のフォールバックでは原則発火しない**（期限は通常18:00固定のため、9時間前の窓は朝9:00頃に限られる）。GAS停止中はリマインダーが止まるが、予約の確定・失効フローそのものは壊れない
- 失敗通知は「正常→失敗に遷移した時」と「失敗継続中は24時間ごと」の2パターンのみ送信される（毎回送るとメール爆撃になるため）。「🚨...失敗し始めました」が来たら、まず`testConnection`を再実行して原因（CRON_SECRET不一致・本番デプロイ未反映等）を確認する
