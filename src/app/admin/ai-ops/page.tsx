import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import AiOpsConsole from "@/components/AiOpsConsole";

export const dynamic = "force-dynamic";

type VenueChoice = { slug: string; name: string };
type LogRow = {
  id: string;
  request_text: string;
  operation_type: string;
  status: string;
  created_at: string;
  applied_at: string | null;
  error_message: string | null;
};

export default async function AdminAiOpsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const [{ data: venues }, { data: logs }] = await Promise.all([
    db.from("venues").select("slug, name").order("name"),
    db
      .from("ai_operation_logs")
      .select("id, request_text, operation_type, status, created_at, applied_at, error_message")
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  return (
    <>
      <div className="admin-header">
        <h1>AI設定オペレーション</h1>
        <span>
          <Link href="/admin" className="policy">
            ← 管理ダッシュボードへ戻る
          </Link>
        </span>
      </div>
      <p className="policy">
        自然言語の指示を安全な操作に変換し、差分プレビューを確認してから適用します。料金・受付条件・クーポンなど、影響範囲が明確な操作から対応しています。
      </p>
      <AiOpsConsole venues={(venues ?? []) as VenueChoice[]} logs={(logs ?? []) as LogRow[]} />
    </>
  );
}
