import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getLicenseStatus, getUpgradeOptions } from "@/lib/license";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const status = await getLicenseStatus();
    const upgrades = getUpgradeOptions(status.max_venues);
    return NextResponse.json({
      ...status,
      available_upgrades: upgrades,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
