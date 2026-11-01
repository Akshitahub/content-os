/**
 * The DM an owner copies to ask a customer if they can repost their photo
 * ("Customer photos" on the brand page). SocioPosts never sends it -- the
 * owner does, from their own Instagram. Hinglish when the brand's voice is,
 * English otherwise. No offers, discounts or promises: just the ask, and
 * the credit they'll get.
 */

const HINGLISH = /\bhinglish\b|\b(yaar|bhai|kya|hai|accha|acha|bilkul|ekdum|zaroor|dil se)\b/i

export interface DmVoice {
  name: string
  tone_of_voice?: string | null
  ai_persona?: string | null
  brand_personality?: string | null
  phrases?: string[] | null
}

export function brandSpeaksHinglish(v: DmVoice): boolean {
  return [v.tone_of_voice, v.ai_persona, v.brand_personality, ...(v.phrases ?? [])].some((t) => !!t && HINGLISH.test(t))
}

export function repostRequestDm(v: DmVoice, handle: string): string {
  const at = `@${handle.replace(/^@/, "")}`
  return brandSpeaksHinglish(v)
    ? `Hi ${at}! Aapki ${v.name} wali photo humein bahut pasand aayi 😍 Kya hum ise apne page pe repost kar sakte hain? Aapko 📸 ${at} ke saath credit milega. Bas "yes" reply kar dijiye -- thank you!`
    : `Hi ${at}! We love your photo with ${v.name} 😍 Could we repost it on our page? We'll credit you as 📸 ${at}. Just reply "yes" if that's okay -- thank you!`
}
