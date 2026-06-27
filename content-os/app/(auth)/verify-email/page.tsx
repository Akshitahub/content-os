"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Mail, CheckCircle2, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { createClient } from "@/lib/supabase/client"

export default function VerifyEmailPage() {
  const searchParams = useSearchParams()
  const email = searchParams.get("email") ?? ""

  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [resendError, setResendError] = useState("")

  async function handleResend() {
    if (!email) return
    setResendState("sending")
    setResendError("")

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/api/auth/callback`,
        },
      })

      if (error) {
        setResendError(error.message)
        setResendState("error")
      } else {
        setResendState("sent")
      }
    } catch {
      setResendError("Something went wrong. Please try again.")
      setResendState("error")
    }
  }

  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader className="space-y-4">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-7 w-7 text-primary" />
        </div>
        <CardTitle className="text-2xl">Check your email</CardTitle>
        <CardDescription className="text-base">
          We sent a confirmation link to{" "}
          {email ? (
            <span className="font-medium text-foreground">{email}</span>
          ) : (
            "your email address"
          )}
          . Click it to activate your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {resendState === "sent" && (
          <Alert className="border-green-200 bg-green-50 text-left">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <AlertDescription className="text-green-700">
              Verification email resent! Check your inbox.
            </AlertDescription>
          </Alert>
        )}

        {resendState === "error" && (
          <Alert variant="destructive" className="text-left">
            <AlertDescription>{resendError}</AlertDescription>
          </Alert>
        )}

        <p className="text-sm text-muted-foreground">
          Didn&apos;t get the email? Check your spam folder, or resend below.
        </p>

        {email && resendState !== "sent" && (
          <Button
            variant="outline"
            className="w-full"
            onClick={handleResend}
            disabled={resendState === "sending"}
          >
            {resendState === "sending" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending…
              </>
            ) : (
              "Resend verification email"
            )}
          </Button>
        )}

        <Button variant="ghost" asChild className="w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>

        {!email && (
          <p className="text-xs text-muted-foreground">
            Wrong email?{" "}
            <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
              Sign up again
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  )
}
