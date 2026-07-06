import { checkRateLimit } from '@/lib/ratelimit';
import { isAllowedOrigin, clientIp } from '@/lib/origin';
import { personality } from '@/data/personality';
import { adamProfile } from '@/data/adamProfile';
import {
    decideTier,
    GEMINI_SMALL_MODELS,
    GEMINI_MAIN_MODELS,
    OPENROUTER_DEEP_MODELS,
    VISION_MODELS,
} from '@/lib/router';
import { logCall, tierCountToday, TIER3_DAILY_CAP } from '@/lib/budget';

export const runtime = 'edge';

// ============================================================
// STRUCTURED REPLY CONTRACT
// {"reply", "emotion", "gesture", "memorable", "lang"}
// ============================================================

interface ConversationTurn {
    role: 'user' | 'assistant';
    content: string;
}

interface ConversationMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

const EMOTIONS = ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'] as const;
type Emotion = (typeof EMOTIONS)[number];

// Fixed gesture vocabulary — anything else from the model is dropped to null.
const GESTURES = new Set(['WAVE', 'NOD', 'SHAKE', 'DANCE', 'BOW', 'CROSS_ARMS', 'THINK']);

interface StructuredReply {
    reply: string;
    emotion: Emotion;
    gesture: string | null;
    memorable: string | null;
    lang: string;
}

