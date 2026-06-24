import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ブルースペース｜レンタルスペース公式予約",
    short_name: "ブルースペース",
    description:
      "仲介手数料なし最安値。空き状況を見てそのままクレジットカード決済で予約完了。",
    start_url: "/",
    display: "standalone",
    background_color: "#0f2d5c",
    theme_color: "#0f2d5c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
