-- 031_image_generation_observability.sql
-- Fixes the observability gap from docs/research/post-imagery-diagnosis.md
-- issue 3: it was impossible to answer "how often does the near-blank/
-- near-black quality check trip, and at which attempt" because
-- generated_images.model_used was hardcoded to a constant instead of
-- recording which provider actually produced the image, and only the
-- final outcome of a call was ever logged, not each internal attempt
-- inside fetchBackgroundImage. This migration does NOT change the 8/247
-- threshold values themselves — the diagnosis explicitly couldn't confirm
-- they're miscalibrated, so this is purely about making the next
-- diagnosis possible with real data, not a guess at a fix.
--
-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor — no
-- automated migration runner is wired up in this environment.

-- `provider` already exists on the live generated_images table (found
-- querying real data — some historical rows already have it populated,
-- e.g. "pollinations" — but no migration in this repo ever added it, so a
-- fresh DB built from these migrations alone would be missing it
-- entirely). IF NOT EXISTS makes this a safe no-op against production.
ALTER TABLE public.generated_images
ADD COLUMN IF NOT EXISTS provider TEXT;

-- One row per real attempt inside fetchBackgroundImage (lib/ai/post-image-pipeline.ts)
-- — not just the final call outcome. `failure_reason` is deliberately
-- structured (not free text) so it's actually queryable: distinguishing
-- near_black/near_blank (the quality-check thresholds under suspicion)
-- from too_small/unreadable/network_error/api_error (everything else)
-- is exactly what's needed to answer whether the quality check itself is
-- over-triggering versus some other cause being the dominant one.
CREATE TABLE public.image_generation_attempts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id          UUID REFERENCES public.brands(id) ON DELETE CASCADE,
  feature           TEXT NOT NULL,
  attempt_number    INTEGER NOT NULL,
  provider          TEXT NOT NULL CHECK (provider IN ('pollinations', 'flux')),
  prompt_variant    TEXT NOT NULL CHECK (prompt_variant IN ('primary', 'fallback')),
  success           BOOLEAN NOT NULL,
  failure_reason    TEXT CHECK (failure_reason IN ('too_small', 'near_black', 'near_blank', 'unreadable', 'network_error', 'api_error') OR failure_reason IS NULL),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_image_generation_attempts_brand_id ON public.image_generation_attempts (brand_id);
CREATE INDEX idx_image_generation_attempts_feature ON public.image_generation_attempts (feature);

ALTER TABLE public.image_generation_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_image_generation_attempts" ON public.image_generation_attempts FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
