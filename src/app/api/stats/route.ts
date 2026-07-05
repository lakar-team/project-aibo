import { todayCounts, kvConfigured, TIER3_DAILY_CAP } from '@/lib/budget';

export const runtime = 'edge';

// Owner-only budget stats: today's brain calls per tier.
// Auth: x-owner-key header (or ?key=) must match the OWNER_KEY env var.
export async function GET(req: Request): Promise<Response> {
    const ownerKey = process.env.OWNER_KEY;
    if (!ownerKey) {
        return new Response(JSON.stringify({ error: 'OWNER_KEY not configured' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const provided =
        req.headers.get('x-owner-key') ?? new URL(req.url).searchParams.get('key');
    if (provided !== ownerKey) {
        return new Response(JSON.stringify({ error: 'Forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { date, tiers } = await todayCounts();
    return new Response(
        JSON.stringify({ date, tiers, tier3Cap: TIER3_DAILY_CAP, kvConfigured }),
        { headers: { 'Content-Type': 'application/json' } }
    );
}
