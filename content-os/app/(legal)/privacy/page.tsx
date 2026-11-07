import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "SocioPosts Privacy Policy",
  description: "Privacy Policy for SocioPosts, the AI content operating system for ecommerce brands.",
}

export default function PrivacyPage() {
  return (
    <article className="prose prose-gray max-w-none">
      <h1 style={{ fontFamily: "Georgia, serif", fontSize: "2rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Privacy Policy
      </h1>
      <p style={{ color: "#6b7280", fontSize: "0.9rem", marginBottom: "2.5rem" }}>
        Last updated: November 2026 &nbsp;·&nbsp; Contact: socioposts@gmail.com
      </p>

      <Section title="1. Who We Are">
        <p>SocioPosts is operated by Akshita Singh. This Privacy Policy explains how we collect, use, and protect your personal data when you use our Service. &ldquo;We,&rdquo; &ldquo;us,&rdquo; and &ldquo;our&rdquo; refer to SocioPosts/Akshita Singh. &ldquo;You&rdquo; refers to you, the user of our Service.</p>
        <p>For privacy-related queries, contact us at <a href="mailto:socioposts@gmail.com" style={{ color: "#6366f1" }}>socioposts@gmail.com</a>.</p>
      </Section>

      <Section title="2. Information We Collect">
        <p>We collect the following categories of information:</p>
        <ul>
          <li><strong>Account information:</strong> Your name, email address, and password (stored securely via Supabase Auth)</li>
          <li><strong>Brand profiles:</strong> Brand names, niches, voice, colours, logos, products, and the other brand details you provide or confirm</li>
          <li><strong>Website and product URLs, and what we read from them:</strong> When you give us a website, product page, or Instagram handle, we fetch those pages and keep the text, product details, and images we extract from them for your brand</li>
          <li><strong>Uploaded photos:</strong> Product photos, logos, and photos you send us (including from your phone), stored in our storage</li>
          <li><strong>Generated content:</strong> The captions, posts, images, carousels, stories, scripts, and other content you create with SocioPosts, and your edits to it</li>
          <li><strong>Connected social accounts:</strong> The accounts you connect for publishing and analytics. Access tokens are stored server-side only (encrypted where we hold them ourselves) and are never sent to your browser</li>
          <li><strong>Usage data:</strong> Content generated, features used, and generation counts</li>
          <li><strong>Billing information:</strong> Your plan and payment records. Payments are handled by Razorpay; we never see or store your card or UPI details</li>
          <li><strong>Technical data:</strong> IP address, browser type, and device information collected automatically, including in security logs</li>
          <li><strong>Product analytics:</strong> Product usage events (via PostHog)</li>
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
        <p>We don&rsquo;t use your data or the content you generate in our marketing, demos, or public showcases without your written permission.</p>
      </Section>

      <Section title="4. Third-Party Services">
        <p>SocioPosts uses the following third-party services (processors). Here is what each one receives:</p>
        <ul>
          <li><strong>Supabase</strong>: Our database, authentication, and file storage. It holds your account, brand profiles, generated content, uploaded and collected photos, and connected-account records.</li>
          <li><strong>Vercel</strong>: Hosting. Every request to SocioPosts passes through it.</li>
          <li><strong>Groq</strong>: AI text generation (hooks, captions, hashtags, carousels, stories, reel scripts, content strategy), AI image analysis (reading photos you upload or we collect for your brand, and checking generated images), and AI voice generation (reel voiceovers). It receives your brand details, the text and prompts for each generation, and the images being analysed.</li>
          <li><strong>OpenAI</strong>: AI image generation (gpt-image-2, for post, carousel, and story images). It receives the image prompt written from your brand and content details and, when you use one, your product or reference photo.</li>
          <li><strong>Razorpay</strong>: Payment processing (PCI-DSS compliant). It receives what&rsquo;s needed to take the payment; your card or UPI details go to Razorpay, not to us.</li>
          <li><strong>Resend</strong>: Email delivery. It receives your email address and the content of the emails we send you (e.g. verification, receipts).</li>
          <li><strong>Zernio</strong>: Publishing to and reading analytics from Instagram, Threads, Pinterest, LinkedIn, YouTube, and Twitter/X for accounts connected through it. It receives the posts you schedule (text and media) and holds the connection to those accounts.</li>
          <li><strong>Meta</strong>: Publishing to and reading analytics from Instagram for accounts connected to Meta directly. It receives the posts you schedule (text and media).</li>
          <li><strong>PostHog</strong>: Product analytics. It receives product usage events.</li>
          <li><strong>Remove.bg</strong>: Background removal. It receives the product photos being cut out.</li>
          <li><strong>PiAPI (Kling)</strong> and <strong>JSON2Video</strong>: Reel video generation and rendering. They receive the scene prompts, voiceover audio, and media for your reels.</li>
        </ul>
        <p>AI providers (Groq, OpenAI) process data through their APIs under their API terms. Each of these services has its own privacy policy and terms; we encourage you to review them for the services relevant to your use.</p>
      </Section>

      <Section title="5. Data Retention">
        <p>We keep your data for as long as your account is active.</p>
        <p>When you delete your account, we delete your brand data, generated content, and the files in our storage (uploaded photos, logos, and generated images) within 30 days. Copies in our providers&rsquo; backups roll off on those providers&rsquo; own backup schedules.</p>
        <p>Security audit logs (for example sign-ins to admin tools, account and brand deletions, and social account connections) are kept for 12 months.</p>
        <p>We keep records we&rsquo;re legally required to keep, such as billing and payment records, for as long as the law requires.</p>
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
        <p>To exercise any of these rights, including asking for an export or deletion of your data, email us at <a href="mailto:socioposts@gmail.com" style={{ color: "#6366f1" }}>socioposts@gmail.com</a>. We will respond within 30 days. You can also delete your account yourself from your account settings.</p>
      </Section>

      <Section title="7. Cookies and Tracking">
        <p>SocioPosts uses cookies and similar technologies for:</p>
        <ul>
          <li>Authentication (session cookies via Supabase)</li>
          <li>Product analytics (PostHog)</li>
        </ul>
        <p>We do not use third-party advertising cookies. You can control cookies through your browser settings, though disabling authentication cookies will prevent you from logging in.</p>
      </Section>

      <Section title="8. Data Security">
        <p>We implement industry-standard security measures including TLS encryption in transit, encrypted storage at rest (via Supabase), and role-level security (RLS) on all database tables. Access to production data is restricted to authorised personnel only.</p>
        <p>No system is completely secure. In the event of a data breach affecting your personal data, we will notify you and relevant authorities as required by applicable law.</p>
      </Section>

      <Section title="9. Changes to This Policy">
        <p>We may update this Privacy Policy from time to time. We will notify you of material changes by email or by posting a notice on the Service at least 14 days before the changes take effect. Your continued use of the Service after the effective date constitutes your acceptance of the updated policy.</p>
        <p>For questions about this Privacy Policy, contact us at <a href="mailto:socioposts@gmail.com" style={{ color: "#6366f1" }}>socioposts@gmail.com</a>.</p>
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
