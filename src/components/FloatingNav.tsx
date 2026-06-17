"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * 拠点ページの追従ナビ。少しスクロールすると画面下部に現れ、
 * 空き状況・アクセス・定期利用相談へワンタップで移動できる。
 */
export default function FloatingNav({ venueSlug }: { venueSlug: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className={`floating-nav no-print${visible ? " show" : ""}`}>
      <a href="#book" className="fn-btn fn-primary">
        📅 空き状況・予約
      </a>
      <a href="#access" className="fn-btn">
        🗺 アクセス
      </a>
      <Link href={`/contact?type=longterm&venue=${venueSlug}`} className="fn-btn">
        💬 定期利用の相談
      </Link>
    </div>
  );
}
