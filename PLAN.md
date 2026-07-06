# PLAN — Build the best AI companion at project-aibo.vercel.app

**Written:** 2026-07-04, by Claude Fable 5 after a full survey of all related projects.
**For:** smaller-model sessions executing phase by phase. Every hard decision is made
here — do not re-litigate, just build. Update the STATE block at the bottom of this
file before ending every session.

---

## 0. Ground truth (verified 2026-07-04 — do not re-derive)

### Which repo deploys where

| Repo (all under github.com/lakar-team) | Deploys to | Stack |
|---|---|---|
| **project-aibo** | **https://project-aibo.vercel.app** ← THE TARGET | Next.js 16.1.4, React 19, three ^0.173, @pixiv/three-vrm ^3.3.1, Tailwind 4, edge runtime |
| solar-punk | https://solar-punk-five.vercel.app | Next.js 16 portfolio; embeds project-aibo planet; has its OWN newer `/api/brain` |
| AIBO_Alive | not deployed (localhost Flask + Ollama; default branch `master`) | Python Flask, SQLAlchemy, edge-tts, Ollama qwen2.5:3b + llava-phi3 |

- AIBO_Alive is Flask → **cannot** deploy to Vercel. It is a feature donor, not the deploy target.
- **Canonical code location (since 2026-07-04):** `G:\My Drive\AI Platforms\project-aibo\` — a full
  git clone of the repo on `main`. Edit here, commit here, push from here. This PLAN.md lives at
  its root. The old `AIBO_Alive\` Drive folder is retired (its CLAUDE.md is just a pointer);
  the old "Project AIBO" folder's assets were merged in along the way.
- WebWitch.vrm copies: `project-aibo\public\avatars\Web Witch.vrm` (canonical, gitignored,
  Drive-only; Miku Liv + both .vroid sources sit beside it), `project-aibo/public/avatar.vrm`
  (deployed one, 17 MB in git), `AIBO_Alive/Static/avatar.vrm` (retired repo).

### CRITICAL workflow rules (from repo + Drive conventions)

1. **NEVER run `npm install`/`npm run build` on Google Drive paths** — corrupts node_modules.
   Use `.\build.ps1` in the project root instead: it mirrors source to
   `%LOCALAPPDATA%\project-aibo-build` and runs all npm work there (`-Dev` for the dev server,
   `-Install` to force reinstall). Never invoke npm directly in the Drive folder.
2. Deploy = push to GitHub `main` (github.com/lakar-team/project-aibo); Vercel auto-deploys to
   https://project-aibo.vercel.app. The local build.ps1 build is verification only — nothing is
   uploaded from it. Env vars are set in the Vercel dashboard.
3. Wiki rule: after each non-trivial phase, update `G:\My Drive\AI Platforms\Wiki\vault\drive-map\project-aibo.md`
   and the wiki-chain block in `G:\My Drive\AI Platforms\project-aibo\CLAUDE.md`.
4. Existing env vars on Vercel: `OPENROUTER_API_KEY`, `GOOGLE_GEMINI_API_KEY`. New ones each
   phase needs are listed per phase; Adam must add them in the Vercel dashboard (ask him).

---

## A. Feature matrix (what exists today, from reading the actual code)

| Capability | project-aibo (deployed) | solar-punk | AIBO_Alive (Flask) | Kip (design docs only) |
|---|---|---|---|---|
| VRM rendering | ✅ @pixiv/three-vrm, blink, sine-wave lip sync (aa/oh/ee), `?embed=true` mode | ❌ (links to project-aibo) | ✅ avatar_core.js/motion_core.js — bone-level gesture animation | ❌ (SVG creature, N/A) |
| Voice OUT | ⚠️ browser `speechSynthesis` (quality varies by OS) | ✅ **Kokoro-js neural TTS in a Web Worker** (`useKokoroTTS.ts`, `kokoro.worker.ts`, voice `af_heart`) + `audioNaturalizer.ts`, markdown strip, sentence queue, cancellation | ✅ server Edge-TTS with MD5 mp3 cache, per-persona voice/pitch/rate | 📋 edge-tts, per-language voice map |
| Voice IN | ⚠️ Web Speech API, hardcoded `en-US` | ❌ | ❌ (text only) | 📋 faster-whisper, auto language detect |
| Vision | ❌ | ❌ | ✅ webcam → llava-phi3, incl. passive "vision check" mode | 📋 consent-gated screen+webcam, "eye open" indicator, caption-to-memory |
| Memory | ❌ **no history even within a session** (only last message sent to API) | ✅ conversation history sent per request (no persistence) | ✅ short_term_buffer + core_biography in SQLite; `/api/dream` consolidation | 📋 **best design**: MEMORY.md index + fact files + daily journal + episodes.db; sleep consolidation w/ triggers, 2000-token budget, morning "dream" |
| Model routing | ⚠️ fallback only: OpenRouter 12-model free rotation → Gemini 1.5-flash | ⚠️ fallback only: Gemini 2.0-flash streaming → OpenRouter streaming | ❌ (one local model) | 📋 **best design**: tier 0 reflex (regex) → 1 haiku → 2 sonnet → 3 opus; heuristics + cheap classifier; per-call budget logging; announces "thinking hard" |
| Streaming replies | ❌ (blocking JSON) | ✅ NDJSON streaming + `ReplyExtractor` (streams only reply text, safe for TTS) | ❌ | — |
| Structured output | ❌ | ✅ `{"reply","planet"}` JSON w/ validation (`parseStructuredReply`) | ⚠️ inline `[HEAD: NOD]` gesture tags + `[EMOTION: X]`, regex-cleaned | — |
| Gestures/emotion | ⚠️ blink + lip sync only | ❌ | ✅ gesture tag protocol, **pose teaching** (save/recall joint angles, `/api/poses`, poses.json), emotion tags | 📋 avatar state machine (idle/listening/thinking/thinking-deep/speaking/sleeping/looking) |
| Idle behavior | greeting only (idle chat disabled) | ❌ | ✅ `free_will()` spontaneous idle actions via `/api/pulse` (45 s idle) | 📋 config-gated proactive mode, N/day cap |
| Multilingual | ❌ | ❌ | ❌ | 📋 **first-class**: detect language → reply in kind → per-language TTS voice map |
| Personality | ⚠️ hardcoded CV-dump system prompt in route.ts | ✅ better: narrative `adamProfile.ts` + character rules, turn-aware prompt compression | ⚠️ puppeteer prompt | 📋 **best**: PERSONALITY.md — character rules, transparency-about-effort, calibration sample lines, naming ceremony |
| Security | ❌ no auth/rate-limit on `/api/brain`; phone number in `public/adam-info.json` | same route style, no rate-limit | localhost-only holes (auto-login, debug=True) | — |

### What Kip contributes (the "best features" Adam wants ported)

Kip = `G:\My Drive\AI Platforms\Kip\Kip\` (note the **nested** folder), a desktop Python companion
designed by Fable 5 on 2026-07-03, only Phase 0 built. Adam does NOT want Kip continued. Port these designs:

1. **Model router tiers + budget guardrails** (ARCHITECTURE.md § 2, config § budget)
2. **Sleeping memory** (ARCHITECTURE.md § 6): index + fact files + journal + episode log; consolidation on "goodnight"/idle/close; compress > 30 days to summaries; ≤ 2000-token digest loaded on wake
3. **Multilingual-first** (§ 7): mirror the user's language everywhere
4. **Consent-gated vision** (§ 4): capture only on explicit ask or opt-in config, visible indicator, frames discarded after reply, only captions ever stored
5. **Personality doc pattern** (docs/PERSONALITY.md): character rules incl. "transparent about effort" (says when it wakes the big model), concise-by-voice, honest-about-being-AI, boundaries; sample calibration lines
6. **The build process itself**: PLAN/STATE/locked-ARCHITECTURE + resume protocol — which is what this file is

---

## B. Architecture decision (LOCKED)

**Target = the existing `project-aibo` repo, upgraded in place.** It is already the Vercel deploy,
already renders WebWitch.vrm, already Next.js. No new repo, no framework migration, no Flask.

- **Framework:** Next.js 16 App Router (already there). Keep edge runtime for `/api/brain`.
- **Brain:** port solar-punk's streaming route as the base (it is strictly better: streaming,
  history, structured JSON, prompt compression) and extend its structured output to
  `{"reply","emotion","gesture","memorable"}`. Add Kip's router tiers on top.
- **Models:** keep free-first stack — Tier 1 `gemini-2.0-flash` (or flash-lite), Tier 2
  `gemini-2.0-flash` / OpenRouter free rotation, Tier 3 a strong model via OpenRouter
  (`deepseek/r1` free when alive, else `anthropic/claude-sonnet-4.5` paid — env-gated).
  Vision goes to Gemini (handles images on the same API). Claude Agent SDK is NOT usable on
  Vercel (subscription CLI auth is desktop-only) — do not attempt it.
- **Voice OUT:** port solar-punk's Kokoro worker TTS (best quality, free, on-device) for
  English + Kokoro's covered voices; **browser `speechSynthesis` fallback keyed by detected
  language** for everything else. (Server Edge-TTS on Vercel is fragile — MS throttles
  datacenter IPs; do not build it as the primary path.)
- **Voice IN:** `MediaRecorder` → `/api/stt` → **Groq `whisper-large-v3-turbo`** (fast, free tier,
  multilingual auto-detect, returns language code). Fallback: Web Speech API. New env: `GROQ_API_KEY`.
- **Vision:** `getUserMedia` webcam → canvas downscale ≤ 1024 px JPEG (AIBO_Alive `vision_core.js`
  pattern) → base64 to `/api/brain` → Gemini multimodal. Kip's consent rules enforced exactly.
- **Memory:** Kip's design adapted to web. Storage = **Upstash Redis** (Vercel Marketplace, free
  tier, works from edge runtime; new envs `KV_REST_API_URL`, `KV_REST_API_TOKEN`). Anonymous
  visitors get a `localStorage` UUID with light memory; Adam gets **owner mode** (secret phrase →
  `OWNER_KEY` env) with full persistent memory + consolidation. Consolidation = `/api/sleep`
  route, triggered by "goodnight" reflex, tab close (`sendBeacon`), or Vercel cron (daily 15:00 UTC = 24:00 JST).
- **Security (must-fix, Phase 0):** delete phone number from `public/adam-info.json`; add
  Upstash rate limiting + same-origin check on all API routes.
- **Assets:** keep `public/avatar.vrm` as-is for now (works today); moving to Vercel Blob is backlog.

---

## C. Phased implementation plan

Rules for every phase: work in the canonical Drive folder
(`G:\My Drive\AI Platforms\project-aibo\`), but **never run npm there** — build and run the dev
server via `.\build.ps1` (mirrors to `%LOCALAPPDATA%\project-aibo-build`); commit per checkbox;
run `.\build.ps1` (verifies `next build` in the mirror) before pushing; push to `main` deploys;
verify on https://project-aibo.vercel.app; then update the STATE block in this file and the wiki.

### Phase 0 — Hygiene, security, baseline
**Goal:** safe, rate-limited baseline deploy with no data leaks.
**Files:** `public/adam-info.json` (edit/remove), `src/app/api/brain/route.ts`, new `src/lib/ratelimit.ts`, `.env.example` (new), `README.md`.
**Do:**
- [x] From `G:\My Drive\AI Platforms\project-aibo\`, run `.\build.ps1 -Dev` (installs deps in the mirror and starts the dev server); confirm avatar loads and chat works (needs the two existing env keys in the mirror's `.env.local` at `%LOCALAPPDATA%\project-aibo-build` — ask Adam to paste them). *(2026-07-05: verified via `npm start` prod server in the mirror instead — homepage + avatar.vrm serve fine; local chat untestable, no `.env.local` keys; chat verified on the live deploy. Note: `next dev` Turbopack panics under Claude's sandboxed shell due to LOCALAPPDATA path virtualization — works from a normal terminal.)*
- [x] Remove the phone number line from `public/adam-info.json` (and from the system prompt in `route.ts` — replace with "contact via email").
- [x] `npm i @upstash/redis @upstash/ratelimit`; create `src/lib/ratelimit.ts` (sliding window, 20 req/min per IP). Apply in `route.ts` before provider calls. If `KV_REST_API_URL` is unset, no-op (so local dev works) — ask Adam to create the Upstash KV integration in Vercel dashboard.
- [x] Add origin check: reject POSTs whose `Origin`/`Referer` is not `project-aibo.vercel.app`, `solar-punk-five.vercel.app`, or localhost.
- [x] Write `.env.example` documenting every env var this plan introduces.
**Verify:** deployed site still chats; `curl -X POST https://project-aibo.vercel.app/api/brain` from elsewhere gets 403/429; phone number gone (`curl .../adam-info.json`).
**Depends on:** nothing.

