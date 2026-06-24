"use client";

import { useEffect, useState } from "react";

/**
 * ブルーストレージLP用の追従CTAバー。
 * - ヒーローを過ぎてスクロールすると画面下部に出現
 * - 問い合わせフォーム(#inquiry)が画面内に入ったら自動で隠れる（重複・邪魔防止）
 * - モバイルは全幅バー、デスクトップは中央寄せのコンパクト表示
 */
export default function StorageStickyCta() {
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const [inquiryVisible, setInquiryVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolledPastHero(window.scrollY > 560);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    // 問い合わせフォームが画面内に入ったら追従バーを隠す
    const target = document.getElementById("inquiry");
    let observer: IntersectionObserver | null = null;
    if (target && "IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => setInquiryVisible(entries[0]?.isIntersecting ?? false),
        { rootMargin: "0px 0px -20% 0px" }
      );
      observer.observe(target);
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, []);

  const show = scrolledPastHero && !inquiryVisible;

  return (
    <div className={`storage-sticky-cta no-print${show ? " show" : ""}`} aria-hidden={!show}>
      <div className="storage-sticky-cta-inner">
        <div className="storage-sticky-cta-text">
          <strong>限定1室・先着順</strong>
          <span>初回限定 ¥400,000相当が無料</span>
        </div>
        <a href="#inquiry" className="storage-sticky-cta-btn">
          📩 見学・お問い合わせ
        </a>
      </div>
    </div>
  );
}
