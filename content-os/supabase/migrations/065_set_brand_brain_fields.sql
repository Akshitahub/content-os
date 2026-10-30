-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Brand Brain fills itself (lib/ai/brand-brain-derive.ts): the derived
-- fields are written field by field, atomically, like
-- set_brand_art_direction (063) -- a Brand Brain edit or an art direction
-- saved meanwhile is never clobbered.
--
-- p_fields: {"facts": {"differentiators": [...]}, "voice": {...}, ...} --
-- only the fields given are touched, inside their section.
-- p_auto = true (a derivation): a field whose brand_brain.field_meta says
-- auto: false (the user edited it) is skipped, and so is a field that
-- already has a value but no field_meta entry (typed in before this
-- existed -- treated as the user's own). Written fields get
-- field_meta.<field> = p_meta.<field> (auto: true, derived_at, ...).
-- p_auto = false (a user edit): always written, field_meta.<field> =
-- {"auto": false, ...}.
-- p_status, when given, replaces brand_brain.derivation (running / done /
-- failed + timestamps) -- what the brand page shows while it runs.
-- SECURITY INVOKER: RLS still applies. Until this runs, the app falls
-- back to a read-merge-update with the same rules.

CREATE OR REPLACE FUNCTION public.set_brand_brain_fields(
  p_brand_id uuid,
  p_fields jsonb,
  p_meta jsonb,
  p_auto boolean,
  p_status jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  brain jsonb;
  meta jsonb;
  sec text;
  fld text;
BEGIN
  SELECT COALESCE(brand_brain, '{}'::jsonb) INTO brain FROM public.brands WHERE id = p_brand_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  meta := COALESCE(brain->'field_meta', '{}'::jsonb);

  FOR sec IN SELECT jsonb_object_keys(COALESCE(p_fields, '{}'::jsonb)) LOOP
    FOR fld IN SELECT jsonb_object_keys(p_fields->sec) LOOP
      IF p_auto AND (
        (meta->fld->>'auto') = 'false'
        OR (NOT (meta ? fld) AND (brain->sec) ? fld)
      ) THEN
        CONTINUE;
      END IF;
      brain := jsonb_set(brain, ARRAY[sec], COALESCE(brain->sec, '{}'::jsonb) || jsonb_build_object(fld, p_fields->sec->fld), true);
      meta := meta || jsonb_build_object(fld, COALESCE(p_meta->fld, '{}'::jsonb) || jsonb_build_object('auto', p_auto));
    END LOOP;
  END LOOP;

  brain := brain || jsonb_build_object('field_meta', meta);
  IF p_status IS NOT NULL THEN
    brain := brain || jsonb_build_object('derivation', p_status);
  END IF;
  UPDATE public.brands SET brand_brain = brain WHERE id = p_brand_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_brand_brain_fields(uuid, jsonb, jsonb, boolean, jsonb) TO authenticated, service_role;
