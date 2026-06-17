/**
 * 簡易レートリミット（インメモリ・ベストエフォート）。
 * サーバーレスではインスタンスごとに別カウントになるため完全ではないが、
 * 本命のガードはDB側（同一メールのpending上限2件）にある。
 */

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit = 10, windowMs = 5 * 60 * 1000): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count++;
  return bucket.count <= limit;
}
