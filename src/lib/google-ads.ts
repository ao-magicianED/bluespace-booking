/**
 * Google Ads API へのオフラインコンバージョン送信。
 *
 * なぜAPIか:
 *   CSVの手動アップロードは週1の手作業が残り、忘れると欠測する。
 *   APIならStripeの決済確定を起点に自動で送れる。
 *
 * なぜ「決済確定を起点」にするか:
 *   ブラウザのタグ（gtag）は広告ブロッカー・タブの即閉じ・リダイレクト失敗で落ちる。
 *   旧直販サイト（UPNOW）に至っては完了ページが他社ドメインでタグ自体を置けなかった。
 *   ここではサーバー側の事実だけを根拠にするため、ブラウザで何が起きても欠測しない。
 *
 * 必要な環境変数（すべて .env.local に置き、コードには書かない）:
 *   GOOGLE_ADS_DEVELOPER_TOKEN    管理者アカウント（MCC）のAPI Centerで発行
 *   GOOGLE_ADS_CLIENT_ID          Google CloudのOAuthクライアントID
 *   GOOGLE_ADS_CLIENT_SECRET      同シークレット
 *   GOOGLE_ADS_REFRESH_TOKEN      OAuth同意で取得したリフレッシュトークン
 *   GOOGLE_ADS_CUSTOMER_ID        送信先アカウントID（ハイフンなし。例 3591281193）
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID  MCC経由で操作する場合のMCC ID（ハイフンなし）
 *   GOOGLE_ADS_CONVERSION_ACTION_ID  コンバージョンアクションの数値ID
 *
 * 環境変数が揃っていない間は isConfigured() が false を返し、
 * 呼び出し側はCSV手動運用にフォールバックする（開発者トークンの審査待ちに耐える）。
 */

/**
 * Google Ads API のバージョン。
 *
 * 各バージョンは約1年で完全終了（sunset）し、終了後は全リクエストが失敗する。
 * v18 は 2025-08 に終了済みなので使ってはいけない。
 * 2026-08 時点のサポート対象は v23 / v24 / v25。
 * バージョン更新のためにデプロイし直さなくて済むよう環境変数で上書きできる。
 */
const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || "v25";

export type ClickConversion = {
  /** 広告クリックID。gclid / gbraid / wbraid のいずれか */
  clickId: string;
  clickIdType: "gclid" | "gbraid" | "wbraid";
  /** 'yyyy-MM-dd HH:mm:ss+09:00' 形式 */
  conversionDateTime: string;
  conversionValue: number;
  /** 冪等化に使う。同じ値で二度送っても二重計上されない */
  orderId: string;
};

export type UploadResult = {
  ok: boolean;
  uploaded: number;
  /**
   * 実際に取り込まれた予約ID。
   * 呼び出し側はこれだけを「送信済み」にする。
   * 部分失敗した分を送信済みにすると永久欠測になるため、件数ではなくIDで返す。
   */
  succeededOrderIds: string[];
  /** 取り込めなかった分（どの予約が何で落ちたか） */
  errors: { orderId: string; message: string }[];
  /** 設定不足でスキップした場合 */
  skipped?: string;
};

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

/** 送信に必要な環境変数がすべて揃っているか */
export function isConfigured(): boolean {
  return Boolean(
    env("GOOGLE_ADS_DEVELOPER_TOKEN") &&
      env("GOOGLE_ADS_CLIENT_ID") &&
      env("GOOGLE_ADS_CLIENT_SECRET") &&
      env("GOOGLE_ADS_REFRESH_TOKEN") &&
      env("GOOGLE_ADS_CUSTOMER_ID") &&
      env("GOOGLE_ADS_CONVERSION_ACTION_ID")
  );
}

/** どの設定が足りていないかを人が読める形で返す（管理画面の表示用） */
export function missingConfig(): string[] {
  const keys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_CLIENT_ID",
    "GOOGLE_ADS_CLIENT_SECRET",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_CONVERSION_ACTION_ID",
  ];
  return keys.filter((k) => !env(k));
}

/**
 * リフレッシュトークンからアクセストークンを取得する。
 * アクセストークンは1時間で失効するため都度取り直す（保存しない）。
 */
