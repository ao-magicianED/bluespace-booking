import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

type VenueRow = {
  id: string;
  slug: string;
  name: string;
  open_hour: number;
  close_hour: number;
  hourly_price: number;
  holiday_hourly_price: number | null;
  last_minute_percent: number;
  early_bird_percent: number;
  early_bird_days: number;
  min_hours: number;
  max_hours: number;
  active: boolean;
};

type CouponRow = {
  id: string;
  code: string;
  description: string;
  percent_off: number | null;
  amount_off: number | null;
  venue_id: string | null;
  starts_at: string | null;
  ends_at: string | null;
  max_uses: number | null;
  used_count: number;
  min_amount: number;
  active: boolean;
  restrict_email: string | null;
};

export type AiOperationSource = "admin_console" | "api" | "codex" | "claude_code";

export type AiOperation =
  | {
      type: "update_venue_pricing";
      venueSlug: string;
      weekdayHourlyPrice?: number;
      holidayHourlyPrice?: number | null;
      lastMinutePercent?: number;
      earlyBirdPercent?: number;
      earlyBirdDays?: number;
      reason?: string;
    }
  | {
      type: "update_venue_booking_rules";
      venueSlug: string;
      openHour?: number;
      closeHour?: number;
      minHours?: number;
      maxHours?: number;
      active?: boolean;
      reason?: string;
    }
  | {
      type: "create_coupon";
      code: string;
      description?: string;
      percentOff?: number;
      amountOff?: number;
      venueSlug?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      maxUses?: number | null;
      minAmount?: number;
      restrictEmail?: string | null;
      active?: boolean;
      reason?: string;
    }
  | {
      type: "deactivate_coupon";
      code: string;
      reason?: string;
    };

export type AiChange = {
  field: string;
  label: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

export type AiOperationPreview = {
  operation: AiOperation;
  operationType: AiOperation["type"];
  title: string;
  target: string;
  summary: string;
  changes: AiChange[];
  warnings: string[];
  safeToApply: boolean;
};

const VENUE_ALIASES: Record<string, string[]> = {
  "keisei-koiwa": ["京成小岩", "小岩", "keisei", "koiwa"],
  kanda: ["神田", "kanda"],
  "ueno-okachimachi": ["上野御徒町", "御徒町", "ueno-okachimachi", "okachimachi"],
  "ueno-4a": ["上野4a", "上野４a", "4a", "４a", "ueno-4a"],
  "ueno-4b": ["上野4b", "上野４b", "4b", "４b", "ueno-4b"],
  "nishi-shinjuku": ["西新宿", "西新宿403", "nishi", "shinjuku"],
  "shirokane-takanawa": ["白金高輪", "白金", "shirokane"],
};

const YEN_RE = /([0-9０-９][0-9０-９,，]*)\s*円?/;
const PERCENT_RE = /([0-9０-９]{1,3})\s*%/;

function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[，]/g, ",")
    .replace(/　/g, " ")
    .trim();
}

function toNumber(input: string | undefined): number | null {
  if (!input) return null;
  const n = Number(input.normalize("NFKC").replaceAll(",", ""));
  return Number.isFinite(n) ? n : null;
}

function findYenAfter(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = toNumber(match?.[1]);
    if (amount != null) return amount;
  }
  return null;
}

function findPercentAfter(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const amount = toNumber(match?.[1]);
    if (amount != null) return amount;
  }
  return null;
}

function findVenueSlug(text: string, venues: { slug: string; name: string }[]): string | null {
  const lower = text.toLowerCase();
  for (const venue of venues) {
    const aliases = [venue.slug, venue.name, venue.name.replace("ブルースペース", ""), ...(VENUE_ALIASES[venue.slug] ?? [])];
    if (aliases.some((alias) => alias && lower.includes(alias.toLowerCase()))) return venue.slug;
  }
  return null;
}

