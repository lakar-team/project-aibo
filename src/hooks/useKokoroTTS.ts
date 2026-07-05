/**
 * Kokoro-js TTS hook — offloads all WASM inference to a dedicated Web Worker.
 *
 * Copied from solar-punk src/hooks/useKokoroTTS.ts with project-aibo additions:
 *  - per-call voice selection (voice map keyed by the brain's `lang` field;
 *    kokoroVoiceFor() returns null for languages Kokoro can't speak, and the
 *    caller falls back to browser speechSynthesis)
 *  - `ready` flag (model loaded) so callers can decide Kokoro vs fallback
 *  - getLevel() passthrough from the naturalizer for audio-driven lip sync
 *  - sentence splitting understands CJK punctuation (。！？)
 *
 * Moving WASM off the main thread eliminates 100-500ms UI freezes that occurred
 * per sentence when tts.generate() ran inline. Audio playback (audioNaturalizer)
 * stays on the main thread because it needs AudioContext / Web Audio API.
 *
 * Worker protocol (kokoro.worker.ts):
 *   → { type: 'warmup' }
 *   → { type: 'speak', id, sentences, voice }
 *   ← { type: 'ready' }
 *   ← { type: 'audio', id, index, samples: Float32Array, sampleRate }  (one per sentence)
 *   ← { type: 'done', id }
 *   ← { type: 'error', id, message }
 *
 * Cancellation: stop() increments responseGenRef and clears pendingRef, which
 * causes speakQueue's gen-check to skip stale chain links, and causes stale
 * 'audio' messages from the worker to be dropped.
 */
'use client';

import { useRef, useState, useCallback, useEffect } from 'react';
import { createNaturalizer, type Naturalizer } from '@/utils/audioNaturalizer';

export interface KokoroTTSState {
    speak: (text: string, voice?: string) => Promise<void>;
    speakQueue: (text: string, voice?: string) => void;
    stop: () => void;
    warmup: () => void;
    loading: boolean;
    ready: boolean;
    progress: number;
    isSpeaking: boolean;
    error: string | null;
    getLevel: () => number;
}

const DEFAULT_VOICE = 'af_heart';

// Kokoro built-in voices by ISO 639-1 reply language (PLAN.md Phase 3 map).
// Languages not present here (e.g. ms) fall back to browser speechSynthesis.
const KOKORO_VOICES: Record<string, string> = {
    en: 'af_heart',
    ja: 'jf_alpha',
    zh: 'zf_xiaobei',
    es: 'ef_dora',
    fr: 'ff_siwis',
    it: 'if_sara',
    pt: 'pf_dora',
    hi: 'hf_alpha',
};

/** Kokoro voice for a reply language, or null when unsupported (→ browser fallback). */
export function kokoroVoiceFor(lang: string | null | undefined): string | null {
    if (!lang) return null;
    return KOKORO_VOICES[lang.toLowerCase()] ?? null;
}

