/**
 * GestureEngine — body language for the Web Witch avatar (Phase 5).
 *
 * Ported from AIBO_Alive's Static/js/motion_core.js (MotionEngine): the same
 * targets-plus-lerp approach — every frame we compute target rotations for
 * each bone (rest pose + breathing + sway + avatar-state offsets, overlaid
 * by a timed gesture), then ease actual rotations toward them. The original's
 * WAVE/DANCE timelines are kept; NOD/SHAKE/BOW/CROSS_ARMS/THINK (referenced
 * but never implemented there) are built in the same style.
 *
 * The engine owns ALL body bones. VrmViewer calls update() once per frame and
 * keeps face-level animation (blink, lip sync, emotions) to itself, so no two
 * systems fight over the same rotations.
 */

import type { VRM } from '@pixiv/three-vrm';

export type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking';

export type GestureName = 'WAVE' | 'NOD' | 'SHAKE' | 'DANCE' | 'BOW' | 'CROSS_ARMS' | 'THINK';

const GESTURE_DURATIONS: Record<GestureName, number> = {
    WAVE: 2.6,
    NOD: 1.4,
    SHAKE: 1.4,
    DANCE: 3.2,
    BOW: 2.4,
    CROSS_ARMS: 3.5,
    THINK: 3.2,
};

interface Vec3 { x: number; y: number; z: number }

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** 0→1→0 envelope over a gesture's lifetime: ease in, hold, ease out. */
function envelope(t: number, duration: number, ramp = 0.35): number {
    if (t <= 0 || t >= duration) return 0;
    if (t < ramp) return smoothstep(t / ramp);
    if (t > duration - ramp) return smoothstep((duration - t) / ramp);
    return 1;
}

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

export class GestureEngine {
    private time = 0;
    private state: AvatarState = 'idle';
    private gesture: { type: GestureName; timer: number; duration: number } | null = null;
    private hipsBaseY: number | null = null;
    private hipsOffset = 0;

    setState(state: AvatarState): void {
        this.state = state;
    }

    getState(): AvatarState {
        return this.state;
    }

    /** Start a gesture; unknown names are ignored (returns false). */
    trigger(name: string | null | undefined): boolean {
        const g = (name ?? '').toUpperCase() as GestureName;
        if (!(g in GESTURE_DURATIONS)) return false;
        this.gesture = { type: g, timer: 0, duration: GESTURE_DURATIONS[g] };
        return true;
    }

    isGesturing(): boolean {
        return this.gesture !== null;
    }

