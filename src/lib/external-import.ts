import { jstToUtc } from "./slots";

/**
 * 外部モール（インスタベース・スペースマーケット・UPNOW）のCSVを正規化する（STEP 0）。
 * 2026-07-19の価格最適化分析で実データ突合済みのロジックをリポジトリに移植したもの。
 * このファイルは純粋関数のみ（DBアクセスなし）。取込・保存は external-import API ルート側で行う。
 */

export type ExternalChannel = "instabase" | "spacemarket" | "upnow";
export type ExternalBookingStatus = "confirmed" | "cancelled" | "other";

export type ExternalBookingRecord = {
  channel: ExternalChannel;
  externalBookingId: string;
  /** 拠点マッチングの結果（マッチしなければnull。rawVenueNameで後から追える） */
  venueSlug: string | null;
  rawVenueName: string;
  status: ExternalBookingStatus;
  /** JSTの日付 'YYYY-MM-DD'（申込日・リクエスト日） */
  bookedAt: string | null;
  /** UTC ISO文字列（利用開始） */
  startAt: string | null;
  /** UTC ISO文字列（利用終了） */
  endAt: string | null;
  hours: number | null;
  grossAmount: number;
  netAmount: number | null;
  couponAmount: number;
  planName: string | null;
  purpose: string | null;
};

// ---------- CSVパーサー（RFC4180準拠。引用符内カンマ・改行・""エスケープに対応） ----------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function toYen(s: string | undefined): number {
  if (s == null) return 0;
  const n = Number(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toYenOrNull(s: string | undefined): number | null {
  if (s == null || s.trim() === "") return null;
  const n = toYen(s);
  return Number.isFinite(n) ? n : null;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "2026/7/11" 等 → "2026-07-11"（不正なら null） */
function parseDateStr(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
}

/** "10:28" 等 → 小数時（10.466...）。省略時は0時 */
function timeStrToHour(s: string | undefined): number {
  if (!s) return 0;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** JSTの日付+時刻文字列からUTCのISO文字列を作る */
function toUtcIso(dateStr: string | null, timeStr: string | undefined): string | null {
  if (!dateStr) return null;
  return jstToUtc(dateStr, timeStrToHour(timeStr)).toISOString();
}

/** "2026-06-30 10:28" のような日時一体型文字列を分解してUTC ISOに変換 */
function parseFullDateTimeToUtcIso(s: string | undefined): { iso: string | null; dateStr: string | null } {
  if (!s) return { iso: null, dateStr: null };
  const m = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m) return { iso: null, dateStr: null };
  const dateStr = `${m[1]}-${m[2]}-${m[3]}`;
  return { iso: jstToUtc(dateStr, Number(m[4]) + Number(m[5]) / 60).toISOString(), dateStr };
}

function hoursBetween(startIso: string | null, endIso: string | null): number | null {
  if (!startIso || !endIso) return null;
  const h = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3_600_000;
  return h > 0 ? h : null;
}

/**
 * 拠点名の文字列群（優先順位順）から拠点slugを判定する。
 * 「上野駅前4A&4B」のように施設名だけでは部屋を特定できないCSVがあるため、
 * スペース名（部屋名）を先に渡し、4A/4Bどちらか片方だけを含む文字列が見つかった時点で確定する。
 * このマッピングは2026-07-19の実データ突合で検証済み（7拠点・7,366件の確定件数が元CSVと一致）。
 */
export function matchVenueSlug(...candidates: (string | null | undefined)[]): string | null {
  for (const raw of candidates) {
    if (!raw) continue;
    if (raw.includes("神田")) return "kanda";
    if (raw.includes("御徒町")) return "ueno-okachimachi";
    if (raw.includes("西新宿")) return "nishi-shinjuku";
    if (raw.includes("白金高輪")) return "shirokane-takanawa";
    if (raw.includes("京成小岩")) return "keisei-koiwa";
    const hasA = raw.includes("4A");
    const hasB = raw.includes("4B");
    if (hasA && !hasB) return "ueno-4a";
    if (hasB && !hasA) return "ueno-4b";
  }
  return null;
}

function headerIndex(header: string[], name: string, channel: string): number {
  const i = header.indexOf(name);
  if (i === -1) {
    throw new Error(`${channel}のCSVに想定した列「${name}」が見つかりません（フォーマット変更の可能性）`);
  }
  return i;
}

// ---------- インスタベース ----------
export function parseInstabaseCsv(text: string): ExternalBookingRecord[] {
  const rows = parseCsv(stripBom(text));
  if (rows.length === 0) return [];
  const header = rows[0];
  const iId = headerIndex(header, "予約ID", "インスタベース");
  const iFac = headerIndex(header, "施設名", "インスタベース");
  const iSp = headerIndex(header, "スペース名", "インスタベース");
  const iSt = headerIndex(header, "ステータス", "インスタベース");
  const iApply = headerIndex(header, "申込日時", "インスタベース");
  const iStart = headerIndex(header, "利用開始日時", "インスタベース");
  const iEnd = headerIndex(header, "利用終了日時", "インスタベース");
  const iGross = headerIndex(header, "予約金額 (税込)", "インスタベース");
  const iNet = headerIndex(header, "支払金額 (税込)", "インスタベース");
  const iPurpose = header.indexOf("利用用途");

  const out: ExternalBookingRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = row[iId]?.trim();
    if (!id) continue; // ID空欄の行はゴミ行（過去の手入力ミス等）としてスキップ
    const stRaw = row[iSt] ?? "";
    const status: ExternalBookingStatus =
      stRaw === "予約確定" ? "confirmed" : stRaw.includes("キャンセル") ? "cancelled" : "other";
    const start = parseFullDateTimeToUtcIso(row[iStart]);
    const end = parseFullDateTimeToUtcIso(row[iEnd]);
    const apply = parseFullDateTimeToUtcIso(row[iApply]);

    out.push({
      channel: "instabase",
      externalBookingId: id,
      venueSlug: matchVenueSlug(row[iSp], row[iFac]),
      rawVenueName: row[iFac] || row[iSp] || "",
      status,
      bookedAt: apply.dateStr,
      startAt: start.iso,
      endAt: end.iso,
      hours: hoursBetween(start.iso, end.iso),
      grossAmount: toYen(row[iGross]),
      netAmount: toYenOrNull(row[iNet]),
      couponAmount: 0,
      planName: null,
      purpose: iPurpose >= 0 ? row[iPurpose] || null : null,
    });
  }
  return out;
}

// ---------- スペースマーケット（1行目はゴミヘッダー、2行目が本ヘッダー） ----------
export function parseSpaceMarketCsv(text: string): ExternalBookingRecord[] {
  const rows = parseCsv(stripBom(text));
  if (rows.length < 2) return [];
  const header = rows[1];
  const iReq = headerIndex(header, "予約リクエスト日", "スペースマーケット");
  const iUse = headerIndex(header, "実施日", "スペースマーケット");
  const iGross = headerIndex(header, "成約金額", "スペースマーケット");
  const iNet = headerIndex(header, "振込予定金額", "スペースマーケット");
  const iSt = headerIndex(header, "ステータス", "スペースマーケット");
  const iFac = headerIndex(header, "施設名", "スペースマーケット");
  // 末尾に正規化済みの「スペース名」列があるためそちらを優先して使う
  const iNorm = header.lastIndexOf("スペース名");

  const out: ExternalBookingRecord[] = [];
  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    const id = row[0]?.trim();
    if (!id || row.length < 10) continue; // ID空欄・列不足のゴミ行をスキップ（CLのみ手入力行など）
    const stRaw = row[iSt] ?? "";
    const status: ExternalBookingStatus = stRaw === "成約" ? "confirmed" : stRaw === "CL" ? "cancelled" : "other";
    const useDate = parseDateStr(row[iUse]);

    out.push({
      channel: "spacemarket",
      externalBookingId: id,
      venueSlug: matchVenueSlug(iNorm >= 0 ? row[iNorm] : undefined, row[iFac]),
      rawVenueName: row[iFac] || "",
      status,
      bookedAt: parseDateStr(row[iReq]),
      // スペースマーケットのCSVには時刻情報がないため終日不明のまま日付のみ保持する
      startAt: useDate ? jstToUtc(useDate, 0).toISOString() : null,
      endAt: null,
      hours: null,
      grossAmount: toYen(row[iGross]),
      netAmount: toYenOrNull(row[iNet]),
      couponAmount: 0,
      planName: null,
      purpose: null,
    });
  }
  return out;
}

