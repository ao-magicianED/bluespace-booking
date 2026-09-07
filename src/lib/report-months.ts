/**
 * note月次レポートの転記対象にできる月だけを選ぶ。
 *
 * 予約データには先々の予約(継続利用など)が confirmed で入っているため、
 * 単純に「直近6ヶ月」を取ると未来月が枠を食い潰し、書きたい月が表から消える。
 * 当月も集計途中なので対象外にする。
 */
export function pickClosedMonths(months: Iterable<string>, currentMonth: string, limit = 6): string[] {
  return [...new Set(months)]
    .filter((m) => m < currentMonth)
    .sort()
    .slice(-limit);
}
