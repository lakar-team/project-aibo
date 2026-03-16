# 🤖 PROJECT AIBO: GENERATIVE AI AVATAR

![Version](https://img.shields.io/badge/Version-2.1.0--ALPHA-cyan)
![Engine](https://img.shields.io/badge/Engine-Next.js_16%2B-black)
![3D](https://img.shields.io/badge/3D-Three.js_%2F_VRM-blue)

**Project AIBO** is a high-fidelity, interactive AI avatar interface. Built with **React 19** and **Three.js**, it brings 3D characters to life using the VRM standard, powered by advanced generative brain models.

## ✨ Core Systems

- 🧠 **Dynamic Brain**: Integrated with **OpenRouter API** (and local Ollama support) for sophisticated, context-aware conversations.
- 💃 **Motion Engine**: Full support for **@pixiv/three-vrm**, enabling realistic body language, facial expressions, and procedural animations.
- 🎭 **Emotion Framework**: A state-based mood system that translates AI intent into visual character states (Happy, Sad, Surprised, Neutral).
- 🎙️ **Neural Voice**: TTS integration via **Edge-TTS**, providing natural-sounding communication with adjustable pitch and rate.

## 🚀 Technical Stack

- **Frontend**: Next.js 16 (Alpha) / React 19 / TypeScript
- **3D Graphics**: Three.js / @react-three/fiber
- **Avatar Format**: VRM (@pixiv/three-vrm)
- **AI Integration**: OpenRouter SDK / Ollama

## 🛠️ Setup & Ignition

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file based on `.env.example`:
```env
OPENROUTER_API_KEY=your_key_here
NEXT_PUBLIC_AVATAR_URL=/models/aibo.vrm
```

### 3. Start the Engine
```bash
npm run dev
```

## 📦 Architecture

- `/src/components/canvas`: The Three.js rendering layer.
- `/src/lib/brain`: Logic for persona management and LLM integration.
- `/src/hooks`: Custom hooks for VRM expression and pose control.

---
&copy; 2026 Lakar Lab / Advanced Agency Framework
