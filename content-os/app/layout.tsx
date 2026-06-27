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

export const metadata: Metadata = {
  title: {
    default: "content/os — Stop staring at the blank caption box",
    template: "%s | content/os",
  },
  description:
    "Teach it your brand voice once. Get AI-generated hooks, captions, and on-brand product images for Instagram in seconds.",
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
        <QueryProvider>
          <PostHogProvider>{children}</PostHogProvider>
        </QueryProvider>
      </body>
    </html>
  )
}