function parseStructuredReply(raw: string): StructuredReply {
    // Unwrap (not delete) code fences some models insist on adding.
    const unfenced = raw.replace(/```(?:json)?/gi, '').trim();

    const jsonMatch = unfenced.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
            if (typeof parsed.reply === 'string' && parsed.reply.trim()) {
                const emotion =
                    typeof parsed.emotion === 'string' &&
                    (EMOTIONS as readonly string[]).includes(parsed.emotion)
                        ? (parsed.emotion as Emotion)
                        : 'neutral';
                const gestureRaw =
                    typeof parsed.gesture === 'string' ? parsed.gesture.toUpperCase() : null;
                const gesture = gestureRaw && GESTURES.has(gestureRaw) ? gestureRaw : null;
                const memorable =
                    typeof parsed.memorable === 'string' && parsed.memorable.trim()
                        ? parsed.memorable.trim()
                        : null;
                const lang =
                    typeof parsed.lang === 'string' && /^[a-zA-Z]{2}/.test(parsed.lang)
                        ? parsed.lang.slice(0, 2).toLowerCase()
                        : 'en';
                return { reply: parsed.reply.trim(), emotion, gesture, memorable, lang };
            }
        } catch {
            /* fall through to plain text */
        }
    }

    return { reply: unfenced, emotion: 'neutral', gesture: null, memorable: null, lang: 'en' };
}

// Extracts clean reply text from the model's raw streaming output.
// Models are instructed to reply with {"reply":"...", ...} with "reply" first.
// Some ignore this and return plain text — both modes are handled.
// Only the reply content is forwarded as stream tokens so the client/TTS
// never sees raw JSON characters like braces or the "reply" key.
class ReplyExtractor {
    private buf = '';
    private state: 'init' | 'json-scan' | 'json-content' | 'json-done' | 'plain' = 'init';

    feed(chunk: string): string {
        this.buf += chunk;

        if (this.state === 'init') {
            const t = this.buf.trimStart();
            if (t.length === 0) return '';
            // Fenced JSON ("```json\n{") is still JSON — scan for the reply key.
            this.state = t[0] === '{' || t[0] === '`' ? 'json-scan' : 'plain';
        }

        if (this.state === 'plain') {
            const out = this.buf;
            this.buf = '';
            return out;
        }

        if (this.state === 'json-scan') {
            const m = this.buf.match(/"reply"\s*:\s*"/);
            if (!m || m.index === undefined) return ''; // still scanning
            this.buf = this.buf.slice(m.index + m[0].length);
            this.state = 'json-content';
        }

        if (this.state === 'json-content') {
            let out = '';
            let i = 0;
            while (i < this.buf.length) {
                const c = this.buf[i];
                if (c === '\\' && i + 1 < this.buf.length) {
                    const n = this.buf[i + 1];
                    out += n === 'n' ? '\n' : n === 't' ? '\t' : n;
                    i += 2;
                } else if (c === '"') {
                    this.state = 'json-done';
                    this.buf = this.buf.slice(i + 1);
                    break;
                } else {
                    out += c;
                    i++;
                }
            }
            if (this.state === 'json-content') this.buf = '';
            return out;
        }

        return '';
    }
}

// ============================================================
// SYSTEM PROMPT — personality every turn; full Adam narrative
// on turn 0 only (turn-aware compression saves ~1500 tokens/turn).
// memoryDigest stays empty until Phase 7 wires Upstash memory in.
// ============================================================

function buildSystemPrompt(turnIndex: number, isIdlePrompt: boolean, memoryDigest = ''): string {
    // Deliberately brief: the full profile is a few sentences on turn 0,
    // a single line after. She is a companion — no CV, no portfolio dump.
    const adamSection =
        turnIndex === 0
            ? `ABOUT ADAM (your creator):\n${adamProfile}`
            : `Adam is your creator and a trusted friend. Don't bring up his work or projects unless he asks.`;

    const memorySection = memoryDigest
        ? `\n════════════════════════════════════════\nWHAT YOU REMEMBER ABOUT THIS VISITOR:\n════════════════════════════════════════\n${memoryDigest}\n`
        : '';

    return `You are Web Witch — a mystical AI companion created by Adam Raman, living at project-aibo.vercel.app. ADAM IS MALE. Always "he/him", never "they" or "she".

${personality}

OUTPUT FORMAT (required — respond with ONE raw JSON object, fields in EXACTLY this order: "lang" first, then "reply", then the rest):
{"lang": "en", "reply": "your message", "emotion": "neutral", "gesture": null, "memorable": null}
- "lang": ISO 639-1 code of the language "reply" is written in ("en", "ja", "ms", "zh", "fr", "es", ...). This MUST be the first field.
- "reply": your plain conversational response. No markdown, no lists, no JSON inside this string.
- "emotion": exactly one of happy | sad | angry | surprised | relaxed | neutral — the feeling you express while delivering this reply.
- "gesture": one of WAVE | NOD | SHAKE | DANCE | BOW | CROSS_ARMS | THINK, or null. Only when it clearly fits: greeting/goodbye → WAVE, agreement → NOD, refusal → SHAKE, celebration → DANCE, thanks/respect → BOW, pondering → THINK. Most replies: null.
- "memorable": if the visitor revealed something about THEMSELVES worth remembering (their name, work, preferences, situation), one short sentence capturing it. Otherwise null.
Return ONLY the raw JSON object — no code fences, nothing outside it.

${adamSection}
${memorySection}
${isIdlePrompt ? '\nThis turn is system-initiated (the visitor did not type it): follow the instruction in the user message warmly and briefly.\n' : ''}
Reply in the language the user wrote in.`;
}

// ============================================================
// STREAMING PROVIDERS — Gemini first, OpenRouter fallback
// ============================================================

async function* streamGemini(
    messages: ConversationMessage[],
    model: string
): AsyncGenerator<string> {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) throw new Error('GOOGLE_GEMINI_API_KEY not configured');

    const sysMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: chatMessages.map(m => ({
                    role: m.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: m.content }],
                })),
                systemInstruction: sysMsg ? { parts: [{ text: sysMsg.content }] } : undefined,
                generationConfig: { maxOutputTokens: 600, temperature: 0.85 },
            }),
        }
    );

    if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Gemini ${response.status}: ${errText.slice(0, 200)}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json || json === '[DONE]') continue;
            try {
                const ev = JSON.parse(json) as {
                    candidates?: { content?: { parts?: { text?: string }[] } }[];
                    error?: { message: string };
                };
                if (ev.error) throw new Error(ev.error.message);
                const text = ev.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) yield text;
            } catch (e) {
                if (e instanceof Error && e.message.startsWith('Gemini')) throw e;
                // skip malformed SSE lines
            }
        }
    }
}

