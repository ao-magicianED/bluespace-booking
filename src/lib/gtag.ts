// GA4（Google Analytics 4）のクライアント用ヘルパー。
// 測定IDはHTMLに必ず露出する公開値のため、フォールバックの直書きは機密に当たらない。
// 環境ごとに変えたい場合は NEXT_PUBLIC_GA_MEASUREMENT_ID で上書きする。
// 本番ビルド以外はフォールバックさせない（ローカル開発・Previewのアクセスが
// 本番プロパティに混ざるのを防ぐ。IDが空のときは計測全体が無効になる）。
const envId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
export const GA_MEASUREMENT_ID =
  envId && /^G-[A-Z0-9]+$/.test(envId)
    ? envId
    : process.env.NODE_ENV === "production"
      ? "G-Q22NGPRZKE"
      : "";

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

// gtag.jsの仕様上、dataLayerには配列ではなくArgumentsオブジェクトをpushする必要がある
// （そのためアロー関数やrest展開ではなくfunction宣言でargumentsを使う）。
// gtag.js本体のロード完了前に積んだコマンドもロード後に順番に処理されるため、
// スクリプトのロード順を気にせずどこからでも呼べる。
export function gtag(..._args: unknown[]) {
  if (typeof window === "undefined" || !GA_MEASUREMENT_ID) return;
  try {
    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  } catch {
    // 計測の失敗が予約・決済導線を止めることは絶対にないよう、例外はここで吸収する
  }
}

let initialized = false;

/** 初期化（js/config）を一度だけdataLayerに積む。page_viewは手動送信するためここでは送らない */
export function ensureGaInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  gtag("js", new Date());
  gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
}

/** GA4にイベントを送る。SSR中・広告ブロッカー環境では静かに何もしない */
export function gaEvent(name: string, params?: Record<string, unknown>) {
  ensureGaInit();
  gtag("event", name, params ?? {});
}
