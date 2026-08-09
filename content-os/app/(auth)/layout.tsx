import type { Metadata } from "next"
import { LogoIcon } from "@/components/shared/LogoIcon"

export const metadata: Metadata = {
  title: {
    default: "Sign in",
    template: "%s | SocioPosts",
  },
}

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        {/* Logo mark */}
        <LogoIcon size={32} />
        <span className="text-xl font-semibold tracking-tight">SocioPosts</span>
      </div>
      {children}
    </div>
  )
}
