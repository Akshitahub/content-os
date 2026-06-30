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

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://content-os-mu-kohl.vercel.app"

export const metadata: Metadata = {
  title: "ContentOS — AI Content Generator for Indian D2C Brands & Creators",
  description:
    "Turn your brand's website into 30 days of Instagram content in seconds. AI-powered hooks, captions, carousels, ad creatives and more — built for Indian D2C brands and creators.",
  keywords: [
    "AI content generator India",
    "Instagram content calendar",
    "D2C content marketing",
    "AI Instagram post generator",
    "content generation tool India",
    "social media content AI",
  ],
  metadataBase: new URL(BASE_URL),
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "ContentOS — AI Content Generator for Indian D2C Brands",
    description: "Turn your brand's website into 30 days of Instagram content in seconds.",
    url: BASE_URL,
    siteName: "ContentOS",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    locale: "en_IN",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ContentOS — AI Content Generator for Indian D2C Brands",
    description: "Turn your brand's website into 30 days of Instagram content in seconds.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
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
