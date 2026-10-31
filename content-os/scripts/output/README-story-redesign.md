# Story redesign renders

Rendered by `scripts/render-story-redesign.ts` with the real story copy call
(`lib/ai/story-sequence-generator.ts`), the frame rules (`lib/ai/story-frames.ts`)
and the real compositor (`lib/image/story-frame-compositor.ts`). Each folder has the
frames (`frame-N-<kind>.jpg`), a contact sheet (`sheet.jpg`) and the frames' copy
(`copy.json`, including where each frame's photo came from).

## `story-redesign/wick-ember`, `story-redesign/kaapi-theory` -- SAMPLE brands

Built-in sample brands (`--sample`), **not real SocioPosts customers**:

- **Wick & Ember** (candles, with a product): its "brand photos" are free stock
  photos (picsum.photos / Unsplash licence) standing in for imported brand photos.
- **Kaapi Theory** (coffee, no photos, no product): with no brand photo and AI image
  generation off (`--no-ai`), every frame renders on the brand palette.

No real brand had imported photos yet when these were made (`brand_images` was empty),
and the OpenAI account had no credits for AI photos. The real-brand sets (SNITCH with its
imported photos, Esthe without) are rendered with
`npx tsx scripts/render-story-redesign.ts --brand <id> [--product <id>]` once the photo
collection has run for SNITCH.
