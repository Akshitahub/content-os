-- ============================================================
-- AI Content OS — Initial Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- USERS (extends Supabase auth.users)
CREATE TABLE public.users (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT UNIQUE NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  plan            TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'agency')),
  stripe_customer_id TEXT UNIQUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- BRANDS
CREATE TABLE public.brands (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  niche           TEXT,
  target_audience TEXT,
  tone_of_voice   TEXT,
  brand_values    TEXT[] DEFAULT '{}',
  competitors     TEXT[] DEFAULT '{}',
  color_palette   JSONB DEFAULT '{}',
  logo_url        TEXT,
  website_url     TEXT,
  instagram_handle TEXT,
  ai_persona      TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- PRODUCTS
CREATE TABLE public.products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  price           DECIMAL(10,2),
  currency        TEXT DEFAULT 'INR',
  category        TEXT,
  key_benefits    TEXT[] DEFAULT '{}',
  ingredients     TEXT,
  target_customer TEXT,
  image_urls      TEXT[] DEFAULT '{}',
  shopify_product_id TEXT,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CONTENT PROJECTS
CREATE TABLE public.content_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','review','approved','scheduled','published')),
  platform        TEXT CHECK (platform IN ('instagram','facebook','tiktok','youtube','linkedin','twitter')),
  content_type    TEXT CHECK (content_type IN ('reel','post','story','carousel','thread')),
  selected_hook   TEXT,
  selected_caption TEXT,
  notes           TEXT,
  media_urls      TEXT[] DEFAULT '{}',
  scheduled_at    TIMESTAMPTZ,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- HOOKS
CREATE TABLE public.hooks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_project_id UUID REFERENCES public.content_projects(id) ON DELETE SET NULL,
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES public.products(id) ON DELETE SET NULL,
  hook_text       TEXT NOT NULL,
  hook_type       TEXT CHECK (hook_type IN ('question','bold_statement','story','statistic','controversial','how_to')),
  generation_prompt TEXT,
  model_used      TEXT DEFAULT 'gpt-4o',
  is_saved        BOOLEAN DEFAULT false,
  is_used         BOOLEAN DEFAULT false,
  user_rating     INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  performance_score DECIMAL(5,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CAPTIONS
CREATE TABLE public.captions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_project_id UUID REFERENCES public.content_projects(id) ON DELETE SET NULL,
  hook_id         UUID REFERENCES public.hooks(id) ON DELETE SET NULL,
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  caption_text    TEXT NOT NULL,
  hashtags        TEXT[] DEFAULT '{}',
  cta             TEXT,
  character_count INTEGER,
  platform        TEXT,
  generation_prompt TEXT,
  model_used      TEXT DEFAULT 'gpt-4o',
  tone_used       TEXT,
  is_saved        BOOLEAN DEFAULT false,
  user_rating     INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  performance_score DECIMAL(5,2),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- CALENDAR ENTRIES
CREATE TABLE public.calendar_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id        UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  content_project_id UUID REFERENCES public.content_projects(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  scheduled_date  DATE NOT NULL,
  scheduled_time  TIME,
  platform        TEXT,
  content_type    TEXT,
  status          TEXT DEFAULT 'planned' CHECK (status IN ('planned','content_ready','scheduled','published','missed')),
  color           TEXT DEFAULT '#6366f1',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- AI GENERATION LOGS (cost tracking)
CREATE TABLE public.ai_generation_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  brand_id        UUID REFERENCES public.brands(id) ON DELETE SET NULL,
  feature         TEXT NOT NULL,
  model           TEXT NOT NULL,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  total_tokens    INTEGER,
  cost_usd        DECIMAL(10,6),
  latency_ms      INTEGER,
  success         BOOLEAN DEFAULT true,
  error_message   TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.captions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generation_logs ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES
CREATE POLICY "users_own_data" ON public.users FOR ALL USING (id = auth.uid());
CREATE POLICY "users_own_brands" ON public.brands FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users_own_products" ON public.products FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_projects" ON public.content_projects FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_hooks" ON public.hooks FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_captions" ON public.captions FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_calendar" ON public.calendar_entries FOR ALL USING (
  brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid())
);
CREATE POLICY "users_own_logs" ON public.ai_generation_logs FOR ALL USING (
  user_id = auth.uid()
);

-- ============================================================
-- TRIGGERS — auto-update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON public.brands
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.content_projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_calendar_updated_at
  BEFORE UPDATE ON public.calendar_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- AUTO-CREATE USER PROFILE on signup
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
