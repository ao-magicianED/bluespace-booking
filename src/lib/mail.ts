/**
 * メール送信（Resend API / fetchのみで実装、SDK不使用）
 * RESEND_API_KEY 未設定の場合は何もしない（ローカル開発で動かしやすくするため）。
 */

type MailInput = { to: string; subject: string; text: string };

/**
 * 日本語表示名を含むFromヘッダをRFC 2047エンコード（=?UTF-8?B?...?=）する。
 * Resend APIは値をHTTPヘッダ相当でも保持するため、非ASCIIをそのまま渡すと弾かれる。
 * 入力例: 'ブルーステージ予約 <noreply@example.com>'
 *   → '=?UTF-8?B?44OW44Or44O844K544OG44O844K46aCa57SE?= <noreply@example.com>'
 */
function encodeFromHeader(from: string): string {
  const m = from.match(/^\s*(.+?)\s*<([^>]+)>\s*$/);
  if (!m) return from;
  const [, name, addr] = m;
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(name)) return from; // ASCIIのみならそのまま
  const b64 = Buffer.from(name, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?= <${addr}>`;
}

export async function sendMail({ to, subject, text }: MailInput): Promise<boolean> {
  // trim: 環境変数に紛れた改行・空白でHTTPヘッダーが壊れるのを防ぐ
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.warn(`[mail] RESEND_API_KEY未設定のためスキップ: ${subject} -> ${to}`);
    return false;
  }
  const from = encodeFromHeader((process.env.MAIL_FROM || "onboarding@resend.dev").trim());
  // 返信先は実在の受信ボックスへ（noreply@send...宛の返信を拾えるようにする）
  const replyTo = (process.env.MAIL_REPLY_TO || "bluespace@bluestage-lcc.com").trim();
  // bodyにマルチバイト文字を含むとundiciがByteString変換で失敗するため、
  // 明示的にUint8Arrayに変換してから送信する（subject/textに日本語を載せるため必須）
  const body = new TextEncoder().encode(
    JSON.stringify({ from, to: [to], subject, text, reply_to: [replyTo] })
  );
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
  });
  if (!res.ok) {
    console.error(`[mail] 送信失敗 (${res.status}): ${await res.text()}`);
    return false;
  }
  return true;
}

/** Discordチャンネルへ通知（DISCORD_WEBHOOK_URL未設定ならスキップ）。送信成功でtrue */
async function sendDiscord(subject: string, text: string): Promise<boolean> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  try {
    // Discordの上限2000文字に収める
    const content = `**【予約システム】${subject}**\n${text}`.slice(0, 1990);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      console.error(`[discord] 送信失敗 (${res.status}): ${await res.text()}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[discord] 送信エラー:", e);
    return false;
  }
}

/**
 * 管理者通知（メール＋Discordの二段構え。通知失敗で業務処理を止めないようthrowしない）。
 * 戻り値でチャネルごとの配信成否を返す（呼び出し側は無視してよい）。
 */
export async function sendAdminAlert(
  subject: string,
  text: string
): Promise<{ discord: boolean; email: boolean }> {
  const discord = await sendDiscord(subject, text);
  const admin = process.env.ADMIN_EMAIL?.trim();
  if (!admin) {
    console.warn(`[mail] ADMIN_EMAIL未設定: ${subject}`);
    return { discord, email: false };
  }
  try {
    const email = await sendMail({ to: admin, subject: `[予約システム] ${subject}`, text });
    return { discord, email };
  } catch (e) {
    console.error(`[mail] 管理者メール送信エラー: ${subject}`, e);
    return { discord, email: false };
  }
}
