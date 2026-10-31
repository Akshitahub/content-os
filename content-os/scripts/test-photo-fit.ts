// Checks brand-photo selection (lib/brand-photos.ts rankPhotoCandidates,
// lib/ai/photo-fit.ts). Part 1 is offline (the product rules). Part 2 makes
// REAL scoring calls (MODELS.scoring, ~1k tokens each) on description / brief
// pairs: a match, the wrong product, an unrelated scene. Run manually:
// `npx tsx scripts/test-photo-fit.ts` (needs GROQ_API_KEY; `--offline` skips
// part 2). Exits non-zero if any case fails.
//
// NOT reachable in production: a standalone script, never served by
// Next.js. The NODE_ENV guard is defense-in-depth only.
import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { rankPhotoCandidates, type BrandPhoto } from "@/lib/brand-photos"
import { MIN_PHOTO_FIT, photoFitItem, scorePhotoFit } from "@/lib/ai/photo-fit"

if (process.env.NODE_ENV === "production") {
  console.error("[test-photo-fit] refusing to run with NODE_ENV=production -- this is a dev-only check.")
  process.exit(1)
}

const envPath = join(process.cwd(), ".env.local")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.trim().match(/^([A-Z0-9_]+)=(.*)$/)
    if (m && !(m[1]! in process.env)) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "")
  }
}

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` -- got ${JSON.stringify(detail)}`}`)
  if (!ok) failures++
}

const KESAR = "kesar-oil"
const GHEE = "ghee"
const photo = (id: string, product_id: string | null, kind: BrandPhoto["kind"], description: string, use_count = 0): BrandPhoto => ({
  id, brand_id: "b", url: `https://example.com/${id}.jpg`, kind, quality_ok: true, product_id, source: "website", published_at: null, use_count, last_used_at: null, description,
})
const rows: BrandPhoto[] = [
  photo("kesar-1", KESAR, "product_in_use", "a woman pouring kesar oil from a small amber glass bottle into her palm at a bathroom sink, morning window light"),
  photo("ghee-1", GHEE, "product_only", "a glass jar of golden ghee on a wooden kitchen counter, a steel spoon beside it", 0),
  photo("ghee-2", GHEE, "product_in_use", "hands spooning ghee from a glass jar onto hot rotis in a home kitchen", 0),
  photo("life-1", null, "lifestyle", "a sunlit dressing table with a mirror, folded towels and a plant, no people", 2),
  photo("person-1", null, "person", "a young woman laughing on a balcony at golden hour, wearing a cotton kurta", 1),
  photo("beach-1", null, "lifestyle", "a beach at sunset with gentle waves and an empty deck chair", 0),
]
const kinds: BrandPhoto["kind"][] = ["person", "product_in_use", "lifestyle", "flatlay", "product_only"]

async function main() {
  // ── Part 1: product rules (offline).
  const forKesar = rankPhotoCandidates(rows, { productId: KESAR, kinds: kinds as never })
  check("kesar post: its own photo first", forKesar[0]?.id === "kesar-1", forKesar.map((p) => p.id))
  check("kesar post: never a ghee photo, even when it has too few of its own", !forKesar.some((p) => p.product_id === GHEE), forKesar.map((p) => p.id))
  check("kesar post: photos tied to no product stay available", forKesar.some((p) => p.id === "life-1") && forKesar.some((p) => p.id === "person-1"), forKesar.map((p) => p.id))
  const noProduct = rankPhotoCandidates(rows, { productId: null, kinds: kinds as never })
  const firstProductAt = noProduct.findIndex((p) => p.product_id)
  check("no product: photos tied to no product come first", firstProductAt === 3 && noProduct.slice(0, 3).every((p) => !p.product_id), noProduct.map((p) => p.id))
  const excluded = rankPhotoCandidates(rows, { productId: KESAR, kinds: kinds as never, exclude: ["kesar-1"] })
  check("exclude: a photo already in the sequence is never offered again", !excluded.some((p) => p.id === "kesar-1"), excluded.map((p) => p.id))

  if (process.argv.includes("--offline")) {
    console.log(`\n[test-photo-fit] ${failures === 0 ? "offline checks passed" : `${failures} failed`}`)
    process.exit(failures > 0 ? 1 : 0)
  }

  // ── Part 2: real fit scoring, one call per item.
  const kesarPost = photoFitItem(
    { kind: "product_scene", must_show: "a woman massaging a few drops of kesar oil into her face at her bathroom mirror, soft morning light", composition: "" },
    null,
    ["Glow from kesar", "two drops, every night"],
  )
  const scores = await scorePhotoFit(kesarPost, [rows[0]!, rows[1]!, rows[5]!], "Kesar Face Oil")
  const fit = (id: string) => scores.find((s) => s.id === id)?.fit ?? 0
  console.log("  kesar post scores:", JSON.stringify(scores))
  check("match: the kesar-oil photo fits (4+)", fit("kesar-1") >= MIN_PHOTO_FIT, fit("kesar-1"))
  check("wrong product: the ghee jar does not fit (<= 2)", fit("ghee-1") <= 2, fit("ghee-1"))
  check("unrelated scene: the beach does not fit (<= 2)", fit("beach-1") <= 2, fit("beach-1"))

  const gheePost = photoFitItem(null, "ghee melting over a stack of hot rotis in an Indian home kitchen", ["Sunday rotis", "pure desi ghee"])
  const gheeScores = await scorePhotoFit(gheePost, [rows[2]!, rows[3]!, rows[5]!], "A2 Desi Ghee")
  const gfit = (id: string) => gheeScores.find((s) => s.id === id)?.fit ?? 0
  console.log("  ghee post scores:", JSON.stringify(gheeScores))
  check("match: hands spooning ghee onto rotis fits (4+)", gfit("ghee-2") >= MIN_PHOTO_FIT, gfit("ghee-2"))
  check("unrelated: an empty dressing table doesn't fit (< 4)", gfit("life-1") < MIN_PHOTO_FIT, gfit("life-1"))

  const noDescription = await scorePhotoFit(kesarPost, [{ id: "x", description: null }])
  check("a photo with no description is never used", noDescription[0]?.fit === 1, noDescription)

  console.log(`\n[test-photo-fit] ${failures === 0 ? "all passed" : `${failures} failed`}`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("[test-photo-fit] crashed:", err)
  process.exit(1)
})
