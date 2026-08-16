-- 026_influencer_discovery_type.sql
-- Adds a discovery_type dimension to influencers so the same table can hold
-- two distinct purposes: finding influencer partners (existing use) and
-- finding prospect customers for SocioPosts itself (new use). Defaults
-- existing/future rows to 'influencer_partner' so today's behavior is
-- unchanged unless a row is explicitly created as 'prospect_customer'.
--
-- Must be run manually in Supabase SQL Editor. Never auto-executes.

ALTER TABLE public.influencers
  ADD COLUMN discovery_type TEXT NOT NULL DEFAULT 'influencer_partner'
  CHECK (discovery_type IN ('influencer_partner', 'prospect_customer'));

CREATE INDEX idx_influencers_discovery_type ON public.influencers(brand_id, discovery_type);
