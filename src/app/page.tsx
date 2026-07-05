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

// Final NDJSON frame from /api/brain — the full structured reply.
interface BrainDone {
  reply: string;
  emotion?: string;
  gesture?: string | null;
  memorable?: string | null;
  lang?: string;
  model?: string;
  provider?: string;
}

// POSTs to /api/brain and reads the NDJSON stream.
// onToken receives the accumulated reply text as tokens arrive.
async function streamBrain(
  message: string,
  history: Message[],
  isIdlePrompt: boolean,
  onToken: (textSoFar: string) => void
): Promise<BrainDone> {
  const response = await fetch('/api/brain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, isIdlePrompt }),
  });

  if (!response.ok || !response.body) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      if (data.error) detail = data.error;
    } catch { /* body wasn't JSON */ }
    throw new Error(detail);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let streamed = '';
  let done: BrainDone | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let ev: { t?: string; error?: string; done?: boolean } & BrainDone;
    try { ev = JSON.parse(line); } catch { return; }
    if (typeof ev.t === 'string') { streamed += ev.t; onToken(streamed); }
    if (ev.error) throw new Error(ev.error);
    if (ev.done) done = ev;
  };

  while (true) {
    const { done: readerDone, value } = await reader.read();
    if (readerDone) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  }
  if (buf) handleLine(buf);

  if (done) return done;
  if (streamed) return { reply: streamed };
  throw new Error('Empty response from brain');
}

