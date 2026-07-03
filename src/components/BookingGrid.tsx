"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AvailabilityResponse, DaySlots, VenueOption } from "@/lib/types";
import type { PriceBreakdown } from "@/lib/pricing";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

type Selection = { date: string; slots: number[] } | null;
type Step = "select" | "confirm" | "options" | "form";

// ─── ユーティリティ ───────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function mdLabel(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function hourToTime(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDuration(hours: number): string {
  if (hours % 1 === 0) return `${hours}時間`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

const DISCOUNT_LABEL: Record<string, string> = {
  last_minute: "直前割",
  early_bird: "早割",
};

// ─── デバウンスフック ──────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ─── メモ化スロットボタン ──────────────────────────────────────

const SlotButton = memo(function SlotButton({
  date,
  hour,
  status,
  selected,
  onToggle,
}: {
  date: string;
  hour: number;
  status: string;
  selected: boolean;
  onToggle: (date: string, hour: number) => void;
}) {
  const cls = selected ? "selected" : status;
  return (
    <button
      type="button"
      className={`slot ${cls}`}
      disabled={status !== "available"}
      onClick={() => onToggle(date, hour)}
      aria-label={`${date} ${hourToTime(hour)} ${status === "available" ? "空き" : "予約不可"}`}
    >
      {selected ? "✓" : status === "available" ? "◯" : "×"}
    </button>
  );
});

// ─── メインコンポーネント ──────────────────────────────────────

