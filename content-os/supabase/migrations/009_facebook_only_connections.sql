-- 009_facebook_only_connections.sql
-- A Facebook Page and its linked Instagram Business account share the same
-- Page access token, so a single social_connections row can serve
-- Facebook-only, Instagram+Facebook, or (after this migration) be created
-- for a Page that has no linked Instagram Business account at all.
-- ig_business_account_id was previously NOT NULL, which incorrectly forced
-- the whole connection to fail when a user only wanted Facebook posting.

ALTER TABLE public.social_connections
ALTER COLUMN ig_business_account_id DROP NOT NULL;