function parseCoupon(text: string, venues: { slug: string; name: string }[]): AiOperation | null {
  if (!/クーポン|coupon/i.test(text)) return null;
  const code = text.match(/(?:クーポン|coupon)\s*([A-Z0-9_-]{2,32})/i)?.[1]?.toUpperCase()
    ?? text.match(/コード\s*[:：]?\s*([A-Z0-9_-]{2,32})/i)?.[1]?.toUpperCase();
  if (!code) return null;
  if (/停止|無効|削除|deactivate|off/i.test(text)) return { type: "deactivate_coupon", code };

  const percentOff = findPercentAfter(text, [/([0-9０-９]{1,3})\s*%\s*(?:off|OFF|引き|割引)?/, /([0-9０-９]{1,3})\s*パーセント/]);
  const amountOff = /円\s*(?:off|OFF|引き|割引)/i.test(text)
    ? findYenAfter(text, [YEN_RE])
    : null;
  if (percentOff == null && amountOff == null) return null;

  const maxUses = toNumber(text.match(/(?:上限|最大)\s*([0-9０-９]+)\s*(?:回|件|人)?/)?.[1] ?? undefined);
  const minAmount = toNumber(text.match(/(?:最低|下限)\s*([0-9０-９,，]+)\s*円/)?.[1] ?? undefined) ?? 0;
  const restrictEmail = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase() ?? null;
  const venueSlug = findVenueSlug(text, venues);

  return {
    type: "create_coupon",
    code,
    percentOff: percentOff ?? undefined,
    amountOff: amountOff ?? undefined,
    venueSlug,
    maxUses: maxUses ?? null,
    minAmount,
    restrictEmail,
    description: "AI設定から作成",
  };
}

export function parseNaturalLanguageCommand(textInput: string, venues: { slug: string; name: string }[]): AiOperation {
  const text = normalizeText(textInput);
  if (!text || text.length > 2000) throw new Error("指示は1〜2,000文字で入力してください");

  const coupon = parseCoupon(text, venues);
  if (coupon) return coupon;

  const venueSlug = findVenueSlug(text, venues);
  if (!venueSlug) throw new Error("対象拠点を特定できません。例: 神田、上野4A、京成小岩");

  const pricing: Extract<AiOperation, { type: "update_venue_pricing" }> = {
    type: "update_venue_pricing",
    venueSlug,
  };
  const weekday = findYenAfter(text, [/(?:平日|weekday)[^0-9０-９]*([0-9０-９,，]+)\s*円?/, /([0-9０-９,，]+)\s*円?[^。\n]*(?:平日|weekday)/]);
  const holiday = findYenAfter(text, [/(?:土日祝|休日|週末|holiday|weekend)[^0-9０-９]*([0-9０-９,，]+)\s*円?/, /([0-9０-９,，]+)\s*円?[^。\n]*(?:土日祝|休日|週末|holiday|weekend)/]);
  const genericPrice = findYenAfter(text, [/(?:料金|価格|単価|時給)[^0-9０-９]*([0-9０-９,，]+)\s*円?/, YEN_RE]);
  if (weekday != null) pricing.weekdayHourlyPrice = weekday;
  if (holiday != null) pricing.holidayHourlyPrice = holiday;
  if (weekday == null && holiday == null && genericPrice != null && /料金|価格|単価|時給/.test(text)) {
    pricing.weekdayHourlyPrice = genericPrice;
  }
  const lastMinute = /直前割/.test(text) ? findPercentAfter(text, [/(?:直前割)[^0-9０-９]*([0-9０-９]{1,3})\s*%/]) : null;
  const earlyBird = /早割/.test(text) ? findPercentAfter(text, [/(?:早割)[^0-9０-９]*([0-9０-９]{1,3})\s*%/]) : null;
  const earlyDays = /早割/.test(text) ? toNumber(text.match(/([0-9０-９]+)\s*日前/)?.[1] ?? undefined) : null;
  if (lastMinute != null) pricing.lastMinutePercent = lastMinute;
  if (earlyBird != null) pricing.earlyBirdPercent = earlyBird;
  if (earlyDays != null) pricing.earlyBirdDays = earlyDays;
  if (
    pricing.weekdayHourlyPrice != null ||
    pricing.holidayHourlyPrice !== undefined ||
    pricing.lastMinutePercent != null ||
    pricing.earlyBirdPercent != null ||
    pricing.earlyBirdDays != null
  ) {
    return pricing;
  }

  const rules: Extract<AiOperation, { type: "update_venue_booking_rules" }> = {
    type: "update_venue_booking_rules",
    venueSlug,
  };
  const hours = text.match(/(?:営業時間|営業|受付時間)[^0-9０-９]*([0-9０-９]{1,2})\s*時?\s*(?:から|-|〜|~)\s*([0-9０-９]{1,2})\s*時?/);
  if (hours) {
    rules.openHour = toNumber(hours[1]) ?? undefined;
    rules.closeHour = toNumber(hours[2]) ?? undefined;
  }
  const minHours = text.match(/(?:最低利用|最短利用|min)[^0-9０-９]*([0-9０-９]+(?:\.[05])?)\s*時間?/);
  if (minHours) rules.minHours = Number(minHours[1]);
  const maxHours = text.match(/(?:最大利用|最長利用|max)[^0-9０-９]*([0-9０-９]+(?:\.[05])?)\s*時間?/);
  if (maxHours) rules.maxHours = Number(maxHours[1]);
  if (/非公開|停止|受付停止|休止|無効/.test(text)) rules.active = false;
  if (/公開|再開|受付再開|有効/.test(text) && rules.active === undefined) rules.active = true;

  if (rules.openHour != null || rules.closeHour != null || rules.minHours != null || rules.maxHours != null || rules.active !== undefined) {
    return rules;
  }

  throw new Error("対応している操作として解釈できませんでした。料金変更、営業時間変更、受付停止、クーポン作成などを指定してください。 ");
}

