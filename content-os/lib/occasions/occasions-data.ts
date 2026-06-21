export type OccasionCategory = "festival" | "awareness" | "shopping"

export type Occasion = {
  id: string
  name: string
  /** Fixed calendar date as "MM-DD". Lunar-based festivals use a representative date; update yearly as needed. */
  date: string
  category: OccasionCategory
  suggestedAngle: string
}

export const OCCASIONS: Occasion[] = [
  // ── January ────────────────────────────────────────────────────────────
  {
    id: "new-year-day",
    name: "New Year's Day",
    date: "01-01",
    category: "shopping",
    suggestedAngle: "'New year, new ritual' — launch-ready content for your January audience",
  },
  {
    id: "end-of-season-sale",
    name: "End of Season Sale",
    date: "01-07",
    category: "shopping",
    suggestedAngle: "Last-chance urgency: bundle deals and 'clear old stock' messaging",
  },
  {
    id: "lohri",
    name: "Lohri",
    date: "01-13",
    category: "festival",
    suggestedAngle: "Warmth and togetherness — Punjabi culture content gets major organic reach",
  },
  {
    id: "makar-sankranti",
    name: "Makar Sankranti",
    date: "01-14",
    category: "festival",
    suggestedAngle: "New season, new beginnings — tie your product to harvest and renewal energy",
  },
  {
    id: "pongal",
    name: "Pongal",
    date: "01-14",
    category: "festival",
    suggestedAngle: "South Indian audience angle; gratitude and tradition-forward content",
  },
  {
    id: "republic-day",
    name: "Republic Day Sale",
    date: "01-26",
    category: "shopping",
    suggestedAngle: "Patriotic sale moment; 'Made in India' and local craftsmanship content converts",
  },

  // ── February ───────────────────────────────────────────────────────────
  {
    id: "vasant-panchami",
    name: "Vasant Panchami",
    date: "02-02",
    category: "festival",
    suggestedAngle: "Arrival of spring; yellow palette + knowledge and beauty themes perform well",
  },
  {
    id: "valentines-day",
    name: "Valentine's Day",
    date: "02-14",
    category: "shopping",
    suggestedAngle: "Gift guide format — position your product as the perfect gesture, not just a purchase",
  },

  // ── March ──────────────────────────────────────────────────────────────
  {
    id: "womens-day",
    name: "International Women's Day",
    date: "03-08",
    category: "awareness",
    suggestedAngle: "Tell the story of the women you're built for — or who built you",
  },
  {
    id: "holi",
    name: "Holi",
    date: "03-14",
    category: "festival",
    suggestedAngle: "Colour, joy, and gifting — one of the biggest impulse-buy moments of the year",
  },
  {
    id: "eid-al-fitr",
    name: "Eid al-Fitr",
    date: "03-31",
    category: "festival",
    suggestedAngle: "Gifting and celebration; festive packaging and bundle angles work very well",
  },
  {
    id: "ugadi",
    name: "Ugadi / Gudi Padwa",
    date: "03-29",
    category: "festival",
    suggestedAngle: "New year for South and West India; fresh-start messaging resonates deeply",
  },

  // ── April ──────────────────────────────────────────────────────────────
  {
    id: "ram-navami",
    name: "Ram Navami",
    date: "04-06",
    category: "festival",
    suggestedAngle: "Devotion and tradition; spiritual and handcrafted product categories see a spike",
  },
  {
    id: "baisakhi",
    name: "Baisakhi",
    date: "04-13",
    category: "festival",
    suggestedAngle: "Harvest and celebration; vibrant, energetic content for a Punjab-leaning audience",
  },
  {
    id: "earth-day",
    name: "Earth Day",
    date: "04-22",
    category: "awareness",
    suggestedAngle: "Spotlight one real thing your brand does for the planet — authenticity over greenwashing",
  },

  // ── May ────────────────────────────────────────────────────────────────
  {
    id: "buddha-purnima",
    name: "Buddha Purnima",
    date: "05-12",
    category: "festival",
    suggestedAngle: "Mindfulness and inner peace; wellness and meditation product tie-ins",
  },
  {
    id: "mothers-day",
    name: "Mother's Day",
    date: "05-11",
    category: "shopping",
    suggestedAngle: "Emotional gifting content — moms over metrics today; story beats product spec",
  },

  // ── June ───────────────────────────────────────────────────────────────
  {
    id: "pride-month",
    name: "Pride Month",
    date: "06-01",
    category: "awareness",
    suggestedAngle: "Support authentically — feature your community, don't just swap your logo colour",
  },
  {
    id: "world-environment-day",
    name: "World Environment Day",
    date: "06-05",
    category: "awareness",
    suggestedAngle: "Share one real sustainability fact about your brand or supply chain",
  },
  {
    id: "eid-al-adha",
    name: "Eid al-Adha",
    date: "06-07",
    category: "festival",
    suggestedAngle: "Giving and gratitude; premium gifting and hospitality content performs well",
  },
  {
    id: "world-wellness-day",
    name: "World Wellness Day",
    date: "06-14",
    category: "awareness",
    suggestedAngle: "What does wellness look like for your customer? Story-first content wins today",
  },
  {
    id: "fathers-day",
    name: "Father's Day",
    date: "06-15",
    category: "shopping",
    suggestedAngle: "Dads are often the hardest to shop for — solve that problem with your product",
  },
  {
    id: "yoga-day",
    name: "International Yoga Day",
    date: "06-21",
    category: "awareness",
    suggestedAngle: "Wellness lifestyle content: how your product fits a mindful daily routine",
  },
  {
    id: "social-media-day",
    name: "Social Media Day",
    date: "06-30",
    category: "awareness",
    suggestedAngle: "Behind-the-scenes of your own content process — real and relatable wins",
  },

  // ── August ─────────────────────────────────────────────────────────────
  {
    id: "friendship-day",
    name: "Friendship Day",
    date: "08-03",
    category: "shopping",
    suggestedAngle: "'Gift your bestie' — bundle and duo-pack content performs particularly well",
  },
  {
    id: "raksha-bandhan",
    name: "Raksha Bandhan",
    date: "08-09",
    category: "festival",
    suggestedAngle: "Brother-sister gifting peak — one of the top gifting moments in India all year",
  },
  {
    id: "independence-day",
    name: "Independence Day",
    date: "08-15",
    category: "festival",
    suggestedAngle: "'Proudly Indian' brand story; spotlight local sourcing or artisan craftsmanship",
  },
  {
    id: "janmashtami",
    name: "Janmashtami",
    date: "08-16",
    category: "festival",
    suggestedAngle: "Devotion and tradition — spiritual, handmade, and cultural product angles",
  },
  {
    id: "ganesh-chaturthi",
    name: "Ganesh Chaturthi",
    date: "08-27",
    category: "festival",
    suggestedAngle: "Community celebration week; eco-friendly and handmade products shine right now",
  },
  {
    id: "womens-equality-day",
    name: "Women's Equality Day",
    date: "08-26",
    category: "awareness",
    suggestedAngle: "Amplify female voices in your community — founder story or customer spotlight",
  },

  // ── September ──────────────────────────────────────────────────────────
  {
    id: "onam",
    name: "Onam",
    date: "09-05",
    category: "festival",
    suggestedAngle: "Kerala's biggest festival; gift hampers and traditional product stories connect well",
  },
  {
    id: "teachers-day",
    name: "Teachers' Day",
    date: "09-05",
    category: "awareness",
    suggestedAngle: "Gift a teacher angle; appreciation and gratitude storytelling performs well",
  },
  {
    id: "world-beauty-day",
    name: "World Beauty Day",
    date: "09-09",
    category: "awareness",
    suggestedAngle: "Celebrate your customer's natural beauty — ritual content or before/after stories",
  },
  {
    id: "navratri",
    name: "Navratri",
    date: "09-22",
    category: "festival",
    suggestedAngle: "Nine nights of celebration — festive dressing, gifting, and tradition content",
  },

  // ── October ────────────────────────────────────────────────────────────
  {
    id: "dussehra",
    name: "Dussehra",
    date: "10-02",
    category: "festival",
    suggestedAngle: "Victory of good; new-beginnings angle — great for product launches",
  },
  {
    id: "world-mental-health-day",
    name: "World Mental Health Day",
    date: "10-10",
    category: "awareness",
    suggestedAngle: "Self-care and gentleness; soft, reassuring content over hard sell today",
  },
  {
    id: "karwa-chauth",
    name: "Karwa Chauth",
    date: "10-10",
    category: "festival",
    suggestedAngle: "Celebration of love; jewellery, beauty, and gifting content spikes strongly",
  },
  {
    id: "dhanteras",
    name: "Dhanteras",
    date: "10-18",
    category: "festival",
    suggestedAngle: "Biggest purchase day of the year — 'auspicious buy' messaging in any category",
  },
  {
    id: "diwali",
    name: "Diwali",
    date: "10-20",
    category: "festival",
    suggestedAngle: "The biggest content moment of the year — gifting, celebration, and limited editions",
  },
  {
    id: "bhai-dooj",
    name: "Bhai Dooj",
    date: "10-23",
    category: "festival",
    suggestedAngle: "Extend your Diwali gifting window — brother-sister gifting content again",
  },
  {
    id: "chhath-puja",
    name: "Chhath Puja",
    date: "10-28",
    category: "festival",
    suggestedAngle: "Devotion and nature-forward content; earthy and spiritual product categories",
  },

  // ── November ───────────────────────────────────────────────────────────
  {
    id: "world-vegan-day",
    name: "World Vegan Day",
    date: "11-01",
    category: "awareness",
    suggestedAngle: "Cruelty-free and plant-based angle; ingredient transparency content works well",
  },
  {
    id: "guru-nanak-jayanti",
    name: "Guru Nanak Jayanti",
    date: "11-05",
    category: "festival",
    suggestedAngle: "Compassion and community; purpose-driven brand story content resonates",
  },
  {
    id: "singles-day",
    name: "Singles' Day (11.11)",
    date: "11-11",
    category: "shopping",
    suggestedAngle: "Treat-yourself messaging; the 11.11 sale hook is globally recognised",
  },
  {
    id: "childrens-day",
    name: "Children's Day",
    date: "11-14",
    category: "awareness",
    suggestedAngle: "Nostalgia and joy; light-hearted content and kid-friendly gifting angles",
  },
  {
    id: "black-friday",
    name: "Black Friday",
    date: "11-28",
    category: "shopping",
    suggestedAngle: "Biggest discount window of the year — start your hype content 3 days early",
  },

  // ── December ───────────────────────────────────────────────────────────
  {
    id: "christmas",
    name: "Christmas",
    date: "12-25",
    category: "festival",
    suggestedAngle: "Gift-giving and gratitude; festive packaging and Christmas bundles convert well",
  },
  {
    id: "new-year-eve",
    name: "New Year's Eve",
    date: "12-31",
    category: "shopping",
    suggestedAngle: "Reflection and renewal — let your product be part of their next chapter",
  },
]
