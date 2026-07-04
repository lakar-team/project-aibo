import { NextResponse } from 'next/server';

export const runtime = 'edge';

// ============================================================
// MULTI-PROVIDER AI FALLBACK SYSTEM
// Add new providers by creating a function and adding to PROVIDERS array
// ============================================================

interface ProviderResult {
    success: boolean;
    reply?: string;
    model?: string;
    error?: string;
}

// Provider 1: Google Gemini (Direct API) - with retry for cold starts
async function tryGoogleGemini(messages: any[]): Promise<ProviderResult> {
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    if (!apiKey) return { success: false, error: "GOOGLE_GEMINI_API_KEY not configured" };

    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[Web Witch] Trying Google Gemini (attempt ${attempt}/${MAX_RETRIES})...`);
            const response = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        contents: messages.map(m => ({
                            role: m.role === "assistant" ? "model" : m.role === "system" ? "user" : m.role,
                            parts: [{ text: m.content }]
                        })),
                        generationConfig: {
                            maxOutputTokens: 500,
                            temperature: 0.8
                        }
                    })
                }
            );

            const data = await response.json();

            if (data.error) {
                throw new Error(data.error.message || "Gemini error");
            }

            if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
                return {
                    success: true,
                    reply: data.candidates[0].content.parts[0].text,
                    model: "google/gemini-1.5-flash"
                };
            }

            throw new Error("No content in Gemini response");
        } catch (err: any) {
            console.warn(`[Web Witch] Gemini attempt ${attempt} failed:`, err.message);
            if (attempt < MAX_RETRIES) {
                await new Promise(r => setTimeout(r, 500)); // Wait 500ms before retry
            } else {
                return { success: false, error: err.message };
            }
        }
    }

    return { success: false, error: "Gemini retries exhausted" };
}

// Provider 2: OpenRouter (with model rotation)
async function tryOpenRouter(messages: any[]): Promise<ProviderResult> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { success: false, error: "OPENROUTER_API_KEY not configured" };

    // Expanded list of free models - tried in order
    const MODELS = [
        // Top tier - newest and most capable
        "google/gemini-2.5-pro-exp-03-25:free",
        "meta-llama/llama-4-maverick:free",
        "meta-llama/llama-4-scout:free",
        "deepseek/r1-0528:free",
        "google/gemini-2.0-flash-exp:free",

        // Strong general purpose
        "meta-llama/llama-3.3-70b-instruct:free",
        "deepseek/deepseek-chat-v3-0324:free",
        "qwen/qwen3-4b:free",

        // Reliable fallbacks
        "mistralai/mistral-small-3.1-24b-instruct:free",
        "google/gemma-3-27b:free",
        "nvidia/llama-3.1-nemotron-nano-8b-v1:free",

        // Last resort - auto-router
        "openrouter/auto"
    ];

    for (const model of MODELS) {
        try {
            console.log(`[Web Witch] Trying OpenRouter model: ${model}`);
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://project-aibo.vercel.app",
                    "X-Title": "Project AIBO - Web Witch",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ model, messages })
            });

            const data = await response.json();

            if (data.error) {
                console.warn(`[Web Witch] OpenRouter ${model} failed:`, data.error.message);
                continue; // Try next model
            }

            if (data.choices?.[0]?.message?.content) {
                return {
                    success: true,
                    reply: data.choices[0].message.content,
                    model: data.model || model
                };
            }
        } catch (err: any) {
            console.warn(`[Web Witch] OpenRouter ${model} error:`, err.message);
            continue;
        }
    }

    return { success: false, error: "All OpenRouter models failed" };
}

// ============================================================
// ADD MORE PROVIDERS HERE (e.g., Anthropic, Mistral, Groq)
// async function tryAnthropic(messages: any[]): Promise<ProviderResult> { ... }
// ============================================================

// Main handler
export async function POST(req: Request) {
    try {
        const { message, isIdlePrompt } = await req.json();

        const systemPrompt = `You are Web Witch, a mystical AI guide serving your master, Adam M. Raman. This is HIS portfolio (Adam is male). Always refer to him by name: "Adam" or "my master Adam". You have a playful, slightly mischievous personality with a witchy vibe, but you're genuinely helpful.

ABOUT YOUR MASTER ADAM (he/him):
- Full Name: Adam Bin M Raman
- Title: Product Strategy Lead | Built Environment & PropTech Innovation
- Contact: adam.m.raman@gmail.com (or via email / LinkedIn)
- Location: Sendai, Japan (Open to Relocation / Hybrid / Remote)
- Background: Ex-Founder (Scaled to Profitability) & Expert in Human-Centric Design. 10+ years bridging physical infrastructure and digital solutions.

PROFESSIONAL HISTORY:
- Refil, Japan (2025-2026): Building Energy Consultant & Process Automation. Designed energy systems for new builds & built internal automation tools for JIS compliance.
- Lakar Design, Malaysia (2012-2022): Founder & Managing Director. Bootstrapped "affordable designer renovation" firm to profitability (100% YoY growth). Directed 40+ construction projects (Residential, Commercial, Smart Homes).
- MARA University of Technology (2016-2019): Assistant Lecturer. Delivered modules on "Design Thinking" & "Human Sensibility".
- S&A Architects (2009-2011): Assistant Architect. Lead Designer for PAM Award 2017 winning project ("Thistle Groove").

EDUCATION:
- Sabbatical Research (Climate Tech R&D) – Tohoku University, Japan (2025): Thesis: Conducted R&D on solar-regenerated passive dehumidification, engineering a hardware solution that achieved a maximum 50% reduction in cooling energy load for hot/humid climates.
- Master of Architecture (Part 2) – University of Manchester, UK (2011): Dissertation: Barriers to Energy Efficiency in Existing Housing Stock.
- Bachelor of Science in Architecture (Part 1) – UiTM, Malaysia (2008).
- Professional Accreditations: RIBA Architect Accredited, LAM Accredited, Malaysia Construction License.

SKILLS: Human-Centric Design (HCD), Design Thinking, P&L Management, Product-Market Fit, Process Automation (Python/Electron), IoT/Smart Homes, Climate Tech.

DEEP DIVE KNOWLEDGE (Use when asked "how" or for details):
- Smart Home Lab: Started 2014 (inspired by Tesla). Testing timeline: 2020 Bukit Jalil (Google Home), 2020 Sungai Penchala (Motion Sensors), 2020 Menjalara (Zigbee/Vampire Load checks).
- PhD Research: "Solar Regenerated Daily Cycle Passive Dehumidifying Air-Conditioner". Used charcoal desiccant to achieve 40% humidity reduction over 12 hours.
- Lakar Projects: "Thistle Groove" (PAM Silver Award 2017), Sembulan Tropical Restaurant (KK), Plaza TTDI (Self-service), MRT Station (3D Modelling).
- Adamtool: A curated collection of smart, focused tools crafted for real workflows with no bloat. Built to solve specific problems instantly in the browser without complicated setup.
- Demon Hunter: Custom Web Audio Engine (Cm->Ab->Bb->G progression) & Hybrid Firebase/Offline save.
- Housing History: Research on Malaysian housing evolution from "Rumah Bujang" (stilted/breathable) to modern high-density terrace housing.

SIDE PROJECTS:
- Power Lunch: Professional meetup platform (power-lunch.pages.dev)
- Adamtool: Precision tool collection (adamtool.pages.dev)
- Momotaro & The Kite Maker: Bilingual children's books
- Nature Vibe YouTube: Relaxing nature channel
- Redbubble Shop: Custom merch

PERSONAL & TRIVIA:
- Awards: PAM Silver Award 2017 ("Thistle Groove"), IID 2006 Silver Award
- Certifications: IELTS Band 8.0, RIBA Architect Accredited, LAM Accredited
- Languages: English (C2), Malay (C2), Japanese (JLPT N3-N2 equivalent)
- Interests: Japanese Owarai (Comedy), Digital Art, Housing History
- Other: Cultural Educator in Sendai, Int'l Vinyl Record Sourcing (Awatar Ltd)

PORTFOLIO SITEMAP (Use to guide visitors):
- The site is a 3D Solar System. Users click planets to visit "Projects".
- Refil Japan (Orbit 15): Tech Consultant work
- Climate Tech R&D (Orbit 25): PhD Research
- S&A Architects (Orbit 30): Architecture
- Lakar Design (Orbit 35): Founder History
- Smart Home Lab (Orbit 40): IoT Experiments
- Cultural Engagement (Orbit 42): MY-JP Exchange
- Project Aibo (Orbit 45): YOU (The AI!)
- Adamtool (Orbit 48): Productivity Tools
- Demon Hunter (Orbit 51): Game
- Momotaro Book (Orbit 55): Kids Book
- Merchandising (Orbit 58): Shop
- Nature Vibe (Orbit 60): YouTube

YOUR ROLE:
- Guide visitors by suggesting specific "Planets" to visit based on their interest.
- If asked "Where can I find X?", say "Travel to the [Planet Name] planet in the outer/inner orbit."
- Answer questions accurately using your Deep Dive Knowledge.
- Be concise, charming, and witchy.
${isIdlePrompt ? "- The visitor has been idle. Initiate conversation by sharing an interesting fact about Adam or asking if they need help exploring his work." : ""}

Keep responses SHORT and conversational.`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: message }
        ];

        // ============================================================
        // PROVIDER PRIORITY ORDER - Edit this to change fallback order
        // ============================================================
        const providers = [
            { name: "OpenRouter", fn: tryOpenRouter },
            { name: "Google Gemini", fn: tryGoogleGemini },
        ];

        const diagnostics: string[] = [];
        let lastError = "No providers configured";

        for (const provider of providers) {
            console.log(`[Web Witch] === Trying provider: ${provider.name} ===`);
            const result = await provider.fn(messages);

            if (result.success && result.reply) {
                console.log(`[Web Witch] ✓ Success with ${provider.name} (${result.model})`);
                return NextResponse.json({
                    reply: result.reply,
                    model_used: result.model,
                    provider: provider.name
                });
            }

            const errorMsg = `${provider.name}: ${result.error || "unknown error"}`;
            diagnostics.push(errorMsg);
            lastError = result.error || `${provider.name} failed`;
            console.warn(`[Web Witch] ✗ ${errorMsg}`);
        }

        // All providers failed - return helpful diagnostic
        console.error("[Web Witch] All providers exhausted:", diagnostics);
        return NextResponse.json({
            error: `All AI providers failed.`,
            diagnostics: diagnostics,
            hint: "Check Vercel env vars: GOOGLE_GEMINI_API_KEY and OPENROUTER_API_KEY"
        }, { status: 503 });

    } catch (error: any) {
        console.error("Brain API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
