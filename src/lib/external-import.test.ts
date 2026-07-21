import { describe, expect, it } from "vitest";
import {
  matchVenueSlug,
  parseCsv,
  parseInstabaseCsv,
  parseSpaceMarketCsv,
  parseUpnowCsv,
} from "./external-import";

describe("parseCsv", () => {
  it("引用符内のカンマ・改行・二重引用符エスケープを正しく扱う", () => {
    const text = 'a,"b,b","c""c"\n1,"line1\nline2",3\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b,b", 'c"c'],
      ["1", "line1\nline2", "3"],
    ]);
  });
});

describe("matchVenueSlug", () => {
  it("拠点名から一意にslugを判定する", () => {
    expect(matchVenueSlug("ブルースペース神田（貸スペース）")).toBe("kanda");
    expect(matchVenueSlug("ブルースペース上野御徒町")).toBe("ueno-okachimachi");
    expect(matchVenueSlug("ブルースペース西新宿403")).toBe("nishi-shinjuku");
    expect(matchVenueSlug("ブルースペース白金高輪")).toBe("shirokane-takanawa");
    expect(matchVenueSlug("レンタルスペース・貸し会議室「ブルースペース京成小岩」")).toBe("keisei-koiwa");
  });

  it("4A/4Bどちらか片方だけを含む文字列があれば確定する（施設名だけでは特定できないケース）", () => {
    // スペース名（優先）に "4A" のみ含まれる → 施設名が両方含んでいても4Aで確定
    expect(matchVenueSlug("4A(401) 貸し会議室", "ブルースペース上野駅前4A&4B(2部屋あり）")).toBe("ueno-4a");
    expect(matchVenueSlug("4B(402) 撮影スタジオ", "ブルースペース上野駅前4A&4B(2部屋あり）")).toBe("ueno-4b");
  });

  it("4A・4Bを両方含む文字列しかない（部屋を特定できない）場合はnull", () => {
    expect(matchVenueSlug("ブルースペース上野駅前4A&4B(2部屋あり）")).toBeNull();
  });

  it("マッチしなければnull", () => {
    expect(matchVenueSlug("どこか知らないスペース")).toBeNull();
  });
});

describe("parseInstabaseCsv", () => {
  const header =
    '"予約ID","施設名","スペース名","ステータス","決済方法","決済状況","予約者ID","予約者会社名・屋号","予約者名","利用用途","用途詳細","利用人数","申込日時","利用開始日時","利用終了日時","利用時間 (時間)","予約金額 (税込)","支払金額 (税込)"';

  it("確定行を正しく正規化する（拠点マッチ・時刻からhours算出）", () => {
    const row =
      '"3467305703","ブルースペース神田（貸スペース）","レンタルスペース・ダンススタジオ","予約確定","クレジットカード","支払い済み","9591269337","株式会社　ナリス化粧品","上中 穂","美容レッスン","ネイルレッスンの開催","10","2026-06-30 10:28","2026-12-01 09:00","2026-12-01 17:00","8","11128","7233"';
    const [rec] = parseInstabaseCsv(`﻿${header}\n${row}\n`);
    expect(rec.channel).toBe("instabase");
    expect(rec.externalBookingId).toBe("3467305703");
    expect(rec.venueSlug).toBe("kanda");
    expect(rec.status).toBe("confirmed");
    expect(rec.bookedAt).toBe("2026-06-30");
    expect(rec.hours).toBeCloseTo(8, 5);
    expect(rec.grossAmount).toBe(11128);
    expect(rec.netAmount).toBe(7233);
  });

  it("キャンセル・ID空欄の行を正しく扱う", () => {
    const cancelRow =
      '"111","ブルースペース神田","レンタルスペース","利用者キャンセル","","","","","","","","1","2026-01-01 10:00","2026-01-02 09:00","2026-01-02 10:00","1","1000","0"';
    const emptyIdRow = ',,,,,,,,,,,,,,,,,';
    const recs = parseInstabaseCsv(`﻿${header}\n${cancelRow}\n${emptyIdRow}\n`);
    expect(recs).toHaveLength(1);
    expect(recs[0].status).toBe("cancelled");
  });

  it("想定外のヘッダーだとエラーを投げる（モールのCSVフォーマット変更検知）", () => {
    expect(() => parseInstabaseCsv("a,b,c\n1,2,3\n")).toThrow(/予約ID/);
  });
});

describe("parseSpaceMarketCsv", () => {
  const junkHeader = "リンク,並び替え,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,,18,19";
  const header =
    "予約ID,予約リクエスト日,成約日,実施日,振込予定日,成約金額,振込予定金額,シェア設定,お支払い方法,施設名,スペース名,プラン名,ゲスト名,利用目的,手数料,予約月,利用月,ステータス,スペース名,";

  it("1行目のゴミヘッダーを飛ばし、末尾の正規化済みスペース名列を優先して拠点マッチする", () => {
    const row =
      "525967,2019/9/30,2019/9/30,2019/10/7,2019/10/21,¥111,¥78,30%,クレジットカード,※神田東口徒歩1分「ブルースペース神田」,※神田東口徒歩1分「ブルースペース神田」,平日OPENセール,青羽 修二,会議,¥33,201909,201910,成約,ブルースペース神田,";
    const [rec] = parseSpaceMarketCsv(`${junkHeader}\n${header}\n${row}\n`);
    expect(rec.channel).toBe("spacemarket");
    expect(rec.venueSlug).toBe("kanda");
    expect(rec.status).toBe("confirmed");
    expect(rec.grossAmount).toBe(111);
    expect(rec.netAmount).toBe(78);
    expect(rec.hours).toBeNull(); // スペースマーケットのCSVには時刻情報がない
  });

  it("ID空欄・列不足のCL行（キャンセルの手入力ゴミ行）をスキップする", () => {
    const junkRow = "||||";
    const recs = parseSpaceMarketCsv(`${junkHeader}\n${header}\n${junkRow}\n`);
    expect(recs).toHaveLength(0);
  });
});

describe("parseUpnowCsv", () => {
  const header =
    "予約ID,予約リクエスト日,予約成立日,利用開始日,開始時間,利用終了日,終了時間,利用時間,予約金額,クーポン,内訳）スペース料,内訳）オプション料,内訳）維持管理費,内訳）消費税,ステータス,振込予定日,支払い方法,スペース名,プラン名,オプション,利用者種別,会社名,ゲスト名,利用目的,利用目的詳細,スペースID,クーポンコード,クーポン名";

  it("開始日時・終了日時からhoursを算出し、拠点・クーポンを正規化する", () => {
    const row =
      '4639531291,2026/7/11,2026/7/11,2026/8/10,12:00,2026/8/10,19:30,7.5時間,12300,3320,14100,0,100,1420,予約確定,2026年9月末,クレジットカード,ブルースペース上野御徒町（御徒町駅徒歩3分）,【平日】直サイトセール,なし,法人,"売上ライズ ラボラトリー",渡邉　夕起子,セミナー・研修,セミナー,1501,WNSY1211,渡辺様専用特別割引';
    const [rec] = parseUpnowCsv(`${header}\n${row}\n`);
    expect(rec.channel).toBe("upnow");
    expect(rec.venueSlug).toBe("ueno-okachimachi");
    expect(rec.status).toBe("confirmed");
    expect(rec.grossAmount).toBe(12300);
    expect(rec.couponAmount).toBe(3320);
    expect(rec.hours).toBeCloseTo(7.5, 5);
    expect(rec.netAmount).toBeNull(); // UPNOWのCSVには手取り列がない
    expect(rec.planName).toBe("【平日】直サイトセール");
  });
});
