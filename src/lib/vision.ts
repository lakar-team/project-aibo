// Vision-intent detection (Phase 6) — multilingual phrases that mean the
// user is inviting Web Witch to look through the webcam. Shared by the
// client (decides to capture a frame) and the router (flags the request).
// Kept in its own module so page.tsx doesn't pull router/server code.

const VISION_PATTERNS: RegExp[] = [
    // English
    /\bcan you see (me|this|it|us)\b/i,
    /\b(take a )?look at (this|me|it|my|what)\b/i,
    /\bhow do i look\b/i,
    /\bwhat am i (holding|wearing|showing)\b/i,
    /\bwhat (do|can) you see\b/i,
    /\bopen your (eyes?|crystal eye)\b/i,
    // Japanese
    /見て(みて|ください|くれる)?/,
    /(私|わたし|これ|それ)[がは]?見える/,
    /どう見える/,
    /何を持って(いる|る)/,
    // Malay / Indonesian
    /\b(boleh )?(nampak|tengok|lihat) (saya|ini|ni)\b/i,
    /\bmacam ?mana rupa saya\b/i,
    /\bapa yang saya pegang\b/i,
    // Spanish / French (light coverage)
    /\bme ves\b/i,
    /\bmira esto\b/i,
    /\b(tu me vois|regardez?[- ]?(moi|ça|ca))\b/i,
];

export function wantsVision(message: string): boolean {
    const msg = message.trim();
    if (!msg) return false;
    return VISION_PATTERNS.some(re => re.test(msg));
}
