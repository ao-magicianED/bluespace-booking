import { describe, expect, it } from "vitest";
import { isBookingOwner } from "./booking-access";

const memberBooking = { user_id: "user-1", customer_email: "member@example.com" };
const guestBooking = { user_id: null, customer_email: "guest@example.com" };

describe("isBookingOwner 会員予約（user_id あり）", () => {
  it("本人（user_id一致）は操作できる", () => {
    expect(isBookingOwner(memberBooking, { id: "user-1", email: "member@example.com" })).toBe(true);
  });

  it("user_idが一致すれば連絡先メールが違っても操作できる", () => {
    expect(isBookingOwner(memberBooking, { id: "user-1", email: "other@example.com" })).toBe(true);
  });

  it("別アカウントは連絡先メールが一致しても操作できない（emailフォールバック禁止）", () => {
    expect(isBookingOwner(memberBooking, { id: "attacker", email: "member@example.com" })).toBe(
      false
    );
  });
});

describe("isBookingOwner ゲスト予約（user_id なし）", () => {
  it("認証済みメールが一致すれば操作できる", () => {
    expect(isBookingOwner(guestBooking, { id: "user-2", email: "guest@example.com" })).toBe(true);
  });

  it("メール不一致は操作できない", () => {
    expect(isBookingOwner(guestBooking, { id: "user-2", email: "other@example.com" })).toBe(false);
  });

  it("大文字小文字・前後空白の表記ゆれは同一メールとみなす", () => {
    const booking = { user_id: null, customer_email: "Guest@Example.com " };
    expect(isBookingOwner(booking, { id: "user-2", email: "guest@example.com" })).toBe(true);
  });

  it("メール未設定のユーザーは操作できない", () => {
    expect(isBookingOwner(guestBooking, { id: "user-2" })).toBe(false);
    expect(isBookingOwner(guestBooking, { id: "user-2", email: null })).toBe(false);
  });
});
