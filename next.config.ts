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
};

export default nextConfig;
