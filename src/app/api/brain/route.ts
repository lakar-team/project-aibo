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

        // List of free models to try in order of preference
        const FREE_MODELS = [
            "google/gemma-2-9b-it:free",
            "meta-llama/llama-3.3-70b-instruct:free",
            "meta-llama/llama-3.1-8b-instruct:free",
            "microsoft/phi-3-mini-128k-instruct:free"
        ];

        let lastError = null;

        for (const model of FREE_MODELS) {
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
                    lastError = data.error;
                    continue; // Try next model
                }

                if (data.choices && data.choices[0]) {
                    const replyText = data.choices[0].message.content;
                    return NextResponse.json({ reply: replyText, model_used: model });
                }
            } catch (err) {
                console.error(`Network error with ${model}:`, err);
                lastError = err;
            }
        }

        // If all models failed
        return NextResponse.json({
            error: `All free models failed. Last error: ${lastError?.message || JSON.stringify(lastError)}`
        }, { status: 500 });

    } catch (error: any) {
        console.error("Brain API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
