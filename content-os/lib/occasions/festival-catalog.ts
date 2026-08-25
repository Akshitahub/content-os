export type OccasionCategory = "festival" | "awareness" | "shopping"

/**
 * The single merged source of truth for every occasion both the dashboard's
 * "Upcoming occasions" card and Autopilot's occasionsNote prompt draw from --
 * replaces the old lib/occasions/occasions-data.ts and
 * lib/data/indian-occasions.ts, which duplicated the same festival list with
 * different, both-wrong hardcoded dates (see festival_dates migration for
 * why). Each entry carries whichever consumer-specific fields it needs:
 * category+suggestedAngle for the dashboard card, emoji+content_angle+
 * hashtags+vibe for Autopilot's prompt -- an entry only used by one consumer
 * simply omits the other's fields rather than being given fabricated
 * content nobody asked for (see getFestivalOccasionsInWindow, which filters
 * each caller to entries that actually have what it needs).
 */
export interface FestivalCatalogEntry {
  /** Stable id -- React key, and the row key in the festival_dates cache table. */
  id: string
  name: string
  /** "MM-DD" -- used only when the festival_dates cache has no row for this
   * festival+year yet (before the first cron run, or a genuine API miss).
   * For lunar/lunisolar/Hijri festivals this is necessarily an approximation
   * of a date that actually moves every year -- resolveViaApi is what fixes
   * that whenever the cache has real data. */
  fallbackDate: string
  /** True for every festival whose real date isn't a fixed Gregorian day --
   * lunar, lunisolar, and Hijri-calendar festivals all shift year to year,
   * so these are the ones the yearly cron actually resolves via TathaAstu.
   * False for fixed-Gregorian dates (Independence Day, Christmas, etc.),
   * which never need an API call since fallbackDate is already exactly
   * correct every year. */
  resolveViaApi: boolean
  /** Name variants to match against TathaAstu's festival names (which don't
   * necessarily match our own naming -- e.g. "Ganesha Chaturthi" vs our
   * "Ganesh Chaturthi"). Only present when resolveViaApi is true. Matching
   * is case-insensitive and punctuation-insensitive (see
   * normalizeForMatch in resolve-and-cache-festival-dates.ts). */
  apiNameVariants?: string[]

  // ── Dashboard card fields (components/dashboard/UpcomingOccasions.tsx) ──
  category?: OccasionCategory
  suggestedAngle?: string

  // ── Autopilot prompt fields (lib/ai/fastlane.ts's occasionsNote) ────────
  emoji?: string
  content_angle?: string
  hashtags?: string[]
  vibe?: string
}

