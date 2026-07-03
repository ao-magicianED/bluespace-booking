/**
 * サイトのベースURL。NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_BASE_URL が混在していたのを統一する窓口。
 * 末尾スラッシュは除去する。
 */
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || "https://bluespacerental.com";
  return raw.replace(/\/$/, "");
}

/** 管理画面の予約詳細ページURL */
export function adminBookingUrl(bookingId: string): string {
  return `${siteUrl()}/admin/bookings/${bookingId}`;
}

/** 管理画面の予約台帳URL */
export function adminLedgerUrl(): string {
  return `${siteUrl()}/admin/ledger`;
}

/** マイページ（予約詳細）URL */
export function myBookingUrl(bookingId: string): string {
  return `${siteUrl()}/my/${bookingId}`;
}

/** 住所からGoogleマップの検索リンクを作る（日本語住所を含むためencodeURIComponent必須） */
export function mapSearchUrl(address: string): string {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}
