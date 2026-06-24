import { hourToTimeStr } from "@/lib/slots";
import type { AvailabilityResponse, DaySlots } from "@/lib/types";

const WEEKDAY_JP = ["日", "月", "火", "水", "木", "金", "土"];

type DayStatus = "free" | "partial" | "full" | "closed";

type DayDigest = {
  date: string;
  /** 'MM/DD' */
  mmdd: string;
  weekday: string;
  isToday: boolean;
  isTomorrow: boolean;
  isWeekend: boolean;
  holidayName?: string;
  status: DayStatus;
  /** 連続した空き時間帯（30分スロットをマージ） */
  freeRanges: { start: number; end: number }[];
  availableCount: number;
  totalCount: number;
};

/** 連続する available スロットを時間帯レンジにまとめる（30分=0.5刻み前提） */
function computeFreeRanges(slots: DaySlots["slots"]): { start: number; end: number }[] {
  const sorted = [...slots].sort((a, b) => a.hour - b.hour);
  const ranges: { start: number; end: number }[] = [];
  for (const s of sorted) {
    if (s.status !== "available") continue;
    const last = ranges[ranges.length - 1];
    if (last && Math.abs(last.end - s.hour) < 1e-6) {
      last.end = s.hour + 0.5; // 連続 → 伸ばす
    } else {
      ranges.push({ start: s.hour, end: s.hour + 0.5 });
    }
  }
  return ranges;
}

function digestForDay(day: DaySlots, index: number): DayDigest {
  const total = day.slots.length;
  const availableCount = day.slots.filter((s) => s.status === "available").length;
  const bookedCount = day.slots.filter((s) => s.status === "booked").length;
  const isWeekend = day.dayOfWeek === 0 || day.dayOfWeek === 6 || !!day.holidayName;

  let status: DayStatus;
  if (total === 0) {
    status = "closed";
  } else if (availableCount === 0) {
    // 予約で埋まっている=満員(赤) / 過去や受付終了で空き無し=closed(グレー)
    status = bookedCount > 0 ? "full" : "closed";
  } else if (availableCount === total) {
    status = "free";
  } else {
    status = "partial";
  }

  const [, mm, dd] = day.date.split("-");
  return {
    date: day.date,
    mmdd: `${mm}/${dd}`,
    weekday: WEEKDAY_JP[day.dayOfWeek] ?? "",
    isToday: index === 0,
    isTomorrow: index === 1,
    isWeekend,
    holidayName: day.holidayName,
    status,
    freeRanges: computeFreeRanges(day.slots),
    availableCount,
    totalCount: total,
  };
}

const STATUS_META: Record<DayStatus, { label: string; cls: string }> = {
  free: { label: "終日空きあり", cls: "av-free" },
  partial: { label: "一部空きあり", cls: "av-partial" },
  full: { label: "満員", cls: "av-full" },
  closed: { label: "受付終了", cls: "av-closed" },
};

function rangeText(r: { start: number; end: number }): string {
  const end = r.end >= 24 ? "24:00" : hourToTimeStr(r.end);
  return `${hourToTimeStr(r.start)}〜${end}`;
}

/** 今日・明日の状況を1枚で示すバナー（ヒーロー直下用） */
function TodayBanner({ days }: { days: DayDigest[] }) {
  const target = [days[0], days[1]].filter(Boolean) as DayDigest[];
  if (target.length === 0) return null;
  return (
    <div className="av-today-banner">
      {target.map((d) => {
        const meta = STATUS_META[d.status];
        const free = d.freeRanges;
        return (
          <a key={d.date} href="#book" className={`av-today-card ${meta.cls}`}>
            <div className="av-today-head">
              <span className="av-today-when">{d.isToday ? "本日" : "明日"}</span>
              <span className="av-today-date">
                {d.mmdd}（{d.weekday}）
              </span>
              <span className="av-today-badge">{meta.label}</span>
            </div>
            <div className="av-today-body">
              {d.status === "free" && <span>0:00〜24:00 ご予約可能です</span>}
              {d.status === "partial" && (
                <span>
                  空き: {free.slice(0, 3).map(rangeText).join(" / ")}
                  {free.length > 3 ? " ほか" : ""}
                </span>
              )}
              {d.status === "full" && <span>ご予約で満員です</span>}
              {d.status === "closed" && (
                <span>{d.isToday ? "本日の受付は終了しました" : "受付対象外です"}</span>
              )}
            </div>
          </a>
        );
      })}
    </div>
  );
}

/**
 * 既存の getAvailability() 出力から「今日・明日バナー」と「7日間ダイジェスト」を描画。
 * サーバーコンポーネント（追加のfetchなし・initialデータを再利用）。
 */
export default function AvailabilityDigest({
  availability,
  variant = "week",
}: {
  availability: AvailabilityResponse;
  variant?: "banner" | "week";
}) {
  if (availability.calendarError || availability.days.length === 0) return null;
  const days = availability.days.map(digestForDay);

  if (variant === "banner") {
    return <TodayBanner days={days} />;
  }

  return (
    <div className="av-week">
      <ul className="av-week-list">
        {days.map((d) => {
          const meta = STATUS_META[d.status];
          return (
            <li
              key={d.date}
              className={`av-week-row ${meta.cls}${d.isWeekend ? " is-weekend" : ""}${
                d.isToday ? " is-today" : ""
              }`}
            >
              <div className="av-week-date">
                <span className="av-week-mmdd">{d.mmdd}</span>
                <span className="av-week-wd">（{d.weekday}）</span>
                {d.isToday && <span className="av-week-tag">本日</span>}
                {d.isTomorrow && <span className="av-week-tag">明日</span>}
                {d.holidayName && <span className="av-week-holiday">{d.holidayName}</span>}
              </div>
              <div className="av-week-status">
                <span className={`av-week-dot ${meta.cls}`} aria-hidden="true" />
                {meta.label}
              </div>
              <div className="av-week-free">
                {d.status === "free" && "0:00〜24:00"}
                {d.status === "partial" &&
                  (d.freeRanges.length > 0
                    ? d.freeRanges.map(rangeText).join(" / ")
                    : "―")}
                {(d.status === "full" || d.status === "closed") && "―"}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="av-week-note policy">
        ※ 表示は{availability.days.length}日分のビルド時点の目安です。本日は現在時刻以降の空き枠のみ表示。
        最新の空き状況と確実なご予約は下の予約カレンダーでご確認ください。
      </p>
    </div>
  );
}