// ---------- UPNOW ----------
export function parseUpnowCsv(text: string): ExternalBookingRecord[] {
  const rows = parseCsv(stripBom(text));
  if (rows.length === 0) return [];
  const header = rows[0];
  const iId = headerIndex(header, "予約ID", "UPNOW");
  const iReq = headerIndex(header, "予約リクエスト日", "UPNOW");
  const iSd = headerIndex(header, "利用開始日", "UPNOW");
  const iStm = headerIndex(header, "開始時間", "UPNOW");
  const iEd = headerIndex(header, "利用終了日", "UPNOW");
  const iEtm = headerIndex(header, "終了時間", "UPNOW");
  const iGross = headerIndex(header, "予約金額", "UPNOW");
  const iCoupon = header.indexOf("クーポン");
  const iSt = headerIndex(header, "ステータス", "UPNOW");
  const iSp = headerIndex(header, "スペース名", "UPNOW");
  const iPlan = header.indexOf("プラン名");
  const iPurpose = header.indexOf("利用目的");

  const out: ExternalBookingRecord[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const id = row[iId]?.trim();
    if (!id) continue;
    const stRaw = row[iSt] ?? "";
    const status: ExternalBookingStatus =
      stRaw === "予約確定" ? "confirmed" : stRaw.includes("キャンセル") ? "cancelled" : "other";
    const startDate = parseDateStr(row[iSd]);
    const endDate = parseDateStr(row[iEd]);
    const startIso = toUtcIso(startDate, row[iStm]);
    const endIso = toUtcIso(endDate, row[iEtm]);

    out.push({
      channel: "upnow",
      externalBookingId: id,
      venueSlug: matchVenueSlug(row[iSp]),
      rawVenueName: row[iSp] || "",
      status,
      bookedAt: parseDateStr(row[iReq]),
      startAt: startIso,
      endAt: endIso,
      hours: hoursBetween(startIso, endIso),
      grossAmount: toYen(row[iGross]),
      netAmount: null, // UPNOWのCSVには手取り列がない（手数料は別途調査値: サイト2.98%+決済3.5%+99円/件）
      couponAmount: iCoupon >= 0 ? toYen(row[iCoupon]) : 0,
      planName: iPlan >= 0 ? row[iPlan] || null : null,
      purpose: iPurpose >= 0 ? row[iPurpose] || null : null,
    });
  }
  return out;
}

export function parseExternalCsv(channel: ExternalChannel, text: string): ExternalBookingRecord[] {
  switch (channel) {
    case "instabase":
      return parseInstabaseCsv(text);
    case "spacemarket":
      return parseSpaceMarketCsv(text);
    case "upnow":
      return parseUpnowCsv(text);
  }
}
