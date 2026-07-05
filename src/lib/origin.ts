// Request gating shared by all API routes (Phase 0 rules):
// only the two deployed apps and localhost may call the APIs.

const ALLOWED_ORIGINS = [
    'https://project-aibo.vercel.app',
    'https://solar-punk-five.vercel.app',
];

export function isAllowedOrigin(req: Request): boolean {
    const raw = req.headers.get('origin') ?? req.headers.get('referer');
    if (!raw) return false;
    try {
        const { origin, hostname } = new URL(raw);
        if (ALLOWED_ORIGINS.includes(origin)) return true;
        return hostname === 'localhost' || hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

export function clientIp(req: Request): string {
    return (
        req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        req.headers.get('x-real-ip') ||
        'unknown'
    );
}
