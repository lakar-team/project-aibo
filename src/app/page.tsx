'use client';

import { useState, useRef } from "react";
import Image from "next/image";
import dynamic from 'next/dynamic';
import type { VRM } from '@pixiv/three-vrm';

// Dynamically import the VrmViewer to avoid SSR issues with Three.js
const VrmViewer = dynamic(() => import('@/components/VrmViewer'), { ssr: false });

export default function Home() {
  const [status, setStatus] = useState("Ready. Click to talk.");
  const [isListening, setIsListening] = useState(false);
  const vrmRef = useRef<VRM | null>(null);

  const startListening = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support Speech Recognition. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      setIsListening(true);
      setStatus("Listening...");
    };

    recognition.onresult = async (event: any) => {
      const text = event.results[0][0].transcript;
      setIsListening(false);
      setStatus("Thinking: " + text);

      try {
        const response = await fetch('/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text })
        });

        const data = await response.json();

        if (data.reply) {
          setStatus("Lakar: " + data.reply);
          speak(data.reply);
        } else {
          setStatus("Error: " + (data.error || "Unknown"));
        }
      } catch (err: any) {
        setStatus("Connection Error: " + err.message);
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
      setStatus("Error occurred. Try again.");
    };

    recognition.start();
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const maleVoice = voices.find(v => v.name.includes('Male') || v.name.includes('Google US English'));
    if (maleVoice) utterance.voice = maleVoice;
    window.speechSynthesis.speak(utterance);

    // Simple Lip Sync Mockup
    if (vrmRef.current) {
      vrmRef.current.expressionManager?.setValue('aa', 0.5);
      setTimeout(() => vrmRef.current?.expressionManager?.setValue('aa', 0), 2000);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505]">
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-accent/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-accent-secondary/10 blur-[120px]" />

      {/* Navigation */}
      <nav className="fixed top-0 z-50 flex w-full items-center justify-between px-8 py-6 backdrop-blur-md">
        <div className="text-2xl font-bold tracking-tighter text-white">
          PROJECT <span className="text-accent">AIBO</span>
        </div>
        <div className="hidden gap-8 text-sm font-medium text-zinc-400 sm:flex">
          <a href="#" className="transition-colors hover:text-white">Vision</a>
          <a href="#" className="transition-colors hover:text-white">Technology</a>
          <a href="#" className="transition-colors hover:text-white">Lakar</a>
        </div>
        <button className="rounded-full border border-white/10 bg-white/5 px-6 py-2 text-sm font-medium transition-all hover:bg-white/10">
          Sign In
        </button>
      </nav>

      <main className="relative z-10 mx-auto flex max-w-7xl flex-col items-center px-6 pt-32 pb-24 lg:flex-row lg:pt-48">
        {/* Left Content */}
        <div className="flex flex-1 flex-col items-center text-center lg:items-start lg:text-left">
          <div className="mb-6 inline-block rounded-full border border-accent/20 bg-accent/5 px-4 py-1 text-xs font-semibold tracking-wider text-accent uppercase">
            The Future of Human-AI Connection
          </div>
          <h1 className="mb-6 max-w-2xl text-5xl font-bold leading-[1.1] text-white md:text-7xl">
            Meet <span className="text-gradient">Lakar</span>,<br />
            Your Intelligent Partner.
          </h1>
          <p className="mb-10 max-w-lg text-lg leading-relaxed text-zinc-400 md:text-xl">
            Project AIBO bridges the gap between digital intelligence and human emotion.
            Lakar is more than an assistant; she's a partner designed for the solar-punk era.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row">
            <button
              onClick={startListening}
              className={`glow group flex h-14 items-center justify-center gap-3 rounded-full px-8 font-bold transition-all hover:scale-105 active:scale-95 ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-accent text-black'}`}
            >
              <span className="text-xl">🎙️</span> {isListening ? 'Listening...' : 'Speak to Lakar'}
            </button>
            <button className="flex h-14 items-center justify-center rounded-full border border-white/10 bg-white/5 px-8 font-bold text-white transition-all hover:bg-white/10">
              {status}
            </button>
          </div>

          <div className="mt-12 flex items-center gap-4 text-sm text-zinc-500">
            <div className="flex -space-x-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-8 rounded-full border-2 border-[#050505] bg-zinc-800" />
              ))}
            </div>
            <span>Joined by <span className="text-white font-medium">1,200+</span> early testers</span>
          </div>
        </div>

        {/* Right Asset (3D VRM) */}
        <div className="mt-16 flex flex-1 justify-center lg:mt-0 lg:justify-end">
          <div className="animate-float relative h-[400px] w-[300px] sm:h-[500px] sm:w-[400px] lg:h-[600px] lg:w-[500px]">
            <div className="glass absolute inset-0 overflow-hidden">
              <VrmViewer onLoaded={(vrm) => { vrmRef.current = vrm; }} />
              <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-[#050505] via-transparent to-transparent" />
            </div>
            {/* Floating UI Elements */}
            <div className="glass absolute -left-8 top-1/4 p-4 text-xs font-mono glow">
              <div className="text-accent">READY</div>
              <div className="text-zinc-500">VOICE_SYNC: ACTIVE</div>
            </div>
            <div className="glass absolute -right-4 bottom-1/4 p-4 text-xs font-mono">
              <div className="text-zinc-500 uppercase">{status}</div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer / Social Links */}
      <footer className="mt-auto border-t border-white/5 py-12 px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-8 md:flex-row">
          <div className="text-sm text-zinc-500">
            © 2026 Project AIBO. Built for the future.
          </div>
          <div className="flex gap-6">
            <a href="#" className="h-5 w-5 opacity-50 transition-opacity hover:opacity-100">
              <Image src="/vercel.svg" alt="Vercel" width={20} height={20} className="invert" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
