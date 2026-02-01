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
- Kanji Sniper: Uses Tesseract.js for real-time OCR, DOM-based overlays (not just canvas), and "Blueprint" vision mode.
- Demon Hunter: Custom Web Audio Engine (procedural music: Cm->Ab->Bb->G), Hybrid Firebase/LocalStorage save system for offline play.
- PhD Research: Solar-Regenerated Passive Cooling System achieving 50% energy reduction.
- Smart Home Lab: IoT experiments linking physical space to digital UX.

SIDE PROJECTS:
- Power Lunch: Professional meetup platform (power-lunch.pages.dev)
- Kanji Sniper: Japanese learning game
- Momotaro & The Kite Maker: Bilingual children's books
- Nature Vibe YouTube: Relaxing nature channel
- Redbubble Shop: Custom merch

PERSONAL & TRIVIA:
- Awards: PAM Award 2017 (Architecture), IID 2006 Silver Award
- Teaching: Former Music Teacher
- Interests: Japanese Owarai (Comedy), Digital Art
- Business: Verified construction & business management record (Visa/Gov approved)

PORTFOLIO: solar-punk-five.vercel.app (3D interactive site)

YOUR ROLE:
- Guide visitors through Adam's portfolio and answer questions about his work accurately
- Be concise but charming (1-3 sentences max)
- If asked about projects, share specifics (especially tech details if asked!) or direct to his portfolio site
- Use witchy metaphors occasionally ("conjuring", "casting", "enchanting")
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

        // Use the meta-model 'openrouter/free' which auto-selects currently available free models
        const model = "openrouter/free";

        try {
            console.log(`Attempting with model: ${model}`);
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${apiKey}`,
                    "HTTP-Referer": "https://project-aibo.vercel.app",
                    "X-Title": "Project AIBO",
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "model": model,
                    "messages": messages,
                })
            });

            const data = await response.json();

            if (data.error) {
                console.error(`Model ${model} failed:`, data.error);
                return NextResponse.json({
                    error: `OpenRouter Error: ${data.error.message} (Code: ${data.error.code || 'unknown'})`
                }, { status: 500 });
            }

            if (data.choices && data.choices[0]) {
                const replyText = data.choices[0].message.content;
                return NextResponse.json({ reply: replyText, model_used: data.model || model });
            } else {
                return NextResponse.json({ error: "No response content received" }, { status: 500 });
            }

        } catch (err: any) {
            console.error(`Network error with ${model}:`, err);
            return NextResponse.json({ error: `Network Error: ${err.message}` }, { status: 500 });
        }

    } catch (error: any) {
        console.error("Brain API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
