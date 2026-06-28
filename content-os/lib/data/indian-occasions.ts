export interface Occasion {
  date: string // MM-DD
  name: string
  emoji: string
  content_angle: string
  hashtags: string[]
  vibe: string
}

export const INDIAN_OCCASIONS: Occasion[] = [
  // January
  {
    date: "01-01", name: "New Year", emoji: "🎉",
    content_angle: "New beginnings, resolutions, fresh start",
    hashtags: ["#NewYear", "#NewBeginnings", "#FreshStart", "#NewYearNewMe", "#2026Goals"],
    vibe: "inspirational",
  },
  {
    date: "01-14", name: "Makar Sankranti", emoji: "🪁",
    content_angle: "Harvest, kites, sesame sweets, new season",
    hashtags: ["#MakarSankranti", "#Sankranti", "#KiteFestival", "#Tilgud", "#HarvestFestival"],
    vibe: "festive",
  },
  {
    date: "01-15", name: "Pongal", emoji: "🍚",
    content_angle: "Harvest festival, South Indian celebration, gratitude",
    hashtags: ["#Pongal", "#HappyPongal", "#SouthIndia", "#Thanksgiving", "#Harvest"],
    vibe: "festive",
  },
  {
    date: "01-26", name: "Republic Day", emoji: "🇮🇳",
    content_angle: "Patriotism, India pride, unity",
    hashtags: ["#RepublicDay", "#JaiHind", "#ProudIndian", "#MadeInIndia", "#IndiaProud"],
    vibe: "inspirational",
  },
  // February
  {
    date: "02-14", name: "Valentine's Day", emoji: "❤️",
    content_angle: "Love, gifting, couples, self-love",
    hashtags: ["#ValentinesDay", "#Love", "#GiftIdeas", "#SelfLove", "#Gifting"],
    vibe: "emotional",
  },
  // March
  {
    date: "03-08", name: "International Women's Day", emoji: "👩",
    content_angle: "Women empowerment, celebrating women, she-economy",
    hashtags: ["#WomensDay", "#IWD", "#WomenEmpowerment", "#HerStory", "#SheLeads"],
    vibe: "inspirational",
  },
  {
    date: "03-14", name: "Holi", emoji: "🎨",
    content_angle: "Colors, celebration, joy, togetherness",
    hashtags: ["#Holi", "#HappyHoli", "#ColorsOfHoli", "#FestivalOfColors", "#HoliVibes"],
    vibe: "festive",
  },
  // April
  {
    date: "04-07", name: "World Health Day", emoji: "🏥",
    content_angle: "Wellness, health, self-care",
    hashtags: ["#WorldHealthDay", "#HealthIsWealth", "#Wellness", "#SelfCare", "#HealthyLiving"],
    vibe: "educational",
  },
  {
    date: "04-14", name: "Ambedkar Jayanti", emoji: "🕊️",
    content_angle: "Equality, social justice, inclusivity",
    hashtags: ["#AmbedkarJayanti", "#Equality", "#SocialJustice", "#Inclusivity", "#JaiBhim"],
    vibe: "inspirational",
  },
  {
    date: "04-22", name: "Earth Day", emoji: "🌍",
    content_angle: "Sustainability, eco-friendly, environment",
    hashtags: ["#EarthDay", "#Sustainability", "#EcoFriendly", "#SaveThePlanet", "#GreenLiving"],
    vibe: "educational",
  },
  // May
  {
    date: "05-01", name: "Labour Day", emoji: "🛠️",
    content_angle: "Hard work, appreciation, team story",
    hashtags: ["#LabourDay", "#MayDay", "#HardWork", "#WorkersDay", "#TeamAppreciation"],
    vibe: "inspirational",
  },
  {
    date: "05-11", name: "Mother's Day", emoji: "💐",
    content_angle: "Gifting for moms, appreciation, love",
    hashtags: ["#MothersDay", "#MomLove", "#GiftForMom", "#MomLife", "#HappyMothersDay"],
    vibe: "emotional",
  },
  // June
  {
    date: "06-05", name: "World Environment Day", emoji: "🌿",
    content_angle: "Sustainability, green choices, eco values",
    hashtags: ["#WorldEnvironmentDay", "#GoGreen", "#Sustainability", "#EcoConscious", "#PlantTrees"],
    vibe: "educational",
  },
  {
    date: "06-15", name: "Father's Day", emoji: "👨",
    content_angle: "Gifting for dads, appreciation, family",
    hashtags: ["#FathersDay", "#DadLove", "#GiftForDad", "#HappyFathersDay", "#DadLife"],
    vibe: "emotional",
  },
  {
    date: "06-21", name: "International Yoga Day", emoji: "🧘",
    content_angle: "Wellness, mindfulness, Indian culture",
    hashtags: ["#YogaDay", "#InternationalYogaDay", "#Mindfulness", "#Wellness", "#YogaLifestyle"],
    vibe: "educational",
  },
  // July
  {
    date: "07-26", name: "Kargil Vijay Diwas", emoji: "🪖",
    content_angle: "Patriotism, bravery, tribute to soldiers",
    hashtags: ["#KargilVijayDiwas", "#JaiHind", "#IndianArmy", "#Salute", "#ProudIndian"],
    vibe: "inspirational",
  },
  // August
  {
    date: "08-15", name: "Independence Day", emoji: "🇮🇳",
    content_angle: "India pride, patriotism, Made in India",
    hashtags: ["#IndependenceDay", "#JaiHind", "#MadeInIndia", "#ProudIndian", "#AzadiKaAmritMahotsav"],
    vibe: "inspirational",
  },
  {
    date: "08-19", name: "Raksha Bandhan", emoji: "🪢",
    content_angle: "Siblings, gifting, love, bonds",
    hashtags: ["#RakshaBandhan", "#Rakhi", "#SiblingLove", "#GiftIdeas", "#RakhiSpecial"],
    vibe: "emotional",
  },
  {
    date: "08-23", name: "Janmashtami", emoji: "🪷",
    content_angle: "Krishna, devotion, Indian culture, sweets",
    hashtags: ["#Janmashtami", "#HappyJanmashtami", "#JaiShreeKrishna", "#Krishna", "#JanmashtamiSpecial"],
    vibe: "festive",
  },
  // September
  {
    date: "09-05", name: "Teachers Day", emoji: "🎓",
    content_angle: "Gratitude, learning, mentorship",
    hashtags: ["#TeachersDay", "#HappyTeachersDay", "#Gratitude", "#GuruShishya", "#ThankYouTeacher"],
    vibe: "inspirational",
  },
  {
    date: "09-17", name: "Ganesh Chaturthi", emoji: "🐘",
    content_angle: "Ganpati, celebration, new beginnings, prosperity",
    hashtags: ["#GaneshChaturthi", "#GanpatiBappaMorya", "#GaneshUtsav", "#Chaturthi", "#BlessedByGanesha"],
    vibe: "festive",
  },
  // October
  {
    date: "10-02", name: "Gandhi Jayanti", emoji: "🕊️",
    content_angle: "Values, simplicity, sustainability, non-violence",
    hashtags: ["#GandhiJayanti", "#Bapu", "#MahatmaGandhi", "#Ahimsa", "#GandhiQuotes"],
    vibe: "inspirational",
  },
  {
    date: "10-20", name: "Navratri / Dussehra", emoji: "🪔",
    content_angle: "Victory of good, celebration, festive season begins",
    hashtags: ["#Navratri", "#Dussehra", "#FestiveSeason", "#GarbaVibes", "#VijayadashamiSpecial"],
    vibe: "festive",
  },
  {
    date: "10-31", name: "Halloween", emoji: "🎃",
    content_angle: "Fun, spooky theme, costume season",
    hashtags: ["#Halloween", "#SpookySeason", "#TrickOrTreat", "#HalloweenVibes", "#SpookyContent"],
    vibe: "entertaining",
  },
  // November
  {
    date: "11-01", name: "Diwali", emoji: "🪔",
    content_angle: "Gifting, celebration, lights, prosperity, festive sales",
    hashtags: ["#Diwali", "#HappyDiwali", "#FestiveOfLights", "#DiwaliGifts", "#DiwaliSale"],
    vibe: "festive",
  },
  {
    date: "11-14", name: "Children's Day", emoji: "🧒",
    content_angle: "Kids, nostalgia, playfulness, inner child",
    hashtags: ["#ChildrensDay", "#BalDiwas", "#InnerChild", "#KidsContent", "#Nostalgia"],
    vibe: "entertaining",
  },
  {
    date: "11-26", name: "Black Friday", emoji: "🛍️",
    content_angle: "Sale, offers, flash deals, urgency",
    hashtags: ["#BlackFriday", "#Sale", "#BlackFridaySale", "#Deals", "#OfferAlert"],
    vibe: "sales",
  },
  // December
  {
    date: "12-01", name: "Cyber Monday", emoji: "💻",
    content_angle: "Online deals, discount, digital shopping",
    hashtags: ["#CyberMonday", "#OnlineSale", "#Deals", "#DigitalShopping", "#CyberMondayDeals"],
    vibe: "sales",
  },
  {
    date: "12-25", name: "Christmas", emoji: "🎄",
    content_angle: "Gifting, celebration, joy, gratitude",
    hashtags: ["#Christmas", "#HappyChristmas", "#MerryChristmas", "#ChristmasGifts", "#Xmas"],
    vibe: "festive",
  },
  {
    date: "12-31", name: "New Year Eve", emoji: "🥂",
    content_angle: "Year in review, celebration, gratitude, new goals",
    hashtags: ["#NewYearEve", "#NYE", "#YearInReview", "#NewYearCountdown", "#Goodbye2025"],
    vibe: "inspirational",
  },
]

export function getUpcomingOccasions(startDate: Date, days: number): Occasion[] {
  const start = new Date(startDate)
  start.setHours(0, 0, 0, 0)
  const upcoming: Occasion[] = []

  for (const occ of INDIAN_OCCASIONS) {
    const [month, day] = occ.date.split("-").map(Number)
    for (let i = 0; i <= days; i++) {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      if (d.getMonth() + 1 === month && d.getDate() === day) {
        upcoming.push(occ)
        break
      }
    }
  }

  return upcoming
}
