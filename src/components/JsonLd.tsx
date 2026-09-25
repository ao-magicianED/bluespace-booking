import { serializeJsonLd, type JsonLd as JsonLdData } from "@/lib/structured-data";

/** 構造化データ（JSON-LD）の埋め込み。null は何も出さない */
export default function JsonLd({ data }: { data: JsonLdData | null }) {
  if (!data) return null;
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