// Inner component that uses useSearchParams
function HomeContent() {
  const searchParams = useSearchParams();
  const isEmbedded = searchParams.get('embed') === 'true';
  const [previewOpen, setPreviewOpen] = useState(false);

  const [status, setStatus] = useState("Establishing connection...");
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isThinking, setIsThinking] = useState(false);

  // Connection phase for intergalactic dialing experience
  type ConnectionPhase = 'dialing' | 'voice-check' | 'ready' | 'error';
  const [connectionPhase, setConnectionPhase] = useState<ConnectionPhase>('dialing');
  const [loadingComplete, setLoadingComplete] = useState(false); // Bell only shows after loading

  const vrmRef = useRef<VRM | null>(null);
  const vrmViewerRef = useRef<VrmViewerHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastInteractionRef = useRef<number>(Date.now());

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Track if VRM is loaded for initial rotation
  const vrmLoadedRef = useRef(false);

  // INTERGALACTIC DIALING: Multi-phase connection experience
  useEffect(() => {
    const dialingTimer = setTimeout(() => {
      if (messages.length === 0 && !isThinking) {
        console.log("[Web Witch] Initiating interdimensional connection...");
        initiateConnection();
      }
    }, 1500); // Start dialing after 1.5 seconds

    return () => clearTimeout(dialingTimer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Callback when VRM loads - set initial facing direction
  const handleVrmLoaded = (vrm: any) => {
    vrmRef.current = vrm;
    vrmLoadedRef.current = true;
  };

  // Phase 1: Establish AI connection (silent)
  const initiateConnection = async () => {
    setConnectionPhase('dialing');
    setStatus("Channeling interdimensional frequencies...");

    // Try to connect to AI (silent, no speech yet)
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`[Web Witch] Connection attempt ${attempt}/5...`);
        const done = await streamBrain("Respond with ONLY: Ready.", [], true, () => {});
        if (done.reply) {
          console.log("[Web Witch] AI connected! Starting voice check...");
          performVoiceCheck();
          return;
        }
      } catch (err) {
        console.warn(`[Web Witch] Attempt ${attempt} failed:`, err);
        setStatus(`Gathering arcane energy... (${attempt}/5)`);
        await new Promise(r => setTimeout(r, 1000 * attempt));
      }
    }

    // All attempts failed - show the bell for user interaction
    console.log("[Web Witch] All connection attempts failed, showing summon bell");
    setLoadingComplete(true); // Now show the bell
    setStatus("Tap the bell to summon me...");
  };

  // Phase 2: Voice check (warm up TTS)
  const performVoiceCheck = async () => {
    setConnectionPhase('voice-check');
    setStatus("Attuning voice frequencies...");

    // Wait for voices to load (they load async in most browsers)
    const waitForVoices = (): Promise<SpeechSynthesisVoice[]> => {
      return new Promise((resolve) => {
        const voices = speechSynthesis.getVoices();
        if (voices.length > 0) {
          resolve(voices);
        } else {
          speechSynthesis.addEventListener('voiceschanged', () => {
            resolve(speechSynthesis.getVoices());
          }, { once: true });
          // Timeout after 2 seconds
          setTimeout(() => resolve(speechSynthesis.getVoices()), 2000);
        }
      });
    };

    if ('speechSynthesis' in window) {
      await waitForVoices();

      const voiceCheckPhrase = "Voice check... one, two.";
      const utterance = new SpeechSynthesisUtterance(voiceCheckPhrase);
      utterance.rate = 0.9;
      utterance.pitch = 1.1;

      // Try to find a female voice
      const voices = speechSynthesis.getVoices();
      const femaleVoice = voices.find(v =>
        v.name.includes("Google UK English Female") ||
        v.name.includes("Samantha") ||
        v.name.toLowerCase().includes("female")
      );
      if (femaleVoice) utterance.voice = femaleVoice;

      let voiceCheckResolved = false;

      utterance.onend = () => {
        if (!voiceCheckResolved) {
          voiceCheckResolved = true;
          console.log("[Web Witch] Voice check complete! Turning around...");
          completeConnection();
        }
      };

      utterance.onerror = (e) => {
        if (!voiceCheckResolved) {
          voiceCheckResolved = true;
          console.warn("[Web Witch] Voice check error:", e.error);
          // Still proceed - the greeting will try TTS again
          completeConnection();
        }
      };

      // Cancel any pending speech and speak
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);

      // Fallback timeout - if TTS is silently blocked, proceed after 3s
      setTimeout(() => {
        if (!voiceCheckResolved) {
          voiceCheckResolved = true;
          console.warn("[Web Witch] Voice check timed out - TTS may be blocked");
          completeConnection();
        }
      }, 3000);
    } else {
      // TTS not supported, skip voice check
      completeConnection();
    }
  };

  // Phase 3: Complete connection (avatar turns, real greeting)
  const completeConnection = async () => {
    setConnectionPhase('ready');
    setIsThinking(true);
    setStatus("Link forged!");

    // Fallback greeting when AI is unavailable
    const fallbackGreeting = "Greetings, traveler! I am Web Witch, mystical guide to Adam's digital realm. The cosmic energies are a bit unstable right now, but feel free to type your questions or use voice to summon my wisdom!";

    // Fetch the real AI greeting (streamed live into the chat)
    try {
      const done = await streamBrain(
        "Greet the visitor warmly. Introduce yourself as Web Witch and offer to help them explore Adam's portfolio.",
        [],
        true,
        (textSoFar) => setMessages([{ role: 'assistant', content: textSoFar }])
      );
      const reply = done.reply || fallbackGreeting;
      setMessages([{ role: 'assistant', content: reply }]);
      setStatus("Web Witch: " + reply.substring(0, 40) + "...");
      console.log("[Web Witch] greeting meta:", { emotion: done.emotion, gesture: done.gesture, lang: done.lang, model: done.model, provider: done.provider });
      speak(reply);
      lastInteractionRef.current = Date.now();
    } catch (err) {
      // Network error or 503 - use fallback greeting
      console.error("[Web Witch] Greeting fetch failed, using fallback:", err);
      setMessages([{ role: 'assistant', content: fallbackGreeting }]);
      setStatus("Web Witch is ready!");
      speak(fallbackGreeting);
      lastInteractionRef.current = Date.now();
    } finally {
      setIsThinking(false);
    }
  };

  // Idle auto-chat disabled — Web Witch only responds when prompted.

  const sendMessage = async (text: string, isIdle = false) => {
    if (!text.trim()) return;

    lastInteractionRef.current = Date.now(); // Reset idle timer

    // Prior turns only — the current message goes in the `message` field.
    const history = messages;

    // Add user message (unless idle prompt)
    if (!isIdle) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
    }
    setInputText("");
    setIsThinking(true);
    setStatus("Thinking...");

    // Streaming UI: append an assistant bubble on the first token,
    // then keep replacing its content as tokens accumulate.
    let assistantAdded = false;
    const upsertAssistant = (content: string) => {
      setMessages(prev => {
        const next = prev.slice();
        if (assistantAdded && next.length > 0 && next[next.length - 1].role === 'assistant') {
          next[next.length - 1] = { role: 'assistant', content };
        } else {
          assistantAdded = true;
          next.push({ role: 'assistant', content });
        }
        return next;
      });
    };

    try {
      const done = await streamBrain(text, history, isIdle, upsertAssistant);
      const reply = done.reply || '';

      if (reply) {
        upsertAssistant(reply); // finalize with the canonical parsed reply
        setStatus("Web Witch: " + reply.substring(0, 40) + "...");
        // Phase 5 wires these into the avatar; Phase 3 uses lang for TTS voice.
        console.log("[Web Witch] reply meta:", {
          emotion: done.emotion, gesture: done.gesture, lang: done.lang,
          memorable: done.memorable, model: done.model, provider: done.provider,
        });
        speak(reply);
      } else {
        setStatus("Error: empty reply");
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
    console.log("[Web Witch] Speaking:", text.substring(0, 50) + "...");

    // Cancel any pending speech
    window.speechSynthesis.cancel();

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

    utterance.onerror = (e) => {
      console.error("[Web Witch] TTS Error:", e.error);
    };

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
            <VrmViewer ref={vrmViewerRef} isEmbedded={isEmbedded} onLoaded={handleVrmLoaded} />
            <div className={`absolute inset-0 pointer-events-none ${isEmbedded ? 'bg-gradient-to-b from-black/30 via-transparent to-black/60' : 'bg-gradient-to-t from-[#050505] via-transparent to-transparent'}`} />

            {/* Mystical Summoning Overlay */}
            {connectionPhase !== 'ready' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-20 transition-opacity duration-1000">
                {/* Rotating Summoning Circle */}
                <div className="relative flex items-center justify-center">
                  {/* Outer rotating ring with glyphs */}
                  <div className="absolute w-72 h-72 rounded-full border border-[#7000ff]/40 animate-spin" style={{ animationDuration: '20s' }}>
                    {/* Arcane symbols positioned around the ring */}
                    {['✧', '◇', '✦', '◈', '✧', '◇', '✦', '◈'].map((glyph, i) => (
                      <span
                        key={i}
                        className="absolute text-[#00f2ff]/60 text-lg"
                        style={{
                          left: '50%',
                          top: '50%',
                          transform: `rotate(${i * 45}deg) translateY(-140px) rotate(-${i * 45}deg)`,
                        }}
                      >
                        {glyph}
                      </span>
                    ))}
                  </div>

                  {/* Middle rotating ring (opposite direction) */}
                  <div className="absolute w-52 h-52 rounded-full border-2 border-[#00f2ff]/30" style={{ animation: 'spin 15s linear infinite reverse' }} />

                  {/* Inner pulsing ring */}
                  <div className="absolute w-36 h-36 rounded-full border border-[#00f2ff]/50 animate-pulse" />

                  {/* Center: Show pulsing orb while loading, bell after loading completes */}
                  {!loadingComplete ? (
                    // Pulsing orb during loading
                    <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#00f2ff]/20 to-[#7000ff]/30 backdrop-blur-sm border-2 border-[#00f2ff]/60 flex items-center justify-center shadow-[0_0_40px_rgba(0,242,255,0.3)]">
                      <div className="w-4 h-4 rounded-full bg-[#00f2ff] animate-pulse shadow-[0_0_20px_rgba(0,242,255,0.8)]" />
                    </div>
                  ) : (
                    // Summon Bell after loading completes
                    <button
                      onClick={() => {
                        console.log("[Web Witch] Summon bell pressed!");
                        setConnectionPhase('ready');
                        const fallbackGreeting = "Greetings, traveler! I am Web Witch, mystical guide to Adam's digital realm. What knowledge do you seek?";
                        setMessages([{ role: 'assistant', content: fallbackGreeting }]);
                        setStatus("Web Witch is ready!");
                        speak(fallbackGreeting);
                        lastInteractionRef.current = Date.now();
                      }}
                      className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#00f2ff]/20 to-[#7000ff]/30 backdrop-blur-sm border-2 border-[#00f2ff]/60 flex items-center justify-center shadow-[0_0_40px_rgba(0,242,255,0.3)] cursor-pointer hover:scale-110 hover:shadow-[0_0_60px_rgba(0,242,255,0.5)] transition-all active:scale-95"
                      aria-label="Summon Web Witch"
                    >
                      <span className="text-3xl">🔔</span>
                    </button>
                  )}
                </div>

                {/* Status Text - Mystical Language */}
                <div className="mt-16 text-center">
                  <p className="text-[#00f2ff] text-sm font-mono tracking-widest uppercase animate-pulse">
                    {connectionPhase === 'dialing' && '✦ SUMMONING PRESENCE ✦'}
                    {connectionPhase === 'voice-check' && '✧ ATTUNING ESSENCE ✧'}
                  </p>
                  <p className="text-zinc-400 text-xs mt-3 font-light italic max-w-xs">{status}</p>
                  {loadingComplete && (
                    <p className="text-[#00f2ff]/80 text-xs mt-4 font-semibold animate-bounce">
                      ↑ Tap the bell to summon me ↑
                    </p>
                  )}
                </div>
              </div>
            )}
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