function yen(value: number | null): string | null {
  return value == null ? null : `¥${value.toLocaleString()}`;
}

function pct(value: number): string {
  return `${value}%`;
}

function assertInt(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name}は${min}〜${max}の整数で指定してください`);
  }
}

function assertHalfHour(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0.5 || value > 24 || Math.round(value * 2) !== value * 2) {
    throw new Error(`${name}は0.5時間刻みで0.5〜24の範囲で指定してください`);
  }
}

function addChange(changes: AiChange[], field: string, label: string, before: AiChange["before"], after: AiChange["after"]): void {
  if (before !== after) changes.push({ field, label, before, after });
}

async function listVenues(db: Db): Promise<VenueRow[]> {
  const { data, error } = await db
    .from("venues")
    .select("id, slug, name, open_hour, close_hour, hourly_price, holiday_hourly_price, last_minute_percent, early_bird_percent, early_bird_days, min_hours, max_hours, active")
    .order("name");
  if (error) throw new Error(`拠点取得エラー: ${error.message}`);
  return (data ?? []) as VenueRow[];
}

async function getVenueBySlug(db: Db, slug: string): Promise<VenueRow> {
  const { data, error } = await db
    .from("venues")
    .select("id, slug, name, open_hour, close_hour, hourly_price, holiday_hourly_price, last_minute_percent, early_bird_percent, early_bird_days, min_hours, max_hours, active")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`拠点取得エラー: ${error.message}`);
  if (!data) throw new Error(`拠点が見つかりません: ${slug}`);
  return data as VenueRow;
}

export async function parseOperationInput(db: Db, input: { text?: string; operation?: unknown }): Promise<{ requestText: string; operation: AiOperation }> {
  if (input.operation && typeof input.operation === "object") {
    return { requestText: input.text?.trim() ?? "structured operation", operation: normalizeOperation(input.operation as AiOperation) };
  }
  const requestText = input.text?.trim() ?? "";
  const venues = await listVenues(db);
  return { requestText, operation: parseNaturalLanguageCommand(requestText, venues.map((v) => ({ slug: v.slug, name: v.name }))) };
}

function normalizeOperation(operation: AiOperation): AiOperation {
  if (!operation || typeof operation !== "object" || !("type" in operation)) throw new Error("operationが不正です");
  return operation;
}

export async function buildOperationPreview(db: Db, operation: AiOperation): Promise<AiOperationPreview> {
  switch (operation.type) {
    case "update_venue_pricing": {
      const venue = await getVenueBySlug(db, operation.venueSlug);
      const changes: AiChange[] = [];
      const warnings = ["既存予約のprice_breakdownと請求額は変更されません。新規見積もりから反映されます。"];
      if (operation.weekdayHourlyPrice != null) {
        assertInt("平日料金", operation.weekdayHourlyPrice, 0, 200000);
        addChange(changes, "hourly_price", "平日1時間料金", yen(venue.hourly_price), yen(operation.weekdayHourlyPrice));
      }
      if (operation.holidayHourlyPrice !== undefined) {
        if (operation.holidayHourlyPrice !== null) assertInt("土日祝料金", operation.holidayHourlyPrice, 0, 200000);
        addChange(changes, "holiday_hourly_price", "土日祝1時間料金", yen(venue.holiday_hourly_price), yen(operation.holidayHourlyPrice));
      }
      if (operation.lastMinutePercent != null) {
        assertInt("直前割", operation.lastMinutePercent, 0, 100);
        addChange(changes, "last_minute_percent", "直前割", pct(venue.last_minute_percent), pct(operation.lastMinutePercent));
      }
      if (operation.earlyBirdPercent != null) {
        assertInt("早割", operation.earlyBirdPercent, 0, 100);
        addChange(changes, "early_bird_percent", "早割", pct(venue.early_bird_percent), pct(operation.earlyBirdPercent));
      }
      if (operation.earlyBirdDays != null) {
        assertInt("早割日数", operation.earlyBirdDays, 1, 365);
        addChange(changes, "early_bird_days", "早割の適用日数", venue.early_bird_days, operation.earlyBirdDays);
      }
      return {
        operation,
        operationType: operation.type,
        title: `${venue.name}の料金設定を変更`,
        target: venue.name,
        summary: changes.length > 0 ? `${changes.length}項目を変更します` : "変更差分はありません",
        changes,
        warnings,
        safeToApply: changes.length > 0,
      };
    }
    case "update_venue_booking_rules": {
      const venue = await getVenueBySlug(db, operation.venueSlug);
      const changes: AiChange[] = [];
      const warnings = ["既存予約は変更されません。空き状況と新規予約受付に反映されます。"];
      const nextOpen = operation.openHour ?? venue.open_hour;
      const nextClose = operation.closeHour ?? venue.close_hour;
      if (operation.openHour != null) assertInt("開始時刻", operation.openHour, 0, 23);
      if (operation.closeHour != null) assertInt("終了時刻", operation.closeHour, 1, 24);
      if (nextOpen >= nextClose) throw new Error("営業時間は開始時刻 < 終了時刻にしてください");
      if (operation.openHour != null) addChange(changes, "open_hour", "営業開始時刻", `${venue.open_hour}:00`, `${operation.openHour}:00`);
      if (operation.closeHour != null) addChange(changes, "close_hour", "営業終了時刻", `${venue.close_hour}:00`, `${operation.closeHour}:00`);
      if (operation.minHours != null) {
        assertHalfHour("最低利用時間", operation.minHours);
        addChange(changes, "min_hours", "最低利用時間", venue.min_hours, operation.minHours);
      }
      if (operation.maxHours != null) {
        assertHalfHour("最大利用時間", operation.maxHours);
        addChange(changes, "max_hours", "最大利用時間", venue.max_hours, operation.maxHours);
      }
      const nextMin = operation.minHours ?? venue.min_hours;
      const nextMax = operation.maxHours ?? venue.max_hours;
      if (nextMin > nextMax) throw new Error("最低利用時間は最大利用時間以下にしてください");
      if (operation.active !== undefined) {
        addChange(changes, "active", "公開/受付状態", venue.active ? "公開" : "非公開", operation.active ? "公開" : "非公開");
        if (!operation.active) warnings.push("非公開にすると拠点ページの受付導線が止まります。既存予約は残ります。");
      }
      return {
        operation,
        operationType: operation.type,
        title: `${venue.name}の受付条件を変更`,
        target: venue.name,
        summary: changes.length > 0 ? `${changes.length}項目を変更します` : "変更差分はありません",
        changes,
        warnings,
        safeToApply: changes.length > 0,
      };
    }
    case "create_coupon": {
      const code = operation.code?.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new Error("クーポンコードは英数字・_・- の2〜32文字で指定してください");
      const hasPercent = operation.percentOff != null;
      const hasAmount = operation.amountOff != null;
      if (hasPercent === hasAmount) throw new Error("percentOff または amountOff のどちらか一方を指定してください");
      if (operation.percentOff != null) assertInt("割引率", operation.percentOff, 1, 100);
      if (operation.amountOff != null) assertInt("割引額", operation.amountOff, 1, 200000);
      if (operation.maxUses != null) assertInt("利用上限", operation.maxUses, 1, 100000);
      if (operation.minAmount != null) assertInt("最低利用金額", operation.minAmount, 0, 1000000);
      const venue = operation.venueSlug ? await getVenueBySlug(db, operation.venueSlug) : null;
      const { data: existing, error } = await db.from("coupons").select("id, code, active").ilike("code", code).maybeSingle();
      if (error) throw new Error(`クーポン取得エラー: ${error.message}`);
      if (existing) throw new Error(`同じコードのクーポンが既に存在します: ${code}`);
      const changes: AiChange[] = [
        { field: "code", label: "クーポンコード", before: null, after: code },
        {
          field: hasPercent ? "percent_off" : "amount_off",
          label: hasPercent ? "割引率" : "割引額",
          before: null,
          after: hasPercent ? pct(operation.percentOff!) : yen(operation.amountOff!),
        },
        { field: "venue_id", label: "対象拠点", before: null, after: venue?.name ?? "全拠点" },
        { field: "min_amount", label: "最低利用金額", before: null, after: yen(operation.minAmount ?? 0) },
      ];
      if (operation.maxUses != null) changes.push({ field: "max_uses", label: "利用上限", before: null, after: operation.maxUses });
      if (operation.restrictEmail) changes.push({ field: "restrict_email", label: "対象メール", before: null, after: operation.restrictEmail });
      return {
        operation: { ...operation, code },
        operationType: operation.type,
        title: `クーポン ${code} を作成`,
        target: venue?.name ?? "全拠点",
        summary: `${hasPercent ? pct(operation.percentOff!) : yen(operation.amountOff!)}のクーポンを作成します`,
        changes,
        warnings: ["作成後すぐ利用可能になります。開始日/終了日が必要な場合はstructured operationでstartsAt/endsAtを指定してください。"],
        safeToApply: true,
      };
    }
    case "deactivate_coupon": {
      const code = operation.code?.trim().toUpperCase();
      if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new Error("クーポンコードが不正です");
      const { data, error } = await db.from("coupons").select("*").ilike("code", code).maybeSingle();
      if (error) throw new Error(`クーポン取得エラー: ${error.message}`);
      if (!data) throw new Error(`クーポンが見つかりません: ${code}`);
      const coupon = data as CouponRow;
      const changes: AiChange[] = [];
      addChange(changes, "active", "クーポン状態", coupon.active ? "有効" : "無効", "無効");
      return {
        operation: { ...operation, code },
        operationType: operation.type,
        title: `クーポン ${code} を停止`,
        target: code,
        summary: changes.length > 0 ? "クーポンを無効化します" : "既に無効です",
        changes,
        warnings: ["既に確定済みの予約金額は変更されません。"],
        safeToApply: changes.length > 0,
      };
    }
    default: {
      const neverOp: never = operation;
      throw new Error(`未対応の操作です: ${JSON.stringify(neverOp)}`);
    }
  }
}

function updatePayloadFromChanges(preview: AiOperationPreview): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const change of preview.changes) {
    switch (change.field) {
      case "hourly_price":
        values.hourly_price = (preview.operation as Extract<AiOperation, { type: "update_venue_pricing" }>).weekdayHourlyPrice;
        break;
      case "holiday_hourly_price":
        values.holiday_hourly_price = (preview.operation as Extract<AiOperation, { type: "update_venue_pricing" }>).holidayHourlyPrice;
        break;
      case "last_minute_percent":
        values.last_minute_percent = (preview.operation as Extract<AiOperation, { type: "update_venue_pricing" }>).lastMinutePercent;
        break;
      case "early_bird_percent":
        values.early_bird_percent = (preview.operation as Extract<AiOperation, { type: "update_venue_pricing" }>).earlyBirdPercent;
        break;
      case "early_bird_days":
        values.early_bird_days = (preview.operation as Extract<AiOperation, { type: "update_venue_pricing" }>).earlyBirdDays;
        break;
      case "open_hour":
        values.open_hour = (preview.operation as Extract<AiOperation, { type: "update_venue_booking_rules" }>).openHour;
        break;
      case "close_hour":
        values.close_hour = (preview.operation as Extract<AiOperation, { type: "update_venue_booking_rules" }>).closeHour;
        break;
      case "min_hours":
        values.min_hours = (preview.operation as Extract<AiOperation, { type: "update_venue_booking_rules" }>).minHours;
        break;
      case "max_hours":
        values.max_hours = (preview.operation as Extract<AiOperation, { type: "update_venue_booking_rules" }>).maxHours;
        break;
      case "active":
        values.active = (preview.operation as Extract<AiOperation, { type: "update_venue_booking_rules" }>).active;
        break;
    }
  }
  return values;
}

function sameValue(a: AiChange["before"], b: AiChange["before"]): boolean {
  return a === b;
}

function assertNoDrift(stored: AiOperationPreview, current: AiOperationPreview): void {
  const currentByField = new Map(current.changes.map((c) => [c.field, c]));
  for (const oldChange of stored.changes) {
    const nowChange = currentByField.get(oldChange.field);
    if (!nowChange || !sameValue(oldChange.before, nowChange.before)) {
      throw new Error(`設定がプレビュー後に変更されています。再度プレビューしてください: ${oldChange.label}`);
    }
  }
}

export async function applyOperationPreview(db: Db, storedPreview: AiOperationPreview): Promise<Record<string, unknown>> {
  if (!storedPreview.safeToApply || storedPreview.changes.length === 0) throw new Error("適用できる変更がありません");
  const currentPreview = await buildOperationPreview(db, storedPreview.operation);
  assertNoDrift(storedPreview, currentPreview);

  switch (storedPreview.operation.type) {
    case "update_venue_pricing":
    case "update_venue_booking_rules": {
      const venue = await getVenueBySlug(db, storedPreview.operation.venueSlug);
      const values = updatePayloadFromChanges(storedPreview);
      const { error } = await db.from("venues").update(values).eq("id", venue.id);
      if (error) throw new Error(`拠点更新エラー: ${error.message}`);
      return { venueId: venue.id, venueSlug: venue.slug, updated: values };
    }
    case "create_coupon": {
      const venue = storedPreview.operation.venueSlug ? await getVenueBySlug(db, storedPreview.operation.venueSlug) : null;
      const { data, error } = await db
        .from("coupons")
        .insert({
          code: storedPreview.operation.code.trim().toUpperCase(),
          description: storedPreview.operation.description ?? "AI設定から作成",
          percent_off: storedPreview.operation.percentOff ?? null,
          amount_off: storedPreview.operation.amountOff ?? null,
          venue_id: venue?.id ?? null,
          starts_at: storedPreview.operation.startsAt ?? null,
          ends_at: storedPreview.operation.endsAt ?? null,
          max_uses: storedPreview.operation.maxUses ?? null,
          min_amount: storedPreview.operation.minAmount ?? 0,
          restrict_email: storedPreview.operation.restrictEmail?.toLowerCase() ?? null,
          active: storedPreview.operation.active ?? true,
        })
        .select("id, code")
        .single();
      if (error) throw new Error(`クーポン作成エラー: ${error.message}`);
      return { coupon: data };
    }
    case "deactivate_coupon": {
      const { data, error } = await db
        .from("coupons")
        .update({ active: false })
        .ilike("code", storedPreview.operation.code)
        .select("id, code")
        .single();
      if (error) throw new Error(`クーポン停止エラー: ${error.message}`);
      return { coupon: data };
    }
  }
}
