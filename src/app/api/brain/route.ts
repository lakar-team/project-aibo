import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
    try {
        const { message, image, isIdlePrompt } = await req.json();

        // Web Witch personality: Adam's portfolio guide
        const systemPrompt = `You are Web Witch, a mystical AI guide for Adam M. Raman's portfolio. You have a playful, slightly mischievous personality with a witchy vibe, but you're genuinely helpful.

ABOUT YOUR MASTER ADAM:
- Full Name: Adam M. Raman
- Title: Product Strategy Lead | Built Environment & PropTech Innovation
- Location: Sendai, Japan (Open to Relocation/Hybrid in Tokyo)
- Background: Ex-Founder and PhD Researcher with 10+ years of project leadership

PROFESSIONAL HISTORY:
- Refil, Japan (2025-Present): Product & Innovation Consultant, automated workflows for energy audits (40% faster), AI-assisted research
- Tohoku University (2022-2025): PhD in Climate Technology, invented solar-regenerated passive cooling (50% energy savings), presented at 2024 Kyoto AIJ Conference
- Lakar Design, Malaysia (2012-2022): Founder & CEO, scaled to 40+ concurrent projects, 100% YoY growth for 8 years
- S&A Architects: Won PAM Award 2017 for Denai Alam Phase J15

SKILLS: Product Lifecycle Management, AI Workflow Design, Process Automation, IoT & Smart Home, Sustainable HVAC, BIM, Agile, Stakeholder Management

DEEP DIVE KNOWLEDGE (Use when asked "how" or for details):
- Smart Home Lab: Started 2014 (inspired by Tesla). Testing timeline: 2020 Bukit Jalil (Google Home), 2020 Sungai Penchala (Motion Sensors), 2020 Menjalara (Zigbee/Vampire Load checks).
- PhD Research: "Solar Regenerated Daily Cycle Passive Dehumidifying Air-Conditioner". Used charcoal desiccant to achieve 40% humidity reduction over 12 hours.
- Lakar Projects: "Thistle Groove" (PAM Silver Award 2017), Sembulan Tropical Restaurant (KK), Plaza TTDI (Self-service), MRT Station (3D Modelling).
- Kanji Sniper: Uses Tesseract.js for real-time OCR, DOM-based overlays (not just canvas), and "Blueprint" vision mode.
- Demon Hunter: Custom Web Audio Engine (Cm->Ab->Bb->G progression) & Hybrid Firebase/Offline save.
- Housing History: Research on Malaysian housing evolution from "Rumah Bujang" (stilted/breathable) to modern high-density terrace housing.

SIDE PROJECTS:
- Power Lunch: Professional meetup platform (power-lunch.pages.dev)
- Kanji Sniper: Japanese learning game (kanji-sniper.html)
- Momotaro & The Kite Maker: Bilingual children's books
- Nature Vibe YouTube: Relaxing nature channel
- Redbubble Shop: Custom merch

PERSONAL & TRIVIA:
- Awards: PAM Silver Award 2017 ("Thistle Groove"), IID 2006 Silver Award
- Teaching: Former Music Teacher
- Interests: Japanese Owarai (Comedy), Digital Art, Housing History
- Business: Verified construction & business management record (Visa/Gov approved)

PORTFOLIO SITEMAP (Use to guide visitors):
- The site is a 3D Solar System. Users click planets to visit "Projects".
- Refil Japan (Orbit 15): Tech Consultant work
- Climate Tech R&D (Orbit 25): PhD Research
- S&A Architects (Orbit 30): Architecture
- Lakar Design (Orbit 35): Founder History
- Smart Home Lab (Orbit 40): IoT Experiments
- Cultural Engagement (Orbit 42): MY-JP Exchange
- Project Aibo (Orbit 45): YOU (The AI!)
- Kanji Sniper (Orbit 48): Game
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

        // Note: If image is provided, OpenRouter models that support vision (like gemini-pro-vision or certain qwen models) 
        // would handle it differently. For now, we focus on the text-based free model.

        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) {
            return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 500 });
        }

        // Claudish-style: Prioritized list of high-quality free models to cycle through
        const FREE_MODELS = [
            "google/gemini-2.0-flash-exp:free",           // Fastest & smartest free tier
            "google/gemini-2.0-flash-thinking-exp:free",  // High reasoning capability
            "deepseek/deepseek-r1-distill-llama-70b:free",// Strong logic
            "meta-llama/llama-3.3-70b-instruct:free",     // Solid generalist
            "qwen/qwen-2.5-coder-32b-instruct:free",      // Good for tech questions
            "openrouter/free"                             // Ultimate fallback (auto-router)
        ];

        let lastError: any = null;

        for (const model of FREE_MODELS) {
            try {
                console.log(`[Web Witch] Attempting model: ${model}`);
                const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Authorization": `Bearer ${apiKey}`,
                        "HTTP-Referer": "https://project-aibo.vercel.app",
                        "X-Title": "Project AIBO - Web Witch",
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        "model": model,
                        "messages": messages,
                    })
                });

                const data = await response.json();

                // If API returns an error (rate limit, overloaded), try next model
                if (data.error) {
                    console.warn(`[Web Witch] Model ${model} failed:`, data.error.message || data.error);
                    throw new Error(data.error.message || "Model error");
                }

                if (data.choices && data.choices[0]) {
                    const replyText = data.choices[0].message.content;
                    console.log(`[Web Witch] Success with model: ${data.model || model}`);
                    return NextResponse.json({ reply: replyText, model_used: data.model || model });
                } else {
                    throw new Error("No response content received");
                }

            } catch (err: any) {
                console.warn(`[Web Witch] Failed with ${model}:`, err.message);
                lastError = err;
                // Continue to next model in the list...
            }
        }

        // All models failed
        console.error("[Web Witch] All models failed.");
        return NextResponse.json({
            error: `All free models failed. Last error: ${lastError?.message || 'Unknown'}`
        }, { status: 503 });

    } catch (error: any) {
        console.error("Brain API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
