import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
    try {
        const { message, image } = await req.json();

        // System instruction
        const systemPrompt = "You are Lakar, a witty architect assistant based in Sendai. You are helpful, concise, and have a dry sense of humor. Keep answers short (under 2 sentences) for conversation.";

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

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "HTTP-Referer": "https://project-aibo.vercel.app", // Optional
                "X-Title": "Project AIBO", // Optional
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemini-2.0-flash-exp:free", // Improved free model reliability
                "messages": messages,
            })
        });

        const data = await response.json();

        if (data.error) {
            console.error("OpenRouter API Error:", data.error);
            return NextResponse.json({
                error: `OpenRouter Error: ${data.error.message} (Code: ${data.error.code || 'unknown'})`
            }, { status: 500 });
        }

        const replyText = data.choices[0].message.content;

        return NextResponse.json({ reply: replyText });

    } catch (error: any) {
        console.error("Brain API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
