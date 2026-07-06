'use client';

import { useState, useRef, useEffect, Suspense } from "react";
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import type { VRM } from '@pixiv/three-vrm';
import type { VrmViewerHandle } from '@/components/VrmViewer';
import { useKokoroTTS, kokoroVoiceFor } from '@/hooks/useKokoroTTS';
import { useMicrophone } from '@/hooks/useMicrophone';
import { useWebcam } from '@/hooks/useWebcam';
import { wantsVision } from '@/lib/vision';

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
  tier?: number;
  model?: string;
  provider?: string;
}

// POSTs to /api/brain and reads the NDJSON stream.
// onToken receives the accumulated reply text as tokens arrive.
async function streamBrain(
  message: string,
  history: Message[],
  isIdlePrompt: boolean,
  onToken: (textSoFar: string) => void,
  onStatus?: (text: string) => void,
  onLang?: (lang: string) => void,
  langHint?: string,
  image?: string
): Promise<BrainDone> {
  const response = await fetch('/api/brain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, isIdlePrompt, lang: langHint, image }),
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
    let ev: { t?: string; error?: string; done?: boolean; status?: string; text?: string } & BrainDone;
    try { ev = JSON.parse(line); } catch { return; }
    if (typeof ev.t === 'string') { streamed += ev.t; onToken(streamed); }
    if (typeof ev.status === 'string' && ev.text) onStatus?.(ev.text);
    // Early language frame — arrives before tokens so TTS can pick a voice.
    if (typeof ev.lang === 'string' && !ev.done) onLang?.(ev.lang);
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
  const [transcribing, setTranscribing] = useState(false);
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

  // Kokoro neural TTS (Phase 3). Model download starts on first user
  // interaction; until it's ready, browser speechSynthesis is the fallback.
  const {
    speak: kokoroSpeak,
    speakQueue: kokoroSpeakQueue,
    stop: kokoroStop,
    warmup: kokoroWarmup,
    loading: ttsLoading,
    ready: ttsReady,
    error: ttsError,
    getLevel: ttsGetLevel,
    isSpeaking: kokoroSpeaking,
  } = useKokoroTTS();

  // warmup() on first user interaction — also satisfies the browser gesture
  // requirement for the AudioContext the naturalizer creates lazily.
  useEffect(() => {
    const onFirstInteraction = () => {
      kokoroWarmup();
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
    window.addEventListener('pointerdown', onFirstInteraction);
    window.addEventListener('keydown', onFirstInteraction);
    return () => {
      window.removeEventListener('pointerdown', onFirstInteraction);
      window.removeEventListener('keydown', onFirstInteraction);
    };
  }, [kokoroWarmup]);

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
    const fallbackGreeting = "Greetings, traveler! I am Web Witch, your mystical companion. The cosmic energies are a bit unstable right now, but feel free to type or speak — I'm listening!";

    // Fetch the real AI greeting (streamed live into the chat)
    try {
      const done = await streamBrain(
        "Greet the visitor warmly. Introduce yourself as Web Witch, their mystical companion, and ask what's on their mind.",
        [],
        true,
        (textSoFar) => setMessages([{ role: 'assistant', content: textSoFar }])
      );
      const reply = done.reply || fallbackGreeting;
      setMessages([{ role: 'assistant', content: reply }]);
      setStatus("Web Witch: " + reply.substring(0, 40) + "...");
      console.log("[Web Witch] greeting meta:", { emotion: done.emotion, gesture: done.gesture, lang: done.lang, model: done.model, provider: done.provider });
      vrmViewerRef.current?.setEmotion(done.emotion);
      vrmViewerRef.current?.playGesture(done.gesture);
      speakSmart(reply, done.lang ?? 'en');
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

  const sendMessage = async (text: string, isIdle = false, langHint?: string) => {
    if (!text.trim()) return;

    lastInteractionRef.current = Date.now(); // Reset idle timer

    // Prior turns only — the current message goes in the `message` field.
    const history = messages;

    // Add user message (unless idle prompt)
    if (!isIdle) {
      setMessages(prev => [...prev, { role: 'user', content: text }]);
    }
    setInputText("");

    // ---- Vision (Phase 6): capture one consented frame when invited ----
    let image: string | undefined;
    const visionWanted = !isIdle && wantsVision(text);
    console.log(`[Web Witch] vision check: wants=${visionWanted} camSupported=${camSupported} eyes=${eyesModeRef.current}`);
    if (visionWanted && camSupported && eyesModeRef.current !== 'off') {
      const consented = visionConsentRef.current || await askVisionConsent();
      console.log(`[Web Witch] vision consent: ${consented} (remembered=${visionConsentRef.current})`);
      if (consented) {
        visionConsentRef.current = true;
        try { localStorage.setItem('aibo:eyes-consent', 'granted'); } catch { /* ignore */ }
        setStatus("Opening the crystal eye…");
        try {
          image = await captureFrame(); // camera closes right after this
          console.log(`[Web Witch] vision frame captured: ${image.length} base64 chars`);
        } catch (err) {
          // Browser permission denied (or no camera) — graceful spoken apology.
          console.warn("[Web Witch] camera unavailable:", err);
          const apology =
            "I tried to open my crystal eye, but the window stayed shut — your browser wouldn't let me see. Ask me again once the camera is allowed, or just describe it to me.";
          setMessages(prev => [...prev, { role: 'assistant', content: apology }]);
          setStatus("Web Witch is ready!");
          speakSmart(apology, 'en');
          return; // the apology is the answer; no brain call without sight
        }
      }
    }

    setIsThinking(true);
    setStatus("Thinking...");

    // Silence any previous speech before the new reply starts.
    kokoroStop();
    window.speechSynthesis.cancel();

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

    // Streaming TTS: dispatch complete sentences to Kokoro as tokens arrive.
    // The brain sends a {lang} frame before tokens, so the voice is known up
    // front; if Kokoro isn't ready or has no voice for the language, nothing
    // dispatches here and the browser fallback speaks the full reply at done.
    let replyLang: string | null = null;
    let pendingTTS = '';
    let seenChars = 0;
    let usedKokoro = false;

    const streamVoice = (): string | null =>
      ttsReady && replyLang ? kokoroVoiceFor(replyLang) : null;

    const flushSentences = (isFinal: boolean) => {
      const voice = streamVoice();
      if (!voice) return;
      let last = 0;
      for (let i = 0; i < pendingTTS.length; i++) {
        const c = pendingTTS[i];
        const cjkEnd = c === '。' || c === '！' || c === '？';
        const latinEnd =
          (c === '.' || c === '!' || c === '?' || c === '…') &&
          (pendingTTS[i + 1] === ' ' || pendingTTS[i + 1] === '\n');
        if (cjkEnd || latinEnd) {
          const sentence = pendingTTS.slice(last, i + 1).trim();
          if (sentence.length > 1) {
            console.log(`[Web Witch] TTS queue (kokoro ${voice}):`, sentence.substring(0, 40));
            kokoroSpeakQueue(sentence, voice);
            usedKokoro = true;
          }
          last = i + 1;
        }
      }
      pendingTTS = pendingTTS.slice(last);
      if (isFinal) {
        const tail = pendingTTS.trim();
        if (tail.length > 1) { kokoroSpeakQueue(tail, voice); usedKokoro = true; }
        pendingTTS = '';
      }
    };

    const onToken = (textSoFar: string) => {
      upsertAssistant(textSoFar);
      pendingTTS += textSoFar.slice(seenChars);
      seenChars = textSoFar.length;
      flushSentences(false);
    };

    try {
      // Status frames ("Consulting the deeper spirits…") land in the nav bar.
      const done = await streamBrain(text, history, isIdle, onToken, setStatus, (l) => { replyLang = l; }, langHint, image);
      const reply = done.reply || '';

      if (reply) {
        upsertAssistant(reply); // finalize with the canonical parsed reply
        setStatus("Web Witch: " + reply.substring(0, 40) + "...");
        console.log("[Web Witch] reply meta:", {
          emotion: done.emotion, gesture: done.gesture, lang: done.lang,
          memorable: done.memorable, tier: done.tier, model: done.model, provider: done.provider,
        });
        // Body language: face + gesture from the structured reply.
        vrmViewerRef.current?.setEmotion(done.emotion);
        vrmViewerRef.current?.playGesture(done.gesture);

        replyLang = done.lang ?? replyLang ?? 'en';
        if (streamVoice()) {
          flushSentences(true); // speak the tail (or everything, if none dispatched yet)
        } else if (!usedKokoro) {
          speak(reply, replyLang); // browser fallback for the whole reply
        }
      } else {
        setStatus("Error: empty reply");
      }
    } catch (err: any) {
      setStatus("Connection Error: " + err.message);
    } finally {
      setIsThinking(false);
    }
  };

  // ---- Eyes (Phase 6): consent-gated one-shot webcam vision ----
  const { supported: camSupported, capturing: camActive, captureFrame } = useWebcam();
  // 'on-ask-only' (default): camera only when the visitor invites a look.
  // 'off': she never uses the camera, even when asked.
  const [eyesMode, setEyesMode] = useState<'on-ask-only' | 'off'>('on-ask-only');
  const eyesModeRef = useRef(eyesMode);
  eyesModeRef.current = eyesMode;
  const visionConsentRef = useRef(false); // granted once, remembered per browser

  useEffect(() => {
    try {
      if (localStorage.getItem('aibo:eyes') === 'off') setEyesMode('off');
      if (localStorage.getItem('aibo:eyes-consent') === 'granted') visionConsentRef.current = true;
    } catch { /* storage unavailable */ }
  }, []);

  const toggleEyes = () => {
    setEyesMode(prev => {
      const next = prev === 'off' ? 'on-ask-only' : 'off';
      try { localStorage.setItem('aibo:eyes', next); } catch { /* ignore */ }
      return next;
    });
  };

  // Promise-based consent dialog: sendMessage awaits the visitor's choice.
  const [consentOpen, setConsentOpen] = useState(false);
  const consentResolveRef = useRef<((ok: boolean) => void) | null>(null);
  const askVisionConsent = (): Promise<boolean> =>
    new Promise(resolve => {
      consentResolveRef.current = resolve;
      setConsentOpen(true);
    });
  const resolveConsent = (ok: boolean) => {
    setConsentOpen(false);
    consentResolveRef.current?.(ok);
    consentResolveRef.current = null;
  };

  // ---- Voice in (Phase 4): push-to-talk -> /api/stt (Groq Whisper) ----
  const {
    supported: micSupported,
    recording,
    startRecording,
    stopRecording,
  } = useMicrophone();
  // Flips false after an STT failure so subsequent clicks use Web Speech.
  const whisperEnabledRef = useRef(true);

  const handleMicPress = async () => {
    if (!micSupported || !whisperEnabledRef.current || recording || transcribing) return;
    try {
      await startRecording();
      setStatus("Listening… (release to send, 30s max)");
    } catch (err) {
      console.warn("[Web Witch] Mic unavailable, falling back to Web Speech:", err);
      whisperEnabledRef.current = false;
      startListening();
    }
  };

  const handleMicRelease = async () => {
    if (!micSupported || !whisperEnabledRef.current) return;
    const blob = await stopRecording();
    if (!blob) return;
    if (blob.size < 2000) {
      setStatus("Too short — hold the mic while you speak");
      return;
    }

    setTranscribing(true);
    setStatus("Deciphering your words…");
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'speech.webm');
      const res = await fetch('/api/stt', { method: 'POST', body: formData });
      const data = await res.json() as { text?: string; language?: string; error?: string };

      if (data.text && data.text.trim()) {
        console.log(`[Web Witch] STT: "${data.text}" (${data.language})`);
        await sendMessage(data.text.trim(), false, data.language);
      } else if (data.error) {
        console.warn("[Web Witch] STT unavailable, falling back to Web Speech:", data.error);
        whisperEnabledRef.current = false;
        setStatus("Whisper unavailable — using browser recognition. Tap the mic again.");
      } else {
        setStatus("Didn't catch that — try again?");
      }
    } catch (err: any) {
      setStatus("Transcription failed: " + err.message);
    } finally {
      setTranscribing(false);
    }
  };

  // Web Speech API fallback (Chrome) — used when MediaRecorder or /api/stt
  // is unavailable. Tap-to-talk rather than push-to-talk.
  const startListening = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Your browser does not support Speech Recognition. Try Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;

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

  // Browser speechSynthesis — the fallback voice (Kokoro not ready, or a
  // language Kokoro has no voice for). utterance.lang steers voice choice.
  const speak = (text: string, lang = 'en') => {
    console.log(`[Web Witch] Speaking (browser, ${lang}):`, text.substring(0, 50) + "...");

    // Cancel any pending speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const LANG_TAGS: Record<string, string> = {
      en: 'en-US', ja: 'ja-JP', zh: 'zh-CN', ms: 'ms-MY', ko: 'ko-KR',
    };
    utterance.lang = LANG_TAGS[lang] ?? lang;

    const voices = window.speechSynthesis.getVoices();
    if (lang === 'en') {
      // Prioritize specific high-quality female voices, then fallback to any female voice
      const femaleVoice = voices.find(v =>
        v.name.includes("Google UK English Female") ||
        v.name.includes("Google US English") || // Often sounds better than default
        v.name.includes("Samantha") ||
        v.name.toLowerCase().includes("female")
      );
      if (femaleVoice) {
        utterance.voice = femaleVoice;
        utterance.pitch = 1.1;
        utterance.rate = 1.0;
      }
    } else {
      // Match a voice for the reply language by BCP-47 prefix.
      const langVoice = voices.find(v => v.lang.toLowerCase().startsWith(utterance.lang.toLowerCase().slice(0, 2)));
      if (langVoice) utterance.voice = langVoice;
    }

    // Text-based lip sync — the fallback path has no audio tap to analyze.
    if (vrmViewerRef.current) {
      vrmViewerRef.current.speakWithLipSync(text);
    }

    utterance.onerror = (e) => {
      console.error("[Web Witch] TTS Error:", e.error);
    };

    window.speechSynthesis.speak(utterance);
  };

  // Speak a complete reply with the best available voice for its language.
  const speakSmart = (text: string, lang: string) => {
    const voice = ttsReady ? kokoroVoiceFor(lang) : null;
    if (voice) {
      console.log(`[Web Witch] Speaking (kokoro ${voice}):`, text.substring(0, 50) + "...");
      kokoroStop();
      void kokoroSpeak(text, voice); // splits into sentences internally
    } else {
      speak(text, lang);
    }
  };

  // ---- Avatar state machine (Phase 5): mic/brain/TTS lifecycle → body ----
  useEffect(() => {
    const state = recording
      ? 'listening'
      : (transcribing || isThinking)
        ? 'thinking'
        : kokoroSpeaking
          ? 'speaking'
          : 'idle';
    vrmViewerRef.current?.setAvatarState(state);
  }, [recording, transcribing, isThinking, kokoroSpeaking]);

  // ---- Idle free-will (Phase 5): client-side, no LLM calls ----
  // After 60–120s of inactivity she does something small on her own.
  // At most ONE spoken proactive line per session (config const below).
  const MAX_PROACTIVE_LINES = 1;
  const idleBusyRef = useRef(false);
  idleBusyRef.current = recording || transcribing || isThinking || kokoroSpeaking;
  const hasConversationRef = useRef(false);
  hasConversationRef.current = messages.length > 0;
  const proactiveCountRef = useRef(0);
  const idleThresholdRef = useRef(60_000 + Math.random() * 60_000);
  const speakSmartRef = useRef(speakSmart);
  speakSmartRef.current = speakSmart;

  useEffect(() => {
    const IDLE_ACTIONS: Array<{ gesture?: string; emotion?: string }> = [
      { gesture: 'THINK' },                      // ponder something
      { gesture: 'NOD', emotion: 'happy' },      // remember something nice
      { emotion: 'relaxed' },                    // soft smile
      { gesture: 'DANCE', emotion: 'happy' },    // hum-sway to herself
      { gesture: 'SHAKE', emotion: 'surprised' }, // shake off a daydream
    ];
    const PROACTIVE_LINES = [
      { text: "Still there, traveler? My cauldron simmers quietly whenever you're ready.", lang: 'en' },
      { text: 'まだそこにいる？聞きたいことができたら、いつでもどうぞ。', lang: 'ja' },
      { text: 'Saya masih di sini — tanyalah kalau perlu apa-apa.', lang: 'ms' },
    ];

    const interval = setInterval(() => {
      if (idleBusyRef.current || !hasConversationRef.current) return;
      if (Date.now() - lastInteractionRef.current < idleThresholdRef.current) return;

      lastInteractionRef.current = Date.now();
      idleThresholdRef.current = 60_000 + Math.random() * 60_000;

      const action = IDLE_ACTIONS[Math.floor(Math.random() * IDLE_ACTIONS.length)];
      console.log('[Web Witch] idle free-will:', action);
      if (action.gesture) vrmViewerRef.current?.playGesture(action.gesture);
      if (action.emotion) vrmViewerRef.current?.setEmotion(action.emotion);

      if (proactiveCountRef.current < MAX_PROACTIVE_LINES) {
        proactiveCountRef.current++;
        const line = PROACTIVE_LINES[Math.floor(Math.random() * PROACTIVE_LINES.length)];
        setMessages(prev => [...prev, { role: 'assistant', content: line.text }]);
        speakSmartRef.current(line.text, line.lang);
      }
    }, 10_000);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="flex items-center gap-4">
          <button
            onClick={toggleEyes}
            title={eyesMode === 'off'
              ? 'Eyes OFF — she will never use the camera'
              : 'Eyes on-ask-only — camera only when you invite her to look'}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              eyesMode === 'off'
                ? 'border-zinc-700 text-zinc-600 hover:text-zinc-400'
                : 'border-[#00f2ff]/30 text-[#00f2ff]/80 hover:text-[#00f2ff]'
            }`}
          >
            {eyesMode === 'off' ? '👁 eyes off' : '👁 eyes: on ask'}
          </button>
          <div className="text-xs text-zinc-500">{status}</div>
        </div>
      </nav>

      {/* Voice model loading indicator (first Kokoro warmup) */}
      {ttsLoading && (
        <div className="fixed top-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[#00f2ff]/30 bg-black/70 px-4 py-2 backdrop-blur-md">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[#00f2ff]" />
          </div>
          <span className="text-xs text-[#00f2ff]">Loading voice model…</span>
        </div>
      )}
      {ttsError && !ttsLoading && (
        <div className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-full bg-black/60 px-4 py-1.5 text-xs text-amber-400/80 backdrop-blur-md">
          Neural voice unavailable — using basic voice
        </div>
      )}

      <main className="relative z-10 flex h-screen flex-col lg:flex-row overflow-hidden">
        {/* Left: 3D Avatar */}
        <div className={`${isEmbedded ? 'absolute inset-0 z-0 h-full w-full' : 'relative flex h-[40vh] w-full items-center justify-center lg:h-full lg:w-1/2'}`}>
          <div className="relative h-full w-full">
            <VrmViewer ref={vrmViewerRef} isEmbedded={isEmbedded} onLoaded={handleVrmLoaded} getAudioLevel={ttsGetLevel} />
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
                        const fallbackGreeting = "Greetings, traveler! I am Web Witch, your mystical companion. What's on your mind tonight?";
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

          {/* 👁 watching badge — visible only while the camera is open */}
          {camActive && (
            <div className="absolute top-20 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-red-400/50 bg-red-500/20 px-4 py-1.5 backdrop-blur-md">
              <span className="animate-pulse text-base">👁</span>
              <span className="text-xs uppercase tracking-widest text-red-300">watching</span>
            </div>
          )}

          {/* Voice Button Overlay — hold to record (Whisper), tap for Web Speech fallback */}
          <button
            onMouseDown={handleMicPress}
            onMouseUp={handleMicRelease}
            onMouseLeave={recording ? handleMicRelease : undefined}
            onTouchStart={(e) => { e.preventDefault(); handleMicPress(); }}
            onTouchEnd={(e) => { e.preventDefault(); handleMicRelease(); }}
            onClick={() => {
              // Only the fallback path uses click; Whisper path is press/release.
              if (!micSupported || !whisperEnabledRef.current) startListening();
            }}
            title={micSupported && whisperEnabledRef.current ? 'Hold to talk' : 'Tap to talk'}
            className={`absolute left-1/2 -translate-x-1/2 z-20 flex h-16 w-16 items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95 select-none ${
              recording || isListening
                ? 'bg-red-500 animate-pulse'
                : transcribing
                  ? 'bg-amber-400'
                  : 'bg-[#00f2ff] shadow-[0_0_30px_rgba(0,242,255,0.4)]'
              } ${isEmbedded ? 'bottom-24' : 'bottom-8'}`}
          >
            <span className={`text-2xl ${transcribing ? 'animate-spin' : ''}`}>
              {recording || isListening ? '🔴' : transcribing ? '🌀' : '🎙️'}
            </span>
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

      {/* Vision consent dialog — first camera use only (Kip § 4) */}
      {consentOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 max-w-sm rounded-2xl border border-[#00f2ff]/30 bg-[#0a0a12] p-6 text-center shadow-[0_0_60px_rgba(0,242,255,0.15)]">
            <div className="mb-3 text-3xl">👁</div>
            <h3 className="mb-2 font-semibold text-white">May I open my crystal eye?</h3>
            <p className="mb-5 text-sm text-zinc-400">
              I&apos;ll take a single glance through your camera to answer. The image is
              looked at once and never stored — my eye closes the moment I&apos;m done.
            </p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => resolveConsent(true)}
                className="rounded-full bg-[#00f2ff] px-5 py-2 font-semibold text-black transition-transform hover:scale-105"
              >
                Let her look
              </button>
              <button
                onClick={() => resolveConsent(false)}
                className="rounded-full bg-white/10 px-5 py-2 text-zinc-300 hover:bg-white/20"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

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
