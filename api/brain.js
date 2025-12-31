// api/brain.js
export const config = {
  runtime: 'edge', // This makes it start instantly (Fast!)
};

export default async function handler(req) {
  // 1. Security Check: Only allow POST requests
  if (req.method !== 'POST') {
    return new Response('Only POST requests allowed', { status: 405 });
  }

  try {
    // 2. Parse the incoming message (Text + optional Image)
    const { message, image } = await req.json();

    // 3. Prepare the payload for Google Gemini
    // We use the "system instruction" to give him personality.
    const systemPrompt = "You are Lakar, a witty architect assistant based in Sendai. You are helpful, concise, and have a dry sense of humor. Keep answers short (under 2 sentences) for conversation.";

    const payload = {
      contents: [
        {
          role: "user",
          parts: [
            { text: systemPrompt + "\n\nUser: " + message }
          ]
        }
      ]
    };

    // If there is an image, add it to the payload
    if (image) {
      payload.contents[0].parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: image // Base64 string
        }
      });
    }

    // 4. Send to Google (The "Fetch" call)
    // We use the Environment Variable process.env.GEMINI_API_KEY
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }
    );

    const data = await response.json();

    // 5. Extract the text reply
    const replyText = data.candidates[0].content.parts[0].text;

    // 6. Send the answer back to the Avatar (Body)
    return new Response(JSON.stringify({ reply: replyText }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
