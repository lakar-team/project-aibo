import { Redis } from '@upstash/redis';

// Sleeping memory + self-amending goals (Phase 7) — Kip's ARCHITECTURE § 6
// adapted to Upstash. Same graceful no-op pattern as ratelimit/budget: no KV
// env vars → every function quietly does nothing.
//
// Per-visitor schema:
//   aibo:mem:{id}:digest   string — consolidated memory, ≤2000-token budget
//   aibo:mem:{id}:journal  list   — raw `memorable` lines since last sleep
//   aibo:mem:{id}:meta     json   — { name?, lang?, owner?, lastVisit, dream? }
//   aibo:goals:{id}        list   — self-amended behavioral directives
//   aibo:owners            set    — visitor ids flagged as Adam (cron targets)
//
// Owners persist forever; ordinary visitors expire 30 days after last touch.

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

export const memoryConfigured = redis !== null;

const VISITOR_TTL_SECONDS = 30 * 24 * 3600;
const GOALS_HARD_CAP = 20; // live cap; sleep consolidation prunes to ≤10

const kDigest = (id: string) => `aibo:mem:${id}:digest`;
const kJournal = (id: string) => `aibo:mem:${id}:journal`;
const kMeta = (id: string) => `aibo:mem:${id}:meta`;
const kGoals = (id: string) => `aibo:goals:${id}`;
const OWNERS_SET = 'aibo:owners';

export interface VisitorMeta {
    name?: string;
    lang?: string;
    owner?: boolean;
    lastVisit?: number;
    lastSleep?: number;
    dream?: string;
}

export interface VisitorMemory {
    digest: string;
    meta: VisitorMeta;
    goals: string[];
    journalLen: number;
}

const EMPTY: VisitorMemory = { digest: '', meta: {}, goals: [], journalLen: 0 };

export function validVisitorId(id: unknown): string | null {
    if (typeof id !== 'string') return null;
    const t = id.trim();
    return /^[a-zA-Z0-9_-]{8,64}$/.test(t) ? t : null;
}

export async function loadVisitorMemory(id: string): Promise<VisitorMemory> {
    if (!redis) return EMPTY;
    try {
        const [digest, meta, goals, journalLen] = await Promise.all([
            redis.get<string>(kDigest(id)),
            redis.get<VisitorMeta>(kMeta(id)),
            redis.lrange<string>(kGoals(id), 0, -1),
            redis.llen(kJournal(id)),
        ]);
        return {
            digest: typeof digest === 'string' ? digest : '',
            meta: meta && typeof meta === 'object' ? meta : {},
            goals: Array.isArray(goals) ? goals.filter(g => typeof g === 'string') : [],
            journalLen: journalLen ?? 0,
        };
    } catch (err) {
        console.warn('[memory] load failed:', err);
        return EMPTY;
    }
}

async function refreshTtls(id: string, isOwner: boolean): Promise<void> {
    if (!redis) return;
    const keys = [kDigest(id), kJournal(id), kMeta(id), kGoals(id)];
    await Promise.all(
        keys.map(k => (isOwner ? redis.persist(k) : redis.expire(k, VISITOR_TTL_SECONDS)))
    );
}

/** Post-reply bookkeeping: meta touch, journal append, live goal append, TTLs. */
export async function persistAfterReply(
    id: string,
    updates: { memorable?: string | null; goal?: string | null; lang?: string; claimOwner?: boolean }
): Promise<void> {
    if (!redis) return;
    try {
        const meta = ((await redis.get<VisitorMeta>(kMeta(id))) ?? {}) as VisitorMeta;
        meta.lastVisit = Date.now();
        if (updates.lang) meta.lang = updates.lang;
        if (updates.claimOwner) meta.owner = true;

        const ops: Promise<unknown>[] = [redis.set(kMeta(id), meta)];
        if (updates.memorable) ops.push(redis.rpush(kJournal(id), updates.memorable));
        if (updates.goal) {
            ops.push(
                redis.rpush(kGoals(id), updates.goal).then(() => redis!.ltrim(kGoals(id), -GOALS_HARD_CAP, -1))
            );
        }
        if (updates.claimOwner) ops.push(redis.sadd(OWNERS_SET, id));
        await Promise.all(ops);
        await refreshTtls(id, meta.owner === true);
    } catch (err) {
        console.warn('[memory] persist failed:', err);
    }
}

// ---- Sleep consolidation I/O (/api/sleep) ----

export async function readForSleep(
    id: string
): Promise<{ digest: string; journal: string[]; goals: string[]; meta: VisitorMeta } | null> {
    if (!redis) return null;
    try {
        const [digest, journal, goals, meta] = await Promise.all([
            redis.get<string>(kDigest(id)),
            redis.lrange<string>(kJournal(id), 0, -1),
            redis.lrange<string>(kGoals(id), 0, -1),
            redis.get<VisitorMeta>(kMeta(id)),
        ]);
        return {
            digest: typeof digest === 'string' ? digest : '',
            journal: Array.isArray(journal) ? journal.filter(l => typeof l === 'string') : [],
            goals: Array.isArray(goals) ? goals.filter(g => typeof g === 'string') : [],
            meta: meta && typeof meta === 'object' ? meta : {},
        };
    } catch (err) {
        console.warn('[memory] readForSleep failed:', err);
        return null;
    }
}

export async function writeSleepResult(
    id: string,
    result: { digest: string; dream: string; goals: string[] }
): Promise<void> {
    if (!redis) return;
    const meta = ((await redis.get<VisitorMeta>(kMeta(id))) ?? {}) as VisitorMeta;
    meta.dream = result.dream;
    meta.lastSleep = Date.now();

    await Promise.all([
        redis.set(kDigest(id), result.digest),
        redis.del(kJournal(id)),
        redis.set(kMeta(id), meta),
        redis.del(kGoals(id)).then(async () => {
            if (result.goals.length) await redis!.rpush(kGoals(id), ...result.goals);
        }),
    ]);
    await refreshTtls(id, meta.owner === true);
}

export async function listOwners(): Promise<string[]> {
    if (!redis) return [];
    try {
        const ids = await redis.smembers<string[]>(OWNERS_SET);
        return Array.isArray(ids) ? ids : [];
    } catch {
        return [];
    }
}
