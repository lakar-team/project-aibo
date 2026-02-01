'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from '@pixiv/three-vrm';

interface VrmViewerProps {
    onLoaded?: (vrm: VRM) => void;
}

export default function VrmViewer({ onLoaded }: VrmViewerProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const vrmRef = useRef<VRM | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        // Setup
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        containerRef.current.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(30, containerRef.current.clientWidth / containerRef.current.clientHeight, 0.1, 20.0);
        camera.position.set(0.0, 1.4, 1.5);

        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(1.0, 1.0, 1.0).normalize();
        scene.add(light);

        // Ambient light for better visibility
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
                if (onLoaded) onLoaded(vrm);
            },
            (progress) => console.log('Loading avatar: ' + (100.0 * progress.loaded / progress.total).toFixed(2) + '%'),
            (error) => console.error('Failed to load avatar:', error)
        );

        // Animation
        const clock = new THREE.Clock();
        let animationId: number;

        const animate = () => {
            animationId = requestAnimationFrame(animate);
            if (vrmRef.current) {
                vrmRef.current.update(clock.getDelta());
            }
            renderer.render(scene, camera);
        };
        animate();

        // Resize
        const handleResize = () => {
            if (!containerRef.current) return;
            renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
            camera.aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
            camera.updateProjectionMatrix();
        };
        window.addEventListener('resize', handleResize);

        const currentContainer = containerRef.current;
        return () => {
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationId);
            renderer.dispose();
            if (currentContainer && currentContainer.contains(renderer.domElement)) {
                currentContainer.removeChild(renderer.domElement);
            }
        };
    }, [onLoaded]);

    return <div ref={containerRef} className="h-full w-full" />;
}
