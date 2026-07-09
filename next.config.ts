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
  async headers() {
    return [
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
