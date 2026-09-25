/**
 * コードが前提とするDBオブジェクトの台帳（マイグレーション1ファイル＝1エントリ）。
 *
 * 毎日のcron（/api/cron/maintenance）が schema-check.ts でこの台帳を本番DBに照合し、
 * 見つからないものがあれば「マイグレーション未適用の疑い」として管理者アラートを送る。
 * （2026-09: 0016/0017 が本番未適用のままコードだけデプロイされ、返金額が記録されなかった事故の再発防止）
 *
 * ▼ supabase/migrations にファイルを追加したら、必ずここにも1エントリ追加すること。
 *   追加し忘れると schema-check.test.ts が落ちる（ファイル一覧と台帳の突き合わせ）。
 *   - tables: 作ったテーブル／追加した列（テーブル → 列名。空配列ならテーブルの存在だけ確認）
 *   - rpcs:   コードが db.rpc() で呼ぶ関数 → コードが渡す引数名の全集合
 *             （PostgRESTは「関数名＋引数名」で関数を探すため、引数名まで一致しないと見つからない）
 *   - unverifiable: 外から確認できる目印がない場合（型変更・RLSのみ等）の理由
 *
 * ⚠️ RPCは本番に対してGET（READ ONLY）で実際に呼んで確かめる。DB書き込みは必ず拒否されるが、
 *   外部HTTP（pg_net等）・NOTIFY・advisory lock など「DB書き込み以外の副作用」を持つ関数を
 *   新しく登録する場合は、探査方法（schema-check.ts）を見直してから追加すること。
 */
export type MigrationManifestEntry = {
  /** supabase/migrations 内のファイル名（拡張子なし） */
  migration: string;
  tables?: Record<string, string[]>;
  rpcs?: Record<string, string[]>;
  unverifiable?: string;
};

export const SCHEMA_MANIFEST: MigrationManifestEntry[] = [
  {
    migration: "0001_init",
    tables: { venues: [], bookings: [], stripe_events: [] },
    rpcs: { expire_stale_pendings: [] },
  },
  {
    migration: "0002_pricing",
    tables: {
      venues: ["holiday_hourly_price", "last_minute_percent", "early_bird_percent", "early_bird_days"],
      bookings: ["coupon_code"],
      jp_holidays: [],
      venue_options: [],
      coupons: [],
    },
    // 0010で作り直されているが、名前・引数が同じなので探査ではどちらの版かは区別できない（0010側を参照）
    rpcs: { increment_coupon_use: ["p_code"] },
  },
  {
    migration: "0003_members",
    tables: { bookings: ["user_id", "receipt_name", "receipt_first_issued_at"] },
  },
  {
    migration: "0004_cancellation",
    tables: { venues: ["cancellation_policy"] },
  },
  {
    migration: "0004_invoice",
    tables: { bookings: ["payment_method", "customer_type", "company_name", "stripe_invoice_id"] },
  },
  {
    migration: "0005_half_hour_slots",
    unverifiable: "列の型変更（min_hours/max_hours を numeric へ）のみ。PostgREST経由では列の型を確認できない",
  },
  {
    migration: "0006_party_receipt_access",
    tables: { bookings: ["party_size", "receipt_name_changed_at"], venues: ["access_info"] },
  },
  {
    migration: "0007_faqs_photos",
    tables: { venues: ["faqs"], venue_photos: [] },
  },
  {
    migration: "0008_member_profiles",
    tables: { member_profiles: [] },
  },
  {
    migration: "0009_coupon_campaigns",
    tables: { coupons: ["restrict_email"], coupon_grants: [] },
  },
  {
    migration: "0010_coupon_atomic_use",
    unverifiable:
      "increment_coupon_use(p_code) を同じ名前・引数で作り直しただけ（戻り値 void→boolean と使用上限の条件追加）。" +
      "READ ONLYの探査では0002版と区別できない",
  },
  {
    migration: "0011_booking_adjustments",
    tables: { bookings: ["adjusted_total"], booking_adjustments: [] },
  },
  {
    migration: "0012_booking_change_requests",
    tables: { booking_change_requests: [] },
  },
  {
    migration: "0013_license_limits",
    tables: { license_limits: [], license_changes: [] },
    rpcs: { get_license_status: [] },
  },
  {
    migration: "0014_reminder_email",
    tables: { bookings: ["reminder_email_sent_at"] },
  },
  {
    migration: "0015_extra_paid_amount",
    tables: { bookings: ["extra_paid_amount"] },
  },
  {
    migration: "0016_reviews",
    tables: { bookings: ["review_token", "review_request_sent_at"], booking_reviews: [] },
  },
  {
    migration: "0017_atomic_amount_increments",
    rpcs: {
      increment_extra_paid_amount: ["p_booking_id", "p_delta"],
      increment_refunded_amount: ["p_booking_id", "p_delta"],
    },
  },
  {
    migration: "0018_occupancy_snapshots",
    tables: { occupancy_daily_snapshots: [] },
  },
  {
    migration: "0019_fix_rls_gap",
    unverifiable: "既存テーブルのRLS有効化のみ。PostgREST（service_role）経由ではRLSの有無を確認できない",
  },
  {
    migration: "0020_pricing_optimization",
    tables: {
      occupancy_pace_snapshots: [],
      price_actions: [],
      external_bookings: [],
      external_import_batches: [],
    },
  },
  {
    migration: "0022_price_bands_and_entry",
    tables: {
      venue_price_bands: [],
      venue_price_band_audits: [],
      venue_entry_tokens: [],
      bookings: ["price_tier"],
      booking_change_requests: ["new_price_breakdown"],
    },
    rpcs: {
      replace_venue_price_bands: ["p_venue_id", "p_day_type", "p_bands"],
      // 0001→0003→0022 と作り直されている。コードが使うのは p_price_tier 付きの0022版
      create_pending_booking: [
        "p_venue_id",
        "p_start_at",
        "p_end_at",
        "p_customer_name",
        "p_customer_email",
        "p_customer_phone",
        "p_purpose",
        "p_total_amount",
        "p_price_breakdown",
        "p_expires_at",
        "p_user_id",
        "p_price_tier",
      ],
    },
  },
  {
    migration: "0023_pending_payment_email",
    tables: { bookings: ["pending_payment_email_sent_at"] },
  },
];
