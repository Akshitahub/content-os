import type { Metadata } from "next"
import { createAdminClient } from "@/lib/supabase/server"
import { PHOTO_LINK_MAX, verifyPhotoLinkToken } from "@/lib/photo-link-token"
import { PhoneUploader } from "@/components/brands/PhoneUploader"

// The phone side of "Send photos from your phone": opened from the QR code
// or a WhatsApp link, no login (the signed 7-day token names the brand).
// Outside proxy.ts's gated prefixes, so it's public like app/p.

export const metadata: Metadata = { title: "Send photos · SocioPosts", robots: { index: false, follow: false } }

type PageProps = { params: Promise<{ token: string }> }

export default async function SendPhotosPage({ params }: PageProps) {
  const { token } = await params
  const link = verifyPhotoLinkToken(token)
  let brandName: string | null = null
  if (link) {
    const admin = await createAdminClient()
    const { data } = await admin.from("brands").select("name").eq("id", link.brandId).maybeSingle<{ name: string }>()
    brandName = data?.name ?? null
  }

  return (
    <main className="min-h-dvh bg-neutral-50 px-4 py-8 text-neutral-900">
      <div className="mx-auto max-w-md">
        <p className="text-xs font-semibold uppercase tracking-wide text-violet-600">SocioPosts</p>
        {link && brandName ? (
          <>
            <h1 className="mt-2 text-2xl font-bold">Photos for {brandName}</h1>
            <p className="mt-2 text-sm text-neutral-600">
              Pick or shoot up to {PHOTO_LINK_MAX} real photos: your products being used, your shop, your team, happy customers.
              We use the good ones in your posts and stories.
            </p>
            <PhoneUploader token={token} max={PHOTO_LINK_MAX} />
          </>
        ) : (
          <>
            <h1 className="mt-2 text-2xl font-bold">This link has expired</h1>
            <p className="mt-2 text-sm text-neutral-600">Links work for 7 days. Open your brand page in SocioPosts on your computer for a fresh one.</p>
          </>
        )}
      </div>
    </main>
  )
}
