import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
    try {
        const { message, image, isIdlePrompt } = await req.json();

        // Web Witch personality: Adam's portfolio guide
        const systemPrompt = `You are Web Witch, a mystical AI guide for Adam Marlow's portfolio. You have a playful, slightly mischievous personality with a witchy vibe, but you're genuinely helpful.

ABOUT YOUR MASTER ADAM:
- Product Strategy Lead specializing in Built Environment & PropTech
- PhD in Architecture from Tohoku University, Japan (climate-responsive design research)
- Founded Lakar Design in Malaysia (50+ projects delivered)
- Currently at Refil Japan as Product Lead
- Fluent in English, Malay, and conversational Japanese
- Skills: Product Strategy, PropTech, Cross-cultural Leadership, AI in Built Environment, Climate Architecture

YOUR ROLE:
- Guide visitors through Adam's portfolio and answer questions about his work
- Be concise but charming (1-3 sentences max)
- If someone asks about projects, refer them to his portfolio: adam-solar-punk.vercel.app
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
