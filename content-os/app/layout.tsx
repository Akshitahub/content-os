import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { QueryProvider } from "@/components/providers/QueryProvider"
import { PostHogProvider } from "@/components/providers/PostHogProvider"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: "ContentOS — Your brand URL → 30 days of content",
    template: "%s | ContentOS",
  },
  description:
    "ContentOS learns your brand voice from your website and generates hooks, captions, reels, carousels, and ad copy — tailored to you, not templates.",
  keywords: [
    "AI content generation",
    "social media content",
    "brand voice",
    "ecommerce marketing",
    "Instagram captions",
    "content calendar",
    "hooks generator",
    "reel scripts",
  ],
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    url: BASE_URL,
    siteName: "ContentOS",
    title: "ContentOS — Your brand URL → 30 days of content",
    description:
      "ContentOS learns your brand voice from your website and generates hooks, captions, reels, carousels, and ad copy — tailored to you, not templates.",
    images: [{ url: "/og", width: 1200, height: 630, alt: "ContentOS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ContentOS — Your brand URL → 30 days of content",
    description:
      "ContentOS learns your brand voice and generates a full month of on-brand content in one click.",
    images: ["/og"],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <QueryProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