export const FESTIVAL_CATALOG: FestivalCatalogEntry[] = [
  // ── January ────────────────────────────────────────────────────────────
  {
    id: "new-year-day", name: "New Year's Day", fallbackDate: "01-01", resolveViaApi: false,
    category: "shopping", suggestedAngle: "'New year, new ritual' — launch-ready content for your January audience",
    emoji: "🎉", content_angle: "New beginnings, resolutions, fresh start",
    hashtags: ["#NewYear", "#NewBeginnings", "#FreshStart", "#NewYearNewMe"], vibe: "inspirational",
  },
  {
    id: "end-of-season-sale", name: "End of Season Sale", fallbackDate: "01-07", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Last-chance urgency: bundle deals and 'clear old stock' messaging",
  },
  {
    id: "lohri", name: "Lohri", fallbackDate: "01-13", resolveViaApi: true, apiNameVariants: ["lohri"],
    category: "festival", suggestedAngle: "Warmth and togetherness — Punjabi culture content gets major organic reach",
  },
  {
    id: "makar-sankranti", name: "Makar Sankranti", fallbackDate: "01-14", resolveViaApi: true, apiNameVariants: ["makar sankranti", "sankranti"],
    category: "festival", suggestedAngle: "New season, new beginnings — tie your product to harvest and renewal energy",
    emoji: "🪁", content_angle: "Harvest, kites, sesame sweets, new season",
    hashtags: ["#MakarSankranti", "#Sankranti", "#KiteFestival", "#Tilgud"], vibe: "festive",
  },
  {
    id: "pongal", name: "Pongal", fallbackDate: "01-14", resolveViaApi: true, apiNameVariants: ["pongal"],
    category: "festival", suggestedAngle: "South Indian audience angle; gratitude and tradition-forward content",
    emoji: "🍚", content_angle: "Harvest festival, South Indian celebration, gratitude",
    hashtags: ["#Pongal", "#HappyPongal", "#SouthIndia", "#Harvest"], vibe: "festive",
  },
  {
    id: "republic-day", name: "Republic Day", fallbackDate: "01-26", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Patriotic sale moment; 'Made in India' and local craftsmanship content converts",
    emoji: "🇮🇳", content_angle: "Patriotism, India pride, unity",
    hashtags: ["#RepublicDay", "#JaiHind", "#ProudIndian", "#MadeInIndia"], vibe: "inspirational",
  },

  // ── February ───────────────────────────────────────────────────────────
  {
    id: "vasant-panchami", name: "Vasant Panchami", fallbackDate: "02-02", resolveViaApi: true, apiNameVariants: ["vasant panchami", "basant panchami"],
    category: "festival", suggestedAngle: "Arrival of spring; yellow palette + knowledge and beauty themes perform well",
  },
  {
    id: "valentines-day", name: "Valentine's Day", fallbackDate: "02-14", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Gift guide format — position your product as the perfect gesture, not just a purchase",
    emoji: "❤️", content_angle: "Love, gifting, couples, self-love",
    hashtags: ["#ValentinesDay", "#Love", "#GiftIdeas", "#SelfLove"], vibe: "emotional",
  },

  // ── March ──────────────────────────────────────────────────────────────
  {
    id: "womens-day", name: "International Women's Day", fallbackDate: "03-08", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Tell the story of the women you're built for — or who built you",
    emoji: "👩", content_angle: "Women empowerment, celebrating women, she-economy",
    hashtags: ["#WomensDay", "#IWD", "#WomenEmpowerment", "#SheLeads"], vibe: "inspirational",
  },
  {
    id: "holi", name: "Holi", fallbackDate: "03-14", resolveViaApi: true, apiNameVariants: ["holi"],
    category: "festival", suggestedAngle: "Colour, joy, and gifting — one of the biggest impulse-buy moments of the year",
    emoji: "🎨", content_angle: "Colors, celebration, joy, togetherness",
    hashtags: ["#Holi", "#HappyHoli", "#ColorsOfHoli", "#FestivalOfColors"], vibe: "festive",
  },
  {
    id: "eid-al-fitr", name: "Eid al-Fitr", fallbackDate: "03-31", resolveViaApi: true, apiNameVariants: ["eid al-fitr", "eid ul fitr", "eid-ul-fitr"],
    category: "festival", suggestedAngle: "Gifting and celebration; festive packaging and bundle angles work very well",
  },
  {
    id: "ugadi", name: "Ugadi / Gudi Padwa", fallbackDate: "03-29", resolveViaApi: true, apiNameVariants: ["ugadi", "gudi padwa"],
    category: "festival", suggestedAngle: "New year for South and West India; fresh-start messaging resonates deeply",
  },

  // ── April ──────────────────────────────────────────────────────────────
  {
    id: "world-health-day", name: "World Health Day", fallbackDate: "04-07", resolveViaApi: false,
    emoji: "🏥", content_angle: "Wellness, health, self-care",
    hashtags: ["#WorldHealthDay", "#HealthIsWealth", "#Wellness", "#SelfCare"], vibe: "educational",
  },
  {
    id: "ram-navami", name: "Ram Navami", fallbackDate: "04-06", resolveViaApi: true, apiNameVariants: ["ram navami"],
    category: "festival", suggestedAngle: "Devotion and tradition; spiritual and handcrafted product categories see a spike",
  },
  {
    id: "ambedkar-jayanti", name: "Ambedkar Jayanti", fallbackDate: "04-14", resolveViaApi: false,
    emoji: "🕊️", content_angle: "Equality, social justice, inclusivity",
    hashtags: ["#AmbedkarJayanti", "#Equality", "#SocialJustice", "#JaiBhim"], vibe: "inspirational",
  },
  {
    id: "baisakhi", name: "Baisakhi", fallbackDate: "04-13", resolveViaApi: true, apiNameVariants: ["baisakhi", "vaisakhi"],
    category: "festival", suggestedAngle: "Harvest and celebration; vibrant, energetic content for a Punjab-leaning audience",
  },
  {
    id: "earth-day", name: "Earth Day", fallbackDate: "04-22", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Spotlight one real thing your brand does for the planet — authenticity over greenwashing",
    emoji: "🌍", content_angle: "Sustainability, eco-friendly, environment",
    hashtags: ["#EarthDay", "#Sustainability", "#EcoFriendly", "#GreenLiving"], vibe: "educational",
  },

  // ── May ────────────────────────────────────────────────────────────────
  {
    id: "labour-day", name: "Labour Day", fallbackDate: "05-01", resolveViaApi: false,
    emoji: "🛠️", content_angle: "Hard work, appreciation, team story",
    hashtags: ["#LabourDay", "#MayDay", "#HardWork", "#TeamAppreciation"], vibe: "inspirational",
  },
  {
    id: "buddha-purnima", name: "Buddha Purnima", fallbackDate: "05-12", resolveViaApi: true, apiNameVariants: ["buddha purnima", "buddha jayanti"],
    category: "festival", suggestedAngle: "Mindfulness and inner peace; wellness and meditation product tie-ins",
  },
  {
    id: "mothers-day", name: "Mother's Day", fallbackDate: "05-11", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Emotional gifting content — moms over metrics today; story beats product spec",
    emoji: "💐", content_angle: "Gifting for moms, appreciation, love",
    hashtags: ["#MothersDay", "#MomLove", "#GiftForMom", "#HappyMothersDay"], vibe: "emotional",
  },

  // ── June ───────────────────────────────────────────────────────────────
  {
    id: "pride-month", name: "Pride Month", fallbackDate: "06-01", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Support authentically — feature your community, don't just swap your logo colour",
  },
  {
    id: "world-environment-day", name: "World Environment Day", fallbackDate: "06-05", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Share one real sustainability fact about your brand or supply chain",
    emoji: "🌿", content_angle: "Sustainability, green choices, eco values",
    hashtags: ["#WorldEnvironmentDay", "#GoGreen", "#Sustainability", "#EcoConscious"], vibe: "educational",
  },
  {
    id: "eid-al-adha", name: "Eid al-Adha", fallbackDate: "06-07", resolveViaApi: true, apiNameVariants: ["eid al-adha", "eid ul adha", "eid-ul-adha", "bakrid", "bakr-id"],
    category: "festival", suggestedAngle: "Giving and gratitude; premium gifting and hospitality content performs well",
  },
  {
    id: "world-wellness-day", name: "World Wellness Day", fallbackDate: "06-14", resolveViaApi: false,
    category: "awareness", suggestedAngle: "What does wellness look like for your customer? Story-first content wins today",
  },
  {
    id: "fathers-day", name: "Father's Day", fallbackDate: "06-15", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Dads are often the hardest to shop for — solve that problem with your product",
    emoji: "👨", content_angle: "Gifting for dads, appreciation, family",
    hashtags: ["#FathersDay", "#DadLove", "#GiftForDad", "#HappyFathersDay"], vibe: "emotional",
  },
  {
    id: "yoga-day", name: "International Yoga Day", fallbackDate: "06-21", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Wellness lifestyle content: how your product fits a mindful daily routine",
    emoji: "🧘", content_angle: "Wellness, mindfulness, Indian culture",
    hashtags: ["#YogaDay", "#InternationalYogaDay", "#Mindfulness", "#Wellness"], vibe: "educational",
  },
  {
    id: "social-media-day", name: "Social Media Day", fallbackDate: "06-30", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Behind-the-scenes of your own content process — real and relatable wins",
  },

  // ── July ───────────────────────────────────────────────────────────────
  {
    id: "kargil-vijay-diwas", name: "Kargil Vijay Diwas", fallbackDate: "07-26", resolveViaApi: false,
    emoji: "🪖", content_angle: "Patriotism, bravery, tribute to soldiers",
    hashtags: ["#KargilVijayDiwas", "#JaiHind", "#IndianArmy", "#Salute"], vibe: "inspirational",
  },

  // ── August ─────────────────────────────────────────────────────────────
  {
    id: "friendship-day", name: "Friendship Day", fallbackDate: "08-03", resolveViaApi: false,
    category: "shopping", suggestedAngle: "'Gift your bestie' — bundle and duo-pack content performs particularly well",
  },
  {
    id: "raksha-bandhan", name: "Raksha Bandhan", fallbackDate: "08-09", resolveViaApi: true, apiNameVariants: ["raksha bandhan", "rakhi", "rakshabandhan"],
    category: "festival", suggestedAngle: "Brother-sister gifting peak — one of the top gifting moments in India all year",
    emoji: "🪢", content_angle: "Siblings, gifting, love, bonds",
    hashtags: ["#RakshaBandhan", "#Rakhi", "#SiblingLove", "#RakhiSpecial"], vibe: "emotional",
  },
  {
    id: "independence-day", name: "Independence Day", fallbackDate: "08-15", resolveViaApi: false,
    category: "festival", suggestedAngle: "'Proudly Indian' brand story; spotlight local sourcing or artisan craftsmanship",
    emoji: "🇮🇳", content_angle: "India pride, patriotism, Made in India",
    hashtags: ["#IndependenceDay", "#JaiHind", "#MadeInIndia", "#ProudIndian"], vibe: "inspirational",
  },
  {
    id: "janmashtami", name: "Janmashtami", fallbackDate: "08-16", resolveViaApi: true, apiNameVariants: ["janmashtami", "krishna janmashtami"],
    category: "festival", suggestedAngle: "Devotion and tradition — spiritual, handmade, and cultural product angles",
    emoji: "🪷", content_angle: "Krishna, devotion, Indian culture, sweets",
    hashtags: ["#Janmashtami", "#HappyJanmashtami", "#JaiShreeKrishna", "#Krishna"], vibe: "festive",
  },
  {
    id: "onam", name: "Onam", fallbackDate: "08-26", resolveViaApi: true, apiNameVariants: ["onam", "thiruvonam"],
    category: "festival", suggestedAngle: "Kerala's biggest festival; gift hampers and traditional product stories connect well",
  },
  {
    id: "womens-equality-day", name: "Women's Equality Day", fallbackDate: "08-26", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Amplify female voices in your community — founder story or customer spotlight",
  },
  {
    id: "ganesh-chaturthi", name: "Ganesh Chaturthi", fallbackDate: "09-14", resolveViaApi: true, apiNameVariants: ["ganesh chaturthi", "ganesha chaturthi", "vinayaka chaturthi"],
    category: "festival", suggestedAngle: "Community celebration week; eco-friendly and handmade products shine right now",
    emoji: "🐘", content_angle: "Ganpati, celebration, new beginnings, prosperity",
    hashtags: ["#GaneshChaturthi", "#GanpatiBappaMorya", "#GaneshUtsav"], vibe: "festive",
  },

  // ── September ──────────────────────────────────────────────────────────
  {
    id: "teachers-day", name: "Teachers' Day", fallbackDate: "09-05", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Gift a teacher angle; appreciation and gratitude storytelling performs well",
    emoji: "🎓", content_angle: "Gratitude, learning, mentorship",
    hashtags: ["#TeachersDay", "#HappyTeachersDay", "#Gratitude", "#GuruShishya"], vibe: "inspirational",
  },
  {
    id: "world-beauty-day", name: "World Beauty Day", fallbackDate: "09-09", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Celebrate your customer's natural beauty — ritual content or before/after stories",
  },
  {
    id: "navratri", name: "Navratri", fallbackDate: "10-11", resolveViaApi: true, apiNameVariants: ["navratri", "sharad navratri"],
    category: "festival", suggestedAngle: "Nine nights of celebration — festive dressing, gifting, and tradition content",
  },

  // ── October ────────────────────────────────────────────────────────────
  {
    id: "gandhi-jayanti", name: "Gandhi Jayanti", fallbackDate: "10-02", resolveViaApi: false,
    emoji: "🕊️", content_angle: "Values, simplicity, sustainability, non-violence",
    hashtags: ["#GandhiJayanti", "#Bapu", "#MahatmaGandhi", "#Ahimsa"], vibe: "inspirational",
  },
  {
    id: "dussehra", name: "Dussehra", fallbackDate: "10-20", resolveViaApi: true, apiNameVariants: ["dussehra", "vijayadashami", "dasara"],
    category: "festival", suggestedAngle: "Victory of good; new-beginnings angle — great for product launches",
    emoji: "🪔", content_angle: "Victory of good, celebration, festive season begins",
    hashtags: ["#Dussehra", "#Vijayadashami", "#FestiveSeason"], vibe: "festive",
  },
  {
    id: "durga-puja", name: "Durga Puja", fallbackDate: "10-19", resolveViaApi: true, apiNameVariants: ["durga puja", "durgotsav"],
    category: "festival", suggestedAngle: "Bengal's biggest festival week; pandal culture and gifting content connect strongly",
    emoji: "🙏", content_angle: "Goddess Durga, community celebration, Bengali culture",
    hashtags: ["#DurgaPuja", "#ShubhoDurgaPuja", "#Durgotsav"], vibe: "festive",
  },
  {
    id: "world-mental-health-day", name: "World Mental Health Day", fallbackDate: "10-10", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Self-care and gentleness; soft, reassuring content over hard sell today",
  },
  {
    id: "karwa-chauth", name: "Karwa Chauth", fallbackDate: "10-29", resolveViaApi: true, apiNameVariants: ["karwa chauth", "karva chauth"],
    category: "festival", suggestedAngle: "Celebration of love; jewellery, beauty, and gifting content spikes strongly",
  },
  {
    id: "dhanteras", name: "Dhanteras", fallbackDate: "11-06", resolveViaApi: true, apiNameVariants: ["dhanteras", "dhantrayodashi"],
    category: "festival", suggestedAngle: "Biggest purchase day of the year — 'auspicious buy' messaging in any category",
  },
  {
    id: "diwali", name: "Diwali", fallbackDate: "11-08", resolveViaApi: true, apiNameVariants: ["diwali", "deepavali"],
    category: "festival", suggestedAngle: "The biggest content moment of the year — gifting, celebration, and limited editions",
    emoji: "🪔", content_angle: "Gifting, celebration, lights, prosperity, festive sales",
    hashtags: ["#Diwali", "#HappyDiwali", "#FestiveOfLights", "#DiwaliSale"], vibe: "festive",
  },
  {
    id: "halloween", name: "Halloween", fallbackDate: "10-31", resolveViaApi: false,
    emoji: "🎃", content_angle: "Fun, spooky theme, costume season",
    hashtags: ["#Halloween", "#SpookySeason", "#TrickOrTreat"], vibe: "entertaining",
  },
  {
    id: "bhai-dooj", name: "Bhai Dooj", fallbackDate: "11-11", resolveViaApi: true, apiNameVariants: ["bhai dooj", "bhai tika"],
    category: "festival", suggestedAngle: "Extend your Diwali gifting window — brother-sister gifting content again",
  },
  {
    id: "chhath-puja", name: "Chhath Puja", fallbackDate: "11-15", resolveViaApi: true, apiNameVariants: ["chhath puja", "chhath"],
    category: "festival", suggestedAngle: "Devotion and nature-forward content; earthy and spiritual product categories",
  },

  // ── November ───────────────────────────────────────────────────────────
  {
    id: "world-vegan-day", name: "World Vegan Day", fallbackDate: "11-01", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Cruelty-free and plant-based angle; ingredient transparency content works well",
  },
  {
    id: "guru-nanak-jayanti", name: "Guru Nanak Jayanti", fallbackDate: "11-24", resolveViaApi: true, apiNameVariants: ["guru nanak jayanti", "gurpurab"],
    category: "festival", suggestedAngle: "Compassion and community; purpose-driven brand story content resonates",
  },
  {
    id: "singles-day", name: "Singles' Day (11.11)", fallbackDate: "11-11", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Treat-yourself messaging; the 11.11 sale hook is globally recognised",
  },
  {
    id: "childrens-day", name: "Children's Day", fallbackDate: "11-14", resolveViaApi: false,
    category: "awareness", suggestedAngle: "Nostalgia and joy; light-hearted content and kid-friendly gifting angles",
    emoji: "🧒", content_angle: "Kids, nostalgia, playfulness, inner child",
    hashtags: ["#ChildrensDay", "#BalDiwas", "#InnerChild"], vibe: "entertaining",
  },
  {
    id: "black-friday", name: "Black Friday", fallbackDate: "11-28", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Biggest discount window of the year — start your hype content 3 days early",
    emoji: "🛍️", content_angle: "Sale, offers, flash deals, urgency",
    hashtags: ["#BlackFriday", "#Sale", "#BlackFridaySale", "#Deals"], vibe: "sales",
  },

  // ── December ───────────────────────────────────────────────────────────
  {
    id: "cyber-monday", name: "Cyber Monday", fallbackDate: "12-01", resolveViaApi: false,
    emoji: "💻", content_angle: "Online deals, discount, digital shopping",
    hashtags: ["#CyberMonday", "#OnlineSale", "#Deals"], vibe: "sales",
  },
  {
    id: "christmas", name: "Christmas", fallbackDate: "12-25", resolveViaApi: false,
    category: "festival", suggestedAngle: "Gift-giving and gratitude; festive packaging and Christmas bundles convert well",
    emoji: "🎄", content_angle: "Gifting, celebration, joy, gratitude",
    hashtags: ["#Christmas", "#HappyChristmas", "#MerryChristmas", "#ChristmasGifts"], vibe: "festive",
  },
  {
    id: "new-year-eve", name: "New Year's Eve", fallbackDate: "12-31", resolveViaApi: false,
    category: "shopping", suggestedAngle: "Reflection and renewal — let your product be part of their next chapter",
    emoji: "🥂", content_angle: "Year in review, celebration, gratitude, new goals",
    hashtags: ["#NewYearEve", "#NYE", "#YearInReview"], vibe: "inspirational",
  },
]
