import Groq from 'groq-sdk';
import { checkRateLimit } from '@/lib/ratelimit';
import { isAllowedOrigin, clientIp } from '@/lib/origin';

export const runtime = 'edge';

// Whisper verbose_json returns full language names — map to ISO 639-1 for
// the TTS voice map. Unknown names fall back to English.
const LANG_TO_ISO: Record<string, string> = {
    english: 'en', japanese: 'ja', malay: 'ms', chinese: 'zh', mandarin: 'zh',
    spanish: 'es', french: 'fr', italian: 'it', portuguese: 'pt', hindi: 'hi',
    korean: 'ko', german: 'de', indonesian: 'id', arabic: 'ar', russian: 'ru',
    thai: 'th', vietnamese: 'vi', tagalog: 'tl', dutch: 'nl', turkish: 'tr',
    cantonese: 'zh', polish: 'pl', ukrainian: 'uk', swedish: 'sv',
};

function toIso(language: string | undefined): string {
    if (!language) return 'en';
    const l = language.toLowerCase().trim();
    if (/^[a-z]{2}$/.test(l)) return l;
    return LANG_TO_ISO[l] ?? 'en';
}

const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

// POST multipart/form-data { audio: webm blob } → { text, language }
export async function POST(req: Request): Promise<Response> {
    if (!isAllowedOrigin(req)) {
        return json({ error: 'Forbidden origin.' }, 403);
    }
    const { success: withinLimit } = await checkRateLimit(clientIp(req));
    if (!withinLimit) {
        return json({ error: 'Too many requests. Try again in a minute.' }, 429);
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        // Graceful no-op: the client falls back to Web Speech API.
        return json({ text: '', language: 'en', error: 'STT not configured' });
    }

    try {
        const form = await req.formData();
        const audio = form.get('audio');
        if (!(audio instanceof File) || audio.size === 0) {
            return json({ error: 'No audio provided' }, 400);
        }
        if (audio.size > 10 * 1024 * 1024) {
            return json({ error: 'Audio too large (max 10 MB)' }, 400);
        }

        const groq = new Groq({ apiKey });
        const result = await groq.audio.transcriptions.create({
            file: audio,
            model: 'whisper-large-v3-turbo',
            response_format: 'verbose_json',
        });

        const r = result as unknown as { text?: string; language?: string };
        return json({ text: (r.text ?? '').trim(), language: toIso(r.language) });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[stt] transcription failed:', message);
        return json({ text: '', language: 'en', error: `Transcription failed: ${message.slice(0, 120)}` }, 502);
    }
}
