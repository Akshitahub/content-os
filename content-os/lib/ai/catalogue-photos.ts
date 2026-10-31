import { download } from "@/lib/brand-photos"
import { plainBackgroundColor } from "@/lib/image/subject-boxes"
import { generatePostImage, type GeneratePostImageOptions } from "./post-image-pipeline"

/**
 * Catalogue photography (a studio shot on a plain background) is never
 * posted full-bleed:
 * - a product post shows it as a cutout on the brand colour (the frame
 *   compositor does that by itself for any plain-background photo);
 * - a lifestyle post, a carousel slide or a story frame gets a candid scene
 *   generated WITH the photo as the product reference (gpt-image-2's
 *   reference input), so the real product is worn / used in a real Indian
 *   setting. The scene then goes through the same checks as any image (the
 *   photo was picked by photo-fit; the finished post is scored by the
 *   critic). When the scene can't be made, the photo itself is used -- as
 *   a cutout, never full-bleed.
 */

const cache = new Map<string, boolean>()

/** A studio / catalogue shot: its border is one plain colour. Cached per URL; false if unreadable. */
export async function isCatalogueShot(url: string | null | undefined): Promise<boolean> {
  if (!url) return false
  if (cache.has(url)) return cache.get(url)!
  const bytes = await download(url).catch(() => null)
  const plain = bytes ? !!(await plainBackgroundColor(bytes).catch(() => null)) : false
  cache.set(url, plain)
  if (cache.size > 500) cache.delete(cache.keys().next().value!)
  return plain
}

/** Real Indian settings a catalogue product is shown in, rotated. */
export const CANDID_SETTINGS = [
  "a busy street in an Indian city, shopfronts and auto-rickshaws softly out of focus behind",
  "a neighbourhood cafe in Bengaluru, a table by the window",
  "a college campus in Delhi, steps and trees behind",
  "a Mumbai metro platform, the train arriving behind",
] as const

/** The scene direction for a catalogue product: worn / used by a real person in one of CANDID_SETTINGS. */
export function candidSceneDirection(seed = Math.floor(Math.random() * 1000)): string {
  const setting = CANDID_SETTINGS[Math.abs(seed) % CANDID_SETTINGS.length]!
  return `a candid phone photo of a young Indian person wearing or using the exact product from the reference photo, in ${setting}, natural daylight, a real everyday moment -- not a studio, not a catalogue shot, no plain backdrop`
}

/** Templates that show the product itself (a cutout reads right); every other post is a lifestyle post. */
const PRODUCT_TEMPLATES = new Set(["product_focus", "annotated_product"])
export const isLifestyleTemplate = (template: string | null | undefined) => !PRODUCT_TEMPLATES.has(template ?? "")

/**
 * The post image from the brand photo photo-fit picked: a catalogue shot on
 * a lifestyle post becomes the product reference for a candid scene; if
 * that fails (or the post shows the product itself) the photo is used as
 * is -- the frame compositor cuts a catalogue shot out onto the brand
 * colour. Attempts from both tries are kept for cost tracking.
 */
export async function postImageFromBrandPhoto(options: GeneratePostImageOptions, photoUrl: string | null, opts: { lifestyle: boolean; seed?: number; label: string }): ReturnType<typeof generatePostImage> {
  if (photoUrl && opts.lifestyle && await isCatalogueShot(photoUrl)) {
    const scene = await generatePostImage({
      ...options,
      brandPhotoUrl: null,
      productImageUrl: photoUrl,
      // The scene is ours; a brief whose kind skips the product reference would drop it.
      visualBrief: undefined,
      imagePrompt: `${candidSceneDirection(opts.seed)}. ${options.imagePrompt}`.slice(0, 1500),
    })
    if (scene.success) {
      console.log(`[catalogue-photos] ${opts.label}: catalogue photo -> a candid scene with the product as reference`)
      return scene
    }
    console.error(`[catalogue-photos] ${opts.label}: scene from the catalogue photo failed (using it as a cutout):`, scene.error)
    const cutout = await generatePostImage({ ...options, brandPhotoUrl: photoUrl })
    return { ...cutout, attempts: [...scene.attempts, ...cutout.attempts] }
  }
  return generatePostImage({ ...options, brandPhotoUrl: photoUrl })
}
