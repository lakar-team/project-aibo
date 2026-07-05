import { Redis } from '@upstash/redis';

// Budget logging — every brain call goes to Upstash so /api/stats can show
// spend per tier and caps can downgrade. Same graceful no-op pattern as
// ratelimit.ts: if the KV env vars are missing, everything silently passes.

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const kvConfigured = redis !== null;

// 0 is a valid cap ("never use tier 3") — only fall back to the default
// when the env var is missing or unparsable.
const rawCap = Number(process.env.BUDGET_TIER3_PER_DAY);
export const TIER3_DAILY_CAP = Number.isFinite(rawCap) && rawCap >= 0 ? rawCap : 20;

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

export interface CallLog {
    tier: number;
    model: string;
    provider: string;
    in_tokens_est: number;
    out_tokens_est: number;
    reason?: string;
}

export async function logCall(entry: CallLog): Promise<void> {
    if (!redis) return;
    try {
        await Promise.all([
            redis.lpush('aibo:calls', JSON.stringify({ ts: Date.now(), ...entry })),
            redis.incr(`aibo:budget:${today()}:tier${entry.tier}`),
        ]);
        // Keep the raw call log bounded.
        await redis.ltrim('aibo:calls', 0, 999);
    } catch (err) {
        console.warn('[budget] log failed:', err);
    }
}

export async function tierCountToday(tier: number): Promise<number> {
    if (!redis) return 0;
    try {
        return Number(await redis.get(`aibo:budget:${today()}:tier${tier}`)) || 0;
    } catch {
        return 0; // Redis unreachable — fail open, don't block replies.
    }
}

export async function todayCounts(): Promise<{ date: string; tiers: Record<string, number> }> {
    const date = today();
    const tiers: Record<string, number> = { tier0: 0, tier1: 0, tier2: 0, tier3: 0 };
    if (redis) {
        try {
            const keys = [0, 1, 2, 3].map(t => `aibo:budget:${date}:tier${t}`);
            const vals = await redis.mget<(string | number | null)[]>(...keys);
            [0, 1, 2, 3].forEach(t => { tiers[`tier${t}`] = Number(vals[t]) || 0; });
        } catch (err) {
            console.warn('[budget] read failed:', err);
        }
    }
    return { date, tiers };
}
