import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import ReceiptClient from "@/components/ReceiptClient";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const db = getDb();
  const { data: booking } = await db.from("bookings").select("*").eq("id", id).maybeSingle<Booking>();
  if (!booking) notFound();
  if (booking.user_id !== user.id && booking.customer_email !== user.email) notFound();
  if (booking.booking_status !== "confirmed" || booking.payment_status !== "paid") notFound();

  const { data: venue } = await db
    .from("venues")
    .select("name")
    .eq("id", booking.venue_id)
    .single<Pick<Venue, "name">>();

  return (
    <ReceiptClient
      bookingId={booking.id}
      shortId={booking.id.replace(/-/g, "").slice(-8).toUpperCase()}
      amount={booking.total_amount}
      period={formatBookingPeriod(booking)}
      venueName={venue?.name ?? ""}
      defaultName={booking.receipt_name ?? booking.company_name ?? booking.customer_name}
      reissue={Boolean(booking.receipt_first_issued_at)}
      nameChangeUsed={Boolean(booking.receipt_name_changed_at)}
      paymentMethod={booking.payment_method}
      registrationNumber={process.env.INVOICE_REGISTRATION_NUMBER ?? ""}
    />
  );
}
