CREATE TABLE public.reel_scripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  platform TEXT,
  hook TEXT NOT NULL,
  scenes JSONB NOT NULL DEFAULT '[]',
  caption TEXT,
  hashtags TEXT[] DEFAULT '{}',
  duration_seconds INTEGER,
  is_saved BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.carousels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  platform TEXT,
  title TEXT,
  slides JSONB NOT NULL DEFAULT '[]',
  hashtags TEXT[] DEFAULT '{}',
  is_saved BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ad_copies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  platform TEXT,
  headline TEXT NOT NULL,
  primary_text TEXT NOT NULL,
  description TEXT,
  cta_button TEXT,
  character_counts JSONB DEFAULT '{}',
  is_saved BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.email_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  sequence_type TEXT,
  emails JSONB NOT NULL DEFAULT '[]',
  is_saved BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.product_descriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  short_description TEXT,
  long_description TEXT,
  bullet_points TEXT[] DEFAULT '{}',
  meta_description TEXT,
  is_saved BOOLEAN DEFAULT true,
  user_rating INTEGER CHECK (user_rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.reel_scripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carousels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_descriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_reel_scripts" ON public.reel_scripts FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));
CREATE POLICY "users_own_carousels" ON public.carousels FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));
CREATE POLICY "users_own_ad_copies" ON public.ad_copies FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));
CREATE POLICY "users_own_email_sequences" ON public.email_sequences FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));
CREATE POLICY "users_own_product_descriptions" ON public.product_descriptions FOR ALL USING (brand_id IN (SELECT id FROM public.brands WHERE user_id = auth.uid()));