const OPENROUTER_FREE_ROTATION = [
    'google/gemini-2.0-flash-exp:free',
    'meta-llama/llama-3.3-70b-instruct:free',
    'deepseek/deepseek-chat-v3-0324:free',
    'mistralai/mistral-small-3.1-24b-instruct:free',
    'openrouter/auto',
];

async function* streamOpenRouter(
    messages: ConversationMessage[],
    models: string[] = OPENROUTER_FREE_ROTATION,
    imageBase64?: string
): AsyncGenerator<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error('OPENROUTER_API_KEY not configured');

    // Vision (Phase 6): the captured frame rides on the final user turn only,
    // as an OpenAI-compatible multimodal content array. Forwarded, never stored.
    const payloadMessages = imageBase64
        ? messages.map((m, i) =>
              i === messages.length - 1 && m.role === 'user'
                  ? {
                        role: 'user' as const,
                        content: [
                            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
                            { type: 'text', text: m.content },
                        ],
                    }
                  : m
          )
        : messages;

    for (const model of models) {
        let yielded = false;
        try {
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://project-aibo.vercel.app',
                    'X-Title': 'Project AIBO — Web Witch',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ model, messages: payloadMessages, stream: true }),
            });

            if (!response.ok || !response.body) continue;

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            let done = false;

            while (!done) {
                const { done: rdone, value } = await reader.read();
                if (rdone) break;
                buf += decoder.decode(value, { stream: true });
                const lines = buf.split('\n');
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('data:')) continue;
                    const json = line.slice(5).trim();
                    if (json === '[DONE]') { done = true; break; }
                    if (!json) continue;
                    try {
                        const ev = JSON.parse(json) as {
                            choices?: { delta?: { content?: string } }[];
                            error?: { message: string };
                        };
                        if (ev.error) continue;
                        const text = ev.choices?.[0]?.delta?.content;
                        if (text) { yielded = true; yield text; }
                    } catch { /* skip */ }
                }
            }

            if (yielded) return;
        } catch (err) {
            if (yielded) throw err; // already sent chunks — can't fall back
            continue;
        }
    }

    throw new Error('All OpenRouter models failed');
}

// ============================================================
// MAIN HANDLER — NDJSON stream: {t: "token"}* then {done: true, ...}
// ============================================================

