"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getBrowserAuth } from "@/lib/auth-browser";

/** ヘッダー右側のログイン/マイページ表示 */
export default function AuthNav() {
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      setState("out");
      return;
    }
    const supabase = getBrowserAuth();
    supabase.auth.getUser().then(({ data }) => setState(data.user ? "in" : "out"));
  }, []);

  async function logout() {
    await getBrowserAuth().auth.signOut();
    window.location.href = "/";
  }

  if (state === "loading") return <nav className="auth-nav" />;
  return (
    <nav className="auth-nav">
      {state === "in" ? (
        <>
          <Link href="/my">マイページ</Link>
          <button onClick={logout}>ログアウト</button>
        </>
      ) : (
        <Link href="/login">ログイン / 会員登録</Link>
      )}
    </nav>
  );
}
