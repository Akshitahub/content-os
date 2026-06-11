import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { QueryProvider } from "@/components/providers/QueryProvider"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: {
    default: "ContentOS — AI Content Operating System for Ecommerce",
    template: "%s | ContentOS",
  },
  description:
    "Generate AI-powered hooks and captions, manage your brand identity, plan content, and track performance — all in one place.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
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
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  )
}
