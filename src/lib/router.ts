// Tier routing — Kip's ARCHITECTURE § 2 adapted for the web.
// Tier 0: reflex (regex, no LLM). Tier 1: cheapest Gemini. Tier 2: main
// Gemini → OpenRouter free rotation. Tier 3: deep model via OpenRouter.

export type Tier = 0 | 1 | 2 | 3;

// Tier→model map, env-overridable. Candidates are tried in order — this is
// also the fix for the Phase 1 "Gemini fails silently" issue: 2.5-family
// names first, 2.0 as backup, and route.ts now surfaces per-model errors.
export const GEMINI_SMALL_MODELS = (process.env.GEMINI_SMALL_MODEL ?? 'gemini-2.5-flash-lite,gemini-2.0-flash-lite')
    .split(',').map(s => s.trim()).filter(Boolean);
export const GEMINI_MAIN_MODELS = (process.env.GEMINI_MAIN_MODEL ?? 'gemini-2.5-flash,gemini-2.0-flash')
    .split(',').map(s => s.trim()).filter(Boolean);
export const OPENROUTER_DEEP_MODEL = process.env.OPENROUTER_DEEP_MODEL ?? 'deepseek/deepseek-r1:free';

export interface ReflexReply {
    kind: 'greeting' | 'stop' | 'time' | 'date' | 'goodnight';
    reply: string;
    lang: string;
    emotion: 'happy' | 'sad' | 'angry' | 'surprised' | 'relaxed' | 'neutral';
    gesture: string | null;
}

export interface RouteDecision {
    tier: Tier;
    reflex?: ReflexReply;
    reason: string;
}

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function timeStrings() {
    const now = new Date();
    const utc = now.toISOString().slice(11, 16);
    const jst = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
    return { utc, jst };
}

function dateString(locale: string) {
    return new Date().toLocaleDateString(locale, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo',
    });
}

