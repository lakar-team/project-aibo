/**
 * Push-to-talk microphone hook (Phase 4).
 *
 * startRecording() opens the mic (getUserMedia on first use) and starts a
 * MediaRecorder with webm/opus (plain webm fallback). stopRecording() stops
 * it and resolves with the recorded Blob. A 30-second hard cap auto-stops
 * the recorder; the finished blob is held so the eventual stopRecording()
 * call (when the user releases the button) still receives it.
 */
'use client';

import { useRef, useState, useCallback, useEffect } from 'react';

export interface MicrophoneState {
    supported: boolean;
    recording: boolean;
    startRecording: () => Promise<void>;
    stopRecording: () => Promise<Blob | null>;
}

const MAX_RECORDING_MS = 30_000;

export function useMicrophone(): MicrophoneState {
    const [supported, setSupported] = useState(true);
    const [recording, setRecording] = useState(false);

    const recorderRef = useRef<MediaRecorder | null>(null);
    const chunksRef = useRef<Blob[]>([]);
    // Resolver armed by stopRecording(); onstop calls it with the blob.
    const stopResolveRef = useRef<((blob: Blob | null) => void) | null>(null);
    // Blob finished before stopRecording() was called (30s cap fired).
    const pendingBlobRef = useRef<Blob | null>(null);
    const capTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        setSupported(
            typeof navigator !== 'undefined' &&
            !!navigator.mediaDevices?.getUserMedia &&
            typeof MediaRecorder !== 'undefined'
        );
    }, []);

    const startRecording = useCallback(async (): Promise<void> => {
        if (recorderRef.current) return; // already recording
        pendingBlobRef.current = null;

        // Throws on permission denial / no device — caller falls back.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
                ? 'audio/webm'
                : undefined;
        const recorder = mimeType
            ? new MediaRecorder(stream, { mimeType })
            : new MediaRecorder(stream);

        chunksRef.current = [];
        recorder.ondataavailable = (e: BlobEvent) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
            const blob = chunksRef.current.length
                ? new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
                : null;
            chunksRef.current = [];
            stream.getTracks().forEach(t => t.stop());
            recorderRef.current = null;
            setRecording(false);
            if (stopResolveRef.current) {
                stopResolveRef.current(blob);
                stopResolveRef.current = null;
            } else {
                pendingBlobRef.current = blob; // cap fired before release
            }
        };

        recorderRef.current = recorder;
        recorder.start();
        setRecording(true);

        capTimerRef.current = setTimeout(() => {
            try {
                if (recorder.state !== 'inactive') recorder.stop();
            } catch { /* already stopped */ }
        }, MAX_RECORDING_MS);
    }, []);

    const stopRecording = useCallback((): Promise<Blob | null> => {
        if (capTimerRef.current) {
            clearTimeout(capTimerRef.current);
            capTimerRef.current = null;
        }
        // Cap already finished this recording — hand over the held blob.
        if (pendingBlobRef.current) {
            const blob = pendingBlobRef.current;
            pendingBlobRef.current = null;
            return Promise.resolve(blob);
        }
        const recorder = recorderRef.current;
        if (!recorder || recorder.state === 'inactive') return Promise.resolve(null);
        return new Promise<Blob | null>(resolve => {
            stopResolveRef.current = resolve;
            try {
                recorder.stop();
            } catch {
                stopResolveRef.current = null;
                resolve(null);
            }
        });
    }, []);

    // Release the mic if the component unmounts mid-recording.
    useEffect(() => {
        return () => {
            if (capTimerRef.current) clearTimeout(capTimerRef.current);
            try { recorderRef.current?.stop(); } catch { /* ignore */ }
        };
    }, []);

    return { supported, recording, startRecording, stopRecording };
}
