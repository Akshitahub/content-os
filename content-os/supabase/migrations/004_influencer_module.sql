-- Influencer marketing module
-- Run after 003_usage_limits.sql

CREATE TABLE public.influencers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  handle TEXT NOT NULL,
  full_name TEXT,
  bio TEXT,
  follower_count INTEGER,
  following_count INTEGER,
  post_count INTEGER,
  avg_engagement_rate DECIMAL(5,2),
  profile_url TEXT,
  avatar_url TEXT,
  niche TEXT,
  location TEXT,
  fit_score INTEGER CHECK (fit_score BETWEEN 0 AND 100),
  fit_reasoning TEXT,
  raw_scraped_data JSONB DEFAULT '{}',
  status TEXT DEFAULT 'discovered' CHECK (status IN ('discovered','contacted','replied','negotiating','partnered','rejected','completed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.influencer_partnerships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  campaign_name TEXT NOT NULL,
  campaign_brief TEXT,
  deliverables TEXT[] DEFAULT '{}',
  talking_points TEXT[] DEFAULT '{}',
  dos TEXT[] DEFAULT '{}',
  donts TEXT[] DEFAULT '{}',
  key_hashtags TEXT[] DEFAULT '{}',
  compensation_type TEXT CHECK (compensation_type IN ('paid','gifted','affiliate','collab')),
  compensation_amount DECIMAL(10,2),
  currency TEXT DEFAULT 'INR',
  timeline_start DATE,
  timeline_end DATE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','active','completed','cancelled')),
  actual_reach INTEGER,
  actual_engagement INTEGER,
  conversions INTEGER,
  roi_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.outreach_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer_id UUID NOT NULL REFERENCES public.influencers(id) ON DELETE CASCADE,
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('dm','email','whatsapp')),
  subject TEXT,
  message_text TEXT NOT NULL,
  tone TEXT,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  reply_text TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.influencers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.influencer_partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_influencers" ON public.influencers
  FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));

CREATE POLICY "users_own_partnerships" ON public.influencer_partnerships
  FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));

CREATE POLICY "users_own_outreach" ON public.outreach_messages
  FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));

CREATE TRIGGER update_influencers_updated_at
  BEFORE UPDATE ON public.influencers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_partnerships_updated_at
  BEFORE UPDATE ON public.influencer_partnerships
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
