-- MANUAL STEP REQUIRED: run this by hand in the Supabase SQL Editor -- no
-- automated migration runner is wired up in this environment.
--
-- Security audit trail (lib/security/audit.ts): admin sign-ins and what
-- admins view, account and brand deletion, social account connect /
-- disconnect / token refresh failures, plan changes, logo uploads and
-- photo-link creation. Written only by the service role -- RLS on with no
-- policies. Never holds passwords, tokens or secrets. Kept 365 days (the
-- cleanup-abandoned-drafts cron deletes older rows). Until this runs,
-- audit writes fail and are logged; nothing else is affected.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  actor_type text CHECK (actor_type IN ('user', 'admin', 'system')),
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  meta jsonb DEFAULT '{}',
  ip text
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON public.audit_logs (actor_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