export default function BookingGrid({
  venueSlug,
  initial,
  options,
  initialForm,
  isLoggedIn,
}: {
  venueSlug: string;
  initial: AvailabilityResponse;
  options: VenueOption[];
  initialForm?: {
    name: string;
    email: string;
    phone: string;
    customerType?: "individual" | "corporate";
    companyName?: string;
  } | null;
  isLoggedIn?: boolean;
}) {
  const today = initial.days[0]?.date ?? "";
  const [weekStart, setWeekStart] = useState(today);
  const [data, setData] = useState<AvailabilityResponse>(initial);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [step, setStep] = useState<Step>("select");
  const [confirmStartHour, setConfirmStartHour] = useState<number>(0);
  const [confirmEndHour, setConfirmEndHour] = useState<number>(0);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [couponInput, setCouponInput] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState("");
  const [quote, setQuote] = useState<PriceBreakdown | null>(null);
  const [quoteError, setQuoteError] = useState("");
  const [form, setForm] = useState({
    name: initialForm?.name ?? "",
    email: initialForm?.email ?? "",
    phone: initialForm?.phone ?? "",
    purpose: "",
  });
  const [customerType, setCustomerType] = useState<"individual" | "corporate">(
    initialForm?.customerType ?? "individual"
  );
  const [companyName, setCompanyName] = useState(initialForm?.companyName ?? "");
  const [partySize, setPartySize] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "invoice">("card");
  const [invoiceDone, setInvoiceDone] = useState<{ dueAt: string; hostedInvoiceUrl: string | null } | null>(
    null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [canceledNotice, setCanceledNotice] = useState(false);

  // モバイル: 日別タブ表示
  const [mobileDay, setMobileDay] = useState(0); // 0-6 (表示中の日のインデックス)
  const [isMobile, setIsMobile] = useState(false);

  // 深夜帯折りたたみ
  const [nightExpanded, setNightExpanded] = useState(false);

  const confirmRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // プリフェッチキャッシュ
  const prefetchCache = useRef<Map<string, AvailabilityResponse>>(new Map());

  const { minHours, maxHours } = data.venue;

  // モバイル検出
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (params.get("canceled") === "1") setCanceledNotice(true);
    }
  }, []);

  // ─── データ取得 & プリフェッチ ────────────────────────────────

  const fetchWeekData = useCallback(
    async (from: string): Promise<AvailabilityResponse | null> => {
      try {
        const res = await fetch(
          `/api/availability?venue=${encodeURIComponent(venueSlug)}&from=${from}`
        );
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    [venueSlug]
  );

  const loadWeek = useCallback(
    async (from: string) => {
      setLoading(true);
      setError("");
      try {
        // キャッシュチェック
        const cached = prefetchCache.current.get(from);
        if (cached) {
          setData(cached);
          setWeekStart(from);
          setSelection(null);
          setStep("select");
          setQuote(null);
          setMobileDay(0);
          prefetchCache.current.delete(from);
        } else {
          const result = await fetchWeekData(from);
          if (!result) throw new Error("取得失敗");
          setData(result);
          setWeekStart(from);
          setSelection(null);
          setStep("select");
          setQuote(null);
          setMobileDay(0);
        }
      } catch {
        setError("空き状況の取得に失敗しました。再読み込みしてください。");
      } finally {
        setLoading(false);
      }
    },
    [fetchWeekData]
  );

  // 隣接週プリフェッチ
  useEffect(() => {
    const prefetchNext = addDays(weekStart, 7);
    const prefetchPrev = addDays(weekStart, -7);

    const doPrefetch = async (target: string) => {
      if (prefetchCache.current.has(target)) return;
      if (target < today || target > addDays(today, 60)) return;
      const result = await fetchWeekData(target);
      if (result) prefetchCache.current.set(target, result);
    };

    // 少し遅延してからプリフェッチ（メインのレンダリングを邪魔しない）
    const timer = setTimeout(() => {
      doPrefetch(prefetchNext);
      if (prefetchPrev >= today) doPrefetch(prefetchPrev);
    }, 500);

    return () => clearTimeout(timer);
  }, [weekStart, today, fetchWeekData]);

  // ─── 見積もりAPI（デバウンス付き） ────────────────────────────

  const selectedSlots = selection ? [...selection.slots].sort((a, b) => a - b) : [];
  const startHour = selectedSlots[0] ?? 0;
  const endHour = selectedSlots.length > 0 ? selectedSlots[selectedSlots.length - 1] + 0.5 : 0;
  const durationHours = selectedSlots.length * 0.5;

  // デバウンスするパラメータをまとめる
  const quoteParams = useMemo(
    () => ({
      step,
      venueSlug,
      date: selection?.date ?? "",
      startHour: confirmStartHour,
      hours: confirmEndHour - confirmStartHour,
      optionIds: selectedOptionIds.join(","),
      coupon: appliedCoupon,
    }),
    [step, venueSlug, selection?.date, confirmStartHour, confirmEndHour, selectedOptionIds, appliedCoupon]
  );

  const debouncedQuoteParams = useDebounce(quoteParams, 300);

  useEffect(() => {
    if (!selection || selectedSlots.length === 0 || debouncedQuoteParams.step === "select") {
      setQuote(null);
      setQuoteError("");
      return;
    }
    let stale = false;
    (async () => {
      try {
        const res = await fetch("/api/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            venueSlug: debouncedQuoteParams.venueSlug,
            date: debouncedQuoteParams.date,
            startHour: debouncedQuoteParams.startHour,
            hours: debouncedQuoteParams.hours,
            optionIds: debouncedQuoteParams.optionIds ? debouncedQuoteParams.optionIds.split(",") : [],
            couponCode: debouncedQuoteParams.coupon,
          }),
        });
        const json = await res.json();
        if (stale) return;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(json.error ?? "見積もりに失敗しました");
          if (appliedCoupon) setAppliedCoupon("");
          return;
        }
        setQuote(json.breakdown);
        setQuoteError("");
      } catch {
        if (!stale) setQuoteError("見積もりの通信に失敗しました");
      }
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuoteParams]);

  // ─── スロット選択ロジック ──────────────────────────────────────

  const toggleSlot = useCallback(
    (date: string, hour: number) => {
      setError("");
      setStep("select");
      setSelection((prev) => {
        if (!prev || prev.date !== date) return { date, slots: [hour] };
        const slots = [...prev.slots].sort((a, b) => a - b);
        const min = slots[0];
        const max = slots[slots.length - 1];
        if (slots.includes(hour)) {
          if (hour === min && slots.length > 1) return { date, slots: slots.slice(1) };
          if (hour === max && slots.length > 1) return { date, slots: slots.slice(0, -1) };
          if (slots.length === 1) return null;
          return { date, slots: [hour] };
        }
        if (hour === min - 0.5 || hour === max + 0.5) {
          if (slots.length * 0.5 >= maxHours) return prev;
          return { date, slots: [...slots, hour].sort((a, b) => a - b) };
        }
        return { date, slots: [hour] };
      });
    },
    [maxHours]
  );

  const isSelected = useCallback(
    (date: string, hour: number): boolean => {
      return selection?.date === date && (selection?.slots.includes(hour) ?? false);
    },
    [selection]
  );

  // ─── ステップ遷移 ────────────────────────────────────────────

  function proceedToConfirm() {
    if (!selection || selectedSlots.length === 0) return;
    setConfirmStartHour(startHour);
    setConfirmEndHour(endHour);
    setStep("confirm");
    setTimeout(() => confirmRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function confirmTime() {
    if (options.length > 0) {
      setStep("options");
      setTimeout(() => optionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } else {
      setStep("form");
      setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }

  function proceedToForm() {
    setStep("form");
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function toggleOption(id: string) {
    setSelectedOptionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  // ─── 確認ポップアップ用の時刻候補 ────────────────────────────

  function getAvailableStartTimes(): number[] {
    if (!selection) return [];
    const day = data.days.find((d) => d.date === selection.date);
    if (!day) return [];
    return day.slots.filter((s) => s.status === "available").map((s) => s.hour);
  }

  function getAvailableEndTimes(start: number): number[] {
    if (!selection) return [];
    const day = data.days.find((d) => d.date === selection.date);
    if (!day) return [];
    const ends: number[] = [];
    let current = start;
    while (true) {
      const slot = day.slots.find((s) => s.hour === current);
      if (!slot || slot.status !== "available") break;
      current += 0.5;
      if ((current - start) >= minHours) ends.push(current);
      if ((current - start) >= maxHours) break;
    }
    return ends;
  }

  // ─── 計算値 ──────────────────────────────────────────────────

  const effectiveHours = confirmEndHour - confirmStartHour;
  const invoiceEligible =
    selection !== null &&
    new Date(`${selection.date}T${String(Math.floor(confirmStartHour)).padStart(2, "0")}:${String(Math.round((confirmStartHour % 1) * 60)).padStart(2, "0")}:00+09:00`).getTime() -
      Date.now() >=
      72 * 60 * 60 * 1000;
  const effectivePayment = paymentMethod === "invoice" && (!invoiceEligible || customerType !== "corporate") ? "card" : paymentMethod;
  const canSubmit =
    selection !== null &&
    effectiveHours >= minHours &&
    quote !== null &&
    form.name.trim() !== "" &&
    form.email.trim() !== "" &&
    form.phone.trim() !== "" &&
    (customerType === "individual" || companyName.trim() !== "") &&
    !submitting;

  // ─── 深夜帯判定（0:00〜6:00のスロットを折りたたみ対象に） ──────

  const nightSlotBoundary = 6; // 6:00未満を深夜帯とする
  const hasNightSlots = (data.days[0]?.slots[0]?.hour ?? 9) < nightSlotBoundary;

  // 表示するスロット行を計算
  const visibleSlotRows = useMemo(() => {
    const allSlots = data.days[0]?.slots ?? [];
    if (!hasNightSlots || nightExpanded) return allSlots;
    return allSlots.filter((s) => s.hour >= nightSlotBoundary);
  }, [data.days, hasNightSlots, nightExpanded]);

  // ─── 送信 ────────────────────────────────────────────────────

  async function submit() {
    if (!selection) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueSlug,
          date: selection.date,
          startHour: confirmStartHour,
          hours: effectiveHours,
          name: form.name,
          email: form.email,
          phone: form.phone,
          purpose: form.purpose,
          optionIds: selectedOptionIds,
          couponCode: appliedCoupon,
          customerType,
          companyName,
          partySize,
          paymentMethod: effectivePayment,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "エラーが発生しました");
        if (res.status === 409) loadWeek(weekStart);
        setSubmitting(false);
        return;
      }
      if (json.invoiceFlow) {
        setInvoiceDone({ dueAt: json.dueAt, hostedInvoiceUrl: json.hostedInvoiceUrl ?? null });
        setSubmitting(false);
        return;
      }
      window.location.href = json.url;
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください。");
      setSubmitting(false);
    }
  }

  const prevDisabled = weekStart <= today || loading;
  const nextDisabled = loading || addDays(weekStart, 7) > addDays(today, 60);
  const selectedDay = selection ? data.days.find((d) => d.date === selection.date) : null;

  // モバイル表示用: 表示する日のデータ
  const mobileDays: DaySlots[] = isMobile ? [data.days[mobileDay]].filter(Boolean) : data.days;

  return (
    <>
      {/* ログイン促進バナー */}
      {!isLoggedIn && (
        <div className="login-prompt">
          <p>
            <strong>会員登録（無料）でもっと便利に</strong>
            <br />
            ログインすると、予約情報の自動入力・予約履歴の確認・領収書の発行が可能になります。
          </p>
          <div className="login-prompt-actions">
            <a href="/login" className="login-prompt-btn">ログイン</a>
            <a href="/signup" className="login-prompt-btn secondary">新規会員登録（無料）</a>
          </div>
        </div>
      )}

      {canceledNotice && (
        <div className="notice">
          決済が完了しなかったため、予約は確定していません。もう一度お手続きください。
        </div>
      )}
      {data.calendarError && (
        <div className="notice error">
          現在、空き状況の確認ができないため新規予約を停止しています。時間をおいて再度お試しください。
        </div>
      )}

      {/* ステップインジケーター */}
      <div className="step-indicator">
        <span className={`step-dot ${step === "select" ? "active" : "done"}`}>①時間選択</span>
        <span className={`step-dot ${step === "confirm" ? "active" : (step === "options" || step === "form") ? "done" : ""}`}>②確認</span>
        {options.length > 0 && (
          <span className={`step-dot ${step === "options" ? "active" : step === "form" ? "done" : ""}`}>③オプション</span>
        )}
        <span className={`step-dot ${step === "form" ? "active" : ""}`}>{options.length > 0 ? "④" : "③"}お客様情報</span>
      </div>

      <div className="week-nav">
        <button onClick={() => loadWeek(addDays(weekStart, -7))} disabled={prevDisabled}>
          ← 前の週
        </button>
        <span className="range">
          {mdLabel(weekStart)} 〜 {mdLabel(addDays(weekStart, 6))}
        </span>
        <button onClick={() => loadWeek(addDays(weekStart, 7))} disabled={nextDisabled}>
          次の週 →
        </button>
      </div>

      {/* モバイル: 日別タブ */}
      {isMobile && (
        <div className="day-tabs">
          {data.days.map((d, idx) => (
            <button
              key={d.date}
              className={`day-tab ${idx === mobileDay ? "active" : ""} ${d.dayType === "holiday" ? "holiday" : ""}`}
              onClick={() => setMobileDay(idx)}
            >
              <span className="day-tab-date">{mdLabel(d.date)}</span>
              <span className="day-tab-dow">{DOW[d.dayOfWeek]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid-wrapper" aria-busy={loading}>
        {/* 深夜帯折りたたみトグル */}
        {hasNightSlots && (
          <button
            type="button"
            className="night-toggle"
            onClick={() => setNightExpanded(!nightExpanded)}
          >
            {nightExpanded ? "▲ 深夜帯（0:00〜6:00）を折りたたむ" : "▼ 深夜帯（0:00〜6:00）を表示する"}
          </button>
        )}

        <table className="slot-table half-hour">
          <thead>
            <tr>
              <th></th>
              {mobileDays.map((d) => (
                <th
                  key={d.date}
                  className={
                    d.dayType === "holiday" && d.dayOfWeek !== 6 ? "sun" : d.dayOfWeek === 6 ? "sat" : ""
                  }
                >
                  {!isMobile && mdLabel(d.date)}
                  <span className="dow">
                    {!isMobile && DOW[d.dayOfWeek]}
                    {d.holidayName ? "・祝" : ""}
                  </span>
                  <span className="day-price">¥{d.pricePerHour.toLocaleString()}/h</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleSlotRows.map((baseSlot) => {
              const slotHour = baseSlot.hour;
              return (
                <tr key={slotHour}>
                  <td className="hour-label">{hourToTime(slotHour)}</td>
                  {mobileDays.map((d) => {
                    const slot = d.slots.find((s) => s.hour === slotHour);
                    if (!slot) return <td key={d.date}></td>;
                    const selected = isSelected(d.date, slot.hour);
                    return (
                      <td key={d.date}>
                        <SlotButton
                          date={d.date}
                          hour={slot.hour}
                          status={slot.status}
                          selected={selected}
                          onToggle={toggleSlot}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="legend">
          <span className="l-available">空き</span>
          <span className="l-selected">選択中</span>
          <span className="l-booked">予約済み</span>
          <span className="l-closed">受付外</span>
        </div>
      </div>

      {/* 選択中の表示と「この時間で進む」ボタン */}
      {selection && selectedSlots.length > 0 && step === "select" && (
        <div className="selection-summary">
          <p>
            <strong>{selection.date}（{DOW[selectedDay?.dayOfWeek ?? 0]}{selectedDay?.holidayName ? "・祝" : ""}）</strong>
            　{hourToTime(startHour)} 〜 {hourToTime(endHour)}（{formatDuration(durationHours)}）
          </p>
          {durationHours < minHours && (
            <p className="notice error">最低利用時間は{formatDuration(minHours)}です。もう少し選択してください。</p>
          )}
          <button
            className="proceed-btn"
            onClick={proceedToConfirm}
            disabled={durationHours < minHours}
          >
            この時間で予約に進む ↓
          </button>
        </div>
      )}

      {/* ステップ2: 時間確認ポップアップ */}
      {step === "confirm" && selection && (
        <div className="confirm-panel" ref={confirmRef}>
          <h2>ご利用時間の確認</h2>
          <p className="confirm-desc">
            選択した時間帯でよろしいですか？ 必要に応じて開始・終了時刻を調整できます。
          </p>
          <div className="confirm-time-selectors">
            <div className="time-selector">
              <label>開始時刻</label>
              <select
                value={confirmStartHour}
                onChange={(e) => {
                  const newStart = Number(e.target.value);
                  setConfirmStartHour(newStart);
                  if (confirmEndHour <= newStart) {
                    const ends = getAvailableEndTimes(newStart);
                    setConfirmEndHour(ends[0] ?? newStart + 0.5);
                  }
                }}
              >
                {getAvailableStartTimes().map((h) => (
                  <option key={h} value={h}>{hourToTime(h)}</option>
                ))}
              </select>
            </div>
            <span className="time-separator">〜</span>
            <div className="time-selector">
              <label>終了時刻</label>
              <select
                value={confirmEndHour}
                onChange={(e) => setConfirmEndHour(Number(e.target.value))}
              >
                {getAvailableEndTimes(confirmStartHour).map((h) => (
                  <option key={h} value={h}>{hourToTime(h)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="confirm-summary">
            <strong>
              {selection.date}（{DOW[selectedDay?.dayOfWeek ?? 0]}{selectedDay?.holidayName ? "・祝" : ""}）
              {hourToTime(confirmStartHour)} 〜 {hourToTime(confirmEndHour)}
              （{formatDuration(effectiveHours)}）
            </strong>
          </div>
          <div className="confirm-actions">
            <button className="back-btn" onClick={() => setStep("select")}>
              ← 時間を選び直す
            </button>
            <button
              className="proceed-btn"
              onClick={confirmTime}
              disabled={effectiveHours < minHours}
            >
              この時間で確定する →
            </button>
          </div>
        </div>
      )}

      {/* ステップ3: オプション選択 */}
      {step === "options" && options.length > 0 && (
        <div className="options-panel" ref={optionsRef}>
          <h2>オプションの選択</h2>
          <p className="options-desc">
            ご利用に合わせて、以下のオプションを追加できます。不要な場合はそのまま「次へ」をお選びください。
          </p>
          <div className="options-list">
            {options.map((o) => (
              <label key={o.id} className="option-card">
                <input
                  type="checkbox"
                  checked={selectedOptionIds.includes(o.id)}
                  onChange={() => toggleOption(o.id)}
                />
                <div className="option-info">
                  <strong>{o.name}</strong>
                  <span className="option-price">
                    +¥{o.price.toLocaleString()}
                    {o.price_unit === "per_hour" ? " /時間" : " /回"}
                  </span>
                </div>
              </label>
            ))}
          </div>
          <div className="confirm-actions">
            <button className="back-btn" onClick={() => setStep("confirm")}>
              ← 時間確認に戻る
            </button>
            <button className="proceed-btn" onClick={proceedToForm}>
              次へ：お客様情報の入力 →
            </button>
          </div>
        </div>
      )}

      {/* ステップ4: お客様情報・決済 */}
      {step === "form" && (
        <div className="booking-panel" ref={formRef}>
          <h2>予約内容の確認・お客様情報</h2>

          {selection && selectedDay ? (
            <div className="summary-box">
              <div>
                {selection.date}（{DOW[selectedDay.dayOfWeek]}
                {selectedDay.holidayName ? "・祝" : ""}）{hourToTime(confirmStartHour)} 〜 {hourToTime(confirmEndHour)}（
                {formatDuration(effectiveHours)}）
              </div>
              {quote ? (
                <div className="quote-lines">
                  <div className="quote-line">
                    <span>
                      {quote.dayType === "holiday" ? "土日祝料金" : "平日料金"} ¥
                      {quote.pricePerHour.toLocaleString()} × {formatDuration(quote.hours)}
                    </span>
                    <span>¥{quote.baseSubtotal.toLocaleString()}</span>
                  </div>
                  {quote.discount && (
                    <div className="quote-line discount">
                      <span>
                        {DISCOUNT_LABEL[quote.discount.kind]}（{quote.discount.percent}%OFF）
                      </span>
                      <span>-¥{quote.discount.amount.toLocaleString()}</span>
                    </div>
                  )}
                  {quote.options.map((o) => (
                    <div className="quote-line" key={o.id}>
                      <span>{o.name}</span>
                      <span>+¥{o.amount.toLocaleString()}</span>
                    </div>
                  ))}
                  {quote.coupon && (
                    <div className="quote-line discount">
                      <span>クーポン（{quote.coupon.code}）</span>
                      <span>-¥{quote.coupon.amount.toLocaleString()}</span>
                    </div>
                  )}
                  <div className="total">合計 ¥{quote.total.toLocaleString()}（税込）</div>
                </div>
              ) : (
                <div className="quote-skeleton">
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line short"></div>
                </div>
              )}
            </div>
          ) : (
            <p>上の表から、ご希望の時間帯を選択してください。</p>
          )}

          <div className="coupon-box">
            <label>クーポンコード</label>
            <div className="coupon-row">
              <input
                type="text"
                value={couponInput}
                onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                placeholder="お持ちの場合のみ入力"
              />
              <button
                type="button"
                onClick={() => setAppliedCoupon(couponInput.trim())}
                disabled={!couponInput.trim() || !selection}
              >
                適用
              </button>
            </div>
            {quoteError && <div className="notice error">{quoteError}</div>}
          </div>

          <div className="customer-type-row">
            <label className="option-item">
              <input
                type="radio"
                name="customerType"
                checked={customerType === "individual"}
                onChange={() => {
                  setCustomerType("individual");
                  setPaymentMethod("card");
                }}
              />
              個人として予約
            </label>
            <label className="option-item">
              <input
                type="radio"
                name="customerType"
                checked={customerType === "corporate"}
                onChange={() => setCustomerType("corporate")}
              />
              法人として予約
            </label>
          </div>

          <div className="form-grid">
            {customerType === "corporate" && (
              <div className="form-field">
                <label>
                  会社名 <span className="req">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="株式会社〇〇"
                />
              </div>
            )}
            <div className="form-field">
              <label>
                お名前 <span className="req">*</span>
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="山田 太郎"
              />
            </div>
            <div className="form-field">
              <label>
                メールアドレス <span className="req">*</span>
              </label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="taro@example.com"
              />
            </div>
            <div className="form-field">
              <label>
                電話番号 <span className="req">*</span>
              </label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="09012345678"
              />
            </div>
            <div className="form-field">
              <label>
                ご利用人数 <span className="req">*</span>
              </label>
              <select value={partySize} onChange={(e) => setPartySize(Number(e.target.value))}>
                {Array.from({ length: 30 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}名
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>ご利用目的（任意）</label>
              <input
                type="text"
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="会議・撮影 など"
              />
            </div>
          </div>

          {customerType === "corporate" && (
            <div className="payment-method-row">
              <strong>お支払い方法</strong>
              <label className="option-item">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={effectivePayment === "card"}
                  onChange={() => setPaymentMethod("card")}
                />
                クレジットカード（即時確定）
              </label>
              <label className="option-item">
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={effectivePayment === "invoice"}
                  disabled={!invoiceEligible}
                  onChange={() => setPaymentMethod("invoice")}
                />
                請求書払い・銀行振込（入金確認後に確定）
                {!invoiceEligible && selection && (
                  <span className="policy">　※利用開始の3日前までのご予約で選択できます</span>
                )}
              </label>
            </div>
          )}

          <p className="policy">
            {effectivePayment === "invoice"
              ? "請求書（PDF・お振込先記載）をメールでお送りします。お支払い期限は発行から3日以内（利用直前のご予約は利用開始24時間前まで）。入金確認をもって予約確定となり、期限を過ぎると自動キャンセルされます。"
              : "ご予約はクレジットカード決済の完了をもって確定します。"}{" "}
            キャンセル料: 利用日の8日以上前は無料 / 7日前〜2日前は50% / 前日・当日は100%（返金不可）。
          </p>

          {error && <div className="notice error">{error}</div>}

          <div className="form-actions">
            <button
              className="back-btn"
              onClick={() => setStep(options.length > 0 ? "options" : "confirm")}
            >
              ← 戻る
            </button>

            {invoiceDone ? (
              <div className="notice">
                <strong>📧 請求書をお送りしました。</strong>
                <br />
                {form.email} 宛てに、お振込先を記載した請求書メールが届きます（Stripeから送信）。
                お支払い期限:{" "}
                {new Date(invoiceDone.dueAt).toLocaleString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  month: "long",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                。入金確認後、予約確定メールをお送りします。それまでこの枠はお客様用に確保されます。
                {invoiceDone.hostedInvoiceUrl && (
                  <>
                    <br />
                    <a href={invoiceDone.hostedInvoiceUrl} target="_blank" rel="noopener noreferrer">
                      請求書を今すぐ開く（お振込先の確認）→
                    </a>
                  </>
                )}
              </div>
            ) : (
              <button className="submit-btn" onClick={submit} disabled={!canSubmit || data.calendarError}>
                {submitting
                  ? "処理中..."
                  : effectivePayment === "invoice"
                    ? "請求書の送付を依頼する（銀行振込）"
                    : "クレジットカードで支払って予約する"}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
