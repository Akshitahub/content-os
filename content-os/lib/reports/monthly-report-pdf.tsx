import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer"
import type { AccountInsightsData } from "@/lib/social/instagram-insights"
import type { BestPost } from "@/lib/ai/account-analytics"
import type { RoiTracking } from "@/lib/analytics/roi-tracking"

export interface MonthlyReportData {
  brandName: string
  periodLabel: string
  windowDays: number
  reach: AccountInsightsData["reach"]
  followerGrowth: AccountInsightsData["followerGrowth"]
  engagement: AccountInsightsData["engagement"]
  demographics: AccountInsightsData["demographics"]
  bestPosts: BestPost[]
  aiInsights: string | null
  roi: RoiTracking
}

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 11,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 12,
    color: "#666666",
    marginBottom: 20,
  },
  section: {
    marginBottom: 18,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    marginBottom: 8,
    borderBottom: "1px solid #e5e5e5",
    paddingBottom: 4,
  },
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metric: {
    fontSize: 11,
  },
  metricValue: {
    fontSize: 16,
    fontWeight: 700,
  },
  listItem: {
    fontSize: 10,
    marginBottom: 4,
    lineHeight: 1.4,
  },
  paragraph: {
    fontSize: 10,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  disclosure: {
    fontSize: 8,
    color: "#888888",
    marginTop: 8,
    fontStyle: "italic",
  },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#999999",
    textAlign: "center",
  },
})

/**
 * Builds the <Document> element directly (rather than a wrapping component)
 * since @react-pdf/renderer's renderToBuffer requires a ReactElement<DocumentProps>
 * as its root — it doesn't reconcile a custom component down to one.
 */
export function buildMonthlyReportDocument(data: MonthlyReportData) {
  const { reach, followerGrowth, engagement } = data

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.brandName} — Monthly Report</Text>
        <Text style={styles.subtitle}>{data.periodLabel}</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Performance (last {data.windowDays} days)</Text>
          <View style={styles.metricRow}>
            <View>
              <Text style={styles.metric}>Reach</Text>
              <Text style={styles.metricValue}>
                {reach.available ? reach.value!.total.toLocaleString() : "N/A"}
              </Text>
              {!reach.available && reach.note && <Text style={styles.listItem}>{reach.note}</Text>}
            </View>
            <View>
              <Text style={styles.metric}>Follower change</Text>
              <Text style={styles.metricValue}>
                {followerGrowth.available
                  ? `${followerGrowth.value!.netChange >= 0 ? "+" : ""}${followerGrowth.value!.netChange}`
                  : "N/A"}
              </Text>
              {!followerGrowth.available && followerGrowth.note && <Text style={styles.listItem}>{followerGrowth.note}</Text>}
            </View>
            <View>
              <Text style={styles.metric}>Engagement</Text>
              <Text style={styles.metricValue}>
                {engagement.available ? engagement.value!.totalInteractions.toLocaleString() : "N/A"}
              </Text>
              {!engagement.available && engagement.note && <Text style={styles.listItem}>{engagement.note}</Text>}
            </View>
          </View>
        </View>

        {data.bestPosts.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Best-performing posts</Text>
            {data.bestPosts.map((post, i) => (
              <Text key={post.permalink || post.timestamp || i} style={styles.listItem}>
                {i + 1}. {post.likeCount.toLocaleString()} likes, {post.commentsCount.toLocaleString()} comments
                {post.caption ? ` — "${post.caption.trim().slice(0, 140)}"` : ""}
              </Text>
            ))}
          </View>
        )}

        {data.demographics.available && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Audience demographics</Text>
            {data.demographics.value!.ageRanges.length > 0 && (
              <Text style={styles.listItem}>
                Age: {data.demographics.value!.ageRanges.slice(0, 3).map((a) => `${a.label} (${a.percentage}%)`).join(", ")}
              </Text>
            )}
            {data.demographics.value!.genderSplit.length > 0 && (
              <Text style={styles.listItem}>
                Gender: {data.demographics.value!.genderSplit.map((g) => `${g.label} (${g.percentage}%)`).join(", ")}
              </Text>
            )}
            {data.demographics.value!.topCities.length > 0 && (
              <Text style={styles.listItem}>
                Top cities: {data.demographics.value!.topCities.slice(0, 3).map((c) => `${c.label} (${c.percentage}%)`).join(", ")}
              </Text>
            )}
          </View>
        )}

        {data.aiInsights && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>AI insights & suggestions</Text>
            <Text style={styles.paragraph}>{data.aiInsights}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Time saved (estimate)</Text>
          <Text style={styles.paragraph}>
            {data.roi.totalHoursSaved} hours saved across {data.roi.totalItems} pieces of content generated this period.
          </Text>
          {data.roi.breakdown.filter((b) => b.count > 0).map((b) => (
            <Text key={b.type} style={styles.listItem}>
              {b.label}: {b.count} × {b.minutesPerItem} min = {b.minutesSaved} min
            </Text>
          ))}
          <Text style={styles.disclosure}>{data.roi.disclosure}</Text>
        </View>

        <Text style={styles.footer} fixed>
          Generated by SocioPosts — {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
        </Text>
      </Page>
    </Document>
  )
}