    update(vrm: VRM, delta: number): void {
        if (!vrm.humanoid) return;
        this.time += delta;
        const time = this.time;

        // ---- 1. Baseline targets: rest pose + breathing + gentle sway ----
        const swaySpeed = this.state === 'thinking' ? 0.3 : 0.5; // slow sway while pondering
        const sway = (f: number, amp: number, phase = 0) => Math.sin(time * swaySpeed * f + phase) * amp;

        const head: Vec3 = { x: 0, y: sway(0.3, 0.01), z: 0 };
        const spine: Vec3 = { x: Math.sin(time * 0.8) * 0.02 + sway(0.7, 0.01), y: 0, z: sway(1, 0.02) };
        const armL: Vec3 = { x: sway(0.5, 0.02), y: 0, z: 1.2 + sway(0.8, 0.03) };
        const armR: Vec3 = { x: sway(0.5, 0.02, 0.3), y: 0, z: -1.2 - sway(0.8, 0.03, 0.5) };
        const elbowL: Vec3 = { x: 0, y: -0.3 + sway(0.6, 0.02), z: 0 };
        const elbowR: Vec3 = { x: 0, y: 0.3 + sway(0.6, 0.02, 0.2), z: 0 };
        let hipsY = 0;

        // ---- 2. Avatar state offsets ----
        if (this.state === 'listening') {
            head.x -= 0.06;           // chin up a touch — attentive
            head.z += 0.14;           // tilt toward the camera
            spine.x += 0.03;          // lean in slightly
        } else if (this.state === 'thinking') {
            head.x += 0.14;           // head down, mulling it over
            head.z -= 0.06;
        } else if (this.state === 'speaking') {
            head.x += Math.sin(time * 2.2) * 0.02; // subtle talking bob
        }

        // ---- 3. Gesture overlay ----
        if (this.gesture) {
            this.gesture.timer += delta;
            const g = this.gesture;
            if (g.timer >= g.duration) {
                this.gesture = null;
            } else {
                const e = envelope(g.timer, g.duration, g.type === 'BOW' || g.type === 'CROSS_ARMS' || g.type === 'THINK' ? 0.5 : 0.35);

                switch (g.type) {
                    case 'WAVE':
                        // motion_core.js WAVE, mirrored for the VRM right arm.
                        armR.x = lerp(armR.x, 0, e);
                        armR.z = lerp(armR.z, -2.3, e);
                        elbowR.y = lerp(elbowR.y, -1.7, e);
                        elbowR.z = Math.sin(time * 8) * 0.45 * e;
                        head.z -= 0.08 * e; // friendly tilt while waving
                        break;
                    case 'NOD':
                        head.x += Math.sin(g.timer * 9) * 0.28 * e;
                        break;
                    case 'SHAKE':
                        head.y += Math.sin(g.timer * 9) * 0.38 * e;
                        break;
                    case 'BOW':
                        spine.x += 0.45 * e;
                        head.x += 0.25 * e;
                        armL.z = lerp(armL.z, 1.35, e); // arms to the sides for a neat bow
                        armR.z = lerp(armR.z, -1.35, e);
                        break;
                    case 'DANCE':
                        // motion_core.js DANCE: hip bounce + torso twist, plus alternating arms.
                        hipsY = Math.abs(Math.sin(time * 7)) * 0.04 * e;
                        spine.y += Math.sin(time * 3.5) * 0.22 * e;
                        armL.z = lerp(armL.z, 1.2 - Math.abs(Math.sin(time * 4)) * 0.9, e);
                        armR.z = lerp(armR.z, -1.2 + Math.abs(Math.sin(time * 4 + Math.PI)) * 0.9, e);
                        head.z += Math.sin(time * 3.5) * 0.08 * e;
                        break;
                    case 'CROSS_ARMS':
                        // motion_core.js ARMS.CROSS, mirrored per side.
                        armL.x = lerp(armL.x, 0.6, e);
                        armL.y = lerp(armL.y, 0.5, e);
                        armL.z = lerp(armL.z, 1.15, e);
                        elbowL.y = lerp(elbowL.y, 2.0, e);
                        armR.x = lerp(armR.x, 0.6, e);
                        armR.y = lerp(armR.y, -0.5, e);
                        armR.z = lerp(armR.z, -1.15, e);
                        elbowR.y = lerp(elbowR.y, -2.0, e);
                        break;
                    case 'THINK':
                        // Right hand drifts toward the chin, head tips pensively.
                        armR.x = lerp(armR.x, 0.3, e);
                        armR.z = lerp(armR.z, -1.0, e);
                        elbowR.y = lerp(elbowR.y, -2.3, e);
                        head.x += 0.12 * e;
                        head.z -= 0.12 * e;
                        break;
                }
            }
        }

        // ---- 4. Ease actual bone rotations toward targets ----
        const humanoid = vrm.humanoid;
        const s = Math.min(1, 6 * delta);
        const apply = (boneName: Parameters<typeof humanoid.getNormalizedBoneNode>[0], t: Vec3) => {
            const bone = humanoid.getNormalizedBoneNode(boneName);
            if (!bone) return;
            bone.rotation.x += (t.x - bone.rotation.x) * s;
            bone.rotation.y += (t.y - bone.rotation.y) * s;
            bone.rotation.z += (t.z - bone.rotation.z) * s;
        };

        apply('head', head);
        apply('spine', spine);
        apply('leftUpperArm', armL);
        apply('rightUpperArm', armR);
        apply('leftLowerArm', elbowL);
        apply('rightLowerArm', elbowR);

        const hips = humanoid.getNormalizedBoneNode('hips');
        if (hips) {
            if (this.hipsBaseY === null) this.hipsBaseY = hips.position.y;
            this.hipsOffset += (hipsY - this.hipsOffset) * s;
            hips.position.y = this.hipsBaseY + this.hipsOffset;
        }
    }
}
