import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service — ContentOS",
  description: "Terms of Service for ContentOS, the AI content operating system for ecommerce brands.",
}

export default function TermsPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Terms of Service
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
        Last updated: June 2026 &nbsp;·&nbsp; Company: ContentOS (Akshita Singh)
      </p>

      <Section title="1. Acceptance of Terms">
        <p>By accessing or using ContentOS (&ldquo;the Service&rdquo;), you agree to be bound by these Terms of Service. If you do not agree, you may not use the Service. These Terms form a binding legal agreement between you and ContentOS (operated by Akshita Singh).</p>
      </Section>

      <Section title="2. Description of Service">
        <p>ContentOS is an AI-powered content generation platform that helps ecommerce brands create hooks, captions, reel scripts, carousels, and other marketing content. The Service includes the Fastlane content planner, influencer discovery tools, brand management features, and related capabilities.</p>
      </Section>

      <Section title="3. Eligibility">
        <p>You must be at least 18 years old to use ContentOS. By using the Service, you represent and warrant that you meet this requirement and that you have the legal capacity to enter into these Terms.</p>
      </Section>

      <Section title="4. User Accounts">
        <p>You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account. You agree to:</p>
        <ul>
          <li>Provide accurate and complete registration information</li>
          <li>Notify us immediately of any unauthorised use of your account</li>
          <li>Not share your account credentials with third parties</li>
          <li>Not create accounts for automated or bot-driven access</li>
        </ul>
        <p>We reserve the right to suspend or terminate accounts that violate these Terms.</p>
      </Section>

      <Section title="5. Acceptable Use">
        <p>You agree not to use ContentOS to:</p>
        <ul>
          <li>Generate content that is unlawful, harmful, abusive, harassing, defamatory, or fraudulent</li>
          <li>Infringe the intellectual property rights of others</li>
          <li>Spread misinformation or deceptive content</li>
          <li>Violate any applicable laws or regulations, including those of India</li>
          <li>Attempt to reverse-engineer, scrape, or abuse the platform&rsquo;s APIs or AI systems</li>
          <li>Resell or sublicense access to the Service without our written consent</li>
        </ul>
        <p>We reserve the right to remove content or suspend accounts that violate these policies.</p>
      </Section>

      <Section title="6. AI-Generated Content">
        <p>ContentOS uses artificial intelligence to generate content suggestions. You acknowledge that:</p>
        <ul>
          <li>AI-generated content may be inaccurate, incomplete, or not suitable for all audiences</li>
          <li>You are solely responsible for reviewing, editing, and approving any content before publishing</li>
          <li>ContentOS does not guarantee the accuracy, originality, or performance of generated content</li>
          <li>You retain full ownership of the final content you publish, subject to our licence below</li>
        </ul>
      </Section>

      <Section title="7. Intellectual Property">
        <p>ContentOS and its original content, features, and technology are owned by Akshita Singh and protected under applicable intellectual property laws. You retain ownership of content you create and publish using the Service.</p>
        <p>By using the Service, you grant ContentOS a limited, non-exclusive, royalty-free licence to process your brand data (URLs, product information, and settings) solely for the purpose of generating content for you. We do not sell or share your brand data with third parties for their own marketing purposes.</p>
      </Section>

      <Section title="8. Subscription and Billing">
        <p>ContentOS offers free and paid subscription plans. Paid plans are billed monthly or annually via Stripe. By subscribing, you agree to:</p>
        <ul>
          <li>Pay all fees associated with your chosen plan</li>
          <li>Provide accurate billing information</li>
          <li>Automatic renewal of your subscription until cancelled</li>
        </ul>
        <p>Refunds are considered on a case-by-case basis. To request a refund, contact us at support@contentos.in within 7 days of a charge. We reserve the right to change pricing with 30 days&rsquo; notice.</p>
      </Section>

      <Section title="9. Cancellation">
        <p>You may cancel your subscription at any time through the Settings page or by contacting support@contentos.in. Cancellation takes effect at the end of the current billing period. You will retain access to paid features until that date.</p>
      </Section>

      <Section title="10. Disclaimers">
        <p>The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind, either express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. ContentOS does not warrant that the Service will be uninterrupted, error-free, or free of harmful components.</p>
      </Section>

      <Section title="11. Limitation of Liability">
        <p>To the maximum extent permitted by applicable law, ContentOS (Akshita Singh) shall not be liable for any indirect, incidental, special, consequential, or punitive damages, including loss of profits, data, or goodwill, arising from your use of or inability to use the Service. Our total liability to you for any cause shall not exceed the amount you paid us in the 3 months preceding the claim.</p>
      </Section>

      <Section title="12. Governing Law and Disputes">
        <p>These Terms are governed by and construed in accordance with the laws of India. Any disputes arising from these Terms or your use of the Service shall be subject to the exclusive jurisdiction of the courts of Delhi, India.</p>
        <p>For any questions or disputes, please contact us first at support@contentos.in — we&rsquo;ll do our best to resolve things informally before any formal proceedings.</p>
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