### Phase 1 — Brain v2: streaming, history, structured output, personality
**Goal:** port solar-punk's superior brain and give Web Witch a real personality file.
**Files:** `src/app/api/brain/route.ts` (rewrite), new `src/data/personality.ts`, new `src/data/adamProfile.ts` (copy from solar-punk `src/data/adamProfile.ts`), `src/app/page.tsx` (consume NDJSON stream).
**Do:**
- [x] Copy solar-punk's `route.ts` machinery: `streamGemini` (gemini-2.0-flash SSE), `streamOpenRouter` (stream:true, model rotation), `ReplyExtractor`, `parseStructuredReply`, NDJSON response, history handling, turn-aware prompt compression (`turnIndex`). Source of truth to copy from: `G:\My Drive\AI Platforms\solar-punk\src\app\api\brain\route.ts` (readable on Drive; solar-punk repo is also on GitHub).
- [x] Extend the JSON contract to `{"reply": string, "emotion": "happy|sad|angry|surprised|relaxed|neutral", "gesture": string|null, "memorable": string|null}`. `emotion` maps to VRM expression presets; `gesture` is a free tag like `WAVE|NOD|SHAKE|DANCE|BOW|CROSS_ARMS` (AIBO_Alive's invent-your-own idea, validated against a known list + ignored if unknown); `memorable` = one short sentence if the user said something worth remembering, else null (feeds Phase 7). *(2026-07-05: also added `"lang"` (ISO 639-1) to the contract — Phase 3 needs it for TTS voice selection; gesture list fixed to WAVE|NOD|SHAKE|DANCE|BOW|CROSS_ARMS|THINK.)*
- [x] Write `src/data/personality.ts`: Web Witch character (witchy, warm, mischievous, genuinely helpful — keep from current prompt) **plus Kip's rules translated**: concise by voice (1–3 sentences spoken), honest about being an AI, transparent about effort ("let me consult the deeper spirits…" when Tier 3 engages), refuses harm kindly, **always replies in the user's language**. Include 4–5 calibration sample lines (see Kip `docs/PERSONALITY.md` for the pattern). *(Adapted directly from Kip `docs/PERSONALITY.md` per Adam's instruction.)*
- [x] System prompt = personality + adamProfile narrative (turn 0 only) + memory digest placeholder (empty until Phase 7) + "reply in the language the user wrote/spoke".
- [x] Update `page.tsx` `sendMessage` to send `history` (the `messages` state) and read the NDJSON stream, appending tokens live; keep `speak()` fired on the final `done` message for now.
**Verify:** local dev — multi-turn conversation remembers earlier turns; ask in Japanese → reply in Japanese; reply arrives as a visible stream; response JSON parsed (emotion/gesture logged to console). Deploy and repeat live.
**Depends on:** Phase 0.

### Phase 2 — Model router + budget log (Kip § 2)
**Goal:** cheap-first routing with observable spend.
**Files:** new `src/lib/router.ts`, `src/app/api/brain/route.ts`, new `src/app/api/stats/route.ts`.
**Do:**
- [x] `router.ts`: `route(message, history) -> {tier: 0|1|2|3}`. Tier 0 reflex: regex for greetings/"stop"/time/date/"goodnight" → canned/instant handling, no LLM. Heuristics for 1 vs 2 vs 3: length, code/task verbs ("write", "debug", "plan", "explain in depth"), question complexity; when unsure, one cheap Tier-1 classification call returning `small|main|deep`. *(Reflexes are multilingual — en/ja/ms; greeting reflex fires on turn 0 only so a mid-conversation "hi" stays contextual.)*
- [x] Tier→model map (env-overridable): 1 = `gemini-2.0-flash-lite` (direct Gemini), 2 = `gemini-2.0-flash` → OpenRouter free rotation fallback, 3 = `OPENROUTER_DEEP_MODEL` env (default `deepseek/deepseek-r1:free`, Adam may set a paid Claude/GPT model later). *(2026-07-06: Gemini candidates are comma-separated env lists, 2.5-family first — `gemini-2.5-flash-lite`/`gemini-2.5-flash` then 2.0 fallbacks; OPENROUTER_DEEP_MODEL also accepts a comma-separated candidate list.)*
- [x] Log every call to Upstash: `LPUSH aibo:calls` JSON `{ts, tier, model, in_tokens_est, out_tokens_est}` + daily counters `aibo:budget:YYYY-MM-DD:tierN`. Soft caps from env (`BUDGET_TIER3_PER_DAY` default 20); when over cap, downgrade tier and have Web Witch say she's conserving her power today. *(No-ops without KV envs, same as the rate limiter; cap=0 verified to force-downgrade with a "conserving" status frame.)*
- [x] `GET /api/stats` (owner-key protected) returns today's counts per tier. *(503 until OWNER_KEY env exists; x-owner-key header or ?key=.)*
- [x] When Tier 3 engages, prepend a transparency flourish to status (client shows "consulting the deeper spirits…"). *(NDJSON `{status:"deep"}` frame before tokens; page.tsx shows it in the nav status line.)*
**Verify:** "hi" → tier 0/1 (check response metadata field `tier`); "write me a python script to rename files by date" → tier 3; `/api/stats` shows the counts; caps downgrade works (set cap to 0 temporarily).
**Depends on:** Phase 1 (structured route), Phase 0 (Upstash).

### Phase 3 — Voice out: Kokoro neural TTS
**Goal:** pleasant on-device neural voice replacing robo-speechSynthesis.
**Files:** copy from solar-punk: `src/hooks/useKokoroTTS.ts`, `src/workers/kokoro.worker.ts`, `src/utils/audioNaturalizer.ts`; edit `src/app/page.tsx`, `src/components/VrmViewer.tsx`; `package.json` (`npm i kokoro-js`).
**Do:**
- [x] Copy the three solar-punk files verbatim (they are self-contained; readable at `G:\My Drive\AI Platforms\solar-punk\src\...`). Wire `useKokoroTTS` into `page.tsx`: `warmup()` on first user interaction, `speakQueue(sentence)` as streamed sentences complete (split on sentence boundaries as tokens arrive — the hook already has `splitSentences`). *(Hook extended: per-call voice, `ready` flag, CJK 。！？ boundaries.)*
- [x] Voice map by reply language: en→`af_heart`, ja→`jf_alpha`, zh→`zf_xiaobei`, es→`ef_dora`, fr→`ff_siwis`, it→`if_sara`, pt→`pf_dora`, hi→`hf_alpha` (Kokoro built-ins); any other language → browser `speechSynthesis` with `utterance.lang` set. Detect reply language with a tiny client heuristic (charset ranges) or have the brain include `"lang":"xx"` in its JSON (preferred — add to contract). *(Went further: contract reordered lang-FIRST and the route emits an early `{lang}` NDJSON frame, so the voice is known before the first token — no heuristic needed.)*
- [x] Drive lip sync from actual audio: replace the text-length sine-wave lip sync in `VrmViewer.tsx` with amplitude-driven mouth (`AnalyserNode` on the Kokoro `AudioContext` output → set `aa` from RMS). Keep the old text-based path as the speechSynthesis fallback.
- [x] Show a small "loading voice model…" progress bar on first warmup (AiboPanel in solar-punk has the pattern, `ttsProgress`). *(Indeterminate pulse bar — the hook exposes no granular progress.)*
**Verify:** English reply speaks with Kokoro voice and the mouth follows the audio; Japanese reply uses `jf_alpha`; an unsupported language falls back to speechSynthesis; no UI freeze while speaking (worker thread).
**Depends on:** Phase 1 (streaming + lang field).

### Phase 4 — Voice in: multilingual Whisper STT
**Goal:** hear the user in any language.
**Files:** new `src/app/api/stt/route.ts`, new `src/hooks/useMicrophone.ts`, edit `src/app/page.tsx`.
**Do:**
- [x] `useMicrophone.ts`: `getUserMedia` audio, `MediaRecorder` (webm/opus), push-to-talk on the existing mic button (press = record, release/2 s silence = stop). Cap 30 s. *(Release-to-stop; the 30 s cap holds the finished blob until release. No silence detection — deferred to Phase 8 polish if wanted.)*
- [x] `/api/stt`: accepts the blob, forwards to Groq `https://api.groq.com/openai/v1/audio/transcriptions`, model `whisper-large-v3-turbo`, `response_format=verbose_json` → returns `{text, language}`. Env: `GROQ_API_KEY` (Adam creates a free key at console.groq.com). Rate-limited like `/api/brain`. *(Via groq-sdk; whisper's full language names mapped to ISO 639-1; origin allowlist shared via new `src/lib/origin.ts`; graceful no-op JSON when the key is unset.)*
- [x] Send `{text, language}` into `sendMessage`; pass the detected language to the brain so the reply and TTS voice match. Keep the old Web Speech path as fallback when `GROQ_API_KEY` is missing or `/api/stt` fails. *(Brain accepts a `lang` hint → system-prompt mirroring line; verified live: English text + lang:ja → Japanese reply.)*
- [x] Status UI: "listening…" state on the avatar (ties into Phase 5 states). *(Status line + mic button states idle/recording/transcribing; the avatar state machine itself is Phase 5.)*
**Verify:** speak English → correct transcript + English reply; speak Japanese/Malay → transcript + reply in the same language, correct TTS voice; unplug key → Web Speech fallback still works in Chrome.
**Depends on:** Phase 1; Phase 3 for the matching voice.

### Phase 5 — Body language: emotions, gestures, idle life
**Goal:** the avatar visibly feels and moves — not just lip sync.
**Files:** `src/components/VrmViewer.tsx` (extend), new `src/lib/gestures.ts`, edit `src/app/page.tsx`.
**Do:**
- [x] Emotion → VRM expression: on each reply, `expressionManager.setValue(emotion, 0.7)` with 400 ms ease in/out, decay to neutral after 6 s. VRM 1.0 presets: `happy, angry, sad, relaxed, surprised, neutral` — WebWitch.vrm is a VRoid export so these exist.
- [x] `gestures.ts`: port AIBO_Alive's `motion_core.js` animation approach (bone rotations over time with easing; it's 220 lines of vanilla JS — translate to TS). Implement: WAVE (right arm), NOD/SHAKE (head), BOW (spine), DANCE (hips+arms loop), CROSS_ARMS, THINK (hand toward chin). Trigger from the `gesture` field of the brain JSON. *(Fetched motion_core.js from the AIBO_Alive GitHub repo — the retired Drive folder only has assets. The engine now owns ALL body bones — rest pose/breath/sway moved out of VrmViewer so nothing fights over rotations. NOD/SHAKE/BOW etc. were referenced-but-unimplemented in the original; built here in its style.)*
- [x] Avatar state machine (Kip § 5 adapted): `idle` (breathing sway + existing blink), `listening` (head tilts toward camera), `thinking` (slight head-down, slow sway; extra sparkle/ring effect when tier 3), `speaking` (existing), and expose `setState()` from `VrmViewer` ref; call it from mic/brain/TTS lifecycle in `page.tsx`. *(Sparkle/ring effect for tier 3 not built — the nav status line shows "Consulting the deeper spirits…" instead; revisit in Phase 8 polish if wanted.)*
- [x] Idle free-will (AIBO_Alive `free_will` idea, but **client-side and free**): after 60–120 s idle, play a random gesture/expression from a local list (stretch, look around, hum-sway). No LLM call. At most one *spoken* proactive line per session (config const), using a canned multilingual list.
**Verify:** ask something sad → sad face; "goodbye" → wave; leave it idle 2 min → it does something; state transitions visible through a full voice exchange.
**Depends on:** Phase 1 (emotion/gesture fields). Independent of 3/4 (can run in parallel with them).

### Phase 6 — Eyes: consent-gated webcam vision
**Goal:** Web Witch can see the user when — and only when — invited.
**Files:** new `src/hooks/useWebcam.ts`, edit `src/app/api/brain/route.ts`, `src/app/page.tsx`, `src/lib/router.ts`.
**Do:**
- [ ] `useWebcam.ts`: on demand `getUserMedia` video → grab frame to canvas → downscale longest side to 1024 px → JPEG q0.7 → base64. Stop the track immediately after capture (AIBO_Alive `vision_core.js` is the reference, 78 lines).
- [ ] Router reflex: phrases like "can you see me / look at this / how do I look / what am I holding" (multilingual patterns) set `wantsVision=true` → client captures → sends `image` field to `/api/brain`.
- [ ] Brain route: when `image` present, force the Gemini provider (multimodal `inline_data` part) regardless of tier; never store the image; if `memorable` is set on a vision reply, store only the text caption.
- [ ] Consent UI (Kip § 4 exactly): first vision use asks permission with a visible dialog; a clear "👁 watching" badge shows whenever the camera is active; a settings toggle `eyes: on-ask-only` (default) / `off`.
**Verify:** "how do I look?" → camera light blinks once, badge shows, she comments on what she sees; no camera activity on ordinary messages; browser permission denied → graceful spoken apology.
**Depends on:** Phases 1–2.

### Phase 7 — Memory that sleeps (Kip § 6 for the web)
**Goal:** she remembers you across visits and consolidates at night.
**Files:** new `src/lib/memory.ts`, new `src/app/api/sleep/route.ts`, edit `src/app/api/brain/route.ts`, `src/app/page.tsx`, `vercel.json` (cron).
**Do:**
- [ ] Identity: `localStorage` UUID `aibo:visitor` sent as `visitorId` with every request. Owner mode: typing the secret phrase (matches `OWNER_KEY` env, e.g. spoken "the witch's true name is …") flags the visitor record as Adam; his memory is permanent, visitors' expire after 30 days (Redis TTL).
- [ ] Redis schema (per visitor): `aibo:mem:{id}:digest` (string ≤ 2000 tokens — the loaded memory), `aibo:mem:{id}:journal` (list — raw `memorable` lines + one-line exchange summaries, appended live), `aibo:mem:{id}:meta` (name, language prefs, last visit, owner flag).
- [ ] Brain route: load `digest` + `meta` into the system prompt every request ("What you remember about this visitor: …"); after each reply, if `memorable` non-null, `RPUSH` journal.
- [ ] `/api/sleep`: Tier-1 model reads journal + old digest → rewrites digest (merge, dedupe, correct, prune to budget) → clears journal → stores a one-line "dream". Triggers: (a) reflex "goodnight" → run + she says a Kip-style goodnight line; (b) `navigator.sendBeacon('/api/sleep?visitor=…')` on `visibilitychange→hidden` if journal non-empty; (c) `vercel.json` cron `0 15 * * *` hitting `/api/sleep?all=owner` (cron secret header `CRON_SECRET`).
- [ ] Morning greeting: if owner + last visit yesterday+, greeting references the digest and the stored dream ("I dreamt about that folder we cleaned up" pattern — see Kip PERSONALITY.md sample lines).
**Verify:** tell her 3 facts → say goodnight → hard-refresh in a new tab next day (or manually call `/api/sleep`) → she recalls all 3 unprompted when relevant; journal emptied; digest under budget; a second browser profile does NOT see your facts.
**Depends on:** Phases 0 (Upstash), 1, 2 (tier-1 calls).

### Phase 8 — Polish & hand-back
**Goal:** it feels alive, stays within budget, and the ecosystem is tidy.
**Do:**
- [ ] Latency log line per exchange (stt ms / brain-first-token ms / tts-first-audio ms) to console + optional stats.
- [ ] Error resilience: all providers down → in-character offline line (Kip's: "my thoughts aren't reaching the cloud right now") in the user's language, memory writes still queue.
- [ ] Mobile pass: layout at 380 px, mic permissions on iOS Safari (speechSynthesis fallback there — Kokoro WASM may be too heavy; test and gate by `navigator.deviceMemory`).
- [ ] Keep `?embed=true` working (solar-punk embeds it); notify solar-punk's AiboPanel none of its API contract broke (it calls its OWN /api/brain, so only the iframe/link matters).
- [ ] Backlog notes → wiki: move avatar.vrm to Vercel Blob; pose-teaching UI port from AIBO_Alive; unify with vtube GLB pipeline (deliberate decision needed — see wiki note); second character Miku Liv.
- [ ] Update `G:\My Drive\AI Platforms\Wiki\vault\drive-map\project-aibo.md` + `AIBO_Alive\CLAUDE.md` wiki-chain block: mark the revamp shipped, AIBO_Alive formally archived as feature-donor.
**Verify:** full conversation by voice on desktop + phone, in two languages, with a memory recall and a tier-3 question, entirely on the live site.

---

## D. Session handoff note (paste this to resume)

> **Project:** upgrade github.com/lakar-team/project-aibo (Next.js 16, deploys to project-aibo.vercel.app, WebWitch VRM avatar) into a full AI companion. The complete locked plan is `G:\My Drive\AI Platforms\project-aibo\PLAN.md` — read it first; all decisions are made there.
> **Key facts:** AIBO_Alive (Flask) and Kip (`G:\My Drive\AI Platforms\Kip\Kip\`) are feature donors only, not deploy targets. solar-punk (`G:\My Drive\AI Platforms\solar-punk\`) has the better brain route + Kokoro TTS worker to copy from. Code lives in the canonical Drive clone `G:\My Drive\AI Platforms\project-aibo\` — NEVER npm on Google Drive; build/dev via `.\build.ps1` (mirrors to `%LOCALAPPDATA%\project-aibo-build`), then push to `main` and Vercel auto-deploys. Existing envs: OPENROUTER_API_KEY, GOOGLE_GEMINI_API_KEY. New envs come per phase (Upstash KV, GROQ_API_KEY, OWNER_KEY, CRON_SECRET) — Adam adds them in the Vercel dashboard.
> **Order:** Phase 0 (security/rate-limit) → 1 (streaming brain + personality + structured {reply,emotion,gesture,lang,memorable}) → 2 (Kip-style model router + budget) → 3 (Kokoro TTS) → 4 (Groq Whisper STT) → 5 (emotions/gestures/idle) → 6 (consent-gated webcam vision) → 7 (sleeping memory in Upstash) → 8 (polish).
> **Start at:** the first unchecked box in the STATE block below. Update STATE + the wiki (`vault/drive-map/project-aibo.md`) before ending your session.

---

## STATE — update before ending every session

**Current phase:** Phase 5 ✅ complete (2026-07-06) → next is **Phase 6**
**Last session:** 2026-07-06, Claude Fable 5 — Phases 2–5 shipped and verified.
Phase 5 commit: `529281f` (`src/lib/gestures.ts` GestureEngine ported from AIBO_Alive motion_core.js — owns all body bones: rest/breath/sway + state offsets + WAVE/NOD/SHAKE/BOW/DANCE/CROSS_ARMS/THINK timelines; VrmViewer emotion overlay 0.7 weight, 400 ms ease, 6 s decay, plus setEmotion/playGesture/setAvatarState on the ref; page.tsx applies emotion+gesture from every done frame, runs the state machine off recording/transcribing/thinking/Kokoro-speaking, and idle free-will at 60–120 s with max one spoken multilingual proactive line per session).
Phase 5 verification: live — sad message → `emotion:"sad"`, "goodbye" → `gesture:"WAVE"` in done frames; browser — full exchange with WAVE+happy ran zero-error through the new engine. **Gesture poses are mathematically plausible but untuned — Adam should eyeball WAVE/BOW/CROSS_ARMS/THINK in a real browser and report any weird limb angles.** Idle free-will logic reviewed but the 60–120 s wait wasn't observed end-to-end.
Phase 4 commit: `fcf63cf` (push-to-talk `useMicrophone` hook — MediaRecorder webm/opus, 30 s cap; `/api/stt` edge route via groq-sdk `whisper-large-v3-turbo` verbose_json → `{text, language}` in ISO 639-1, origin+rate gated, graceful no-op without `GROQ_API_KEY`; shared `src/lib/origin.ts`; brain accepts a `lang` hint injected as a mirroring instruction; mic button hold-to-record with idle/recording/transcribing states and Web Speech fallback).
Phase 4 verification: local — stt 403 without origin, `{"text":"","language":"en","error":"STT not configured"}` no-op without key; live — same no-op (GROQ_API_KEY not in Vercel yet), and the lang hint verified end-to-end: English text + `lang:"ja"` → Japanese reply with `lang:"ja"` (auto-selects `jf_alpha` TTS). **Real-mic push-to-talk needs a hands-on test once GROQ_API_KEY is added.**
Phase 3 commit: `496c8fa` (Kokoro worker TTS ported from solar-punk; voice map by reply `lang` with browser-speechSynthesis fallback for unsupported languages; contract reordered lang-first + early `{lang}` NDJSON frame so streaming sentence dispatch knows the voice before tokens; AnalyserNode RMS → `aa` audio-driven lip sync with the text sine-wave kept for the fallback path; loading-voice chip; fixed a pre-existing VrmViewer remount bug — `onLoaded` in effect deps re-created the Three.js scene and re-downloaded the VRM on every parent render — and added ResizeObserver canvas sizing).
Phase 3 verification (local prod server + real browser via preview): "hi" → `TTS queue (kokoro af_heart)` streaming dispatch; こんにちは → `jf_alpha` with 。-boundary splitting; "salam" (ms, not in Kokoro) → `Speaking (browser, ms)` fallback; loading chip appears on first interaction; page stays responsive during inference (worker thread). Live deploy verified: `{lang}` frame precedes tokens on both reflex and LLM paths. Kokoro audio/lip-sync is client-side — confirm audibly in a real browser when convenient.
Phase 2 commits: `647745d` (router tiers + budget log + `/api/stats` + transparency status frames + Gemini model-name fix + `diag` field), `ac6aed3` (cap=0 = never-tier-3; `OPENROUTER_DEEP_MODEL` accepts comma-separated candidates).
Earlier: Phase 0 `d8a07b1`/`c6baaed`; Phase 1 `0950b48`/`8752e2d`.
Phase 2 live verification: "hi"/"こんにちは"/"what time is it"/"goodnight" → `tier:0` reflex, no LLM; "who is adam?" → `tier:1`; "write me a python script…"/"debug this…" → `tier:3` with `{status:"deep","Consulting the deeper spirits…"}` frame first; `BUDGET_TIER3_PER_DAY=0` → `{status:"conserving"}` + tier-2 chain (tested locally); `/api/stats` correctly 503s while OWNER_KEY is unset.
**Blockers / Adam actions (all Vercel dashboard):**
0. **NEW (Phase 4):** create a free Groq key at console.groq.com and add `GROQ_API_KEY` — until then voice input silently falls back to browser Web Speech (Chrome-only, English).
1. **`GOOGLE_GEMINI_API_KEY` is NOT visible in production** — the new `diag` field proved it: every Gemini attempt fails with "not configured". This was the real cause of Phase 1's "Gemini fails silently" (never a model-name problem). Check the env var exists for the Production environment under that exact name, then redeploy. Until then OpenRouter free rotation serves everything (works, but tier 1/2 have no Gemini and the router's classifier call also no-ops).
2. Upstash KV integration still missing (`KV_REST_API_URL`/`KV_REST_API_TOKEN`) — rate limiting and budget logging both no-op; `/api/stats` will show zeros. Phase 7 hard-depends on it.
3. Set `OWNER_KEY` to enable `/api/stats` (also used by Phase 7 owner mode).
4. Both default deep models (`deepseek/deepseek-r1:free`, `deepseek/r1-0528:free`) currently fail on OpenRouter — tier 3 degrades to the free rotation (fine). Pick a live reasoning model on openrouter.ai/models and set `OPENROUTER_DEEP_MODEL`.
5. Mirror still has no `.env.local` for local chat testing.
**Decisions since plan:** 2026-07-04 — workflow changed from "local clone at C:\projects" to canonical Drive clone + build.ps1 mirror (see § 0 CRITICAL rules). This PLAN.md's canonical copy now lives at the project-aibo repo root (committed to git); the AIBO_Alive copy is stale. 2026-07-05 — `.env.example` lives at repo root (not `src/`); origin check parses the header with `new URL()` and compares exact origin/hostname (prevents `project-aibo.vercel.app.evil.com` prefix spoofing).
