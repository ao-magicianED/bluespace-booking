/**
 * 広告アトリビューション（どの広告から来た予約かを追う仕組み）。
 *
 * 旧直販サイト（UPNOW）では予約完了ページが他社ドメイン上にあり、
 * 自社のタグを置けなかったためコンバージョンが一度も取れなかった。
 * 自社サイトは着地から決済完了まで自ドメインで完結するので、ここで取り切る。
 *
 * 設計方針:
 * - ブラウザのイベント送信（gtag）だけに頼らない。広告ブロッカー・タブの即閉じ・
 *   リダイレクト失敗のいずれでも欠測するため、**決済確定というサーバー事実**を正本にする。
 * - 広告クリック時に付く gclid を着地ページで拾い、localStorageへ保存。
 *   決済リクエストに同梱してDBへ書き、Stripe Webhookの確定と結びつける。
 * - 保存期間は90日（Google広告のコンバージョン計測期間の既定値に合わせる）。
 */

export type Attribution = {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  landingPath?: string;
  /** 保存時刻（ミリ秒）。有効期限の判定に使う */
  savedAt: number;
};

const KEY = "bs_attribution";
/** Google広告のコンバージョン計測期間の既定値に合わせる */
const TTL_MS = 90 * 24 * 60 * 60 * 1000;

/** 値の妥当性チェック。長すぎる値や制御文字はDBに入れない */
function clean(v: string | null, max = 200): string | undefined {
  if (!v) return undefined;
  const s = v.trim().slice(0, max);
  if (!s || /[\u0000-\u001f]/.test(s)) return undefined;
  return s;
}

/**
 * 着地時にURLパラメータを読んで保存する。
 * すでに保存済みでも、新しい広告クリック（gclid等）が来たら上書きする
 * （最後にクリックされた広告に成果を付ける＝ラストクリック）。
 * UTMだけの流入では既存のクリックIDを消さない。
 */
export function captureAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    const q = new URLSearchParams(window.location.search);
    const gclid = clean(q.get("gclid"));
    const gbraid = clean(q.get("gbraid"));
    const wbraid = clean(q.get("wbraid"));
    const utmSource = clean(q.get("utm_source"), 80);
    const utmMedium = clean(q.get("utm_medium"), 80);
    const utmCampaign = clean(q.get("utm_campaign"), 120);

    const hasClickId = Boolean(gclid || gbraid || wbraid);
    const hasUtm = Boolean(utmSource || utmMedium || utmCampaign);
    if (!hasClickId && !hasUtm) return;

    const prev = readAttribution();
    // クリックIDが来たら丸ごと差し替え。UTMだけならクリックIDを引き継ぐ
    const next: Attribution = {
      gclid: hasClickId ? gclid : (gclid ?? prev?.gclid),
      gbraid: hasClickId ? gbraid : (gbraid ?? prev?.gbraid),
      wbraid: hasClickId ? wbraid : (wbraid ?? prev?.wbraid),
      utmSource: utmSource ?? prev?.utmSource,
      utmMedium: utmMedium ?? prev?.utmMedium,
      utmCampaign: utmCampaign ?? prev?.utmCampaign,
      landingPath: clean(window.location.pathname, 200),
      savedAt: Date.now(),
    };
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // 計測の失敗が予約導線を止めることは絶対にない
  }
}

/** 保存済みのアトリビューションを読む。期限切れは無効として扱う */
export function readAttribution(): Attribution | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Attribution;
    if (!v || typeof v.savedAt !== "number") return null;
    if (Date.now() - v.savedAt > TTL_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

/** 決済リクエストに載せる形。値が無ければキーごと省く */
export function attributionPayload(): Record<string, string> {
  const a = readAttribution();
  if (!a) return {};
  const out: Record<string, string> = {};
  if (a.gclid) out.gclid = a.gclid;
  if (a.gbraid) out.gbraid = a.gbraid;
  if (a.wbraid) out.wbraid = a.wbraid;
  if (a.utmSource) out.utmSource = a.utmSource;
  if (a.utmMedium) out.utmMedium = a.utmMedium;
  if (a.utmCampaign) out.utmCampaign = a.utmCampaign;
  if (a.landingPath) out.landingPath = a.landingPath;
  return out;
}

/** サーバー側でリクエストボディから安全に取り出す（型と長さを検証） */
export function parseAttributionInput(body: Record<string, unknown>) {
  const pick = (k: string, max: number) => {
    const v = body[k];
    if (typeof v !== "string") return null;
    const s = v.trim().slice(0, max);
    return s && !/[\u0000-\u001f]/.test(s) ? s : null;
  };
  return {
    gclid: pick("gclid", 200),
    gbraid: pick("gbraid", 200),
    wbraid: pick("wbraid", 200),
    utm_source: pick("utmSource", 80),
    utm_medium: pick("utmMedium", 80),
    utm_campaign: pick("utmCampaign", 120),
    landing_path: pick("landingPath", 200),
  };
}
