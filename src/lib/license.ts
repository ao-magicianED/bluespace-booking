/**
 * ライセンス管理（外販対応）
 *
 * このインスタンスが契約しているプランと、追加可能なアップグレードを扱う。
 * DBスキーマは supabase/migrations/0013_license_limits.sql 参照。
 * 設計の詳細は docs/license-upgrade-feature-design.md 参照。
 */
import { getDb } from "./supabase";

/** プラン定義（LPの料金表と完全一致させる） */
export const LICENSE_PLANS = {
  starter_1: { max_venues: 1, price: 55_000, label: "1部屋プラン" },
  starter_2_3: { max_venues: 3, price: 88_000, label: "2-3部屋プラン" },
  starter_4_5: { max_venues: 5, price: 132_000, label: "4-5部屋プラン" },
  starter_6_10: { max_venues: 10, price: 198_000, label: "6-10部屋プラン" },
  starter_11_20: { max_venues: 20, price: 297_000, label: "11-20部屋プラン" },
  internal: { max_venues: 999, price: 0, label: "内部利用（無制限）" },
} as const;

export type PlanName = keyof typeof LICENSE_PLANS;

const PLAN_ORDER: PlanName[] = [
  "starter_1",
  "starter_2_3",
  "starter_4_5",
  "starter_6_10",
  "starter_11_20",
];

export interface LicenseStatus {
  max_venues: number;
  used: number;
  remaining: number;
  plan_name: string;
  plan_label: string;
}

export interface UpgradeOption {
  to_plan: PlanName;
  to_label: string;
  to_max_venues: number;
  price_diff: number;
}

/** 現在のライセンス状況を取得（Supabase RPC: get_license_status） */
export async function getLicenseStatus(): Promise<LicenseStatus> {
  const db = getDb();
  const { data, error } = await db.rpc("get_license_status");
  if (error) {
    throw new Error(`get_license_status failed: ${error.message}`);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new Error("license_limits 行が存在しません。migration 0013 を適用してください");
  }
  const planName = row.plan_name as string;
  const planMeta = (LICENSE_PLANS as Record<string, { label: string }>)[planName];
  return {
    max_venues: Number(row.max_venues),
    used: Number(row.used),
    remaining: Number(row.remaining),
    plan_name: planName,
    plan_label: planMeta?.label ?? planName,
  };
}

/** 現プランからアップグレード可能なプラン一覧と差額を返す */
export function getUpgradeOptions(currentMaxVenues: number): UpgradeOption[] {
  const currentPlan = PLAN_ORDER.find(
    (k) => LICENSE_PLANS[k].max_venues === currentMaxVenues,
  );
  const currentPrice = currentPlan ? LICENSE_PLANS[currentPlan].price : 0;
  return PLAN_ORDER
    .filter((k) => LICENSE_PLANS[k].max_venues > currentMaxVenues)
    .map((k) => ({
      to_plan: k,
      to_label: LICENSE_PLANS[k].label,
      to_max_venues: LICENSE_PLANS[k].max_venues,
      price_diff: LICENSE_PLANS[k].price - currentPrice,
    }));
}

/** 部屋数から最適なプラン名を返す（営業見積もり用） */
export function planForRooms(rooms: number): PlanName | null {
  for (const k of PLAN_ORDER) {
    if (rooms <= LICENSE_PLANS[k].max_venues) return k;
  }
  return null; // 20部屋超は要相談
}
