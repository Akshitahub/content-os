import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy — SocioPosts",
  description: "Privacy Policy for SocioPosts, the AI content operating system for ecommerce brands.",
}

export default function PrivacyPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Privacy Policy
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
        Last updated: June 2026 &nbsp;·&nbsp; Contact: privacy@contentos.in
      </p>

      <Section title="1. Who We Are">
        <p>SocioPosts is operated by Akshita Singh. This Privacy Policy explains how we collect, use, and protect your personal data when you use our Service. &ldquo;We,&rdquo; &ldquo;us,&rdquo; and &ldquo;our&rdquo; refer to SocioPosts/Akshita Singh. &ldquo;You&rdquo; refers to you, the user of our Service.</p>
        <p>For privacy-related queries, contact us at <a href="mailto:privacy@contentos.in" style={{ color: "#6366f1" }}>privacy@contentos.in</a>.</p>
      </Section>

      <Section title="2. Information We Collect">
        <p>We collect the following categories of information:</p>
        <ul>
          <li><strong>Account information:</strong> Your name, email address, and password (stored securely via Supabase Auth)</li>
          <li><strong>Brand data:</strong> Website URLs, brand names, niches, and product information you provide</li>
          <li><strong>Usage data:</strong> Content generated, features used, and generation counts</li>
          <li><strong>Billing information:</strong> Subscription plan and payment method details (handled by Stripe — we do not store raw card numbers)</li>
          <li><strong>Technical data:</strong> IP address, browser type, and device information collected automatically</li>
          <li><strong>Analytics data:</strong> Anonymised product usage events (via PostHog)</li>
        </ul>
      </Section>

      <Section title="3. How We Use Your Information">
        <p>We use your information to:</p>
        <ul>
          <li>Provide and improve the SocioPosts Service</li>
          <li>Generate AI content tailored to your brand voice</li>
          <li>Process payments and manage your subscription</li>
          <li>Send transactional emails (account verification, billing receipts)</li>
          <li>Detect and prevent fraud or abuse</li>
          <li>Analyse product usage to improve features (using aggregated, anonymised data)</li>
          <li>Comply with applicable legal obligations</li>
        </ul>
        <p>We do not sell your personal data to third parties. We do not use your brand data or generated content to train our AI models without your explicit consent.</p>
      </Section>

      <Section title="4. Third-Party Services">
        <p>SocioPosts uses the following third-party services that may process your data:</p>
        <ul>
          <li><strong>Supabase</strong> — Database and authentication (data stored in EU region)</li>
          <li><strong>Stripe</strong> — Payment processing (PCI-DSS compliant)</li>
          <li><strong>NVIDIA NIM / AI services</strong> — AI model inference for content generation</li>
          <li><strong>Pollinations.ai</strong> — AI image generation</li>
          <li><strong>Remove.bg</strong> — Background removal for product images</li>
          <li><strong>PostHog</strong> — Product analytics (anonymised usage events)</li>
          <li><strong>Resend</strong> — Transactional email delivery</li>
          <li><strong>Vercel</strong> — Hosting and edge infrastructure</li>
        </ul>
        <p>Each of these services has its own privacy policy. We encourage you to review them for the services relevant to your use.</p>
      </Section>

      <Section title="5. Data Retention">
        <p>We retain your data for as long as your account is active or as needed to provide the Service. If you delete your account, we will delete your personal data within 30 days, except where we are required to retain it for legal or compliance reasons (e.g., billing records, which we retain for 7 years as required under Indian tax law).</p>
      </Section>

      <Section title="6. Your Rights">
        <p>Depending on your location, you may have the following rights:</p>
        <ul>
          <li><strong>Access:</strong> Request a copy of the data we hold about you</li>
          <li><strong>Correction:</strong> Request correction of inaccurate data</li>
          <li><strong>Deletion:</strong> Request deletion of your account and associated data</li>
          <li><strong>Portability:</strong> Request an export of your data in a machine-readable format</li>
          <li><strong>Objection:</strong> Object to certain processing activities</li>
        </ul>
        <p>To exercise any of these rights, email us at <a href="mailto:privacy@contentos.in" style={{ color: "#6366f1" }}>privacy@contentos.in</a>. We will respond within 30 days.</p>
      </Section>

      <Section title="7. Cookies and Tracking">
        <p>SocioPosts uses cookies and similar technologies for:</p>
        <ul>
          <li>Authentication (session cookies via Supabase)</li>
          <li>Analytics (PostHog, anonymised)</li>
        </ul>
        <p>We do not use third-party advertising cookies. You can control cookies through your browser settings, though disabling authentication cookies will prevent you from logging in.</p>
      </Section>

      <Section title="8. Data Security">
        <p>We implement industry-standard security measures including TLS encryption in transit, encrypted storage at rest (via Supabase), and role-level security (RLS) on all database tables. Access to production data is restricted to authorised personnel only.</p>
        <p>No system is completely secure. In the event of a data breach affecting your personal data, we will notify you and relevant authorities as required by applicable law.</p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by posting a notice on the Service at least 14 days before the changes take effect. Your continued use of the Service after the effective date constitutes your acceptance of the updated policy.</p>
        <p>For questions about this Privacy Policy, contact us at <a href="mailto:privacy@contentos.in" style={{ color: "#6366f1" }}>privacy@contentos.in</a>.</p>
      </Section>
    </article>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: "2rem" }}>
      <h2 style={{ fontSize: "1.15rem", fontWeight: 700, marginBottom: "0.75rem", fontFamily: "Georgia, serif" }}>
        {title}
      </h2>
      <div style={{ lineHeight: 1.75, color: "#374151", fontSize: "0.95rem" }}>{children}</div>
    </section>
  )
}
