export type Venue = {
  id: string;
  slug: string;
  name: string;
  address: string;
  description: string;
  open_hour: number;
  close_hour: number;
  hourly_price: number;
  holiday_hourly_price: number | null;
  last_minute_percent: number;
  early_bird_percent: number;
  early_bird_days: number;
  min_hours: number; // 0.5刻み（30分単位）
  max_hours: number; // 0.5刻み（30分単位）
  calendar_id: string;
  external_booking_url: string;
  active: boolean;
  cancellation_policy?: { tiers: { days_before: number; percent: number }[] } | null;
  /** 入退室のご案内（鍵・入室方法など）。確定予約者のみに表示 */
  access_info?: string;
  /** 拠点別FAQの上書き（nullならコード内のデフォルトFAQを表示） */
  faqs?: { q: string; a: string }[] | null;
};

export type VenueOption = {
  id: string;
  name: string;
  price: number;
  price_unit: "per_booking" | "per_hour";
};

export type BookingStatus = "pending" | "confirmed" | "cancelled" | "expired";

export type Booking = {
  id: string;
  venue_id: string;
  user_id: string | null;
  start_at: string;
  end_at: string;
  booking_status: BookingStatus;
  payment_status: "unpaid" | "paid" | "refunded" | "partially_refunded";
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  purpose: string;
  total_amount: number;
  currency: string;
  coupon_code: string | null;
  price_breakdown: unknown;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  calendar_event_id: string | null;
  calendar_sync_status: "none" | "synced" | "failed";
  confirmation_email_sent_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  refunded_amount: number;
  created_at: string;
  payment_method: "card" | "invoice";
  customer_type: "individual" | "corporate";
  company_name: string | null;
  stripe_invoice_id: string | null;
  party_size: number | null;
  receipt_name: string | null;
  receipt_first_issued_at: string | null;
  receipt_name_changed_at: string | null;
  /** 調整後の実効金額（null=調整なし、total_amountがそのまま有効） */
  adjusted_total: number | null;
};

export type AdjustmentType = "price_decrease" | "price_increase" | "cancel_fee_override";
export type AdjustmentStatus = "pending_payment" | "completed" | "failed" | "expired";

export type BookingAdjustment = {
  id: string;
  booking_id: string;
  adjustment_type: AdjustmentType;
  previous_amount: number;
  new_amount: number;
  amount_delta: number;
  reason: string;
  stripe_refund_id: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  status: AdjustmentStatus;
  created_at: string;
};

export type ChangeRequestType = "self_extend" | "self_modify" | "admin_modify";
export type ChangeRequestStatus =
  | "pending"
  | "pending_payment"
  | "approved"
  | "rejected"
  | "expired";

/**
 * 予約時間変更申請。
 * - self_extend: お客様の延長（仮押さえ→決済完了で確定）
 * - self_modify: お客様の短縮/時間ずらし（管理者承認制）
 * - admin_modify: 管理者の直接変更（即時反映の監査ログ）
 */
export type BookingChangeRequest = {
  id: string;
  booking_id: string;
  request_type: ChangeRequestType;
  previous_start_at: string;
  previous_end_at: string;
  requested_start_at: string;
  requested_end_at: string;
  previous_amount: number;
  new_amount: number;
  refund_amount: number;
  extra_amount: number;
  /** 申請作成時刻スナップショット（キャンセル料計算の基準） */
  cancel_fee_basis_at: string;
  status: ChangeRequestStatus;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_refund_id: string | null;
  reason: string;
  decided_at: string | null;
  decided_by: string | null;
  admin_note: string;
  created_at: string;
};

/** 時間帯（UTCのDateで保持） */
export type TimeRange = { start: Date; end: Date };

export type SlotStatus = "available" | "booked" | "closed";

export type DaySlots = {
  /** JSTの日付 'YYYY-MM-DD' */
  date: string;
  /** 曜日 0=日〜6=土（JST基準） */
  dayOfWeek: number;
  /** weekday=平日 / holiday=土日祝 */
  dayType: "weekday" | "holiday";
  /** この日の時給（円） */
  pricePerHour: number;
  /** 祝日名（祝日のみ） */
  holidayName?: string;
  slots: { hour: number; status: SlotStatus }[];
};

export type AvailabilityResponse = {
  venue: {
    slug: string;
    name: string;
    hourlyPrice: number;
    holidayHourlyPrice: number | null;
    lastMinutePercent: number;
    earlyBirdPercent: number;
    earlyBirdDays: number;
    minHours: number;
    maxHours: number;
  };
  days: DaySlots[];
  /** FreeBusy取得に失敗した場合true（fail closed: 全枠closed表示） */
  calendarError: boolean;
};
