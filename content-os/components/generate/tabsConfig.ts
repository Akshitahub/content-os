import { FileText, Sparkles, Layers, ImageIcon, RefreshCw, Wand2, LayoutGrid, Smartphone, Laugh, Newspaper } from "lucide-react"

export type Tab = "ad_maker" | "full_post" | "carousel" | "stories" | "memes" | "hooks" | "content" | "images" | "repurpose" | "blog"

export const TAB_DESCRIPTIONS: Record<Tab, string> = {
  ad_maker:  "Upload your product photo and place it in an AI-generated scene. Perfect for Instagram ads.",
  full_post: "Generate a complete post — hook, caption, hashtags and visual direction in one click.",
  carousel:  "Create a multi-slide carousel for Instagram or LinkedIn with AI-written content per slide.",
  stories:   "Generate 3-5 connected Instagram stories that tell a narrative arc.",
  memes:     "Create brand-specific memes in popular formats. Memes get 3x more shares.",
  hooks:     "Generate scroll-stopping opening lines for your posts. Max 8 words, maximum impact.",
  content:   "Write reel scripts, email sequences, product descriptions and long-form content.",
  images:    "Generate brand-consistent visuals and product photos with AI.",
  repurpose: "Turn one piece of content into multiple formats across platforms.",
  blog:      "Write a full SEO-friendly blog article for your brand, starting from your own topic.",
}

export const TABS: { id: Tab; label: string; icon: React.ElementType; tooltip: string }[] = [
  { id: "ad_maker",  label: "Ad Maker ✨",      icon: Wand2,       tooltip: "Create product ads with AI-generated scenes" },
  { id: "full_post", label: "Post Builder",      icon: FileText,    tooltip: "Build a complete post: hook + caption + visual" },
  { id: "carousel",  label: "Carousel 🎠",       icon: LayoutGrid,  tooltip: "Visual carousel builder with slide preview" },
  { id: "stories",   label: "Stories 📱",        icon: Smartphone,  tooltip: "Connected Instagram story sequence" },
  { id: "memes",     label: "Memes 😂",          icon: Laugh,       tooltip: "Brand memes that get shared 3× more" },
  { id: "hooks",     label: "Scroll Stoppers",   icon: Sparkles,    tooltip: "Hook-only generator for viral openers" },
  { id: "content",   label: "Deep Content",      icon: Layers,      tooltip: "Reels, carousels, ad copy, email sequences" },
  { id: "images",    label: "Visuals",           icon: ImageIcon,   tooltip: "AI-generated images in your brand style" },
  { id: "repurpose", label: "Repurpose",         icon: RefreshCw,   tooltip: "Turn existing content into multiple formats" },
  { id: "blog",      label: "Blog Post",         icon: Newspaper,   tooltip: "SEO article with AI suggestions" },
]