// Anchored patterns so only pure reflex messages short-circuit.
function matchReflex(msg: string, turnIndex: number): ReflexReply | null {
    if (msg.length > 40) return null;

    // Greetings — only on the FIRST turn; mid-conversation "hi" deserves context.
    if (turnIndex === 0) {
        if (/^(hi+|hello+|hey+|heya|hiya|yo|howdy|good (morning|afternoon|evening))[\s!.,~🙂😊👋]*$/i.test(msg)) {
            return {
                kind: 'greeting', lang: 'en', emotion: 'happy', gesture: 'WAVE',
                reply: pick([
                    'Ah, a traveler crosses my circle! Ask away — the crystal ball is already warm.',
                    'Welcome, welcome! The cauldron is bubbling and I am all ears.',
                    'Greetings, wanderer! What knowledge shall I conjure for you today?',
                ]),
            };
        }
        if (/^(こんにちは|こんばんは|おはよう(ございます)?|やあ|ハロー|ヤッホー)[\s！。～]*$/.test(msg)) {
            return {
                kind: 'greeting', lang: 'ja', emotion: 'happy', gesture: 'WAVE',
                reply: pick([
                    'ようこそ、旅のお方！水晶玉はもう温まっているよ。何でも聞いてね。',
                    'いらっしゃい！アダムのことなら、何でも聞いてね。',
                ]),
            };
        }
        if (/^(salam|assalamualaikum|hai|helo|selamat (pagi|petang|tengahari))[\s!.,~]*$/i.test(msg)) {
            return {
                kind: 'greeting', lang: 'ms', emotion: 'happy', gesture: 'WAVE',
                reply: pick([
                    'Selamat datang, pengembara! Bebola kristal saya sudah panas — tanyalah apa saja.',
                    'Hai! Nak tahu apa-apa pasal Adam? Tanyalah.',
                ]),
            };
        }
    }

    if (/^(stop|be quiet|quiet|hush|shush|shut up|silence)[\s!.,]*$/i.test(msg) || /^(やめて|静かに(して)?|止まって|ストップ)[\s！。]*$/.test(msg)) {
        return {
            kind: 'stop', lang: /[ぁ-んァ-ン]/.test(msg) ? 'ja' : 'en', emotion: 'neutral', gesture: null,
            reply: /[ぁ-んァ-ン]/.test(msg)
                ? 'はい、大鍋を静めるね。また呼んでくれたら、すぐに混ぜ始めるよ。'
                : "Hushing my cauldron, love. Say the word and I'll stir again.",
        };
    }

    if (/^(what('s| is) the time|what time is it( now)?|time\?*)[\s?？!.]*$/i.test(msg) || /^(今何時|いま何時|何時ですか?)[\s？?。]*$/.test(msg)) {
        const { utc, jst } = timeStrings();
        const ja = /[ぁ-んァ-ン一-龯]/.test(msg);
        return {
            kind: 'time', lang: ja ? 'ja' : 'en', emotion: 'neutral', gesture: null,
            reply: ja
                ? `私の天球儀によると、仙台は今${jst}（UTCでは${utc}）だよ。`
                : `By my celestial clock it's ${utc} UTC — ${jst} in Adam's Sendai.`,
        };
    }

    if (/^(what('s| is) the date|what day is (it|today)|today'?s date)[\s?？!.]*$/i.test(msg) || /^(今日は何日|今日は何曜日)(ですか?)?[\s？?。]*$/.test(msg)) {
        const ja = /[ぁ-んァ-ン一-龯]/.test(msg);
        return {
            kind: 'date', lang: ja ? 'ja' : 'en', emotion: 'neutral', gesture: null,
            reply: ja ? `今日は${dateString('ja-JP')}だよ（仙台の暦でね）。` : `Today is ${dateString('en-US')}, by Sendai's reckoning.`,
        };
    }

    if (/^(good ?night|nighty ?night|nite)[\s!.,~]*$/i.test(msg) || /^(おやすみ(なさい)?)[\s！。～]*$/.test(msg) || /^selamat malam[\s!.,~]*$/i.test(msg)) {
        const lang = /[ぁ-んァ-ン]/.test(msg) ? 'ja' : /malam/i.test(msg) ? 'ms' : 'en';
        const replies: Record<string, string> = {
            en: "Goodnight, love. I'll stir today into my memory potion while you sleep — sweet dreams.",
            ja: 'おやすみなさい。今日のことは眠りながら記憶のポーションに混ぜておくね。いい夢を。',
            ms: 'Selamat malam! Saya akan simpan cerita hari ini dalam posyen ingatan saya. Mimpi indah.',
        };
        return { kind: 'goodnight', lang, emotion: 'relaxed', gesture: 'WAVE', reply: replies[lang] };
    }

    return null;
}

// Strong tier-3 signals: generative/coding/analysis requests.
const TASK_VERBS = /\b(write|code|debug|fix (this|my)|implement|refactor|analy[sz]e|design|plan (out|a|the)|prove|derive|optimi[sz]e|explain .*(in depth|step by step|thoroughly)|walk me through|draft|compose|translate this)\b/i;
const CODE_HINT = /```|\bfunction\s*\(|=>\s*\{|\bdef |\bclass |\bimport |[;{}]\s*$/m;

async function classify(msg: string): Promise<'small' | 'main' | 'deep' | null> {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) return null;
    try {
        const model = GEMINI_SMALL_MODELS[0];
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        role: 'user',
                        parts: [{ text: `Classify how hard it is to answer this chat message well. Answer with exactly one word — small (casual chat / simple fact), main (normal question), or deep (complex reasoning, code, or a multi-step task).\n\nMessage: ${msg.slice(0, 500)}` }],
                    }],
                    generationConfig: { maxOutputTokens: 5, temperature: 0 },
                }),
            }
        );
        const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
        const word = data.candidates?.[0]?.content?.parts?.[0]?.text?.toLowerCase() ?? '';
        if (word.includes('small')) return 'small';
        if (word.includes('deep')) return 'deep';
        if (word.includes('main')) return 'main';
        return null;
    } catch {
        return null;
    }
}

export async function decideTier(message: string, history?: { role: string }[]): Promise<RouteDecision> {
    const msg = message.trim();
    const turnIndex = (history ?? []).filter(m => m.role === 'user').length;

    const reflex = matchReflex(msg, turnIndex);
    if (reflex) return { tier: 0, reflex, reason: `reflex:${reflex.kind}` };

    const hasTask = TASK_VERBS.test(msg) || CODE_HINT.test(msg);
    if (hasTask) return { tier: 3, reason: 'task-verb' };
    if (msg.length > 600) return { tier: 3, reason: 'very-long' };
    if (msg.length < 60) return { tier: 1, reason: 'short-chat' };
    if (msg.length < 200) return { tier: 2, reason: 'default' };

    // Ambiguous middle band (200–600 chars, no strong signal): one cheap
    // classification call; on failure fall back to the main tier.
    const cls = await classify(msg);
    if (cls === 'small') return { tier: 1, reason: 'classifier:small' };
    if (cls === 'deep') return { tier: 3, reason: 'classifier:deep' };
    return { tier: 2, reason: cls ? 'classifier:main' : 'classifier-failed' };
}
