/**
 * One-shot consent-gated webcam capture (Phase 6).
 *
 * Based on AIBO_Alive's Static/js/vision_core.js capture path, adapted to
 * Kip's consent rules: the camera opens ON DEMAND for a single frame and the
 * track is stopped immediately after capture — never a standing stream.
 * Downscales the longest side to 1024 px, JPEG q0.7, returns raw base64
 * (no data: prefix). Frames are sent to the brain and never stored.
 */
'use client';

import { useState, useCallback } from 'react';

export interface WebcamState {
    supported: boolean;
    /** True while the camera is open (the "👁 watching" badge window). */
    capturing: boolean;
    /** Opens the camera, grabs one frame, closes the camera. Throws on denial. */
    captureFrame: () => Promise<string>;
}

const MAX_SIDE = 1024;
const JPEG_QUALITY = 0.7;

export function useWebcam(): WebcamState {
    const [capturing, setCapturing] = useState(false);

    const supported =
        typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

    const captureFrame = useCallback(async (): Promise<string> => {
        setCapturing(true);
        let stream: MediaStream | null = null;
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });

            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            await video.play();
            // Give auto-exposure a moment so the frame isn't black.
            await new Promise(r => setTimeout(r, 400));

            const w = video.videoWidth || 640;
            const h = video.videoHeight || 480;
            const scale = Math.min(1, MAX_SIDE / Math.max(w, h));

            const canvas = document.createElement('canvas');
            canvas.width = Math.round(w * scale);
            canvas.height = Math.round(h * scale);
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Canvas 2D unavailable');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

            const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            video.srcObject = null;
            return dataUrl.slice(dataUrl.indexOf(',') + 1); // strip data: prefix
        } finally {
            // Kip § 4: the camera closes the moment the glance is done.
            stream?.getTracks().forEach(t => t.stop());
            setCapturing(false);
        }
    }, []);

    return { supported, capturing, captureFrame };
}
