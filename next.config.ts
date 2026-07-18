import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // googleapis をサーバーバンドルから除外（ビルド時間短縮・サイズ削減）
  serverExternalPackages: ["googleapis"],
  images: {
    // 管理画面からアップロードした写真（Supabase Storage）をnext/imageで配信する
    remotePatterns: [
      {
        protocol: "https",
        hostname: "ybvhjmyryztwjdnturrc.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async redirects() {
    return [
      {
        // www.bluespacerental.com が非wwwと同じ内容を200で返していたため、
        // Googleに「代替ページ（適切なcanonicalタグあり）」として全URLが二重計上されていた。
        // 308でパス・クエリを保持したまま非wwwへ寄せる。
        // ※Vercelのドメイン設定側でもリダイレクトを掛ける（そちらが本命・これは保険）
        source: "/:path*",
        has: [{ type: "host", value: "www.bluespacerental.com" }],
        destination: "https://bluespacerental.com/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        // *.vercel.app のデプロイURLは本番と同一内容を返すミラーになるため、
        // 検索エンジンに拾わせない。本番ドメインにはこのヘッダは付かない。
        source: "/:path*",
        has: [{ type: "host", value: ".*\\.vercel\\.app" }],
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
      {
        // /review/[token] のURLはトークン自体が認証情報（bearer token）。
        // ページ内リンク遷移時にReferer経由でトークンが外部/ログへ漏れないようにする
        source: "/review/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