function stripMarkdown(text: string): string {
    return text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/__(.*?)__/g, '$1')
        .replace(/_(.*?)_/g, '$1')
        .replace(/`{1,3}[^`]*`{1,3}/g, '')
        .replace(/^#+\s+/gm, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/^[-*]\s+/gm, '')
        .replace(/^\d+\.\s+/gm, '')
        .trim();
}

export function splitSentences(text: string): string[] {
    const clean = stripMarkdown(text);
    if (!clean) return [];
    const delimited = clean
        .replace(/([。！？])/g, '$1\x00') // CJK sentence enders need no trailing space
        .replace(/([!?…])\s+/g, '$1\x00')
        .replace(/\.\s+(?=[A-Z])/g, '.\x00')
        .replace(/\n\n+/g, '\x00');
    return delimited
        .split('\x00')
        .map(s => s.trim())
        .filter(s => s.length > 1);
}

type WorkerMessage =
    | { type: 'ready' }
    | { type: 'audio'; id: number; index: number; samples: Float32Array; sampleRate: number }
    | { type: 'done'; id: number }
    | { type: 'error'; id: number; message: string };

export function useKokoroTTS(): KokoroTTSState {
    const [loading, setLoading] = useState(false);
    const [ready, setReady] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const workerRef = useRef<Worker | null>(null);
    const naturalizerRef = useRef<Naturalizer | null>(null);
    // Generation counter: incremented by stop() to cancel in-flight speakQueue chains.
    const responseGenRef = useRef(0);
    // Sequential promise chain so speakQueue sentences are generated one at a time.
    const genQueueRef = useRef<Promise<void>>(Promise.resolve());
    // Monotonic request ID for matching worker responses to pending promises.
    const reqIdRef = useRef(0);
    const pendingRef = useRef<Map<number, { resolve: () => void; reject: (e: Error) => void }>>(new Map());

    useEffect(() => {
        if (!naturalizerRef.current) {
            naturalizerRef.current = createNaturalizer();
            naturalizerRef.current.onStart(() => setIsSpeaking(true));
            naturalizerRef.current.onEnd(() => setIsSpeaking(false));
        }

        if (!workerRef.current && typeof window !== 'undefined') {
            const worker = new Worker(
                new URL('../workers/kokoro.worker.ts', import.meta.url)
            );

            worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
                const msg = e.data;

                if (msg.type === 'ready') {
                    setLoading(false);
                    setReady(true);
                    return;
                }
                if (msg.type === 'audio') {
                    // Drop audio for cancelled/cleared requests.
                    if (pendingRef.current.has(msg.id)) {
                        naturalizerRef.current?.enqueue(msg.samples, msg.sampleRate);
                    }
                    return;
                }
                if (msg.type === 'done') {
                    const p = pendingRef.current.get(msg.id);
                    if (p) { pendingRef.current.delete(msg.id); p.resolve(); }
                    return;
                }
                if (msg.type === 'error') {
                    const p = pendingRef.current.get(msg.id);
                    if (p) { pendingRef.current.delete(msg.id); p.reject(new Error(msg.message)); }
                    if (msg.id === -1) {
                        setError(msg.message);
                        setLoading(false);
                    }
                }
            };

            worker.onerror = (e) => {
                setError(e.message ?? 'Worker error');
                setLoading(false);
            };

            workerRef.current = worker;
        }

        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    const warmup = useCallback(() => {
        if (!workerRef.current) return;
        setLoading(true);
        setError(null);
        workerRef.current.postMessage({ type: 'warmup' });
    }, []);

    // Send a single sentence to the worker and return a promise that resolves
    // when the worker sends 'done' for that request id.
    const sendToWorker = useCallback((sentence: string, voice: string): Promise<void> => {
        return new Promise<void>((resolve, reject) => {
            const id = ++reqIdRef.current;
            pendingRef.current.set(id, { resolve, reject });
            workerRef.current?.postMessage({ type: 'speak', id, sentences: [sentence], voice });
        });
    }, []);

    // speakQueue: enqueue a sentence without aborting other in-flight sentences
    // from the same response. Sentences chain sequentially so WASM is never
    // concurrent. stop() increments responseGenRef to cancel pending chain links.
    const speakQueue = useCallback((text: string, voice: string = DEFAULT_VOICE): void => {
        if (!text.trim()) return;
        const myGen = responseGenRef.current;
        genQueueRef.current = genQueueRef.current.then(async () => {
            if (responseGenRef.current !== myGen) return;
            try { await sendToWorker(text, voice); } catch { /* ignore single-sentence failures */ }
        });
    }, [sendToWorker]);

    const speak = useCallback(async (text: string, voice: string = DEFAULT_VOICE): Promise<void> => {
        if (!text.trim()) return;
        const sentences = splitSentences(text);
        const myGen = responseGenRef.current;
        for (const sentence of sentences) {
            if (responseGenRef.current !== myGen) break;
            try { await sendToWorker(sentence, voice); } catch { /* ignore */ }
        }
    }, [sendToWorker]);

    const stop = useCallback(() => {
        responseGenRef.current++;
        // Resolve all pending promises so the queue chains drain without hanging.
        for (const [, p] of pendingRef.current) p.resolve();
        pendingRef.current.clear();
        naturalizerRef.current?.stop();
    }, []);

    const getLevel = useCallback((): number => {
        return naturalizerRef.current?.getLevel() ?? 0;
    }, []);

    return {
        speak,
        speakQueue,
        stop,
        warmup,
        loading,
        ready,
        progress: loading ? 0 : 100,
        isSpeaking,
        error,
        getLevel,
    };
}
