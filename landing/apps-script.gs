/**
 * BlueReserve LP 問い合わせ受信用 Google Apps Script
 *
 * 機能:
 * - LPの問い合わせフォームから送信された内容をスプレッドシートに記録
 * - 自分のGmailアドレスから NOTIFY_EMAIL に通知メールを送信（迷惑メールに入りにくい）
 * - 返信先(reply-to)を顧客のメールアドレスに設定 → 「返信」で直接お客様にメール
 *
 * セットアップは landing/SETUP_FORM.md を参照
 */

// ===== 設定（必須） =====
const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // Step1で作ったスプレッドシートのID
const NOTIFY_EMAIL = 'info@bluestage-lcc.com';      // 通知先メールアドレス
const SHEET_NAME = 'お問い合わせ';                     // シート名（通常そのままでOK）

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // ----- スプレッドシートに記録 -----
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        '受信日時', 'お名前', '会社名', 'メール', '電話番号',
        '拠点数', '現在のサービス', 'メッセージ', '商品', '流入元', 'UA'
      ]);
      // ヘッダーを太字に
      sheet.getRange(1, 1, 1, 11).setFontWeight('bold').setBackground('#e0e7ff');
    }
    sheet.appendRow([
      new Date(),
      data.name || '',
      data.company || '',
      data.email || '',
      data.phone || '',
      data.rooms || '',
      data.current || '',
      data.message || '',
      data.product || '',
      data.source || '',
      data.userAgent || '',
    ]);

    // ----- メール通知 -----
    const subject = `【BlueReserve】${data.name || '匿名'}様より新規お問い合わせ`;
    const body = [
      '新規お問い合わせがありました。',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '■ お名前: ' + (data.name || '-'),
      '■ 会社名: ' + (data.company || '-'),
      '■ メール: ' + (data.email || '-'),
      '■ 電話番号: ' + (data.phone || '-'),
      '■ 運営拠点数: ' + (data.rooms || '-'),
      '■ 現在のサービス: ' + (data.current || '-'),
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '■ ご質問・ご要望:',
      data.message || '(なし)',
      '',
      '━━━━━━━━━━━━━━━━━━━━',
      '※ このメールに直接返信すると、お客様（' + (data.email || '-') + '）に返信されます。',
      '━━━━━━━━━━━━━━━━━━━━',
      '',
      '商品: ' + (data.product || '-'),
      '流入元: ' + (data.source || '-'),
      '受信日時: ' + new Date().toLocaleString('ja-JP'),
    ].join('\n');

    const mailOptions = {
      to: NOTIFY_EMAIL,
      subject: subject,
      body: body,
      name: 'BlueReserve LP',
    };
    // お客様メールが正しい形式ならreplyToを設定（返信で直接お客様に届く）
    if (data.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      mailOptions.replyTo = data.email;
    }
    MailApp.sendEmail(mailOptions);

    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    // エラー時は自分宛にもエラーメール送信（気づけるように）
    try {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        subject: '【BlueReserve】⚠️ フォーム受信エラー',
        body: 'エラー: ' + String(err) + '\n\nリクエスト内容:\n' + (e.postData ? e.postData.contents : '(なし)'),
      });
    } catch (_) {}
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput('BlueReserve Contact Endpoint - OK');
}

/**
 * 手動テスト用: Apps Scriptエディタから直接実行できる
 * メニュー「実行」→ testSend を選んで実行
 */
function testSend() {
  const mock = {
    postData: {
      contents: JSON.stringify({
        name: 'テスト送信',
        company: 'ブルーステージ合同会社',
        email: 'info@bluestage-lcc.com',
        phone: '000-0000-0000',
        rooms: 'これから開業',
        current: '未利用',
        message: 'Apps Scriptの動作確認テストです。',
        product: 'BlueReserve',
        source: 'manual-test',
        userAgent: 'manual-test',
        timestamp: new Date().toISOString(),
      })
    }
  };
  const result = doPost(mock);
  Logger.log(result.getContent());
}
