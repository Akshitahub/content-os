export interface IndianOccasion {
  date: string // MM-DD
  name: string
  content_angle: string
}

export const INDIAN_OCCASIONS: IndianOccasion[] = [
  // January
  { date: "01-01", name: "New Year", content_angle: "New beginnings, resolutions, fresh start" },
  { date: "01-14", name: "Makar Sankranti", content_angle: "Harvest, kites, sesame sweets, new season" },
  { date: "01-15", name: "Pongal", content_angle: "Harvest festival, South Indian celebration, gratitude" },
  { date: "01-23", name: "Netaji Birthday", content_angle: "Patriotism, courage, leadership" },
  { date: "01-26", name: "Republic Day", content_angle: "Patriotism, India pride, unity" },
  // February
  { date: "02-14", name: "Valentine's Day", content_angle: "Love, gifting, couples, self-love" },
  { date: "02-19", name: "Shivaji Jayanti", content_angle: "Valor, heritage, Maharashtra pride" },
  // March
  { date: "03-08", name: "International Women's Day", content_angle: "Women empowerment, celebrating women, she-economy" },
  { date: "03-22", name: "World Water Day", content_angle: "Sustainability, conservation, mindful living" },
  { date: "03-25", name: "Holi", content_angle: "Colors, celebration, joy, togetherness" },
  // April
  { date: "04-01", name: "April Fool's Day", content_angle: "Humor, light-heartedness, fun brand personality" },
  { date: "04-07", name: "World Health Day", content_angle: "Wellness, health, self-care" },
  { date: "04-14", name: "Ambedkar Jayanti", content_angle: "Equality, social justice, inclusivity" },
  { date: "04-14", name: "Tamil New Year / Vishu", content_angle: "New beginnings, South Indian celebration" },
  { date: "04-22", name: "Earth Day", content_angle: "Sustainability, eco-friendly, environment" },
  // May
  { date: "05-01", name: "Labour Day", content_angle: "Hard work, appreciation, team story" },
  { date: "05-11", name: "Mother's Day", content_angle: "Gifting for moms, appreciation, love" },
  // June
  { date: "06-05", name: "World Environment Day", content_angle: "Sustainability, green choices, eco values" },
  { date: "06-15", name: "Father's Day", content_angle: "Gifting for dads, appreciation, family" },
  { date: "06-21", name: "International Yoga Day", content_angle: "Wellness, mindfulness, Indian culture" },
  // July
  { date: "07-26", name: "Kargil Vijay Diwas", content_angle: "Patriotism, bravery, tribute to soldiers" },
  // August
  { date: "08-12", name: "International Youth Day", content_angle: "Youth, ambition, next generation" },
  { date: "08-15", name: "Independence Day", content_angle: "India pride, patriotism, Made in India" },
  { date: "08-19", name: "Raksha Bandhan", content_angle: "Siblings, gifting, love, bonds" },
  { date: "08-23", name: "Janmashtami", content_angle: "Krishna, devotion, Indian culture, sweets" },
  // September
  { date: "09-05", name: "Teachers Day", content_angle: "Gratitude, learning, mentorship" },
  { date: "09-17", name: "Ganesh Chaturthi", content_angle: "Ganpati, celebration, new beginnings, prosperity" },
  // October
  { date: "10-02", name: "Gandhi Jayanti", content_angle: "Values, simplicity, sustainability, non-violence" },
  { date: "10-20", name: "Dussehra", content_angle: "Victory of good, celebration, festive season begins" },
  { date: "10-20", name: "Navratri", content_angle: "Festive, celebration, tradition, dance" },
  { date: "10-31", name: "Halloween", content_angle: "Fun, spooky theme, costume season" },
  // November
  { date: "11-01", name: "Diwali", content_angle: "Gifting, celebration, lights, prosperity, festive sales" },
  { date: "11-13", name: "Bhai Dooj", content_angle: "Siblings, gifting, brother-sister bond" },
  { date: "11-14", name: "Children's Day", content_angle: "Kids, nostalgia, playfulness, inner child" },
  { date: "11-19", name: "International Men's Day", content_angle: "Men's wellness, brotherhood, appreciation" },
  { date: "11-26", name: "Black Friday", content_angle: "Sale, offers, flash deals, urgency" },
  // December
  { date: "12-01", name: "Cyber Monday", content_angle: "Online deals, discount, digital shopping" },
  { date: "12-10", name: "Human Rights Day", content_angle: "Equality, values, social impact" },
  { date: "12-24", name: "Christmas Eve", content_angle: "Gifting, celebration, festive mood" },
  { date: "12-25", name: "Christmas", content_angle: "Gifting, celebration, joy, gratitude" },
  { date: "12-31", name: "New Year Eve", content_angle: "Year in review, celebration, gratitude, new goals" },
]

export const SPORTS_OCCASIONS = [
  { name: "IPL Season", months: [3, 4, 5], content_angle: "Cricket fever, team spirit, India" },
  { name: "ICC World Cup", months: [10, 11], content_angle: "India cricket, national pride, unity" },
  { name: "Olympics", months: [7, 8], content_angle: "Sport, achievement, India on world stage" },
  { name: "FIFA World Cup", months: [11, 12], content_angle: "Football fever, global sport" },
]

export function getUpcomingOccasions(daysAhead = 30): IndianOccasion[] {
  const today = new Date()
  const upcoming: IndianOccasion[] = []
  for (const occ of INDIAN_OCCASIONS) {
    const [month, day] = occ.date.split("-").map(Number)
    for (let i = 0; i <= daysAhead; i++) {
      const d = new Date(today)
      d.setDate(today.getDate() + i)
      if (d.getMonth() + 1 === month && d.getDate() === day) {
        upcoming.push(occ)
        break
      }
    }
  }
  return upcoming
}
