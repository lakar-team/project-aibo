'use client';

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';
import { GestureEngine, type AvatarState } from '@/lib/gestures';

interface VrmViewerProps {
    onLoaded?: (vrm: VRM) => void;
    isEmbedded?: boolean;
    /** Returns current TTS audio RMS (0 when silent) — drives the mouth when Kokoro speaks. */
    getAudioLevel?: () => number;
}

export interface VrmViewerHandle {
    speakWithLipSync: (text: string) => void;
    setFacingDirection: (direction: 'front' | 'back') => void;
    /** Show an emotion on the face (VRM preset name); eases in, decays after 6s. */
    setEmotion: (emotion: string | null | undefined) => void;
    /** Play a body gesture (WAVE/NOD/SHAKE/DANCE/BOW/CROSS_ARMS/THINK); unknown → ignored. */
    playGesture: (gesture: string | null | undefined) => void;
    /** Drive the avatar state machine: idle | listening | thinking | speaking. */
    setAvatarState: (state: AvatarState) => void;
}

// VRM 1.0 expression presets a VRoid export ships with.
const VALID_EMOTIONS = new Set(['happy', 'angry', 'sad', 'relaxed', 'surprised']);
const EMOTION_WEIGHT = 0.7;
const EMOTION_RAMP = 0.4;  // seconds ease in/out
const EMOTION_HOLD = 6.0;  // seconds before decay starts