async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_ADS_CLIENT_ID")!,
      client_secret: env("GOOGLE_ADS_CLIENT_SECRET")!,
      refresh_token: env("GOOGLE_ADS_REFRESH_TOKEN")!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`アクセストークンの取得に失敗: ${res.status} ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("アクセストークンが返りませんでした");
  return json.access_token;
}

/**
 * クリックコンバージョンをまとめて送信する。
 *
 * partialFailure を有効にしているので、1件が不正でも他の件は取り込まれる
 * （1件のミスで全部落ちるのを防ぐ）。失敗分は errors に入れて呼び出し側へ返す。
 */
export async function uploadClickConversions(
  conversions: ClickConversion[]
): Promise<UploadResult> {
  if (conversions.length === 0)
    return { ok: true, uploaded: 0, succeededOrderIds: [], errors: [] };

  const missing = missingConfig();
  if (missing.length > 0) {
    return {
      ok: false,
      uploaded: 0,
      succeededOrderIds: [],
      errors: [],
      skipped: `環境変数が未設定: ${missing.join(", ")}`,
    };
  }

  const customerId = env("GOOGLE_ADS_CUSTOMER_ID")!.replace(/-/g, "");
  const loginCustomerId = env("GOOGLE_ADS_LOGIN_CUSTOMER_ID")?.replace(/-/g, "");
  const actionId = env("GOOGLE_ADS_CONVERSION_ACTION_ID")!;
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": env("GOOGLE_ADS_DEVELOPER_TOKEN")!,
    "Content-Type": "application/json",
  };
  // MCC経由で子アカウントを操作する場合に必要
  if (loginCustomerId) headers["login-customer-id"] = loginCustomerId;

  const url =
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}:uploadClickConversions`;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      conversions: conversions.map((c) => ({
        [c.clickIdType]: c.clickId,
        conversionAction: `customers/${customerId}/conversionActions/${actionId}`,
        conversionDateTime: c.conversionDateTime,
        conversionValue: c.conversionValue,
        currencyCode: "JPY",
        // 同じorderIdで再送しても二重計上されない（冪等）
        orderId: c.orderId,
      })),
      // 1件の不正で全体を落とさない
      partialFailure: true,
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Google Ads APIエラー: ${res.status} ${bodyText.slice(0, 500)}`);
  }

  const json = JSON.parse(bodyText) as {
    results?: unknown[];
    partialFailureError?: GoogleRpcStatus;
  };

  // 部分失敗は「何番目の操作が落ちたか」で返ってくる。
  // 件数だけ見ても復旧できないので、落ちた添字を特定して予約IDに戻す。
  const failures = parsePartialFailure(json.partialFailureError, conversions.length);

  const errors: UploadResult["errors"] = [];
  const succeededOrderIds: string[] = [];
  conversions.forEach((c, i) => {
    const message = failures.get(i);
    if (message) errors.push({ orderId: c.orderId, message });
    else succeededOrderIds.push(c.orderId);
  });

  return {
    ok: errors.length === 0,
    uploaded: succeededOrderIds.length,
    succeededOrderIds,
    errors,
  };
}

/** google.rpc.Status（部分失敗の入れ物） */
type GoogleRpcStatus = {
  message?: string;
  details?: {
    errors?: {
      message?: string;
      errorCode?: Record<string, string>;
      location?: {
        fieldPathElements?: { fieldName?: string; index?: number }[];
      };
    }[];
  }[];
};

/**
 * partialFailureError から「失敗した操作の添字 → 理由」を取り出す。
 *
 * 失敗した操作は results では空オブジェクト {} として返るため、
 * filter(Boolean) では成功と区別できない（{} は truthy）。
 * 添字は errors[].location.fieldPathElements の中で
 * fieldName === "conversions" の要素が持っている。
 *
 * 添字が取れないエラー（リクエスト全体に対する指摘など）は
 * 全件失敗として扱う。取りこぼすより再送するほうが安全なため。
 */
function parsePartialFailure(
  status: GoogleRpcStatus | undefined,
  total: number
): Map<number, string> {
  const failed = new Map<number, string>();
  if (!status) return failed;

  const details = status.details ?? [];
  let sawIndex = false;

  for (const d of details) {
    for (const e of d.errors ?? []) {
      const code = e.errorCode ? Object.values(e.errorCode)[0] : undefined;
      const message = [code, e.message].filter(Boolean).join(": ") || "取り込みに失敗しました";
      const idx = e.location?.fieldPathElements?.find(
        (f) => f.fieldName === "conversions"
      )?.index;
      if (typeof idx === "number") {
        sawIndex = true;
        failed.set(idx, message);
      }
    }
  }

  if (!sawIndex) {
    // どの操作が落ちたか特定できない ＝ 安全側に倒して全件失敗にする
    const message = status.message ?? "一部のコンバージョンが取り込めませんでした";
    for (let i = 0; i < total; i++) failed.set(i, message);
  }

  return failed;
}
