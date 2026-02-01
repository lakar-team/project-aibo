'use client';

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { VRM } from '@pixiv/three-vrm';
import type { VrmViewerHandle } from '@/components/VrmViewer';

const VrmViewer = dynamic(() => import('@/components/VrmViewer'), { ssr: false });

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// Inner component that uses useSearchParams
function HomeContent() {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get('embed') === 'true';
  const [previewOpen, setPreviewOpen] = useState(false);

  const [status, setStatus] = useState("Ready. Click to talk or type below.");
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const vrmRef = useRef<VRM | null>(null);
  const vrmViewerRef = useRef<VrmViewerHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // WARM-UP: Trigger welcome message on page load to pre-connect AI and speech
  useEffect(() => {
    const warmupTimer = setTimeout(() => {
      if (messages.length === 0 && !isThinking) {
        console.log("[Web Witch] Warming up AI connection...");
        triggerWelcome();
      }
    }, 2000); // Wait 2 seconds after page load

    return () => clearTimeout(warmupTimer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerWelcome = async () => {
    setIsThinking(true);
    setStatus("Web Witch is waking up...");

    // Try up to 5 times with increasing delays
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`[Web Witch] Welcome attempt ${attempt}/5...`);
        const response = await fetch('/api/brain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: "Greet the visitor warmly and introduce yourself briefly.", isIdlePrompt: true })
        });

        const data = await response.json();
        if (data.reply) {
          setMessages([{ role: 'assistant', content: data.reply }]);
          setStatus("Web Witch: " + data.reply.substring(0, 40) + "...");
          speak(data.reply);
          setIsThinking(false);
          lastInteractionRef.current = Date.now();
          return; // Success!
        }

        // If we got an error, wait and retry
        if (data.error) {
          console.warn(`[Web Witch] Attempt ${attempt} failed:`, data.error);
          await new Promise(r => setTimeout(r, 1000 * attempt)); // Exponential backoff
        }
      } catch (err) {
        console.error(`[Web Witch] Attempt ${attempt} network error:`, err);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    // All attempts failed - show fallback message
    setStatus("Web Witch is resting... Type to wake her!");
    setIsThinking(false);
  };

  // Idle conversation timer (2.5 minutes = 150000ms)
  useEffect(() => {
    const IDLE_TIMEOUT = 150000; // 2.5 minutes

    const checkIdle = () => {
      const timeSinceLastInteraction = Date.now() - lastInteractionRef.current;
      if (timeSinceLastInteraction >= IDLE_TIMEOUT && !isThinking) {
        triggerIdleConversation();
      }
    };

    idleTimerRef.current = setInterval(checkIdle, 30000); // Check every 30 seconds

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [isThinking]);

  const triggerIdleConversation = async () => {
    lastInteractionRef.current = Date.now(); // Reset timer
    setIsThinking(true);
    setStatus("Web Witch is thinking...");

    try {
      const response = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "Start a conversation about your master Adam.", isIdlePrompt: true })
      });

      const data = await response.json();
      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        setStatus("Web Witch: " + data.reply.substring(0, 40) + "...");
        speak(data.reply);
      }
    } catch (err) {
      console.error("Idle conversation error:", err);
    } finally {
      setIsThinking(false);
    }
  };

  const sendMessage = async (text: string, isIdle = false) => {
    if (!text.trim()) return;

    lastInteractionRef.current = Date.now(); // Reset idle timer

    // Add user message (unless idle prompt)
    if (!isIdle) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
    }
    setInputText("");
    setIsThinking(true);
    setStatus("Thinking...");

    try {
      const response = await fetch('/api/brain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, isIdlePrompt: isIdle })
      });

      const data = await response.json();

      if (data.reply) {
        setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
        setStatus("Web Witch: " + data.reply.substring(0, 40) + "...");
        speak(data.reply);
      } else {
        setStatus("Error: " + (data.error || "Unknown"));
      }
    } catch (err: any) {
      setStatus("Connection Error: " + err.message);
    } finally {
      setIsThinking(false);
    }
  };

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
      await sendMessage(text);
    };

    recognition.onerror = () => {
      setIsListening(false);
      setStatus("Error occurred. Try again.");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    // Prioritize specific high-quality female voices, then fallback to any female voice
    const femaleVoice = voices.find(v =>
      v.name.includes("Google UK English Female") ||
      v.name.includes("Google US English") || // Often sounds better than default
      v.name.includes("Samantha") ||
      v.name.toLowerCase().includes("female")
    );

    if (femaleVoice) {
      utterance.voice = femaleVoice;
      // Slightly higher pitch for a more feminine tone if needed
      utterance.pitch = 1.1;
      utterance.rate = 1.0;
    }

    // Trigger lip sync through the VrmViewer ref
    if (vrmViewerRef.current) {
      vrmViewerRef.current.speakWithLipSync(text);
    }

    window.speechSynthesis.speak(utterance);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(inputText);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#050505]">
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] h-[500px] w-[500px] rounded-full bg-[#00f2ff]/10 blur-[120px]" />
      <div className="absolute bottom-[-10%] right-[-10%] h-[500px] w-[500px] rounded-full bg-[#7000ff]/10 blur-[120px]" />

      {/* Navigation */}
      <nav className={`fixed top-0 z-50 flex w-full items-center justify-between px-8 py-4 backdrop-blur-md ${isEmbedded ? 'hidden' : ''}`}>
        <div className="text-xl font-bold tracking-tighter text-white">
          PROJECT <span className="text-[#00f2ff]">AIBO</span>
        </div>
        <div className="text-xs text-zinc-500">{status}</div>
      </nav>

      <main className="relative z-10 flex h-screen flex-col lg:flex-row overflow-hidden">
        {/* Left: 3D Avatar */}
        <div className={`${isEmbedded ? 'absolute inset-0 z-0 h-full w-full' : 'relative flex h-[40vh] w-full items-center justify-center lg:h-full lg:w-1/2'}`}>
          <div className="relative h-full w-full">
            <VrmViewer ref={vrmViewerRef} isEmbedded={isEmbedded} onLoaded={(vrm) => { vrmRef.current = vrm; }} />
            <div className={`absolute inset-0 pointer-events-none ${isEmbedded ? 'bg-gradient-to-b from-black/30 via-transparent to-black/60' : 'bg-gradient-to-t from-[#050505] via-transparent to-transparent'}`} />
          </div>

          {/* Voice Button Overlay */}
          <button
            onClick={startListening}
            className={`absolute left-1/2 -translate-x-1/2 z-20 flex h-16 w-16 items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 ${isListening ? 'bg-red-500 animate-pulse' : 'bg-[#00f2ff] shadow-[0_0_30px_rgba(0,242,255,0.4)]'
              } ${isEmbedded ? 'bottom-24' : 'bottom-8'}`}
          >
            <span className="text-2xl">{isListening ? '🔴' : '🎙️'}</span>
          </button>
        </div>

        {/* Right: Chat Interface */}
        <div className={`${isEmbedded ? 'absolute bottom-0 z-10 w-full h-[45%] flex flex-col bg-gradient-to-t from-black via-black/90 to-transparent pointer-events-none' : 'flex h-[60vh] w-full flex-col lg:h-full lg:w-1/2'}`}>
          {/* Chat Messages */}
          <div className={`flex-1 overflow-y-auto p-6 ${isEmbedded ? 'pt-4 pointer-events-auto scrollbar-hide' : 'pt-20 custom-scrollbar'}`}>
            {messages.length === 0 && !isEmbedded && (
              <div className="flex h-full items-center justify-center text-center text-zinc-600">
                <div>
                  <p className="text-lg font-medium text-zinc-400">Talk or chat with Web Witch</p>
                  <p className="mt-2 text-sm">Click the microphone or type below</p>
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`mb-4 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${msg.role === 'user'
                  ? 'bg-[#00f2ff]/20 text-white backdrop-blur-sm'
                  : 'bg-black/40 text-zinc-200 border border-white/10 backdrop-blur-sm'
                  }`}>
                  {msg.role === 'assistant' && (
                    <div className="mb-0.5 text-[10px] font-bold text-[#00f2ff] uppercase tracking-wider">Web Witch</div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {isThinking && (
              <div className="mb-4 flex justify-start">
                <div className="max-w-[80%] rounded-2xl bg-black/40 px-4 py-3 text-zinc-400 border border-white/10 backdrop-blur-sm">
                  <div className="flex gap-1">
                    <span className="animate-bounce">.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.1s' }}>.</span>
                    <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Text Input */}
          <div className={`border-t border-white/10 p-4 ${isEmbedded ? 'pointer-events-auto bg-black/80 backdrop-blur-md' : ''}`}>
            <div className="flex gap-3">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isThinking && inputText.trim()) {
                      sendMessage(inputText);
                    }
                  }
                }}
                placeholder={isThinking ? "Web Witch is thinking..." : "Type a message..."}
                className={`flex-1 rounded-full bg-white/5 px-6 py-3 text-white placeholder-zinc-500 outline-none border border-white/10 focus:border-[#00f2ff]/50 transition-colors ${isThinking ? 'opacity-50' : 'opacity-100'}`}
              />
              <button
                onClick={() => sendMessage(inputText)}
                disabled={isThinking || !inputText.trim()}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-[#00f2ff] text-black font-bold transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Dev Preview Button - Only visible when NOT embedded */}
      {!isEmbedded && (
        <>
          <button
            onClick={() => setPreviewOpen(!previewOpen)}
            className="fixed bottom-4 right-4 z-50 px-4 py-2 bg-zinc-800/80 border border-zinc-700 text-zinc-400 text-xs rounded hover:text-white transition-colors"
          >
            {previewOpen ? 'Close Preview' : 'Preview Embed'}
          </button>

          {previewOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
              <div className="relative border border-amber-500/30 rounded-lg overflow-hidden shadow-2xl bg-black">
                <div className="absolute top-2 right-2 z-10">
                  <button
                    onClick={() => setPreviewOpen(false)}
                    className="w-6 h-6 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-red-500/50"
                  >
                    ✕
                  </button>
                </div>
                <iframe
                  src="/?embed=true"
                  className="w-[400px] h-[650px] border-0"
                  title="Embed Preview"
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Wrap with Suspense for useSearchParams
export default function Home() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#050505]" />}>
      <HomeContent />
    </Suspense>
  );
}
