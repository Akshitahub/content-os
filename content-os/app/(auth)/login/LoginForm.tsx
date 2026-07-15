"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { Loader2, Mail } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription } from "@/components/ui/alert"

const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

type LoginFormData = z.infer<typeof loginSchema>

type Mode = "password" | "magic-link" | "sent"

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get("redirectTo") ?? "/dashboard"
  const urlError = searchParams.get("error")
  const successMessage = searchParams.get("message")

  const [serverError, setServerError] = useState<string | null>(urlError)
  const [isGoogleLoading, setIsGoogleLoading] = useState(false)
  const [mode, setMode] = useState<Mode>("password")
  const [magicLinkLoading, setMagicLinkLoading] = useState(false)
  const [sentToEmail, setSentToEmail] = useState("")

  const {
    register,
    handleSubmit,
    getValues,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  })

  const anyLoading = isSubmitting || isGoogleLoading || magicLinkLoading

  async function onSubmit(data: LoginFormData) {
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })

    if (error) {
      setServerError("Invalid email or password. Please try again.")
      return
    }

    router.push(redirectTo)
    router.refresh()
  }

  async function handleGoogleLogin() {
    setIsGoogleLoading(true)
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback?next=${redirectTo}`,
      },
    })

    if (error) {
      setServerError(error.message)
      setIsGoogleLoading(false)
    }
  }

  async function handleMagicLink() {
    const emailValid = await trigger("email")
    if (!emailValid) return

    const email = getValues("email")
    setMagicLinkLoading(true)
    setServerError(null)
    const supabase = createClient()

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=${redirectTo}`,
      },
    })

    setMagicLinkLoading(false)

    if (error) {
      setServerError(error.message)
      return
    }

    setSentToEmail(email)
    setMode("sent")
  }

  function switchToMagicLink() {
    setServerError(null)
    setMode("magic-link")
  }

  function switchToPassword() {
    setServerError(null)
    setMode("password")
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-1">
        <CardTitle className="text-2xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your SocioPosts account</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {successMessage && (
          <Alert>
            <AlertDescription>{successMessage}</AlertDescription>
          </Alert>
        )}
        {serverError && (
          <Alert variant="destructive">
            <AlertDescription>{serverError}</AlertDescription>
          </Alert>
        )}

        {/* Google OAuth — always visible */}
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={handleGoogleLogin}
          disabled={anyLoading}
        >
          {isGoogleLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
          )}
          Continue with Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <Separator />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with email</span>
          </div>
        </div>

        {/* ── Sent confirmation ── */}
        {mode === "sent" ? (
          <div className="space-y-3 py-2 text-center">
            <div className="flex justify-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
            </div>
            <p className="font-medium">Check your inbox</p>
            <p className="text-sm text-muted-foreground">
              We sent a sign-in link to{" "}
              <span className="font-medium text-foreground">{sentToEmail}</span>.
              Check your spam folder if you don&apos;t see it within a minute.
            </p>
            <button
              type="button"
              onClick={switchToPassword}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Back to password sign-in
            </button>
          </div>
        ) : mode === "password" ? (
          /* ── Password form ── */
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@brand.com"
                autoComplete="email"
                {...register("email")}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="Your password"
                autoComplete="current-password"
                {...register("password")}
                aria-invalid={!!errors.password}
              />
              {errors.password && (
                <p className="text-xs text-destructive">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full" disabled={anyLoading}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Sign in
            </Button>

            <button
              type="button"
              onClick={switchToMagicLink}
              className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Send magic link instead
            </button>
          </form>
        ) : (
          /* ── Magic link form ── */
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email-magic">Email</Label>
              <Input
                id="email-magic"
                type="email"
                placeholder="you@brand.com"
                autoComplete="email"
                {...register("email")}
                aria-invalid={!!errors.email}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email.message}</p>
              )}
            </div>

            <Button
              type="button"
              className="w-full"
              onClick={handleMagicLink}
              disabled={anyLoading}
            >
              {magicLinkLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              Send magic link
            </Button>

            <button
              type="button"
              onClick={switchToPassword}
              className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              ← Back to password sign-in
            </button>
          </div>
        )}

        <p className="text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign up free
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}
