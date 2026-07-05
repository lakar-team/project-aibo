# project-aibo

Next.js AI companion app — the "Web Witch" avatar — deployed at
https://project-aibo.vercel.app. VRM avatar rendered via `@pixiv/three-vrm` +
Three.js (Next.js 16 App Router, React 19, Tailwind 4). AI brain is the
`/api/brain` edge route: streaming, OpenRouter free-model rotation with
Gemini fallback. This Drive folder is the canonical clone of
https://github.com/lakar-team/project-aibo (branch `main`).

This project absorbed **AIBO_Alive** (the local Flask/Ollama variant, now
retired): its VRM/VRoid character assets live in `public/avatars/`, and its
implementation roadmap became `PLAN.md` here.

## CRITICAL: never run npm in this folder

This project lives on Google Drive; `npm install` here corrupts
`node_modules`. Always build through `.\build.ps1` (mirrors source to
`%LOCALAPPDATA%\project-aibo-build` and runs npm there), same as the vtube
and AI-CAD projects. Deploying does NOT use the build output: push to
`main` and Vercel builds from GitHub. `build.ps1` is for local verification
(`.\build.ps1`) and the dev server (`.\build.ps1 -Dev`).

## Roadmap

`PLAN.md` at the root is the locked, phased implementation plan (9 phases,
0–8: security baseline → streaming brain v2 → model router → Kokoro TTS →
Whisper STT → gestures/emotions → webcam vision → sleeping memory → polish).
All hard decisions are made there — read it before any feature work, execute
phase by phase, and update its STATE block before ending a session.

## Layout notes

- `public/avatar.vrm` — the currently deployed Web Witch model (keep as-is).
- `public/avatars/` — canonical character assets (Web Witch + Miku Liv,
  .vrm + .vroid sources), moved here from the retired AIBO_Alive folder.
  Gitignored — too large for the repo; they live on Drive only.
- `docs/Appropriate measurement.txt` — character measurement notes.

## Wiki — check before, update after

A knowledge wiki lives at `G:\My Drive\AI Platforms\Wiki` (markdown notes in
`vault/`, cross-linked with `[[note-id]]` syntax, visualized in `index.html`).
It documents *why* things are built the way they are and the bug history behind
current design choices — this file documents *what's true right now*.

**Before** starting any non-trivial task here (brain route, VRM rendering,
TTS/STT, memory, deploy questions): check `vault/drive-map/project-aibo.md`
and `vault/shared/` for relevant existing notes first.

**After** resolving a non-trivial bug or architecture decision: add or update
a note in the vault as appropriate, AND update the `status`/`updated`/`links`
fields in the `wiki-chain` block at the bottom of this file — that block is
what keeps the wiki's chain view current without anyone needing to remember
to run a sync separately. See [[claude-md-chain-architecture]] for why the
block is structured this way.

<!-- wiki-chain
id: project-aibo-claude
status: Phases 0–3 shipped 2026-07-06 — security baseline; brain v2 (NDJSON streaming, history, lang-first {lang,reply,emotion,gesture,memorable} contract); model router (tier 0 reflexes → Gemini chains → deep model, Upstash budget log, /api/stats); Kokoro worker TTS with per-language voices (browser fallback for unsupported langs), early {lang} frame for streamed sentence dispatch, audio-RMS lip sync. Prod env still missing GOOGLE_GEMINI_API_KEY + Upstash KV + OWNER_KEY (see PLAN.md STATE). Next: Phase 4 (Groq Whisper STT). Plan in PLAN.md.
updated: 2026-07-06
links: [project-aibo, ai-platforms-claude, vtube-claude]
-->
