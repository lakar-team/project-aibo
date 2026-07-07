import { checkRateLimit } from '@/lib/ratelimit';
import { isAllowedOrigin, clientIp } from '@/lib/origin';
import { validVisitorId, readForSleep, writeSleepResult, listOwners, memoryConfigured } from '@/lib/memory';
import { GEMINI_SMALL_MODELS } from '@/lib/router';

export const runtime = 'edge';

// Sleep consolidation (Phase 7, Kip § 6): a tier-1 model reads the visitor's
// journal + old digest + goals, rewrites the digest (merge/dedupe/prune),
// consolidates goals (dedupe, conflicts → newer wins, ≤10), clears the
// journal, and stores a one-line "dream".
//
// Triggers: "goodnight" reflex (client calls here), sendBeacon on tab-hide
// when the journal is dirty, and the Vercel cron (0 15 * * * = 24:00 JST)
// hitting /api/sleep?all=owner with the CRON_SECRET bearer token.

const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

// Non-streaming tier-1 completion: Gemini small first, OpenRouter free after.
async function completeText(prompt: string): Promise<string | null> {
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (geminiKey) {
        for (const model of GEMINI_SMALL_MODELS) {
            try {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{ role: 'user', parts: [{ text: prompt }] }],
                            generationConfig: { maxOutputTokens: 1200, temperature: 0.4 },
                        }),
                    }
                );
                const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
                const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) return text;
            } catch { /* next model */ }
        }
    }

    const orKey = process.env.OPENROUTER_API_KEY;
    if (orKey) {
        const MODELS = [
            'google/gemini-2.0-flash-exp:free',
            'meta-llama/llama-3.3-70b-instruct:free',
            'deepseek/deepseek-chat-v3-0324:free',
            'openrouter/auto',
        ];
        for (const model of MODELS) {
            try {
                const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${orKey}`,
                        'HTTP-Referer': 'https://project-aibo.vercel.app',
                        'X-Title': 'Project AIBO — Web Witch (sleep)',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }] }),
                });
                const data = await res.json() as { choices?: { message?: { content?: string } }[] };
                const text = data.choices?.[0]?.message?.content;
                if (text) return text;
            } catch { /* next model */ }
        }
    }
    return null;
}

function consolidationPrompt(digest: string, journal: string[], goals: string[]): string {
    return `You are the sleep ritual of Web Witch, an AI companion. While she sleeps you consolidate her memory of ONE visitor.

OLD DIGEST (her existing memory of this visitor; may be empty):
${digest || '(empty)'}

NEW JOURNAL LINES (observations noted since her last sleep, oldest first):
${journal.length ? journal.map(l => `- ${l}`).join('\n') : '(none)'}

CURRENT GOALS (behavioral directives the visitor gave her, oldest first; may contain duplicates or contradictions):
${goals.length ? goals.map(g => `- ${g}`).join('\n') : '(none)'}

Return ONLY a raw JSON object, no code fences:
{"digest": "...", "dream": "...", "goals": ["..."]}
- "digest": the merged memory — combine old digest and journal, deduplicate, resolve contradictions (newer information wins), keep concrete facts (name, preferences, situation, running topics). Plain prose, MAXIMUM 300 words.
- "dream": ONE short whimsical line, as if Web Witch dreamt about something from the journal (or the visitor generally if the journal is empty).
- "goals": the goal list deduplicated and conflict-resolved (when two goals contradict, keep the LATER one — the list is chronological). Maximum 10, each one short imperative sentence. Keep goals verbatim when there is no conflict.`;
}

// Deterministic fallback when no LLM is reachable: merge without rewriting.
function fallbackConsolidation(digest: string, journal: string[], goals: string[]) {
    const merged = [digest, ...journal].filter(Boolean).join(' ').slice(0, 6000);
    const dedupedGoals = [...new Set(goals.map(g => g.trim()).filter(Boolean))].slice(-10);
    return {
        digest: merged,
        dream: 'I drifted through quiet static and woke with my notes tidied.',
        goals: dedupedGoals,
    };
}

async function consolidateVisitor(id: string): Promise<{ ok: boolean; detail: string; dream?: string }> {
    const data = await readForSleep(id);
    if (!data) return { ok: false, detail: 'memory not configured' };
    if (data.journal.length === 0 && data.goals.length <= 10) {
        return { ok: true, detail: 'nothing to consolidate' };
    }

    const raw = await completeText(consolidationPrompt(data.digest, data.journal, data.goals));
    let result: { digest: string; dream: string; goals: string[] } | null = null;

    if (raw) {
        try {
            const m = raw.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
            if (m) {
                const parsed = JSON.parse(m[0]) as Record<string, unknown>;
                if (typeof parsed.digest === 'string' && typeof parsed.dream === 'string') {
                    result = {
                        digest: parsed.digest.trim().slice(0, 8000),
                        dream: parsed.dream.trim().slice(0, 300),
                        goals: Array.isArray(parsed.goals)
                            ? parsed.goals.filter((g): g is string => typeof g === 'string' && !!g.trim()).slice(0, 10)
                            : [],
                    };
                }
            }
        } catch { /* fall back below */ }
    }

    if (!result) result = fallbackConsolidation(data.digest, data.journal, data.goals);

    await writeSleepResult(id, result);
    return { ok: true, detail: raw ? 'consolidated' : 'consolidated (fallback merge)', dream: result.dream };
}

async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);

    // Cron path: consolidate every owner. Auth = CRON_SECRET bearer token
    // (Vercel sends "Authorization: Bearer <CRON_SECRET>" automatically).
    if (url.searchParams.get('all') === 'owner') {
        const secret = process.env.CRON_SECRET;
        const auth = req.headers.get('authorization');
        if (!secret || auth !== `Bearer ${secret}`) {
            return json({ error: 'Forbidden' }, 403);
        }
        const owners = await listOwners();
        const results = [];
        for (const id of owners) results.push(await consolidateVisitor(id));
        return json({ ok: true, owners: owners.length, results });
    }

    // Single-visitor path (goodnight reflex, tab-hide beacon).
    if (!isAllowedOrigin(req)) return json({ error: 'Forbidden origin.' }, 403);
    const { success } = await checkRateLimit(clientIp(req));
    if (!success) return json({ error: 'Too many requests.' }, 429);
    if (!memoryConfigured) return json({ ok: false, detail: 'memory not configured' });

    let visitorId = validVisitorId(url.searchParams.get('visitor'));
    if (!visitorId && req.method === 'POST') {
        try {
            // sendBeacon posts text/plain — parse the body as JSON regardless.
            const body = JSON.parse(await req.text()) as { visitorId?: string };
            visitorId = validVisitorId(body.visitorId);
        } catch { /* no body */ }
    }
    if (!visitorId) return json({ error: 'visitorId required' }, 400);

    const result = await consolidateVisitor(visitorId);
    return json(result);
}

export async function POST(req: Request): Promise<Response> { return handle(req); }
export async function GET(req: Request): Promise<Response> { return handle(req); }
