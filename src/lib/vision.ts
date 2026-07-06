// Vision-intent detection (Phase 6) — multilingual phrases that mean the
// user is inviting Web Witch to look through the webcam. Shared by the
// client (decides to capture a frame) and the router (flags the request).
// Kept in its own module so page.tsx doesn't pull router/server code.
//
// Patterns are deliberately loose PARTIAL matches (not anchored phrases) and
// cover casual spellings ("what do u see?", "do u see me?") — the first
// production users wrote exactly that and the old formal patterns missed it.

const VISION_PATTERNS: RegExp[] = [
    // English — casual "u"/"ya" spellings included, partial matches
    /(can|do|could) (you|u|ya) see/i,          // "can u see", "do you see me?"
    /what (do|can|does) (you|u|ya) see/i,      // "what do u see?"
    /\bsee me\b/i,
    /\bsee (this|that|it|us|what i)\b/i,
    /look at (this|that|me|it|my|us|what)/i,
    /\btake a look\b/i,
    /\bhave a look\b/i,
    /how do i look/i,
    /what am i (holding|wearing|showing|doing)/i,
    /open your (eyes?|crystal eye)/i,
    /\buse (your|the) camera\b/i,
    // Japanese
    /見て/,
    /見える/,
    /見えますか/,
    /何を持って/,
    // Malay / Indonesian
    /(boleh )?(nampak|tengok|lihat) (saya|aku|ini|ni)/i,
    /macam ?mana rupa saya/i,
    /apa yang saya pegang/i,
    // Spanish / French
    /\bme ves\b/i,
    /\bmiras?\b/i,
    /mira esto/i,
    /\bregardez?\b/i,
    /tu me vois/i,
];

export function wantsVision(message: string): boolean {
    const msg = message.trim();
    if (!msg) return false;
    return VISION_PATTERNS.some(re => re.test(msg));
}