export async function POST(req: Request): Promise<Response> {
    if (!isAllowedOrigin(req)) {
        return new Response(JSON.stringify({ error: 'Forbidden origin.' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { success: withinLimit } = await checkRateLimit(clientIp(req));
    if (!withinLimit) {
        return new Response(
            JSON.stringify({ error: 'Too many requests — the witch needs a moment to catch her breath. Try again in a minute.' }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
        );
    }

    try {
        const { message, history, isIdlePrompt, lang, image } = await req.json() as {
            message: string;
            history?: ConversationTurn[];
            isIdlePrompt?: boolean;
            lang?: string;  // detected STT language hint (ISO 639-1)
            image?: string; // base64 JPEG webcam frame (Phase 6) — never stored
        };
        const userLang = typeof lang === 'string' && /^[a-z]{2}$/i.test(lang.trim())
            ? lang.trim().toLowerCase()
            : null;
        const userImage =
            typeof image === 'string' && image.length > 100 && image.length < 4_500_000
                ? image
                : undefined;

        if (!message || typeof message !== 'string' || message.length > 2000) {
            return new Response(JSON.stringify({ error: 'Invalid message' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Sanitize history: strip any structured-JSON wrappers from stored
        // assistant turns, and drop anything before the first user turn.
        const rawHistory = (history ?? []).slice(-20).map(m => ({
            role: m.role,
            content: m.role === 'assistant' ? parseStructuredReply(m.content).reply : m.content,
        }));
        const firstUser = rawHistory.findIndex(m => m.role === 'user');
        const cleanHistory = firstUser >= 0 ? rawHistory.slice(firstUser) : [];

        // Prior user turns decide prompt verbosity (turn-aware compression).
        const turnIndex = cleanHistory.filter(m => m.role === 'user').length;

        const encoder = new TextEncoder();

        // ---- Phase 2: tier routing ----
        const decision = await decideTier(message, cleanHistory);

        // Tier 0 reflex: canned reply, no LLM call at all. (Never when an
        // image is attached — a glance always goes to the multimodal model.)
        if (!userImage && decision.tier === 0 && decision.reflex) {
            const r = decision.reflex;
            await logCall({
                tier: 0, model: 'reflex', provider: 'reflex',
                in_tokens_est: Math.ceil(message.length / 4),
                out_tokens_est: Math.ceil(r.reply.length / 4),
                reason: decision.reason,
            });
            const frames =
                JSON.stringify({ lang: r.lang }) + '\n' +
                JSON.stringify({ t: r.reply }) + '\n' +
                JSON.stringify({
                    done: true, reply: r.reply, emotion: r.emotion, gesture: r.gesture,
                    memorable: null, lang: r.lang, tier: 0, model: 'reflex', provider: 'reflex',
                }) + '\n';
            return new Response(frames, {
                headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
            });
        }

        // Soft budget cap: tier 3 over its daily allowance downgrades to
        // tier 2, and Web Witch mentions she's conserving her power.
        let tier = decision.tier;
        let conserving = false;
        if (tier === 3 && (await tierCountToday(3)) >= TIER3_DAILY_CAP) {
            tier = 2;
            conserving = true;
        }

        const systemContent =
            buildSystemPrompt(turnIndex, isIdlePrompt === true) +
            (userLang
                ? `\nThe user is SPEAKING in the language with ISO code "${userLang}" (detected from their voice). Mirror it: reply in that language and set "lang" accordingly.`
                : '') +
            (conserving
                ? '\nNOTE: your deeper powers reached their daily budget, so you are conserving energy. If this question needed deep thought, briefly mention in character that you are conserving your power today.'
                : '');

        const messages: ConversationMessage[] = [
            { role: 'system', content: systemContent },
            ...(cleanHistory as ConversationMessage[]),
            { role: 'user', content: message },
        ];

        const inTokensEst = Math.ceil(messages.reduce((n, m) => n + m.content.length, 0) / 4);

        // Provider chain per tier — cheapest capable model first, with
        // graceful degradation down the chain (and up to OpenRouter free).
        interface Provider { name: string; model: string; gen: () => AsyncGenerator<string> }
        const gem = (model: string): Provider =>
            ({ name: 'Google Gemini', model, gen: () => streamGemini(messages, model) });
        const orFree: Provider =
            { name: 'OpenRouter', model: 'free-rotation', gen: () => streamOpenRouter(messages) };
        const orDeep: Provider =
            { name: 'OpenRouter', model: OPENROUTER_DEEP_MODELS.join('|'), gen: () => streamOpenRouter(messages, OPENROUTER_DEEP_MODELS) };

        const providers: Provider[] =
            tier === 1 ? [...GEMINI_SMALL_MODELS.map(gem), ...GEMINI_MAIN_MODELS.map(gem), orFree]
            : tier === 3 ? [orDeep, ...GEMINI_MAIN_MODELS.map(gem), orFree]
            : [...GEMINI_MAIN_MODELS.map(gem), orFree];

        // Vision (Phase 6): an image forces the multimodal chain via
        // OpenRouter (VISION_MODEL env, default llama-3.2-11b-vision),
        // regardless of tier. If her sight fails entirely (models down),
        // a "blind" text-only chain answers with an in-character apology
        // instead of a hard error.
        const visionChain: Provider[] = [{
            name: 'OpenRouter',
            model: `${VISION_MODELS.join('|')}+vision`,
            gen: () => streamOpenRouter(messages, VISION_MODELS, userImage),
        }];
        const blindMessages: ConversationMessage[] = userImage
            ? [
                  {
                      role: 'system',
                      content:
                          systemContent +
                          '\nNOTE: the visitor invited you to look through the camera, but your sight failed this time (the vision spirits are unreachable). Briefly apologize in character and answer from their words alone.',
                  },
                  ...(cleanHistory as ConversationMessage[]),
                  { role: 'user', content: message },
              ]
            : [];
        const blindChain: Provider[] = userImage
            ? [
                  ...GEMINI_MAIN_MODELS.map(model => ({
                      name: 'Google Gemini',
                      model,
                      gen: () => streamGemini(blindMessages, model),
                  })),
                  { name: 'OpenRouter', model: 'free-rotation', gen: () => streamOpenRouter(blindMessages) },
              ]
            : [];

        const stream = new ReadableStream({
            async start(controller) {
                const send = (obj: object) =>
                    controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));

                // Kip's transparency rule: say when the deep mind wakes.
                if (tier === 3 && !userImage) send({ status: 'deep', text: 'Consulting the deeper spirits…' });
                if (conserving) send({ status: 'conserving', text: 'Conserving my deeper powers today…' });

                const diag: string[] = [];

                // Runs one provider chain; returns true once a reply was sent.
                const runChain = async (chain: Provider[]): Promise<boolean> => {
                    for (const provider of chain) {
                        const extractor = new ReplyExtractor();
                        let fullRaw = '';
                        let langSent = false;

                        try {
                            for await (const chunk of provider.gen()) {
                                fullRaw += chunk;
                                // "lang" precedes "reply" in the contract, so the
                                // client learns the TTS voice before tokens arrive.
                                if (!langSent) {
                                    const m = fullRaw.match(/"lang"\s*:\s*"([a-zA-Z]{2})/);
                                    if (m) { send({ lang: m[1].toLowerCase() }); langSent = true; }
                                }
                                const extracted = extractor.feed(chunk);
                                if (extracted) send({ t: extracted });
                            }
                        } catch (err) {
                            const errMsg = err instanceof Error ? err.message : String(err);
                            diag.push(`${provider.name}(${provider.model}): ${errMsg.slice(0, 160)}`);
                            console.warn(`[brain] provider failed — ${provider.name} ${provider.model}:`, errMsg);
                            if (fullRaw) {
                                // Partial response received — send what we have.
                                const parsed = parseStructuredReply(fullRaw);
                                await logCall({
                                    tier, model: provider.model, provider: provider.name,
                                    in_tokens_est: inTokensEst,
                                    out_tokens_est: Math.ceil(fullRaw.length / 4),
                                    reason: decision.reason,
                                });
                                send({
                                    done: true,
                                    ...parsed,
                                    reply: parsed.reply || 'Something interrupted my crystal ball...',
                                    tier, model: provider.model, provider: provider.name,
                                    ...(diag.length ? { diag } : {}),
                                });
                                return true;
                            }
                            continue; // nothing sent yet, try next provider
                        }

                        if (fullRaw) {
                            const parsed = parseStructuredReply(fullRaw);
                            await logCall({
                                tier, model: provider.model, provider: provider.name,
                                in_tokens_est: inTokensEst,
                                out_tokens_est: Math.ceil(fullRaw.length / 4),
                                reason: decision.reason,
                            });
                            send({
                                done: true, ...parsed, tier,
                                model: provider.model, provider: provider.name,
                                ...(diag.length ? { diag } : {}),
                            });
                            return true;
                        }
                    }
                    return false;
                };

                const answered = userImage
                    ? (await runChain(visionChain)) || (await runChain(blindChain))
                    : await runChain(providers);

                if (!answered) {
                    send({ error: 'All AI providers failed.', ...(diag.length ? { diag } : {}) });
                }
                controller.close();
            },
        });

        return new Response(stream, {
            headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
        });
    } catch (error: unknown) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}