const VrmViewer = forwardRef<VrmViewerHandle, VrmViewerProps>(({ onLoaded, isEmbedded, getAudioLevel }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);
    const isSpeakingRef = useRef(false);
    const targetRotationRef = useRef<number>(Math.PI); // Default: facing front (model is rotated 180°)

    // Kept in refs so the scene-setup effect doesn't tear down and rebuild the
    // whole Three.js scene (and re-download the VRM) when the parent re-renders
    // with fresh function identities — which happens on every streamed token.
    const getAudioLevelRef = useRef<VrmViewerProps['getAudioLevel']>(getAudioLevel);
    getAudioLevelRef.current = getAudioLevel;
    const onLoadedRef = useRef<VrmViewerProps['onLoaded']>(onLoaded);
    onLoadedRef.current = onLoaded;

    // Body language engine (Phase 5) — owns all body-bone animation.
    const engineRef = useRef<GestureEngine>(new GestureEngine());
    // Active facial emotion: name + elapsed time (drives ease-in/hold/decay).
    const emotionRef = useRef<{ name: string; timer: number } | null>(null);

    // Expose functions to parent
    useImperativeHandle(ref, () => ({
        speakWithLipSync: (text: string) => {
            isSpeakingRef.current = true;
            const duration = Math.min(text.length * 80, 10000);
            setTimeout(() => {
                isSpeakingRef.current = false;
            }, duration);
        },
        setFacingDirection: (direction: 'front' | 'back') => {
            // 'front': face camera (rotation.y = Math.PI)
            // 'back': face away (rotation.y = 0)
            targetRotationRef.current = direction === 'front' ? Math.PI : 0;
        },
        setEmotion: (emotion) => {
            const name = (emotion ?? '').toLowerCase();
            const prev = emotionRef.current;
            if (prev && prev.name !== name) {
                // Snap the outgoing emotion off; the new one eases in.
                vrmRef.current?.expressionManager?.setValue(prev.name, 0);
            }
            emotionRef.current = VALID_EMOTIONS.has(name) ? { name, timer: 0 } : null;
        },
        playGesture: (gesture) => {
            engineRef.current.trigger(gesture);
        },
        setAvatarState: (state) => {
            engineRef.current.setState(state);
        },
    }));

    useEffect(() => {
        if (!containerRef.current) return;

        // Setup renderer
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 20.0);
        // Initial camera position
        // isEmbedded: zoom out more (z=1.4) and aim higher to lower avatar (y=1.5)
        // Main: zoom out more (z=1.75) and aim higher (y=1.5)
        if (isEmbedded) {
            camera.position.set(0.0, 1.5, 1.4);
        } else {
            camera.position.set(0.0, 1.5, 1.75);
        }

        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(1.0, 1.0, 1.0).normalize();
        scene.add(light);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        // Load VRM
        const loader = new GLTFLoader();
        loader.register((parser: unknown) => {
            return new VRMLoaderPlugin(parser as ConstructorParameters<typeof VRMLoaderPlugin>[0]);
        });

        loader.load(
            '/avatar.vrm',
            (gltf) => {
                const vrm = gltf.userData.vrm as VRM;
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.combineSkeletons(gltf.scene);
                vrm.scene.rotation.y = Math.PI;
                scene.add(vrm.scene);
                vrmRef.current = vrm;
                onLoadedRef.current?.(vrm);
            },
            (progress) => console.log('Loading avatar: ' + (100.0 * progress.loaded / progress.total).toFixed(2) + '%'),
            (error) => console.error('Failed to load avatar:', error)
        );

        // Animation state
        const clock = new THREE.Clock();
        let animationId: number;
        let mouthLevel = 0; // smoothed audio-driven mouth openness
        let blinkTimer = 0;
        let nextBlinkTime = Math.random() * 3 + 2; // Random blink every 2-5 seconds
        let isBlinking = false;
        let blinkProgress = 0;

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            const delta = clock.getDelta();
            const elapsed = clock.getElapsedTime();

            if (vrmRef.current) {
                const vrm = vrmRef.current;
                vrm.update(delta);

                // === SMOOTH ROTATION TO TARGET ===
                // Lerp the model's Y rotation toward the target (for facing front/back)
                const currentRotation = vrm.scene.rotation.y;
                const targetRotation = targetRotationRef.current;
                const rotationDiff = targetRotation - currentRotation;
                if (Math.abs(rotationDiff) > 0.01) {
                    vrm.scene.rotation.y += rotationDiff * 0.05; // Smooth lerp factor
                }

                // === BODY LANGUAGE (Phase 5) ===
                // Rest pose, breathing, sway, avatar states, and gestures all
                // live in the GestureEngine — one owner per bone.
                engineRef.current.update(vrm, delta);

                // === FACIAL EMOTION ===
                // Ease in over 400ms, hold at 0.7, decay to neutral after 6s.
                const emo = emotionRef.current;
                if (emo) {
                    emo.timer += delta;
                    let weight: number;
                    if (emo.timer < EMOTION_RAMP) {
                        weight = (emo.timer / EMOTION_RAMP) * EMOTION_WEIGHT;
                    } else if (emo.timer < EMOTION_HOLD) {
                        weight = EMOTION_WEIGHT;
                    } else if (emo.timer < EMOTION_HOLD + EMOTION_RAMP) {
                        weight = (1 - (emo.timer - EMOTION_HOLD) / EMOTION_RAMP) * EMOTION_WEIGHT;
                    } else {
                        weight = 0;
                    }
                    vrm.expressionManager?.setValue(emo.name, Math.max(0, weight));
                    if (weight <= 0) {
                        emotionRef.current = null;
                    }
                }

                // === NATURAL BLINKING ===
                blinkTimer += delta;
                if (!isBlinking && blinkTimer >= nextBlinkTime) {
                    isBlinking = true;
                    blinkProgress = 0;
                }

                if (isBlinking) {
                    blinkProgress += delta * 8; // Blink speed
                    const blinkValue = blinkProgress < 0.5
                        ? blinkProgress * 2 // Closing
                        : 2 - blinkProgress * 2; // Opening

                    vrm.expressionManager?.setValue('blink', Math.max(0, Math.min(1, blinkValue)));

                    if (blinkProgress >= 1) {
                        isBlinking = false;
                        blinkTimer = 0;
                        nextBlinkTime = Math.random() * 3 + 2; // Reset random interval
                        vrm.expressionManager?.setValue('blink', 0);
                    }
                }

                // === LIP SYNC ===
                // Preferred: amplitude-driven mouth from the Kokoro audio chain
                // (AnalyserNode RMS). Fallback: the old text-length sine wave,
                // used while browser speechSynthesis speaks (no audio tap there).
                const audioLevel = getAudioLevelRef.current?.() ?? 0;
                if (audioLevel > 0.005) {
                    // Attack fast, release slower — reads as natural articulation.
                    const target = Math.min(1, audioLevel * 6.5);
                    mouthLevel += (target - mouthLevel) * (target > mouthLevel ? 0.55 : 0.28);
                    vrm.expressionManager?.setValue('aa', mouthLevel);
                    vrm.expressionManager?.setValue('oh', mouthLevel * 0.25);
                    vrm.expressionManager?.setValue('ee', 0);
                } else if (isSpeakingRef.current) {
                    // Simulate mouth movement with varying vowel shapes
                    const aaAmount = (Math.sin(elapsed * 15) + 1) * 0.25;
                    const ohAmount = (Math.cos(elapsed * 10) + 1) * 0.15;

                    vrm.expressionManager?.setValue('aa', aaAmount);
                    vrm.expressionManager?.setValue('oh', ohAmount);
                    vrm.expressionManager?.setValue('ee', (Math.sin(elapsed * 8) + 1) * 0.1);
                } else {
                    // Reset mouth when not speaking (ease shut, don't snap)
                    mouthLevel += (0 - mouthLevel) * 0.3;
                    vrm.expressionManager?.setValue('aa', mouthLevel < 0.02 ? 0 : mouthLevel);
                    vrm.expressionManager?.setValue('oh', 0);
                    vrm.expressionManager?.setValue('ee', 0);
                }
            }

            renderer.render(scene, camera);
        };
        animate();

        // Resize handling: a ResizeObserver on the container fires on initial
        // layout too — the container can measure 0×0 at mount (hydration runs
        // before CSS layout), which used to leave the canvas permanently empty.
        const handleResize = () => {
            if (!containerRef.current) return;
            const { clientWidth, clientHeight } = containerRef.current;
            if (clientWidth === 0 || clientHeight === 0) return;
            renderer.setSize(clientWidth, clientHeight);
            camera.aspect = clientWidth / clientHeight;
            camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', handleResize);
        const resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(containerRef.current);

        const currentContainer = containerRef.current;
        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
            cancelAnimationFrame(animationId);
            renderer.dispose();
            if (currentContainer && currentContainer.contains(renderer.domElement)) {
                currentContainer.removeChild(renderer.domElement);
            }
        };
    }, [isEmbedded]);

    return <div ref={containerRef} className="h-full w-full" />;
});

VrmViewer.displayName = 'VrmViewer';

export default VrmViewer;
