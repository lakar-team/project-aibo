import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// Sliding window: 20 requests per minute per IP.
// If the Upstash KV env vars are missing (local dev, or production before
// the Vercel/Upstash integration is wired up), rate limiting no-ops so the
// app keeps working.
const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;

const limiter =
    url && token
        ? new Ratelimit({
              redis: new Redis({ url, token }),
              limiter: Ratelimit.slidingWindow(20, '1 m'),
              prefix: 'aibo:rl',
          })
        : null;

export async function checkRateLimit(ip: string): Promise<{ success: boolean }> {
    if (!limiter) return { success: true };
    try {
        const { success } = await limiter.limit(ip);
        return { success };
    } catch (err) {
        // Redis unreachable — fail open rather than taking the companion down.
        console.warn('[ratelimit] check failed, allowing request:', err);
        return { success: true };
    }
}
