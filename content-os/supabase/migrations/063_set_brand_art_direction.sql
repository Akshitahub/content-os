-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Atomic write of the derived brand art direction (lib/ai/art-direction.ts).
-- The derivation takes 30-60s; writing the whole brand_brain JSONB from the
-- copy read at its start would silently overwrite a Brand Brain save made
-- meanwhile. This merges just the art_direction key in one UPDATE.
-- SECURITY INVOKER: RLS still applies (a user can only touch their own brands;
-- the service role used by Autopilot / background derivations bypasses it).
-- Until this runs, the app falls back to a read-merge-update.

CREATE OR REPLACE FUNCTION public.set_brand_art_direction(p_brand_id uuid, p_art_direction jsonb)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  UPDATE public.brands
  SET brand_brain = COALESCE(brand_brain, '{}'::jsonb) || jsonb_build_object('art_direction', p_art_direction)
  WHERE id = p_brand_id
$$;

GRANT EXECUTE ON FUNCTION public.set_brand_art_direction(uuid, jsonb) TO authenticated, service_role;
